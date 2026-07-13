import type { ChampionCatalog } from "../../catalog/championCatalog";
import { APP_VERSION } from "../../../shared/appInfo";
import type {
  CompetitionTier,
  NormalizedProDraft,
  ProDraftBan,
  ProDraftPick,
  ProSide,
} from "../../../shared/proData";
import { PRO_RAW_SCHEMA_VERSION } from "../../../shared/proData";
import type { ChampionRef, Role } from "../../../shared/types";
import { classifyProCompetition } from "./competitionPolicy";

export { classifyProCompetition as classifyCompetition } from "./competitionPolicy";

export interface LeaguepediaCargoOptions {
  endpoint?: string;
  userAgent?: string;
  pageSize?: number;
  minimumRequestIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: CargoFetch;
  delay?: (milliseconds: number) => Promise<void>;
}

export interface LeaguepediaFetchResult {
  drafts: NormalizedProDraft[];
  warnings: string[];
  etag: string | null;
  notModified: boolean;
}

export type CargoFetch = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

interface CargoRow {
  [key: string]: unknown;
}

interface CargoPage {
  status: number;
  headers: { get(name: string): string | null };
  body: unknown;
}

class NonRetryableCargoError extends Error {}

const DEFAULT_ENDPOINT = "https://lol.fandom.com/api.php";
const DEFAULT_USER_AGENT =
  `DraftCoach-ProSnapshot/${APP_VERSION} (+https://github.com/wilsonpeng20070926-beep/draft-coach)`;
const DEFAULT_PAGE_SIZE = 100;
const roleOrder: Role[] = ["top", "jungle", "middle", "bottom", "utility"];
const pickOrders: Record<ProSide, number[]> = {
  blue: [1, 4, 5, 8, 9],
  red: [2, 3, 6, 7, 10],
};
const banOrders: Record<ProSide, number[]> = {
  blue: [1, 3, 5, 7, 9],
  red: [2, 4, 6, 8, 10],
};

export class LeaguepediaCargoAdapter {
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly pageSize: number;
  private readonly minimumRequestIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: CargoFetch;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly championLookup: Map<string, ChampionRef>;

  constructor(
    catalog: ChampionCatalog,
    options: LeaguepediaCargoOptions = {},
  ) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? 1_500;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? (fetch as CargoFetch);
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.championLookup = createChampionLookup(catalog);
  }

  async fetchDrafts(
    patches: string[],
    ifNoneMatch?: string | null,
  ): Promise<LeaguepediaFetchResult> {
    validatePatches(patches);
    const drafts: NormalizedProDraft[] = [];
    const warnings: string[] = [];
    let offset = 0;
    let etag: string | null = null;

    while (true) {
      if (offset > 0 && this.minimumRequestIntervalMs > 0) {
        await this.delay(this.minimumRequestIntervalMs);
      }

      const response = await this.fetchPage(
        patches,
        offset,
        offset === 0 ? ifNoneMatch : null,
      );

      if (response.status === 304) {
        return { drafts: [], warnings: [], etag, notModified: true };
      }

      etag = response.headers.get("etag") ?? etag;
      const rows = parseCargoRows(response.body);

      for (const row of rows) {
        try {
          const draft = this.normalizeRow(row, patches);

          if (draft) {
            drafts.push(draft);
          }
        } catch (error) {
          warnings.push(
            `Dropped ${stringField(row, "GameId") || "unknown game"}: ${toError(error).message}`,
          );
        }
      }

      if (rows.length < this.pageSize) {
        break;
      }

      offset += this.pageSize;
    }

    return {
      drafts: dedupeDrafts(drafts),
      warnings: warnings.sort(),
      etag,
      notModified: false,
    };
  }

  private async fetchPage(
    patches: string[],
    offset: number,
    ifNoneMatch?: string | null,
  ): Promise<CargoPage> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(this.createUrl(patches, offset), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
            ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}),
          },
          signal: controller.signal,
        });

        if (response.status === 304) {
          return {
            status: response.status,
            headers: response.headers,
            body: null,
          };
        }

        if (response.ok) {
          const body = await response.json();
          const apiError = cargoApiError(body);

          if (!apiError) {
            return {
              status: response.status,
              headers: response.headers,
              body,
            };
          }

          if (!isRetryableCargoError(apiError.code)) {
            throw new NonRetryableCargoError(
              `Leaguepedia Cargo API error ${apiError.code}: ${apiError.info}`,
            );
          }

          lastError = new Error(
            `Leaguepedia Cargo retryable API error ${apiError.code}: ${apiError.info}`,
          );
        } else {
          if (response.status !== 429 && response.status < 500) {
            throw new NonRetryableCargoError(
              `Leaguepedia Cargo request failed with status ${response.status}`,
            );
          }

          lastError = new Error(`Leaguepedia Cargo retryable status ${response.status}`);
        }
      } catch (error) {
        if (error instanceof NonRetryableCargoError) {
          throw error;
        }

        lastError = toError(error);
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < this.maxRetries) {
        await this.delay(500 * 2 ** attempt);
      }
    }

    throw lastError ?? new Error("Leaguepedia Cargo request failed");
  }

  private createUrl(patches: string[], offset: number): string {
    const params = new URLSearchParams({
      action: "cargoquery",
      format: "json",
      tables: "ScoreboardGames=SG,PicksAndBansS7=PB",
      join_on: "SG.GameId=PB.GameId",
      fields: [
        "SG.GameId=GameId",
        "SG.Tournament=Tournament",
        "SG.DateTime_UTC=DateTime_UTC",
        "SG.Patch=Patch",
        "SG.Team1=Team1",
        "SG.Team2=Team2",
        "SG.Winner=Winner",
        ...slotFields("Team1Pick"),
        ...slotFields("Team2Pick"),
        ...slotFields("Team1Ban"),
        ...slotFields("Team2Ban"),
        ...slotFields("Team1Role"),
        ...slotFields("Team2Role"),
        "PB.Phase=Stage",
        "PB.IsComplete=IsComplete",
      ].join(","),
      where: createCargoWhere(patches),
      order_by: "SG.DateTime_UTC ASC,SG.GameId ASC",
      limit: String(this.pageSize),
      offset: String(offset),
    });

    return `${this.endpoint}?${params.toString()}`;
  }

  private normalizeRow(row: CargoRow, patches: string[]): NormalizedProDraft | null {
    const competition = stringField(row, "Tournament");
    const competitionTier = classifyProCompetition(competition);
    const patch = normalizePatch(stringField(row, "Patch"));

    if (!competitionTier || !patches.includes(patch)) {
      return null;
    }

    const blueTeam = requiredField(row, "Team1");
    const redTeam = requiredField(row, "Team2");
    const bluePicks = this.parseChampionList(
      slotList(row, "Team1Pick", "Team1Picks"),
    );
    const redPicks = this.parseChampionList(
      slotList(row, "Team2Pick", "Team2Picks"),
    );

    if (bluePicks.length !== 5 || redPicks.length !== 5) {
      throw new Error("pick list is partial");
    }

    const blueRoles = parseRoles(slotList(row, "Team1Role", "Team1Roles"));
    const redRoles = parseRoles(slotList(row, "Team2Role", "Team2Roles"));
    const format = nullableField(row, "Format");

    return {
      schemaVersion: PRO_RAW_SCHEMA_VERSION,
      gameId: requiredField(row, "GameId"),
      patch,
      playedAt: normalizeUtcTimestamp(requiredField(row, "DateTime_UTC")),
      competition,
      competitionTier,
      stage: nullableField(row, "Stage"),
      format,
      fearless: parseFearless(row.Fearless, format),
      blueTeam,
      redTeam,
      winner: parseWinner(requiredField(row, "Winner"), blueTeam, redTeam),
      picks: [
        ...createPicks("blue", bluePicks, blueRoles),
        ...createPicks("red", redPicks, redRoles),
      ].sort((left, right) => left.order - right.order),
      bans: [
        ...createBans(
          "blue",
          this.parseChampionList(slotList(row, "Team1Ban", "Team1Bans")),
        ),
        ...createBans(
          "red",
          this.parseChampionList(slotList(row, "Team2Ban", "Team2Bans")),
        ),
      ].sort((left, right) => left.order - right.order),
    };
  }

  private parseChampionList(value: string): ChampionRef[] {
    if (!value.trim()) {
      return [];
    }

    return splitList(value).map((name) => {
      const champion = this.championLookup.get(normalizeName(name));

      if (!champion) {
        throw new Error(`unknown champion alias ${name}`);
      }

      return champion;
    });
  }
}

function createCargoWhere(patches: string[]): string {
  const patchList = patches.map((patch) => `'${patch}'`).join(",");
  const competition = [
    "SG.Tournament LIKE '%World%'",
    "SG.Tournament LIKE '%Mid-Season Invitational%'",
    "SG.Tournament LIKE '%MSI%'",
    "SG.Tournament LIKE '%First Stand%'",
    "SG.Tournament LIKE '%Esports World Cup%'",
    "SG.Tournament LIKE '%EWC%'",
    "SG.Tournament LIKE '%LCK%'",
    "SG.Tournament LIKE '%LPL%'",
    "SG.Tournament LIKE '%LEC%'",
    "SG.Tournament LIKE '%LCS%'",
    "SG.Tournament LIKE '%LCP%'",
    "SG.Tournament LIKE '%CBLOL%'",
  ].join(" OR ");

  const exclusions = [
    "Academy",
    "Challenger",
    "Development",
    "Collegiate",
    "University",
    "NACL",
    "Prime League",
    "Ultraliga",
    "Superliga",
  ]
    .map((name) => `SG.Tournament NOT LIKE '%${name}%'`)
    .join(" AND ");

  return `PB.IsComplete=1 AND SG.Patch IN (${patchList}) AND (${competition}) AND ${exclusions}`;
}

function slotFields(prefix: string): string[] {
  return Array.from(
    { length: 5 },
    (_, index) => `PB.${prefix}${index + 1}=${prefix}${index + 1}`,
  );
}

function slotList(row: CargoRow, prefix: string, listFallback: string): string {
  const slots = Array.from(
    { length: 5 },
    (_, index) => stringField(row, `${prefix}${index + 1}`),
  ).filter(Boolean);

  return slots.length > 0 ? slots.join("|") : stringField(row, listFallback);
}

function createChampionLookup(catalog: ChampionCatalog): Map<string, ChampionRef> {
  const lookup = new Map<string, ChampionRef>();

  for (const champion of catalog.all()) {
    lookup.set(normalizeName(champion.name), champion);
    lookup.set(normalizeName(champion.slug), champion);
  }

  const wukong = catalog.bySlug("MonkeyKing");

  if (wukong) {
    lookup.set("monkeyking", wukong);
    lookup.set("wukong", wukong);
  }

  return lookup;
}

function createPicks(
  side: ProSide,
  champions: ChampionRef[],
  roles: Role[],
): ProDraftPick[] {
  return champions.map((champion, index) => ({
    order: pickOrders[side][index],
    side,
    role: roles[index] ?? roleOrder[index],
    championId: champion.id,
  }));
}

function createBans(side: ProSide, champions: ChampionRef[]): ProDraftBan[] {
  return champions.slice(0, 5).map((champion, index) => ({
    order: banOrders[side][index],
    side,
    championId: champion.id,
  }));
}

function parseRoles(value: string): Role[] {
  const parsed = splitList(value)
    .map(normalizeRole)
    .filter((role): role is Role => role !== null);

  return parsed.length === 5 ? parsed : roleOrder;
}

function normalizeRole(value: string): Role | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "mid") return "middle";
  if (normalized === "adc" || normalized === "bot") return "bottom";
  if (normalized === "support" || normalized === "sup") return "utility";
  return roleOrder.includes(normalized as Role) ? (normalized as Role) : null;
}

function parseWinner(value: string, blueTeam: string, redTeam: string): ProSide {
  const normalized = value.trim().toLowerCase();

  if (normalized === "1" || normalized === "blue" || normalized === blueTeam.toLowerCase()) {
    return "blue";
  }

  if (normalized === "2" || normalized === "red" || normalized === redTeam.toLowerCase()) {
    return "red";
  }

  throw new Error(`unknown winner ${value}`);
}

function parseFearless(value: unknown, format: string | null): boolean | null {
  if (value === true || value === 1 || value === "1" || String(value).toLowerCase() === "yes") {
    return true;
  }

  if (value === false || value === 0 || value === "0" || String(value).toLowerCase() === "no") {
    return false;
  }

  return format?.toLowerCase().includes("fearless") ? true : null;
}

function normalizePatch(value: string): string {
  return value.trim().replace(/^v/i, "").split(".").slice(0, 2).join(".");
}

function normalizeUtcTimestamp(value: string): string {
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? value
    : `${value.trim().replace(" ", "T")}Z`;
  const timestamp = new Date(normalized);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("invalid UTC timestamp");
  }

  return timestamp.toISOString();
}

function validatePatches(patches: string[]): void {
  if (patches.length === 0 || patches.length > 3 || patches.some((patch) => !/^\d{1,2}\.\d{1,2}$/.test(patch))) {
    throw new Error("Exactly one to three normalized patches are required");
  }
}

function parseCargoRows(value: unknown): CargoRow[] {
  const cargoquery = (value as { cargoquery?: unknown })?.cargoquery;

  if (!Array.isArray(cargoquery)) {
    throw new Error("Leaguepedia Cargo response is missing cargoquery rows");
  }

  return cargoquery
    .map((item) => (item as { title?: unknown })?.title)
    .filter((title): title is CargoRow => Boolean(title && typeof title === "object"));
}

function cargoApiError(value: unknown): { code: string; info: string } | null {
  const error = (value as { error?: unknown })?.error;

  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  const info = (error as { info?: unknown }).info;

  return {
    code: typeof code === "string" ? code : "unknown",
    info: typeof info === "string" ? info : "unknown Cargo API error",
  };
}

function isRetryableCargoError(code: string): boolean {
  return code === "ratelimited" || code === "maxlag" || code.startsWith("internal_api_error");
}

function dedupeDrafts(drafts: NormalizedProDraft[]): NormalizedProDraft[] {
  return [...new Map(drafts.map((draft) => [draft.gameId, draft])).values()].sort(
    (left, right) => left.playedAt.localeCompare(right.playedAt) || left.gameId.localeCompare(right.gameId),
  );
}

function splitList(value: string): string[] {
  return value.split(/\s*(?:\||,|;)\s*/).map((item) => item.trim()).filter(Boolean);
}

function requiredField(row: CargoRow, key: string): string {
  const value = stringField(row, key);

  if (!value) {
    throw new Error(`missing ${key}`);
  }

  return value;
}

function nullableField(row: CargoRow, key: string): string | null {
  return stringField(row, key) || null;
}

function stringField(row: CargoRow, key: string): string {
  const value = row[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
