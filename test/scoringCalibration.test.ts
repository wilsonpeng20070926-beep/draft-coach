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
import { CounterModule } from "../src/main/engine/factors/counterModule";
import { SynergyModule } from "../src/main/engine/factors/synergyModule";
import { TeamCounterModule } from "../src/main/engine/factors/teamCounterModule";
import {
  RecommendationEngine,
  scoreLaneMetaEntry,
  type RecommendationEngineOptions,
} from "../src/main/engine/engine";
import { FACTOR_WEIGHT_PRESETS, type FactorWeights } from "../src/shared/config";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const ahri = mustChampion(103);
const lissandra = mustChampion(127);
const nocturne = mustChampion(56);
const orianna = mustChampion(61);
const sett = mustChampion(875);
const vladimir = mustChampion(8);
const xerath = mustChampion(101);
const yasuo = mustChampion(157);
const attributes = createChampionAttributeProvider("15.10.1");

describe("scoring calibration", () => {
  it("keeps Trust the meta ordering equivalent to meta-only ordering on neutral fixtures", async () => {
    const meta = createNeutralMeta();
    const expectedOrder = [...meta.laneMeta]
      .sort((a, b) => scoreLaneMetaEntry(b) - scoreLaneMetaEntry(a))
      .slice(0, 5)
      .map((entry) => entry.champion.name);
    const engine = createEngine(meta, FACTOR_WEIGHT_PRESETS.trustTheMeta);

    const result = await recommend(engine, createDraft());

    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual(
      expectedOrder,
    );
  });

  it("lets a synergy/counter-forward preset reorder a motivated top five", async () => {
    const meta = createMotivatedMeta();
    const trustEngine = createEngine(meta, FACTOR_WEIGHT_PRESETS.trustTheMeta);
    const coachEngine = createEngine(meta, FACTOR_WEIGHT_PRESETS.coach);
    const draft = createDraft({
      allies: [player(0, "middle", null, true), player(1, "jungle", nocturne, false)],
      enemies: [player(5, "middle", yasuo, false, "assigned", 1)],
    });

    const trust = await recommend(trustEngine, draft);
    const coach = await recommend(coachEngine, draft);
    const trustOrder = trust.recommendations.map((recommendation) => recommendation.champion.name);
    const coachOrder = coach.recommendations.map((recommendation) => recommendation.champion.name);

    expect(trustOrder[0]).toBe("Ahri");
    expect(coachOrder[0]).toBe("Orianna");
    expect(coachOrder).not.toEqual(trustOrder);
  });

  it("keeps calibrated totals away from clamp pileups", async () => {
    const engine = createEngine(createMotivatedMeta(), FACTOR_WEIGHT_PRESETS.coach);
    const result = await recommend(
      engine,
      createDraft({
        allies: [player(0, "middle", null, true), player(1, "jungle", nocturne, false)],
        enemies: [player(5, "middle", yasuo, false, "assigned", 1)],
      }),
    );
    const totals = result.recommendations.map((recommendation) => recommendation.total);

    expect(Math.min(...totals)).toBeGreaterThan(0.2);
    expect(Math.max(...totals)).toBeLessThan(0.85);
    expect(totals.some((total) => total === 0 || total === 1)).toBe(false);
  });

  it("scores the same candidate lower into a worse lane matchup than an even one", async () => {
    const evenMeta = new FakeMetaDataSource([laneEntry(ahri, 0.52, 1)]);
    evenMeta.setMatchup(ahri, yasuo, 0.5);
    const riskyMeta = new FakeMetaDataSource([laneEntry(ahri, 0.52, 1)]);
    riskyMeta.setMatchup(ahri, yasuo, 0.46);
    const draft = createDraft({
      enemies: [player(5, "middle", yasuo, false, "assigned", 1)],
    });

    const even = await recommend(createEngine(evenMeta, FACTOR_WEIGHT_PRESETS.laneBully), draft);
    const risky = await recommend(createEngine(riskyMeta, FACTOR_WEIGHT_PRESETS.laneBully), draft);

    expect(risky.recommendations[0].total).toBeLessThan(even.recommendations[0].total);
  });

  it("lets lane-bully weights lift a team-counter answer above a vulnerable meta pick", async () => {
    const meta = new FakeMetaDataSource([
      laneEntry(xerath, 0.535, 1),
      laneEntry(sett, 0.527, 2),
    ]);
    meta.setAnalysis(xerath, analysisFor(xerath, []));
    meta.setAnalysis(sett, analysisFor(sett, []));
    const trustEngine = createTeamCounterEngine(meta, FACTOR_WEIGHT_PRESETS.trustTheMeta);
    const laneBullyEngine = createTeamCounterEngine(meta, FACTOR_WEIGHT_PRESETS.laneBully);
    const draft = createDraft({
      localPlayer: player(0, "top", null, true),
      allies: [player(0, "top", null, true)],
    });

    const trust = await recommend(trustEngine, draft);
    const laneBully = await recommend(laneBullyEngine, draft);

    expect(trust.recommendations[0].champion.name).toBe("Xerath");
    expect(laneBully.recommendations[0].champion.name).toBe("Sett");
    expect(
      laneBully.recommendations[0].contributions
        .find((contribution) => contribution.factor === "teamCounter")
        ?.reasonChips?.[0],
    ).toEqual(expect.objectContaining({ text: "Frontline answers their dive" }));
  });
});

function createNeutralMeta(): FakeMetaDataSource {
  return new FakeMetaDataSource([
    laneEntry(ahri, 0.535, 1),
    laneEntry(orianna, 0.526, 2),
    laneEntry(lissandra, 0.522, 2),
    laneEntry(vladimir, 0.518, 3),
    laneEntry(xerath, 0.516, 3),
  ]);
}

function createMotivatedMeta(): FakeMetaDataSource {
  const meta = createNeutralMeta();

  meta.setMatchup(ahri, yasuo, 0.46);
  meta.setMatchup(orianna, yasuo, 0.58);
  meta.setMatchup(lissandra, yasuo, 0.5);
  meta.setMatchup(vladimir, yasuo, 0.5);
  meta.setMatchup(xerath, yasuo, 0.5);
  meta.setAnalysis(ahri, analysisFor(ahri, []));
  meta.setAnalysis(
    orianna,
    analysisFor(orianna, [synergy(orianna, nocturne, "jungle", 0.9, 0, 2600, 1)]),
  );
  meta.setAnalysis(lissandra, analysisFor(lissandra, []));
  meta.setAnalysis(vladimir, analysisFor(vladimir, []));
  meta.setAnalysis(xerath, analysisFor(xerath, []));

  return meta;
}

function createEngine(meta: MetaDataSource, weights: FactorWeights): RecommendationEngine {
  const counter = new CounterModule(meta, () => "global", () => "emerald_plus", () => 0.58);
  const synergy = new SynergyModule(meta, () => "global", () => "emerald_plus", () => 0.58);
  const teamCounter = new TeamCounterModule(
    meta,
    attributes,
    () => "global",
    () => "emerald_plus",
    () => 0.58,
  );

  return new RecommendationEngine(meta, [counter, teamCounter, synergy], createOptions(weights));
}

function createTeamCounterEngine(
  meta: MetaDataSource,
  weights: FactorWeights,
): RecommendationEngine {
  const teamCounter = new TeamCounterModule(
    meta,
    attributes,
    () => "global",
    () => "emerald_plus",
    () => 0.58,
  );

  return new RecommendationEngine(
    meta,
    [teamCounter],
    createOptions(weights),
    async () => diveThreatContext(1),
  );
}

function createOptions(weights: FactorWeights): RecommendationEngineOptions {
  return {
    region: "global",
    rank: "emerald_plus",
    topN: 5,
    candidateCap: 30,
    weights,
    shrinkK: 1000,
    pickRateFloor: 0.005,
    metaRolePresenceFloor: 0.2,
  };
}

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  const localPlayer = player(0, "middle", null, true);

  return {
    phase: "champSelect",
    allies: [localPlayer],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer,
    ...overrides,
  };
}

function diveThreatContext(confidence: number): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [],
    enemyThreats: [{ kind: "dive", severity: 1 }],
    confidence,
  };
}

function emptyComposition(): TeamContext["ally"] {
  return {
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
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };
}

function player(
  cellId: number,
  role: Role | null,
  champion: ChampionRef | null,
  isLocalPlayer: boolean,
  roleSource?: DraftPlayer["roleSource"],
  roleConfidence?: number,
): DraftPlayer {
  return {
    cellId,
    side: cellId >= 5 ? "enemy" : "ally",
    role,
    champion,
    pickState: champion ? "locked" : "empty",
    isLocalPlayer,
    roleSource,
    roleConfidence,
  };
}

function recommend(engine: RecommendationEngine, draft: DraftState) {
  const player = draft.localPlayer;

  if (!player?.role) {
    throw new Error("Calibration draft requires a target role");
  }

  return engine.recommend(draft, {
    side: "ally",
    cellId: player.cellId,
    role: player.role,
    source: "automatic",
    purpose: "recommend",
  });
}

function laneEntry(
  champion: ChampionRef,
  winRate: number,
  tier: number,
  pickRate = 0.1,
  play = 20000,
  roleRate = 1,
): LaneMetaEntry {
  return {
    champion,
    winRate,
    tier,
    pickRate,
    play,
    roleRate,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

class FakeMetaDataSource implements MetaDataSource {
  private readonly matchups = new Map<string, number>();
  private readonly analyses = new Map<number, ChampionAnalysis>();

  constructor(readonly laneMeta: LaneMetaEntry[]) {}

  setMatchup(candidate: ChampionRef, opponent: ChampionRef, winRate: number): void {
    this.matchups.set(`${candidate.id}:${opponent.id}`, winRate);
  }

  setAnalysis(champion: ChampionRef, analysis: ChampionAnalysis): void {
    this.analyses.set(champion.id, analysis);
  }

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    return this.laneMeta;
  }

  async getMatchup(candidate: ChampionRef, opponent: ChampionRef): Promise<MatchupResult> {
    return {
      winRate: this.matchups.get(`${candidate.id}:${opponent.id}`) ?? 0.5,
    };
  }

  async getSynergy(a: ChampionRef, b: ChampionRef): Promise<SynergyResult> {
    const match = this.analyses
      .get(a.id)
      ?.synergies.find((synergy) => synergy.partnerChampionId === b.id);

    return match
      ? {
          score: match.score,
          winRate: match.winRate,
          sampleSize: match.sampleSize,
          notable: match.notable,
          tier: match.tier,
          confidence: match.confidence,
        }
      : { score: null };
  }

  async getChampionAnalysis(champion: ChampionRef): Promise<ChampionAnalysis> {
    return this.analyses.get(champion.id) ?? analysisFor(champion, []);
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

function analysisFor(
  champion: ChampionRef,
  synergies: ChampionSynergyAnalysis[],
): ChampionAnalysis {
  return {
    damageStyle: champion.tags.includes("Mage") ? "ap" : "ad",
    synergies,
  };
}

function synergy(
  champion: ChampionRef,
  partner: ChampionRef,
  partnerPosition: Role,
  score: number,
  tier: number,
  sampleSize: number,
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
    sampleSize,
    tier,
    winRate: 0.53,
    notable: tier <= 1,
  };
}
