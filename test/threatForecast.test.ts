import { describe, expect, it } from "vitest";
import { createChampionAttributeProvider } from "../src/main/catalog/championAttributes";
import type {
  ChampionAnalysis,
  ChampionSynergyAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import { RankedThreatForecastProvider } from "../src/main/engine/threatForecast";
import type { ProAnalyticsProvider } from "../src/main/data/pro/proAnalytics";
import type {
  ProCandidateAnalysis,
  ProEvidenceRecord,
  ProSignal,
} from "../src/shared/proData";
import type {
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  Role,
} from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const attributes = createChampionAttributeProvider("15.10.1");
const ahri = mustChampion(103);
const brand = mustChampion(63);
const mundo = mustChampion(36);
const orianna = mustChampion(61);
const vayne = mustChampion(67);

describe("ranked threat forecast", () => {
  it("is deterministic and excludes bans plus locked picks", async () => {
    const source = new FakeThreatSource([
      laneEntry(ahri, 0.54, 1),
      laneEntry(brand, 0.53, 1),
      laneEntry(vayne, 0.52, 2),
      laneEntry(mundo, 0.51, 3),
    ]);
    source.setAnalysis(
      brand,
      {
        damageStyle: "ap",
        synergies: [synergy(brand, vayne, "middle", 0.82, 0.9)],
      },
    );
    source.matchups.set(vayne.id, 0.57);
    const provider = new RankedThreatForecastProvider(source, attributes);
    const draft = createDraft({
      bans: [ahri],
      allies: [player(0, "ally", "middle", orianna, "locked")],
      enemies: [player(5, "enemy", "utility", brand, "locked")],
    });
    const target = enemyTarget("middle", 7);

    const first = await provider.forecast(draft, target, {
      region: "global",
      rank: "emerald_plus",
    });
    const second = await provider.forecast(draft, target, {
      region: "global",
      rank: "emerald_plus",
    });

    expect(second).toEqual(first);
    expect(first.map((threat) => threat.champion.name)).toEqual([
      "Vayne",
      "Dr. Mundo",
    ]);
    expect(first[0]).toMatchObject({
      source: "forecast",
      role: "middle",
      targetCellId: 7,
      pinned: false,
      evidence: expect.arrayContaining([
        "Ranked role presence",
        "Pairs with Brand",
        "Answers the revealed lane pick",
      ]),
    });
    expect(first.every((threat) => threat.confidence <= 0.55)).toBe(true);
  });

  it("uses pro strategy only for simulator or favorite-team forecast contexts", async () => {
    const source = new FakeThreatSource([
      laneEntry(ahri, 0.53, 1),
      laneEntry(vayne, 0.52, 2),
    ]);
    const pro = new FakeProAnalytics(vayne.id);
    const provider = new RankedThreatForecastProvider(source, attributes, pro);
    const draft = createDraft();
    const target = enemyTarget("middle", 7);

    const live = await provider.forecast(draft, target, {
      region: "global",
      rank: "emerald_plus",
      context: "live",
    });
    expect(pro.analysisCalls).toBe(0);
    expect(live.flatMap((threat) => threat.evidence ?? [])).not.toContain(
      "MSI · patch 26.13 · 4 picks / 0 bans",
    );

    const simulator = await provider.forecast(draft, target, {
      region: "global",
      rank: "emerald_plus",
      context: "simulator",
    });
    expect(pro.analysisCalls).toBeGreaterThan(0);
    expect(simulator.find((threat) => threat.champion.id === vayne.id)?.evidence).toContain(
      "MSI · patch 26.13 · 4 picks / 0 bans",
    );

    const beforeFavorite = pro.analysisCalls;
    await provider.forecast(draft, target, {
      region: "global",
      rank: "emerald_plus",
      context: "live",
      favoriteTeams: ["T1", "Bilibili Gaming"],
    });
    expect(pro.analysisCalls).toBeGreaterThan(beforeFavorite);
  });
});

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  return {
    phase: "champSelect",
    allies: [],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer: null,
    ...overrides,
  };
}

function player(
  cellId: number,
  side: DraftPlayer["side"],
  role: Role,
  champion: ChampionRef,
  pickState: DraftPlayer["pickState"],
): DraftPlayer {
  return {
    cellId,
    side,
    role,
    champion,
    pickState,
    isLocalPlayer: false,
    roleSource: "assigned",
    roleConfidence: 1,
  };
}

function enemyTarget(role: Role, cellId: number): DraftTarget {
  return {
    side: "enemy",
    cellId,
    role,
    source: "simulation",
    purpose: "anticipate",
  };
}

function laneEntry(
  champion: ChampionRef,
  winRate: number,
  tier: number,
): LaneMetaEntry {
  return {
    champion,
    winRate,
    tier,
    pickRate: 0.08,
    play: 20_000,
    roleRate: 0.9,
  };
}

function synergy(
  champion: ChampionRef,
  partner: ChampionRef,
  partnerPosition: Role,
  score: number,
  confidence: number,
): ChampionSynergyAnalysis {
  return {
    championId: champion.id,
    championName: champion.name,
    partnerChampionId: partner.id,
    partnerChampionName: partner.name,
    partnerPosition,
    score,
    confidence,
    tier: 1,
    sampleSize: 1_000,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

class FakeThreatSource implements MetaDataSource {
  readonly matchups = new Map<number, number>();
  private readonly analyses = new Map<number, ChampionAnalysis>();

  constructor(private readonly laneMeta: LaneMetaEntry[]) {}

  setAnalysis(champion: ChampionRef, analysis: ChampionAnalysis): void {
    this.analyses.set(champion.id, analysis);
  }

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    return this.laneMeta;
  }

  async getMatchup(candidate: ChampionRef): Promise<MatchupResult> {
    return { winRate: this.matchups.get(candidate.id) ?? 0.5 };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
  }

  async getChampionAnalysis(champion: ChampionRef): Promise<ChampionAnalysis> {
    return this.analyses.get(champion.id) ?? {
      damageStyle: "unknown",
      synergies: [],
    };
  }

  async getChampionRoleFit(): Promise<RoleFit> {
    return {
      top: 0,
      jungle: 0,
      middle: 0,
      bottom: 0,
      utility: 0,
    };
  }
}

class FakeProAnalytics implements ProAnalyticsProvider {
  analysisCalls = 0;

  constructor(private readonly priorityChampionId: number) {}

  analyzeCandidate(query: { championId: number; role: Role }): ProCandidateAnalysis {
    this.analysisCalls += 1;
    const priority = query.championId === this.priorityChampionId
      ? signal(0.9, proEvidence())
      : signal(0);
    const neutral = signal(0);

    return {
      championId: query.championId,
      role: query.role,
      priority,
      rolePresence: neutral,
      flex: neutral,
      synergy: neutral,
      matchup: neutral,
      response: neutral,
      composition: neutral,
      success: neutral,
      favorite: neutral,
      overallStrength: priority.value * priority.confidence,
      proInspiredStrength: priority.value * priority.confidence,
      evidence: priority.evidence,
    };
  }

  topRoleCandidateIds(): number[] {
    return [this.priorityChampionId];
  }
}

function signal(value: number, evidence: ProEvidenceRecord[] = []): ProSignal {
  return {
    value,
    confidence: value > 0 ? 0.8 : 0,
    effectiveSample: value > 0 ? 4 : 0,
    material: value > 0,
    evidence,
  };
}

function proEvidence(): ProEvidenceRecord[] {
  return [{
    kind: "priority",
    text: "MSI · patch 26.13 · 4 picks / 0 bans",
    statistics: { picks: 4, bans: 0 },
    patches: ["26.13"],
    competitions: ["MSI 2026"],
    teams: [],
    effectiveSample: 4,
    confidence: 0.8,
    ageDays: 1,
    material: true,
  }];
}
