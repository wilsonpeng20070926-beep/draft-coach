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
import {
  CANDIDATE_POOL_LIMITS,
  buildCandidatePool,
} from "../src/main/engine/candidatePool";
import { CompFitModule } from "../src/main/engine/factors/compFitModule";
import {
  RecommendationEngine,
  scoreLaneMetaEntry,
  type RecommendationEngineOptions,
} from "../src/main/engine/engine";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const provider = createChampionAttributeProvider("15.10.1");
const brand = mustChampion(63);
const nocturne = mustChampion(56);
const sett = mustChampion(875);
const topMetaChampion = champion(3001, "Meta Fighter 1", ["Fighter"]);

describe("candidate pool v2", () => {
  it("surfaces a champion outside the meta backbone from locked-ally synergy lists", async () => {
    const source = new FakeMetaDataSource();
    const laneMeta = [
      laneEntry(topMetaChampion, 0.55, 1),
      ...syntheticMetaFighters(2, 24),
      laneEntry(brand, 0.49, 5),
    ];
    source.setAnalysis(
      nocturne,
      analysisFor(nocturne, [
        synergy(nocturne, brand, "middle", 0.9, 0, 2600, 1),
      ]),
    );
    const pool = await buildCandidatePool({
      laneMeta,
      draft: createDraft({
        allies: [
          player(0, "middle", null, true),
          player(1, "jungle", nocturne, false),
        ],
      }),
      ctx: neutralContext(),
      options: createOptions(),
      metaSource: source,
      scoreMeta: (entry) => scoreLaneMetaEntry(entry, createOptions()),
      getAttributes: provider.getAttributes,
    });

    expect(laneMeta.slice(0, CANDIDATE_POOL_LIMITS.meta).some((entry) => entry.champion.id === brand.id)).toBe(false);
    expect(pool.some((entry) => entry.champion.id === brand.id)).toBe(true);
    expect(pool.some((entry) => entry.champion.id === topMetaChampion.id)).toBe(true);
    expect(pool.length).toBeLessThanOrEqual(CANDIDATE_POOL_LIMITS.maxPoolSize);
    expect(source.analysisCalls).toBe(1);
  });

  it("lets an off-meta comp-fit candidate enter the top five after full scoring", async () => {
    const source = new FakeMetaDataSource();
    const laneMeta = [
      laneEntry(topMetaChampion, 0.55, 1),
      ...syntheticMetaFighters(2, 24),
      laneEntry(brand, 0.49, 5),
    ];
    source.laneMeta = laneMeta;
    const compFitModule = new CompFitModule(
      source,
      provider,
      () => "global",
      () => "emerald_plus",
    );
    const engine = new RecommendationEngine(
      source,
      [compFitModule],
      createOptions({
        weights: {
          meta: 0,
          laneCounter: 0,
          teamCounter: 0,
          synergy: 0,
          compFit: 1,
        },
      }),
      async () => apNeedContext(1),
      (input) =>
        buildCandidatePool({
          ...input,
          getAttributes: provider.getAttributes,
        }),
    );

    const result = await engine.recommend(createDraft());

    expect(result.recommendations[0].champion.name).toBe("Brand");
    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toContain(
      "Brand",
    );
  });

  it("dedupes contributors, preserves exclusions, and stays inside the pool bound", async () => {
    const source = new FakeMetaDataSource();
    const bannedAp = champion(3901, "Banned Mage", ["Mage"]);
    const pickedTank = champion(3902, "Picked Tank", ["Tank"]);
    const laneMeta = [
      laneEntry(topMetaChampion, 0.55, 1),
      ...syntheticMetaFighters(2, 48),
      laneEntry(brand, 0.49, 5),
      laneEntry(bannedAp, 0.48, 5),
      laneEntry(pickedTank, 0.48, 5),
      laneEntry(sett, 0.47, 5),
    ];
    const pool = await buildCandidatePool({
      laneMeta,
      draft: createDraft({
        bans: [bannedAp],
        enemies: [player(5, "top", pickedTank, false)],
      }),
      ctx: {
        ...apNeedContext(1),
        enemyThreats: [{ kind: "dive", severity: 1 }],
      },
      options: createOptions(),
      metaSource: source,
      scoreMeta: (entry) => scoreLaneMetaEntry(entry, createOptions()),
      getAttributes: provider.getAttributes,
    });
    const ids = pool.map((entry) => entry.champion.id);

    expect(pool.length).toBeLessThanOrEqual(CANDIDATE_POOL_LIMITS.maxPoolSize);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(bannedAp.id);
    expect(ids).not.toContain(pickedTank.id);
    expect(ids).toContain(topMetaChampion.id);
  });
});

function syntheticMetaFighters(start: number, count: number): LaneMetaEntry[] {
  return Array.from({ length: count }, (_, index) =>
    laneEntry(
      champion(3000 + start + index, `Meta Fighter ${start + index}`, ["Fighter"]),
      0.55 - index * 0.001,
      1,
    ),
  );
}

function createOptions(
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
    shrinkK: 1000,
    pickRateFloor: 0.005,
    metaRolePresenceFloor: 0.2,
    ...overrides,
  };
}

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  const localPlayer = player(0, "middle", null, true);

  return {
    phase: "champSelect",
    allies: [localPlayer],
    enemies: [],
    bans: [],
    localPlayer,
    laneOpponent: null,
    ...overrides,
  };
}

function apNeedContext(confidence: number): TeamContext {
  return {
    ...neutralContext(),
    allyNeeds: [{ kind: "ap", severity: 1 }],
    confidence,
  };
}

function neutralContext(): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [],
    enemyThreats: [],
    confidence: 0,
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

function laneEntry(
  championRef: ChampionRef,
  winRate: number,
  tier: number,
  pickRate = 0.05,
  play = 20000,
  roleRate = 1,
): LaneMetaEntry {
  return {
    champion: championRef,
    winRate,
    tier,
    pickRate,
    play,
    roleRate,
  };
}

function player(
  cellId: number,
  role: Role | null,
  championRef: ChampionRef | null,
  isLocalPlayer: boolean,
): DraftPlayer {
  return {
    cellId,
    role,
    champion: championRef,
    isLocalPlayer,
  };
}

function analysisFor(
  championRef: ChampionRef,
  synergies: ChampionSynergyAnalysis[],
): ChampionAnalysis {
  return {
    damageStyle: championRef.tags.includes("Mage") ? "ap" : "ad",
    synergies,
  };
}

function synergy(
  championRef: ChampionRef,
  partner: ChampionRef,
  partnerPosition: Role,
  score: number,
  tier: number,
  sampleSize: number,
  confidence: number,
): ChampionSynergyAnalysis {
  return {
    championId: championRef.id,
    championName: championRef.name,
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

function champion(id: number, name: string, tags: string[]): ChampionRef {
  return {
    id,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    tags,
    iconUrl: "",
  };
}

function mustChampion(id: number): ChampionRef {
  const championRef = catalog.byId(id);

  if (!championRef) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return championRef;
}

class FakeMetaDataSource implements MetaDataSource {
  laneMeta: LaneMetaEntry[] = [];
  analysisCalls = 0;
  private readonly analyses = new Map<number, ChampionAnalysis>();

  setAnalysis(championRef: ChampionRef, analysis: ChampionAnalysis): void {
    this.analyses.set(championRef.id, analysis);
  }

  async getLaneMeta(): Promise<LaneMetaEntry[]> {
    return this.laneMeta;
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
  }

  async getChampionAnalysis(championRef: ChampionRef): Promise<ChampionAnalysis> {
    this.analysisCalls += 1;
    return this.analyses.get(championRef.id) ?? analysisFor(championRef, []);
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
