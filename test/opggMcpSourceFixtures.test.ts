import { readFileSync } from "node:fs";
import { TransformStream } from "node:stream/web";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChampionCatalog } from "../src/main/catalog/championCatalog";
import type { ChampionRef } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const yasuo = mustChampion(157);
const zaahen = mustChampion(904);
const nocturne = mustChampion(56);
const orianna = mustChampion(61);
const lissandra = mustChampion(127);
const riven = mustChampion(92);
let hooks: typeof import("../src/main/data/opggMcpSource").opggMcpTestHooks;
let OpggMcpSource: typeof import("../src/main/data/opggMcpSource").OpggMcpSource;

beforeAll(async () => {
  (globalThis as unknown as { TransformStream?: typeof TransformStream }).TransformStream =
    TransformStream;
  const module = await import("../src/main/data/opggMcpSource");
  hooks = module.opggMcpTestHooks;
  OpggMcpSource = module.OpggMcpSource;
});

describe("OP.GG fixture field mappings", () => {
  it("extracts lane meta candidates from the discovered lane-meta fixture", () => {
    const rows = hooks.parseLaneMetaRows(fixtureText("lol_list_lane_meta_champions"), "mid");

    expect(rows[0].championName).toBe("Ahri");
    expect(rows[0].winRate).toBeCloseTo(0.5162766521394426, 5);
    expect(rows[0].pickRate).toBe(0.11);
    expect(rows[0].tier).toBe(1);
  });

  it("maps the Zaahen anchor to sane top-lane stats", () => {
    const rowsByPosition = hooks.parseAllLaneMetaRows(rawFixtureText("positions-csv"));
    const zaahenRow = rowsByPosition.top.find((row) => row.championName === "Zaahen");

    expect(zaahenRow).toBeDefined();
    expect(zaahenRow?.winRate).toBeCloseTo(0.4970905760650368, 5);
    expect(zaahenRow?.pickRate).toBe(0.02);
    expect(zaahenRow?.tier).toBe(4);
  });

  it("drops malformed lane rows instead of ranking field-drift junk", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const text = [
      "class LolListLaneMetaChampions: data",
      "class Data: positions",
      "class Positions: mid",
      "class Mid: champion,win_rate,pick_rate,tier,play",
      "",
      'LolListLaneMetaChampions(Data(Positions([Mid("Bugged",40,0.02,26265,3404)])))',
    ].join("\n");

    try {
      expect(hooks.parseLaneMetaRows(text, "mid")).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("refreshes a stale catalog before falling back on unresolved champions", async () => {
    const staleCatalog = new RefreshingCatalog(zaahen);
    const source = new OpggMcpSource(staleCatalog);
    (source as unknown as { callToolText: () => Promise<string> }).callToolText = async () =>
      [
        "class LolListLaneMetaChampions: data",
        "class Data: positions",
        "class Positions: mid",
        "class Mid: champion,play,win,win_rate,pick_rate,tier",
        "",
        'LolListLaneMetaChampions(Data(Positions([Mid("Zaahen",1104733,549184,0.5,0.02,4)])))',
      ].join("\n");

    const entries = await source.getLaneMeta("middle", "global", "emerald_plus");

    expect(staleCatalog.refreshCount).toBe(1);
    expect(entries[0].champion).toMatchObject({
      id: zaahen.id,
      name: "Zaahen",
    });
  });

  it("extracts all-position role fit rows from the champion-position fallback fixture", () => {
    const rowsByPosition = hooks.parseAllLaneMetaRows(fixtureText("champion-positions"));

    expect(rowsByPosition.top[0]).toMatchObject({
      championName: "Malphite",
      roleRate: 0.79,
    });
    expect(rowsByPosition.mid.some((row) => row.championName === "Ahri")).toBe(true);
    expect(rowsByPosition.support.some((row) => row.championName === "Lux")).toBe(true);
  });

  it("extracts matchup win rate from the discovered lane matchup fixture", () => {
    const matchup = hooks.parseMatchupGuide(
      fixtureText("lol_get_lane_matchup_guide"),
      yasuo,
    );

    expect(matchup.winRate).toBeCloseTo(3181 / 6287, 5);
    expect(matchup.sampleNote).toBe("6,287 games");
  });

  it("extracts counter and synergy rows from discovered fixtures", () => {
    const counters = hooks.parseAnalysisCounters(
      fixtureText("lol_get_champion_analysis"),
    );
    const synergies = hooks.parseSynergyRows(
      fixtureText("lol_get_champion_synergies"),
    );

    expect(counters.strongCounters[0].championName).toBe("Azir");
    expect(counters.strongCounters[0].winRate).toBeCloseTo(954 / 1636, 5);
    expect(counters.weakCounters[0].championName).toBe("Katarina");
    expect(counters.weakCounters[0].winRate).toBeCloseTo(3452 / 7128, 5);
    expect(synergies[0].championName).toBe("Ahri");
    expect(synergies[0].synergyChampionName).toBe("Lee Sin");
    expect(synergies[0].winRate).toBeCloseTo(3179 / 6024, 5);
  });

  it("parses damage_type from the Phase 6 analysis probe fixture", () => {
    const fixture = JSON.parse(readFileSync("scripts/fixtures/analysis-damage-type.json", "utf8")) as {
      calls?: Array<{ champion?: string; response?: { content?: Array<{ type?: string; text?: string }> } }>;
    };
    const parsed = new Map(
      (fixture.calls ?? []).map((call) => [
        call.champion,
        hooks.parseAnalysisDamageStyle(textFromResponse(call.response)),
      ]),
    );

    expect(parsed.get("JINX")).toBe("ad");
    expect(parsed.get("ORIANNA")).toBe("ap");
    expect(parsed.get("JAYCE")).toBe("ad");
    expect(hooks.parseAnalysisDamageStyle(fixtureText("lol_get_champion_analysis"))).toBe("ap");
  });

  it("parses synergy_tier_data from the Phase 8 analysis probe fixture", () => {
    const fixture = JSON.parse(readFileSync("scripts/fixtures/analysis-synergy-tier.json", "utf8")) as {
      calls?: Array<{ response?: { content?: Array<{ type?: string; text?: string }> } }>;
    };
    const rows = (fixture.calls ?? []).flatMap((call) =>
      hooks.parseSynergyRows(textFromResponse(call.response)),
    );
    const tiers = new Set(rows.map((row) => row.synergyTier).filter((tier) => tier !== null));
    const tierZero = rows.find((row) => row.synergyTier === 0);
    const tierFour = rows.find((row) => row.synergyTier === 4);

    expect(tiers.has(0)).toBe(true);
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(4)).toBe(true);
    expect(tierZero).toBeDefined();
    expect(tierFour).toBeDefined();
    expect(hooks.normalizeSynergyScore(tierZero!)).toBeGreaterThan(
      hooks.normalizeSynergyScore(tierFour!) + 0.2,
    );
  });

  it("shrinks thin-sample tier-0 synergy toward neutral", () => {
    const sturdy: Parameters<typeof hooks.normalizeSynergyScore>[0] = {
      championId: 61,
      championName: "Orianna",
      synergyChampionId: 64,
      synergyChampionName: "Lee Sin",
      synergyPosition: "JUNGLE",
      scoreRank: 1,
      score: 0,
      play: 2000,
      win: 1040,
      winRate: 0.52,
      synergyTier: 0,
    };
    const thin = {
      ...sturdy,
      play: 12,
      win: 7,
      winRate: 7 / 12,
    };

    expect(hooks.normalizeSynergyScore(sturdy)).toBeGreaterThan(0.85);
    expect(hooks.normalizeSynergyScore(thin)).toBeGreaterThan(0.5);
    expect(hooks.normalizeSynergyScore(thin)).toBeLessThan(0.53);
  });

  it("parses analysis-scoped synergy rows and suppresses tiny-sample chips", () => {
    const oriannaRows = hooks.parseSynergyRows(fixtureText("analysis-orianna"));
    const lissandraRows = hooks.parseSynergyRows(fixtureText("analysis-lissandra"));
    const rivenRows = hooks.parseSynergyRows(fixtureText("analysis-riven"));
    const oriannaNocturne = oriannaRows.find((row) => row.synergyChampionName === "Nocturne");
    const oriannaLeeSin = oriannaRows.find((row) => row.synergyChampionName === "Lee Sin");
    const rivenNocturne = rivenRows.find((row) => row.synergyChampionName === "Nocturne");

    expect(oriannaNocturne).toBeDefined();
    expect(oriannaLeeSin).toBeDefined();
    expect(hooks.createSynergyResult(oriannaLeeSin!)).toMatchObject({
      notable: true,
    });
    expect(hooks.createSynergyResult(oriannaNocturne!)).toMatchObject({
      notable: false,
    });
    expect(lissandraRows.some((row) => row.synergyChampionName === "Nocturne")).toBe(false);
    expect(rivenNocturne).toBeDefined();
    expect(rivenNocturne?.play).toBeLessThan(500);
    expect(hooks.createSynergyResult(rivenNocturne!)).toMatchObject({
      notable: false,
    });
    expect(hooks.normalizeSynergyScore(oriannaNocturne!)).toBeGreaterThan(
      hooks.normalizeSynergyScore(rivenNocturne!),
    );
  });

  it("returns different pairwise synergy scores for different mids against Nocturne", async () => {
    const source = new OpggMcpSource(catalog);
    (source as unknown as {
      callToolText: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<string>;
    }).callToolText = async (_name, args) => {
      if (args.champion === "ORIANNA") {
        return fixtureText("analysis-orianna");
      }

      if (args.champion === "LISSANDRA") {
        return fixtureText("analysis-lissandra");
      }

      if (args.champion === "RIVEN") {
        return fixtureText("analysis-riven");
      }

      return "";
    };

    const oriannaScore = await source.getSynergy(
      orianna,
      nocturne,
      "global",
      "emerald_plus",
      "middle",
      "jungle",
    );
    const lissandraScore = await source.getSynergy(
      lissandra,
      nocturne,
      "global",
      "emerald_plus",
      "middle",
      "jungle",
    );
    const rivenScore = await source.getSynergy(
      riven,
      nocturne,
      "global",
      "emerald_plus",
      "middle",
      "jungle",
    );

    expect(oriannaScore.score).toBeGreaterThan(lissandraScore.score ?? 0);
    expect(lissandraScore.score).toBe(0.5);
    expect(rivenScore.score).not.toBe(lissandraScore.score);
    expect(rivenScore.score).toBeLessThan(oriannaScore.score ?? 0);
    expect(rivenScore.notable).toBe(false);
  });

  it("orders known Orianna jungle synergies above neutral pairings", () => {
    const synergyFixture = JSON.parse(readFileSync("scripts/fixtures/synergy-json.json", "utf8")) as {
      response?: { content?: Array<{ type?: string; text?: string }> };
    };
    const text =
      synergyFixture.response?.content?.find((item) => item.type === "text")?.text ?? "";
    const synergies = hooks.parseSynergyRows(text);
    const xinZhao = synergies.find((row) => row.synergyChampionName === "Xin Zhao");
    const nocturne = synergies.find((row) => row.synergyChampionName === "Nocturne");
    const graves = synergies.find((row) => row.synergyChampionName === "Graves");

    expect(xinZhao).toBeDefined();
    expect(nocturne).toBeDefined();
    expect(graves).toBeDefined();
    expect(hooks.normalizeSynergyScore(xinZhao!)).toBeGreaterThan(
      hooks.normalizeSynergyScore(graves!),
    );
    expect(hooks.normalizeSynergyScore(nocturne!)).toBeGreaterThan(
      hooks.normalizeSynergyScore(graves!),
    );
  });
});

function fixtureText(name: string): string {
  const fixture = JSON.parse(readFileSync(`scripts/fixtures/${name}.json`, "utf8")) as unknown;
  const content = asRecord(fixture).response;
  const rawItems = asRecord(content).content;
  const items: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  const textItem = items.find((item: unknown) => asRecord(item).type === "text");
  const text = asRecord(textItem).text;

  if (typeof text !== "string") {
    throw new Error(`Missing text fixture for ${name}`);
  }

  return text;
}

function rawFixtureText(name: string): string {
  return readFileSync(`scripts/fixtures/${name}.txt`, "utf8");
}

function textFromResponse(response: unknown): string {
  const items = asRecord(response).content;
  const textItem = Array.isArray(items)
    ? items.find((item: unknown) => asRecord(item).type === "text")
    : null;
  const text = asRecord(textItem).text;

  if (typeof text !== "string") {
    throw new Error("Missing response text");
  }

  return text;
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

class RefreshingCatalog implements ChampionCatalog {
  refreshCount = 0;

  constructor(private readonly refreshedChampion: ChampionRef) {}

  async ready(): Promise<void> {
    return Promise.resolve();
  }

  async refresh(): Promise<void> {
    this.refreshCount += 1;
  }

  version(): string {
    return "test";
  }

  byId(championId: number): ChampionRef | null {
    return this.all().find((champion) => champion.id === championId) ?? null;
  }

  bySlug(slug: string): ChampionRef | null {
    return this.all().find((champion) => champion.slug === slug) ?? null;
  }

  all(): ChampionRef[] {
    return this.refreshCount > 0 ? [this.refreshedChampion] : [];
  }
}
