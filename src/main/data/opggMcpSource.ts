import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ChampionCatalog } from "../catalog/championCatalog";
import { APP_VERSION } from "../../shared/appInfo";
import type { DamageStyle } from "../../shared/championAttributes";
import type { ChampionRef, Role } from "../../shared/types";
import type {
  ChampionAnalysis,
  ChampionSynergyAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "./metaDataSource";

type OpggPosition = "top" | "jungle" | "mid" | "adc" | "support";

interface OpggMcpSourceOptions {
  endpoint?: string;
  lang?: string;
  maxConcurrentRequests?: number;
  analysisCacheTtlMs?: number;
}

interface CounterRow {
  championId: number;
  championName: string;
  play: number;
  win: number;
  winRate: number;
}

interface SynergyRow {
  championId: number;
  championName: string;
  synergyChampionId: number;
  synergyChampionName: string;
  synergyPosition: string;
  scoreRank: number;
  score: number;
  play: number;
  win: number;
  winRate: number;
  synergyTier: number | null;
}

interface LaneMetaRow {
  championName: string;
  winRate: number;
  pickRate: number;
  tier: number;
  play: number;
  roleRate: number;
}

interface AnalysisCacheEntry {
  expiresAt: number;
  text: Promise<string>;
}

const DEFAULT_ENDPOINT = "https://mcp-api.op.gg/mcp";
const TOOL_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;
const DEFAULT_ANALYSIS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NO_NOTABLE_SYNERGY_SCORE = 0.5;
const MIN_NOTABLE_SYNERGY_GAMES = 500;
const SYNERGY_SAMPLE_PSEUDO_GAMES = 500;
const SYNERGY_HIGH_SAMPLE_GAMES = 1500;
const SYNERGY_WIN_RATE_TIE_BREAK_SPREAD = 0.06;
const SYNERGY_TIER_STRENGTH: Record<number, number> = {
  0: 0.9,
  1: 0.78,
  2: 0.64,
  3: 0.52,
  4: 0.42,
};
const positions: OpggPosition[] = ["top", "jungle", "mid", "adc", "support"];
const laneMetaFields =
  "champion,is_rip,play,win,kill,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev,rank_prev_patch";
const synergyFields =
  "champion_id,champion_name,position,synergy_champion_id,synergy_champion_name,synergy_position,score_rank,score,play,win,win_rate";
const analysisSynergyFields = positions.flatMap((synergyPosition) => [
  `data.synergies.${synergyPosition}[].{${synergyFields}}`,
  `data.synergies.${synergyPosition}[].synergy_tier_data.{tier,rank,rank_prev,rank_prev_patch}`,
]);

export class OpggMcpSource implements MetaDataSource {
  private readonly endpoint: string;
  private readonly lang: string;
  private readonly championsByNormalizedName: Map<string, ChampionRef>;
  private readonly knownChampionPositions = new Map<number, OpggPosition>();
  private clientPromise: Promise<Client> | null = null;
  private roleFitTablePromise: Promise<Map<number, RoleFit>> | null = null;
  private readonly analysisTextByChampionPosition = new Map<string, AnalysisCacheEntry>();
  private readonly requestLimiter: ConcurrentRequestLimiter;
  private readonly analysisCacheTtlMs: number;
  private catalogRefreshAttempted = false;

  constructor(
    private readonly catalog: ChampionCatalog,
    options: OpggMcpSourceOptions = {},
  ) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.lang = options.lang ?? "en_US";
    this.requestLimiter = new ConcurrentRequestLimiter(
      options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    );
    this.analysisCacheTtlMs =
      options.analysisCacheTtlMs ?? DEFAULT_ANALYSIS_CACHE_TTL_MS;
    this.championsByNormalizedName = new Map();
    this.rebuildChampionLookup();
  }

  async getLaneMeta(role: Role, _region: string, _rank: string): Promise<LaneMetaEntry[]> {
    const position = toOpggPosition(role);
    const text = await this.callToolText("lol_list_lane_meta_champions", {
      lang: this.lang,
      position,
      desired_output_fields: [
        `data.positions.${position}[].{${laneMetaFields}}`,
      ],
    });

    const entries: LaneMetaEntry[] = [];

    for (const row of parseLaneMetaRows(text, position)) {
      const champion = await this.resolveChampion(row.championName);

      if (champion.id <= 0) {
        continue;
      }

      this.knownChampionPositions.set(champion.id, position);
      entries.push({
        champion,
        winRate: row.winRate,
        tier: row.tier,
        pickRate: row.pickRate,
        play: row.play,
        roleRate: row.roleRate,
      });
    }

    return entries;
  }

  async getMatchup(
    candidate: ChampionRef,
    opponent: ChampionRef,
    role: Role,
    _region: string,
    _rank: string,
  ): Promise<MatchupResult> {
    const position = toOpggPosition(role);

    try {
      const analysisResult = await this.getAnalysisMatchup(candidate, opponent, position);

      if (analysisResult.winRate !== null) {
        return analysisResult;
      }
    } catch {
      // The lane guide below remains available when full analysis fails.
    }

    try {
      const guideText = await this.callToolText("lol_get_lane_matchup_guide", {
        lang: this.lang,
        position,
        my_champion: toOpggChampionToken(candidate),
        opponent_champion: toOpggChampionToken(opponent),
      });
      const guideResult = parseMatchupGuide(guideText, opponent);

      if (guideResult.winRate !== null) {
        return guideResult;
      }
    } catch {
      // No direct lane result is available.
    }

    return { winRate: null };
  }

  async getSynergy(
    a: ChampionRef,
    b: ChampionRef,
    _region: string,
    _rank: string,
    aRole?: Role | null,
    bRole?: Role | null,
  ): Promise<SynergyResult> {
    const aPosition = aRole ? toOpggPosition(aRole) : this.knownChampionPositions.get(a.id) ?? guessPosition(a);

    if (!aPosition) {
      return { score: null };
    }

    const bPosition = bRole ? toOpggPosition(bRole) : this.knownChampionPositions.get(b.id) ?? guessPosition(b);
    const results: SynergyResult[] = [];
    const directResult = await this.findAnalysisSynergy(a, aPosition, b, bPosition);

    if (directResult.score !== null) {
      results.push(directResult);
    }

    if (bPosition) {
      const reverseResult = await this.findAnalysisSynergy(b, bPosition, a, aPosition);

      if (reverseResult.score !== null) {
        results.push(reverseResult);
      }
    }

    if (results.length === 0) {
      return {
        score: NO_NOTABLE_SYNERGY_SCORE,
        notable: false,
      };
    }

    return results.sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0];
  }

  async getChampionRoleFit(
    champion: ChampionRef,
    _region: string,
    _rank: string,
  ): Promise<RoleFit> {
    const table = await this.getRoleFitTable();

    return table.get(champion.id) ?? createEmptyRoleFit();
  }

  async getChampionAnalysis(
    champion: ChampionRef,
    role: Role,
    _region: string,
    _rank: string,
  ): Promise<ChampionAnalysis> {
    const text = await this.getAnalysisText(champion, toOpggPosition(role));

    return {
      damageStyle: parseAnalysisDamageStyle(text),
      synergies: parseSynergyRows(text).map(createChampionSynergyAnalysis),
    };
  }

  async warmUp(): Promise<void> {
    await this.getClient();
  }

  async close(): Promise<void> {
    if (!this.clientPromise) {
      return;
    }

    const clientPromise = this.clientPromise;
    this.clientPromise = null;

    try {
      const client = await clientPromise;
      await client.close();
    } catch {
      // A failed connection has no open client to close.
    }
  }

  private async getAnalysisMatchup(
    candidate: ChampionRef,
    opponent: ChampionRef,
    position: OpggPosition,
  ): Promise<MatchupResult> {
    const text = await this.getAnalysisText(candidate, position);
    const { weakCounters, strongCounters } = parseAnalysisCounters(text);
    const weakMatch = weakCounters.find((counter) =>
      matchesChampion(counter.championId, counter.championName, opponent),
    );

    if (weakMatch) {
      return {
        winRate: weakMatch.winRate,
        sampleNote: `${weakMatch.play.toLocaleString()} games`,
      };
    }

    const strongMatch = strongCounters.find((counter) =>
      matchesChampion(counter.championId, counter.championName, opponent),
    );

    if (strongMatch) {
      return {
        winRate: clamp01(1 - strongMatch.winRate),
        sampleNote: `${strongMatch.play.toLocaleString()} games`,
      };
    }

    return { winRate: null };
  }

  private async findAnalysisSynergy(
    champion: ChampionRef,
    championPosition: OpggPosition,
    partner: ChampionRef,
    partnerPosition?: OpggPosition | null,
  ): Promise<SynergyResult> {
    try {
      const rows = await this.getAnalysisSynergyRows(champion, championPosition, partnerPosition);
      const matched = rows.find((row) =>
        matchesChampion(row.synergyChampionId, row.synergyChampionName, partner),
      );

      return matched ? createSynergyResult(matched) : { score: null };
    } catch {
      return { score: null };
    }
  }

  private getAnalysisSynergyRows(
    champion: ChampionRef,
    championPosition: OpggPosition,
    partnerPosition?: OpggPosition | null,
  ): Promise<SynergyRow[]> {
    return this.getAnalysisText(champion, championPosition).then((text) => {
      const rows = parseSynergyRows(text);

      if (!partnerPosition) {
        return rows;
      }

      return rows.filter(
        (row) => row.synergyPosition.toLowerCase() === partnerPosition,
      );
    });
  }

  private getAnalysisText(
    champion: ChampionRef,
    championPosition: OpggPosition,
  ): Promise<string> {
    const cacheKey = `${this.catalog.version()}:${champion.id}:${championPosition}`;
    const cached = this.analysisTextByChampionPosition.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }

    const promise = this.callToolText("lol_get_champion_analysis", {
      game_mode: "ranked",
      champion: toOpggChampionToken(champion),
      position: championPosition,
      lang: this.lang,
      desired_output_fields: [
        "data.{damage_type,mythic_items}",
        "data.weak_counters[].{champion_id,champion_name,play,win,win_rate}",
        "data.strong_counters[].{champion_id,champion_name,play,win,win_rate}",
        ...analysisSynergyFields,
      ],
    }).catch((error) => {
      this.analysisTextByChampionPosition.delete(cacheKey);
      throw error;
    });

    this.analysisTextByChampionPosition.set(cacheKey, {
      expiresAt: Date.now() + this.analysisCacheTtlMs,
      text: promise,
    });
    return promise;
  }

  private async getRoleFitTable(): Promise<Map<number, RoleFit>> {
    if (!this.roleFitTablePromise) {
      this.roleFitTablePromise = this.loadRoleFitTable();
    }

    return this.roleFitTablePromise;
  }

  private async loadRoleFitTable(): Promise<Map<number, RoleFit>> {
    const text = await this.callToolText("lol_list_lane_meta_champions", {
      lang: this.lang,
      position: "all",
      desired_output_fields: positions.map(
        (position) => `data.positions.${position}[].{${laneMetaFields}}`,
      ),
    });
    const rowsByPosition = parseAllLaneMetaRows(text);
    const rawWeightsByChampion = new Map<number, Partial<Record<Role, number>>>();

    for (const position of positions) {
      const role = fromOpggPosition(position);

      for (const row of rowsByPosition[position]) {
        const champion = await this.resolveChampion(row.championName);

        if (champion.id <= 0) {
          continue;
        }

        const rawWeight =
          row.roleRate && row.roleRate > 0
            ? row.roleRate
            : row.play && row.play > 0
              ? row.play
              : row.pickRate;
        const existing = rawWeightsByChampion.get(champion.id) ?? {};
        existing[role] = rawWeight;
        rawWeightsByChampion.set(champion.id, existing);
      }
    }

    return new Map(
      [...rawWeightsByChampion.entries()].map(([championId, rawWeights]) => [
        championId,
        normalizeRoleFit(rawWeights),
      ]),
    );
  }

  private async callToolText(name: string, args: Record<string, unknown>): Promise<string> {
    return this.requestLimiter.run(async () => {
      const client = await this.getClient();
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: TOOL_REQUEST_TIMEOUT_MS },
      );
      const text = extractToolText(result);

      if (!text) {
        throw new Error(`OP.GG tool ${name} returned no text content`);
      }

      return text;
    });
  }

  private async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }

    return this.clientPromise;
  }

  private async connect(): Promise<Client> {
    const client = new Client({ name: "draft-coach", version: APP_VERSION });
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint));
    await client.connect(transport);
    return client;
  }

  private findChampion(name: string): ChampionRef | null {
    return this.championsByNormalizedName.get(normalizeLookupName(name)) ?? null;
  }

  private async resolveChampion(name: string): Promise<ChampionRef> {
    const champion = this.findChampion(name);

    if (champion) {
      return champion;
    }

    if (!this.catalogRefreshAttempted) {
      this.catalogRefreshAttempted = true;

      try {
        await this.catalog.refresh();
        this.rebuildChampionLookup();
      } catch (error) {
        console.warn("[OP.GG] Data Dragon refresh failed", toError(error).message);
      }

      const refreshedChampion = this.findChampion(name);

      if (refreshedChampion) {
        return refreshedChampion;
      }
    }

    console.warn(`[OP.GG] unresolved champion "${name}" after Data Dragon refresh`);
    return createUnresolvedChampion(name);
  }

  private rebuildChampionLookup(): void {
    this.championsByNormalizedName.clear();

    for (const champion of this.catalog.all()) {
      this.championsByNormalizedName.set(normalizeLookupName(champion.name), champion);
    }
  }
}

class ConcurrentRequestLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("OP.GG request concurrency must be a positive integer");
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

function parseLaneMetaRows(
  text: string,
  position: OpggPosition,
): LaneMetaRow[] {
  const className = toPositionClassName(position);

  return filterLaneMetaRows(parseLaneMetaRowConstructors(text, className));
}

function parseAllLaneMetaRows(text: string): Record<OpggPosition, LaneMetaRow[]> {
  const emptyRows: Record<OpggPosition, LaneMetaRow[]> = {
    top: [],
    jungle: [],
    mid: [],
    adc: [],
    support: [],
  };
  const positionsArgs = findConstructorArguments(text, "Positions")[0];

  if (!positionsArgs) {
    return emptyRows;
  }

  const positionLists = splitTopLevel(positionsArgs);

  return {
    top: parseLaneMetaPositionList(text, positionLists[0] ?? "", "Top"),
    jungle: parseLaneMetaPositionList(text, positionLists[1] ?? "", "Jungle"),
    mid: parseLaneMetaPositionList(text, positionLists[2] ?? "", "Mid"),
    adc: parseLaneMetaPositionList(text, positionLists[3] ?? "", "Adc"),
    support: parseLaneMetaPositionList(text, positionLists[4] ?? "", "Support"),
  };
}

function parseLaneMetaPositionList(
  classText: string,
  rowsText: string,
  preferredClassName: string,
): LaneMetaRow[] {
  const classNames = [preferredClassName, "Top", "Jungle", "Mid", "Adc", "Support"];

  for (const className of classNames) {
    const fields = getClassFields(classText, className);

    if (fields.length === 0) {
      continue;
    }

    const rows = filterLaneMetaRows(parseLaneMetaRowsWithFields(rowsText, className, fields));

    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function parseLaneMetaRowConstructors(
  text: string,
  className: string,
): LaneMetaRow[] {
  const fields = getClassFields(text, className);

  if (fields.length === 0) {
    return [];
  }

  return parseLaneMetaRowsWithFields(text, className, fields);
}

function parseLaneMetaRowsWithFields(
  text: string,
  className: string,
  fields: string[],
): LaneMetaRow[] {
  return findConstructorArguments(text, className)
    .map(splitTopLevel)
    .map((values) => createLaneMetaRow(fields, values));
}

function filterLaneMetaRows(
  rows: ReturnType<typeof parseLaneMetaRowConstructors>,
): LaneMetaRow[] {
  return rows.filter((row) => {
    const isValid =
      row.championName.length > 0 &&
      Number.isFinite(row.winRate) &&
      row.winRate >= 0.3 &&
      row.winRate <= 0.7 &&
      Number.isInteger(row.tier) &&
      row.tier >= 0 &&
      row.tier <= 6 &&
      (!Number.isFinite(row.pickRate) || (row.pickRate >= 0 && row.pickRate <= 1));

    if (!isValid) {
      console.warn("[OP.GG] dropped malformed lane-meta row", JSON.stringify(row));
    }

    return isValid;
  });
}

function createLaneMetaRow(fields: string[], values: string[]): LaneMetaRow {
  const championName = toStringValue(valueByField(fields, values, "champion"));
  const play = numberByField(fields, values, "play");
  const win = numberByField(fields, values, "win");
  const rawWinRate = numberByField(fields, values, "win_rate");
  const pickRate = normalizeRateValue(numberByField(fields, values, "pick_rate"));
  const roleRate = normalizeRateValue(numberByField(fields, values, "role_rate"));
  const tier = Math.trunc(numberByField(fields, values, "tier"));

  return {
    championName,
    play,
    winRate: normalizeWinRate(rawWinRate, win, play),
    pickRate,
    roleRate,
    tier,
  };
}

function valueByField(fields: string[], values: string[], fieldName: string): string {
  const index = fields.indexOf(fieldName);

  return index === -1 ? "" : values[index] ?? "";
}

function numberByField(fields: string[], values: string[], fieldName: string): number {
  return toNumberValue(valueByField(fields, values, fieldName));
}

function parseMatchupGuide(text: string, opponent: ChampionRef): MatchupResult {
  const parsed = JSON.parse(text) as unknown;
  const data = getRecord(asRecord(parsed), "data");
  const counters = getArray(data, "counters");

  for (const item of counters) {
    const counter = asRecord(item);
    const championId = getNumber(counter, "champion_id");
    const championName = getString(counter, "champion_name");

    if (!matchesChampion(championId, championName, opponent)) {
      continue;
    }

    const win = getNumber(counter, "win");
    const play = getNumber(counter, "play");

    if (win !== null && play !== null && play > 0) {
      return {
        winRate: normalizeWinRate(Number.NaN, win, play),
        sampleNote: `${play.toLocaleString()} games`,
      };
    }
  }

  const laneAdvantage = getString(data, "lane_advantage_champion");

  if (laneAdvantage === "EVEN") {
    return { winRate: 0.5 };
  }

  return { winRate: null };
}

function parseAnalysisCounters(text: string): {
  weakCounters: CounterRow[];
  strongCounters: CounterRow[];
} {
  const dataArgs = findConstructorArguments(text, "Data")
    .map(splitTopLevel)
    .find((args) => args.some((arg) => arg.includes("Counter(")));

  if (!dataArgs || dataArgs.length < 2) {
    return { weakCounters: [], strongCounters: [] };
  }

  const counterArgs = dataArgs.filter((arg) => arg.startsWith("[") && arg.includes("Counter("));

  if (counterArgs.length < 2) {
    return { weakCounters: [], strongCounters: [] };
  }

  const classFields = text.match(/class Data: ([^\n]+)/)?.[1] ?? "";
  const weakIndex = classFields.indexOf("weak_counters");
  const strongIndex = classFields.indexOf("strong_counters");
  const weakCountersFirst = weakIndex !== -1 && (strongIndex === -1 || weakIndex < strongIndex);

  return {
    weakCounters: parseCounterRows(weakCountersFirst ? counterArgs[0] : counterArgs[1]),
    strongCounters: parseCounterRows(weakCountersFirst ? counterArgs[1] : counterArgs[0]),
  };
}

function parseAnalysisDamageStyle(text: string): DamageStyle {
  const dataFields = getClassFields(text, "Data");

  if (!dataFields.includes("damage_type")) {
    return "unknown";
  }

  const dataArgs = findConstructorArguments(text, "Data")
    .map(splitTopLevel)
    .find((values) => values.length >= dataFields.length);

  if (!dataArgs) {
    return "unknown";
  }

  return normalizeOpggDamageStyle(toStringValue(valueByField(dataFields, dataArgs, "damage_type")));
}

function normalizeOpggDamageStyle(value: string): DamageStyle {
  const normalized = value.trim().toUpperCase();

  if (normalized === "AD") {
    return "ad";
  }

  if (normalized === "AP") {
    return "ap";
  }

  if (normalized === "BOTH" || normalized === "HYBRID" || normalized === "MIXED") {
    return "hybrid";
  }

  if (normalized === "TRUE") {
    return "true";
  }

  return "unknown";
}

function parseCounterRows(text: string): CounterRow[] {
  return findConstructorArguments(text, "WeakCounter")
    .concat(findConstructorArguments(text, "StrongCounter"))
    .map(splitTopLevel)
    .map((values) => {
      const play = toNumberValue(values[2]);
      const win = toNumberValue(values[3]);

      return {
        championId: toNumberValue(values[0]),
        championName: toStringValue(values[1]),
        play,
        win,
        winRate: normalizeWinRate(toNumberValue(values[4]), win, play),
      };
    })
    .filter((row) => row.championId > 0 && row.championName.length > 0);
}

function parseSynergyRows(text: string): SynergyRow[] {
  return ["Top", "Jungle", "Mid", "Adc", "Support", "Synergie"]
    .flatMap((className) => parseSynergyRowsByClass(text, className))
    .filter((row) => row.championId > 0 && row.synergyChampionId > 0);
}

function parseSynergyRowsByClass(text: string, className: string): SynergyRow[] {
  const fields = getClassFields(text, className);

  if (fields.length === 0) {
    return [];
  }

  return findConstructorArguments(text, className)
    .map(splitTopLevel)
    .map((values) => createSynergyRow(fields, values));
}

function createSynergyRow(fields: string[], values: string[]): SynergyRow {
  const play = numberByField(fields, values, "play");
  const win = numberByField(fields, values, "win");

  return {
    championId: numberByField(fields, values, "champion_id"),
    championName: toStringValue(valueByField(fields, values, "champion_name")),
    synergyChampionId: numberByField(fields, values, "synergy_champion_id"),
    synergyChampionName: toStringValue(valueByField(fields, values, "synergy_champion_name")),
    synergyPosition: toStringValue(valueByField(fields, values, "synergy_position")),
    scoreRank: numberByField(fields, values, "score_rank"),
    score: numberByField(fields, values, "score"),
    play,
    win,
    winRate: normalizeWinRate(numberByField(fields, values, "win_rate"), win, play),
    synergyTier: parseTierData(valueByField(fields, values, "synergy_tier_data")),
  };
}

function findConstructorArguments(text: string, constructorName: string): string[] {
  const marker = `${constructorName}(`;
  const matches: string[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const start = text.indexOf(marker, searchIndex);

    if (start === -1) {
      break;
    }

    if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1] ?? "")) {
      searchIndex = start + marker.length;
      continue;
    }

    const argsStart = start + marker.length;
    const argsEnd = findMatchingParen(text, argsStart);

    if (argsEnd === -1) {
      break;
    }

    matches.push(text.slice(argsStart, argsEnd));
    searchIndex = argsEnd + 1;
  }

  return matches;
}

function getClassFields(text: string, className: string): string[] {
  const pattern = new RegExp(`^class ${escapeRegExp(className)}: ([^\\n]+)$`, "m");
  const match = pattern.exec(text);

  if (!match) {
    return [];
  }

  return match[1].split(",").map((field) => field.trim()).filter(Boolean);
}

function findMatchingParen(text: string, startIndex: number): number {
  let depth = 1;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevel(text: string): string[] {
  const values: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    } else if (char === "," && parenDepth === 0 && bracketDepth === 0) {
      values.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  values.push(text.slice(start).trim());
  return values;
}

function parsePrimitive(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return JSON.parse(trimmed) as string;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null" || trimmed.length === 0) {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function extractToolText(result: unknown): string | null {
  const content = getArray(asRecord(result), "content");

  for (const item of content) {
    const contentItem = asRecord(item);

    if (getString(contentItem, "type") === "text") {
      return getString(contentItem, "text");
    }
  }

  return null;
}

function toOpggPosition(role: Role): OpggPosition {
  if (role === "middle") {
    return "mid";
  }

  if (role === "bottom") {
    return "adc";
  }

  if (role === "utility") {
    return "support";
  }

  return role;
}

function fromOpggPosition(position: OpggPosition): Role {
  if (position === "mid") {
    return "middle";
  }

  if (position === "adc") {
    return "bottom";
  }

  if (position === "support") {
    return "utility";
  }

  return position;
}

function parseOpggPosition(value: string): Role | null {
  const normalized = value.toLowerCase();

  return positions.includes(normalized as OpggPosition)
    ? fromOpggPosition(normalized as OpggPosition)
    : null;
}

function toPositionClassName(position: OpggPosition): string {
  return position.charAt(0).toUpperCase() + position.slice(1);
}

function toOpggChampionToken(champion: ChampionRef): string {
  return champion.name
    .normalize("NFKD")
    .replace(/&/g, " ")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function matchesChampion(championId: number | null, championName: string | null, champion: ChampionRef): boolean {
  return (
    championId === champion.id ||
    (championName !== null && normalizeLookupName(championName) === normalizeLookupName(champion.name))
  );
}

function createSynergyResult(row: SynergyRow): SynergyResult {
  const score = normalizeSynergyScore(row);
  const confidence = synergySampleConfidence(row.play);

  return {
    score,
    winRate: row.winRate,
    sampleSize: row.play,
    tier: row.synergyTier,
    confidence,
    notable: row.play >= MIN_NOTABLE_SYNERGY_GAMES && isNotableSynergy(row.synergyTier, score),
  };
}

function createChampionSynergyAnalysis(row: SynergyRow): ChampionSynergyAnalysis {
  const result = createSynergyResult(row);

  return {
    championId: row.championId,
    championName: row.championName,
    partnerChampionId: row.synergyChampionId,
    partnerChampionName: row.synergyChampionName,
    partnerPosition: parseOpggPosition(row.synergyPosition),
    score: result.score ?? NO_NOTABLE_SYNERGY_SCORE,
    confidence: result.confidence ?? 0,
    winRate: result.winRate,
    sampleSize: result.sampleSize,
    tier: result.tier,
    notable: result.notable,
  };
}

function normalizeSynergyScore(row: SynergyRow): number {
  if (row.synergyTier !== null) {
    const tierStrength =
      SYNERGY_TIER_STRENGTH[row.synergyTier] ??
      clamp01(0.42 - Math.max(0, row.synergyTier - 4) * 0.04);
    const adjusted = tierStrength + synergyWinRateTieBreak(row) + synergyRankTieBreak(row);

    return sampleAdjustedSynergyScore(clamp01(adjusted), row.play);
  }

  if (Number.isFinite(row.scoreRank) && row.scoreRank > 0) {
    const rankFallback = clamp01(0.66 - Math.min(row.scoreRank - 1, 20) * 0.012);

    return sampleAdjustedSynergyScore(rankFallback, row.play);
  }

  if (row.score > 0 && row.score <= 1) {
    return sampleAdjustedSynergyScore(row.score, row.play);
  }

  if (row.play > 0) {
    const adjustedWinRate = adjustRateWithPseudoGames(
      row.winRate > 0 && row.winRate <= 1 ? row.winRate : row.win / row.play,
      row.play,
      SYNERGY_SAMPLE_PSEUDO_GAMES,
    );

    return sampleAdjustedSynergyScore(
      normalizeRange(adjustedWinRate, 0.45, 0.58),
      row.play,
    );
  }

  return NO_NOTABLE_SYNERGY_SCORE;
}

function sampleAdjustedSynergyScore(score: number, play: number): number {
  const sampleConfidence = synergySampleConfidence(play);

  return clamp01(NO_NOTABLE_SYNERGY_SCORE + (score - NO_NOTABLE_SYNERGY_SCORE) * sampleConfidence);
}

function synergySampleConfidence(play: number): number {
  return Number.isFinite(play) ? clamp01(play / MIN_NOTABLE_SYNERGY_GAMES) : 0;
}

function synergyWinRateTieBreak(row: SynergyRow): number {
  if (
    row.play < SYNERGY_HIGH_SAMPLE_GAMES ||
    row.winRate <= 0 ||
    row.winRate > 1
  ) {
    return 0;
  }

  const adjustedWinRate = adjustRateWithPseudoGames(
    row.winRate,
    row.play,
    SYNERGY_SAMPLE_PSEUDO_GAMES,
  );

  return (normalizeRange(adjustedWinRate, 0.48, 0.56) - 0.5) *
    SYNERGY_WIN_RATE_TIE_BREAK_SPREAD;
}

function synergyRankTieBreak(row: SynergyRow): number {
  if (!Number.isFinite(row.scoreRank) || row.scoreRank <= 0) {
    return 0;
  }

  return clamp01((20 - Math.min(row.scoreRank, 20)) / 19) * 0.015;
}

function isNotableSynergy(tier: number | null, score: number): boolean {
  return (tier !== null && tier <= 1) || score >= 0.68;
}

function adjustRateWithPseudoGames(rate: number, play: number, pseudoGames: number): number {
  if (!Number.isFinite(play) || play <= 0 || pseudoGames <= 0) {
    return rate;
  }

  return (play * rate + pseudoGames * 0.5) / (play + pseudoGames);
}

function parseTierData(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const [tier] = findConstructorArguments(value, "TierData")
    .concat(findConstructorArguments(value, "SynergyTierData"))
    .map(splitTopLevel)
    .map((values) => toNumberValue(values[0]))
    .filter(Number.isFinite);

  return tier === undefined ? null : tier;
}

function guessPosition(champion: ChampionRef): OpggPosition | null {
  if (champion.tags.includes("Marksman")) {
    return "adc";
  }

  if (champion.tags.includes("Support")) {
    return "support";
  }

  if (champion.tags.includes("Mage") || champion.tags.includes("Assassin")) {
    return "mid";
  }

  if (champion.tags.includes("Fighter") || champion.tags.includes("Tank")) {
    return "top";
  }

  return null;
}

function normalizeLookupName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeWinRate(rawValue: number, win?: number, play?: number): number {
  if (
    typeof win === "number" &&
    typeof play === "number" &&
    Number.isFinite(win) &&
    Number.isFinite(play) &&
    play > 0
  ) {
    return clamp01(win / play);
  }

  return normalizeRateValue(rawValue);
}

function normalizeRateValue(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  if (value > 1 && value <= 100) {
    return value / 100;
  }

  return value;
}

function createUnresolvedChampion(name: string): ChampionRef {
  const slug = normalizeLookupName(name) || "unknown";

  return {
    id: -hashString(slug),
    slug,
    name,
    tags: [],
    iconUrl: "",
  };
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash || 1;
}

function createEmptyRoleFit(): RoleFit {
  return {
    top: 0,
    jungle: 0,
    middle: 0,
    bottom: 0,
    utility: 0,
  };
}

function normalizeRoleFit(rawWeights: Partial<Record<Role, number>>): RoleFit {
  const fit = createEmptyRoleFit();
  const maxWeight = Math.max(
    ...Object.values(rawWeights).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    ),
    0,
  );

  if (maxWeight <= 0) {
    return fit;
  }

  for (const role of Object.keys(fit) as Role[]) {
    const rawWeight = rawWeights[role] ?? 0;
    fit[role] = rawWeight > 0 ? clamp01(rawWeight / maxWeight) : 0;
  }

  return fit;
}

function toStringValue(value: string): string {
  const parsed = parsePrimitive(value);
  return typeof parsed === "string" ? parsed : "";
}

function toNumberValue(value: string): number {
  const parsed = parsePrimitive(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key]);
}

function getArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeRange(value: number, low: number, high: number): number {
  if (high <= low) {
    return 0.5;
  }

  return clamp01((value - low) / (high - low));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const opggMcpTestHooks = {
  ConcurrentRequestLimiter,
  parseAllLaneMetaRows,
  parseAnalysisCounters,
  parseAnalysisDamageStyle,
  parseLaneMetaRows,
  parseMatchupGuide,
  createChampionSynergyAnalysis,
  createSynergyResult,
  normalizeSynergyScore,
  parseSynergyRows,
  SYNERGY_TIER_STRENGTH,
};
