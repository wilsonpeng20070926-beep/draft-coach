import { describe, expect, it } from "vitest";
import { createChampionAttributeProvider } from "../src/main/catalog/championAttributes";
import type {
  ChampionAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import { buildCandidatePool } from "../src/main/engine/candidatePool";
import {
  RecommendationEngine,
  type FactorModule,
  type RecommendationEngineOptions,
} from "../src/main/engine/engine";
import { TeamCounterModule } from "../src/main/engine/factors/teamCounterModule";
import {
  createProContributions,
  createProSupportedEntry,
  type ProScoringProvider,
} from "../src/main/engine/proScoring";
import { DEFAULT_EVIDENCE_ORDER } from "../src/main/engine/scoringConstants";
import { DEFAULT_APP_CONFIG } from "../src/shared/config";
import type { TeamContext } from "../src/shared/championAttributes";
import type {
  ProCandidateAnalysis,
  ProEvidenceRecord,
  ProSignal,
} from "../src/shared/proData";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  FactorContribution,
  Role,
} from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const attributes = createChampionAttributeProvider("15.10.1");
const brand = mustChampion(63);
const vayne = mustChampion(67);
const ahri = mustChampion(103);
const riven = mustChampion(92);
const mundo = mustChampion(36);
const wukong = mustChampion(62);

describe("blended professional scoring", () => {
  it("keeps the documented default factor order motivated by equal-strength fixtures", async () => {
    expect(DEFAULT_EVIDENCE_ORDER).toEqual([
      "lane",
      "synergy",
      "ranked-meta",
      "enemy-answer",
      "allied-need",
      "pro-priority-flex",
      "tournament-success",
    ]);
    const meta = new FakeMeta([laneEntry(ahri, 0.5), laneEntry(vayne, 0.5)]);
    const lane = candidateFactor("laneCounter", ahri.id, 0.12);
    const synergy = candidateFactor("synergy", vayne.id, 0.12);
    const engine = createEngine(meta, [lane, synergy], null, {
      weights: DEFAULT_APP_CONFIG.weights,
    });

    const result = await engine.recommend(draft("middle"), target("middle"));

    expect(result.recommendations[0].champion.id).toBe(ahri.id);
  });

  it("lets repeated current-patch pro evidence reorder Best overall", async () => {
    const meta = new FakeMeta([
      laneEntry(brand, 0.522, 1),
      laneEntry(vayne, 0.519, 1),
    ]);
    const pro = new StubProScoring();
    pro.byChampion.set(vayne.id, createProContributions(proAnalysis(vayne.id, 5, true)));
    const engine = createEngine(meta, [], pro);

    const result = await engine.recommend(draft("middle"), target("middle"));

    expect(result.recommendations[0].champion.id).toBe(vayne.id);
    expect(result.evidenceBalance.proPercent).toBeGreaterThan(0);
    expect(
      result.recommendations[0].contributions.find(
        (item) => item.factor === "proPriority",
      ),
    ).toMatchObject({
      source: "pro",
      proEvidence: [expect.objectContaining({ effectiveSample: 5, material: true })],
    });
    expect(result.categories.find((item) => item.key === "pro")?.recommendations[0].champion.id).toBe(vayne.id);
  });

  it("does not let a single pro observation materially reorder Best overall", async () => {
    const meta = new FakeMeta([
      laneEntry(brand, 0.522, 1),
      laneEntry(vayne, 0.519, 1),
    ]);
    const pro = new StubProScoring();
    pro.byChampion.set(vayne.id, createProContributions(proAnalysis(vayne.id, 1, false)));
    const engine = createEngine(meta, [], pro);

    const result = await engine.recommend(draft("middle"), target("middle"));

    expect(result.recommendations[0].champion.id).toBe(brand.id);
    expect(result.categories.some((item) => item.key === "pro")).toBe(false);
  });

  it("admits a materially supported off-meta candidate without the ranked meta gate", async () => {
    const meta = new FakeMeta([laneEntry(brand, 0.53, 1)]);
    const pro = new StubProScoring();
    pro.entries = [createProSupportedEntry(riven)];
    pro.byChampion.set(riven.id, createProContributions(proAnalysis(riven.id, 6, true)));
    const engine = createEngine(meta, [], pro);

    const result = await engine.recommend(draft("middle"), target("middle"));

    expect(result.recommendations.map((item) => item.champion.id)).toContain(riven.id);
    expect(
      result.recommendations
        .find((item) => item.champion.id === riven.id)
        ?.contributions.find((item) => item.factor === "meta")?.reasons,
    ).toEqual(["Ranked meta: no role-specific baseline"]);
  });

  it("preserves ranked-only parity when pro evidence is disabled or missing", async () => {
    const laneMeta = [laneEntry(brand, 0.522, 1), laneEntry(vayne, 0.519, 1)];
    const pro = new StubProScoring();
    pro.byChampion.set(vayne.id, createProContributions(proAnalysis(vayne.id, 5, true)));
    const disabled = createEngine(new FakeMeta(laneMeta), [], pro, {
      proEvidenceEnabled: false,
    });
    const missing = createEngine(new FakeMeta(laneMeta), [], null, {
      proEvidenceEnabled: true,
    });

    const disabledResult = await disabled.recommend(draft("middle"), target("middle"));
    const missingResult = await missing.recommend(draft("middle"), target("middle"));

    expect(disabledResult.recommendations).toEqual(missingResult.recommendations);
    expect(disabledResult.evidenceBalance.proPercent).toBe(0);
  });

  it("lets reduced-confidence anticipated threats reorder enemy answers", async () => {
    const meta = new FakeMeta([laneEntry(wukong, 0.5, 2), laneEntry(vayne, 0.5, 2)]);
    const teamCounter = new TeamCounterModule(
      meta,
      attributes,
      () => "global",
      () => "emerald_plus",
      () => 0.58,
    );
    const engine = createEngine(meta, [teamCounter], null, {
      weights: {
        meta: 1,
        laneCounter: 0,
        teamCounter: 1,
        synergy: 0,
        compFit: 0,
      },
    });
    const noThreat = await engine.recommend(draft("bottom"), target("bottom"));
    const threat: AnticipatedThreat = {
      champion: mundo,
      role: "top",
      source: "forecast",
      confidence: 1,
      pinned: false,
      evidence: ["Hypothetical pro priority"],
    };
    const withThreat = await engine.recommend(draft("bottom"), target("bottom"), [threat]);

    expect(noThreat.recommendations[0].champion.id).toBe(wukong.id);
    expect(withThreat.recommendations[0].champion.id).toBe(vayne.id);
    expect(
      withThreat.recommendations[0].contributions
        .find((item) => item.factor === "teamCounter")
        ?.reasons[0],
    ).toContain("Hypothetical");
  });

  it("reranks cached blended evidence without any ranked or pro data calls", async () => {
    const meta = new FakeMeta([laneEntry(brand, 0.52, 1), laneEntry(vayne, 0.51, 2)]);
    const pro = new StubProScoring();
    pro.byChampion.set(vayne.id, createProContributions(proAnalysis(vayne.id, 5, true)));
    let options = engineOptions();
    const engine = new RecommendationEngine(
      meta,
      [],
      () => options,
      async () => neutralContext(),
      buildCandidatePool,
      pro,
    );
    await engine.recommend(draft("middle"), target("middle"));
    meta.laneMetaCalls = 0;
    pro.candidateCalls = 0;
    pro.contributionCalls = 0;
    options = {
      ...options,
      weights: { ...options.weights, meta: 0.2 },
    };

    expect(engine.rerankLatest()).not.toBeNull();
    expect(meta.laneMetaCalls).toBe(0);
    expect(pro.candidateCalls).toBe(0);
    expect(pro.contributionCalls).toBe(0);
  });
});

class StubProScoring implements ProScoringProvider {
  entries: LaneMetaEntry[] = [];
  byChampion = new Map<number, FactorContribution[]>();
  candidateCalls = 0;
  contributionCalls = 0;

  candidateEntries(): LaneMetaEntry[] {
    this.candidateCalls += 1;
    return this.entries;
  }

  contributions(candidate: ChampionRef): FactorContribution[] {
    this.contributionCalls += 1;
    return this.byChampion.get(candidate.id) ?? [];
  }
}

function createEngine(
  meta: MetaDataSource,
  factors: FactorModule[],
  pro: ProScoringProvider | null,
  overrides: Partial<RecommendationEngineOptions> = {},
): RecommendationEngine {
  return new RecommendationEngine(
    meta,
    factors,
    engineOptions(overrides),
    async () => neutralContext(),
    buildCandidatePool,
    pro,
  );
}

function engineOptions(
  overrides: Partial<RecommendationEngineOptions> = {},
): RecommendationEngineOptions {
  return {
    region: "global",
    rank: "emerald_plus",
    topN: 5,
    candidateCap: 40,
    weights: {
      meta: 1,
      laneCounter: 0,
      teamCounter: 0,
      synergy: 0,
      compFit: 0,
    },
    shrinkK: 0,
    pickRateFloor: 0,
    metaRolePresenceFloor: 0,
    proEvidenceEnabled: true,
    ...overrides,
  };
}

function proAnalysis(
  championId: number,
  sample: number,
  material: boolean,
): ProCandidateAnalysis {
  const priority = signal(1, sample, material);
  const rolePresence = signal(1, sample, material);
  const empty = signal(0, 0, false, []);

  return {
    championId,
    role: "middle",
    priority,
    rolePresence,
    flex: empty,
    synergy: empty,
    matchup: empty,
    response: empty,
    composition: empty,
    success: empty,
    favorite: empty,
    overallStrength: material ? 0.5 : 0,
    proInspiredStrength: material ? 0.5 : 0,
    evidence: [...priority.evidence, ...rolePresence.evidence],
  };
}

function signal(
  value: number,
  sample: number,
  material: boolean,
  evidence: ProEvidenceRecord[] = [proEvidence(sample, material)],
): ProSignal {
  return {
    value,
    confidence: sample > 0 ? sample / (sample + 5) : 0,
    effectiveSample: sample,
    material,
    evidence,
  };
}

function proEvidence(sample: number, material: boolean): ProEvidenceRecord {
  return {
    kind: "priority",
    text: `${material ? "MSI" : "Observation · MSI"} · patch 26.13 · ${sample} picks / 0 bans`,
    statistics: { picks: sample, bans: 0 },
    patches: ["26.13"],
    competitions: ["MSI 2026"],
    teams: [],
    effectiveSample: sample,
    confidence: sample > 0 ? sample / (sample + 5) : 0,
    ageDays: 1,
    material,
  };
}

function candidateFactor(
  key: string,
  championId: number,
  delta: number,
): FactorModule {
  return {
    key,
    enabled: true,
    contribute: async (candidate) => ({
      factor: key,
      delta: candidate.id === championId ? delta : 0,
      confidence: 1,
      reasons: [],
    }),
  };
}

function draft(role: Role): DraftState {
  const targetPlayer = player(0, "ally", role, null);
  return {
    phase: "champSelect",
    allies: [targetPlayer],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [0],
    localPlayer: targetPlayer,
  };
}

function target(role: Role): DraftTarget {
  return {
    side: "ally",
    cellId: 0,
    role,
    source: "automatic",
    purpose: "recommend",
  };
}

function player(
  cellId: number,
  side: DraftPlayer["side"],
  role: Role,
  champion: ChampionRef | null,
): DraftPlayer {
  return {
    cellId,
    side,
    role,
    champion,
    pickState: champion ? "locked" : "empty",
    isLocalPlayer: cellId === 0,
    roleSource: "assigned",
    roleConfidence: 1,
  };
}

function laneEntry(
  champion: ChampionRef,
  winRate: number,
  tier = 2,
): LaneMetaEntry {
  return {
    champion,
    winRate,
    tier,
    pickRate: 0.08,
    play: 20_000,
    roleRate: 1,
  };
}

function neutralContext(): TeamContext {
  const composition = {
    adWeight: 0,
    apWeight: 0,
    engage: 0,
    peel: 0,
    frontline: 0,
    poke: 0,
    waveclear: 0,
    cc: 0,
    mobility: 0,
    carryPotential: 0,
    rangedCount: 0,
    powerCurve: { early: 0, mid: 0, late: 0 },
    championCount: 0,
    averageRoleConfidence: 1,
    averageAttributeConfidence: 1,
  };
  return {
    ally: composition,
    enemy: composition,
    allyNeeds: [],
    enemyThreats: [],
    confidence: 1,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);
  if (!champion) throw new Error(`Missing fixture champion ${id}`);
  return champion;
}

class FakeMeta implements MetaDataSource {
  laneMetaCalls = 0;

  constructor(private readonly entries: LaneMetaEntry[]) {}

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    this.laneMetaCalls += 1;
    return this.entries;
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
  }

  async getChampionRoleFit(): Promise<RoleFit> {
    return { top: 0, jungle: 0, middle: 0, bottom: 0, utility: 0 };
  }

  async getChampionAnalysis(champion: ChampionRef): Promise<ChampionAnalysis> {
    return {
      damageStyle: champion.tags.includes("Mage") ? "ap" : "ad",
      synergies: [],
    };
  }
}
