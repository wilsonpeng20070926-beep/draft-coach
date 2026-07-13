import { describe, expect, it, vi } from "vitest";
import type {
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "../src/main/data/metaDataSource";
import {
  createMetaContribution,
  createMetaBase,
  HOVER_RECOMMENDATION_DEBOUNCE_MS,
  RecommendationEngine,
  RecommendationRunner,
  scoreLaneMetaEntry,
  type FactorModule,
  type RecommendationEngineOptions,
} from "../src/main/engine/engine";
import { DELTA_CAP } from "../src/main/engine/scoringConstants";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ChampionRef, DraftPlayer, DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const ahri = mustChampion(103);
const darius = mustChampion(122);
const jax = mustChampion(24);
const wukong = mustChampion(62);
const yasuo = mustChampion(157);
const zaahen = mustChampion(904);
const riven = mustChampion(92);

describe("RecommendationEngine", () => {
  it("excludes banned and picked champions from the candidate pool", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [
      laneEntry(ahri, 0.53, 1),
      laneEntry(darius, 0.52, 1),
      laneEntry(jax, 0.51, 2),
      laneEntry(wukong, 0.5, 3),
    ];
    const engine = createEngine(meta, []);
    const recommendationTarget = player(0, "middle", null, true);
    const draft = createDraft({
      bans: [jax],
      allies: [
        recommendationTarget,
        player(1, "top", ahri, false, "ally"),
      ],
      enemies: [player(5, "middle", darius, false)],
      localPlayer: recommendationTarget,
    });

    const result = await recommend(engine, draft);

    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual([
      "Wukong",
    ]);
  });

  it("combines bounded meta base and weighted factor deltas", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.47, 5)];
    const factor: FactorModule = fixedFactor("laneCounter", DELTA_CAP);
    const engine = createEngine(meta, [factor], {
      weights: {
        meta: 0.25,
        laneCounter: 0.75,
        teamCounter: 0,
        synergy: 0,
        compFit: 0,
      },
      topN: 1,
      candidateCap: 10,
    });

    const result = await recommend(engine, createDraft());
    const expectedBase = createMetaBase(scoreLaneMetaEntry(meta.laneMeta[0]), 0.25);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].total).toBeCloseTo(expectedBase + DELTA_CAP * 0.75, 5);
    expect(result.recommendations[0].contributions.map((contribution) => contribution.factor)).toEqual([
      "meta",
      "laneCounter",
    ]);
  });

  it("respects top-N after sorting", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [
      laneEntry(jax, 0.5, 3),
      laneEntry(wukong, 0.53, 1),
      laneEntry(ahri, 0.52, 1),
    ];
    const engine = createEngine(meta, [], { topN: 2, candidateCap: 10 });

    const result = await recommend(engine, createDraft());

    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual([
      "Wukong",
      "Ahri",
    ]);
  });

  it("shrinks thin-sample win rate and down-weights picks below the floor", async () => {
    const thinHighWin = laneEntry(jax, 0.6, 1, 0.001, 50);
    const sturdyMeta = laneEntry(wukong, 0.52, 2, 0.07, 20000);
    const weakLowPick = laneEntry(zaahen, 0.4971, 4, 0.0022, 1100);

    expect(scoreLaneMetaEntry(sturdyMeta)).toBeGreaterThan(scoreLaneMetaEntry(thinHighWin));
    expect(scoreLaneMetaEntry(sturdyMeta)).toBeGreaterThan(scoreLaneMetaEntry(weakLowPick));
  });

  it("excludes champions without meaningful presence in the local role", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [
      laneEntry(riven, 0.53, 3, 0.01, 300466, 0.15),
      laneEntry(ahri, 0.52, 1, 0.11, 5312867, 0.97),
    ];
    const engine = createEngine(meta, [], { topN: 5, candidateCap: 10 });

    const result = await recommend(engine, createDraft());

    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual([
      "Ahri",
    ]);
  });

  it("formats meta reasons with normalized percentages and small tiers", () => {
    const contribution = createMetaContribution(laneEntry(zaahen, 0.4971, 4, 0.0224, 1104733));

    expect(contribution.reasons).toEqual(["Meta: 50% WR · 2.2% pick · tier 4"]);
  });

  it("returns no recommendations outside champ select or without a role", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.53, 1)];
    const engine = createEngine(meta, []);

    await expect(recommend(engine, createDraft({ phase: "inProgress" }))).resolves.toMatchObject({
      recommendations: [],
    });
    await expect(
      recommend(
        engine,
        createDraft({
          allies: [player(0, null, null, true)],
          localPlayer: player(0, null, null, true),
        }),
      ),
    ).resolves.toMatchObject({
      recommendations: [],
    });
  });

  it("ignores unweighted future factors until config gives them a weight", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.47, 5), laneEntry(wukong, 0.47, 5)];
    const seamFactor: FactorModule = {
      key: "seam",
      enabled: true,
      contribute: async (candidate) => ({
        factor: "seam",
        delta: candidate.id === wukong.id ? DELTA_CAP : -DELTA_CAP,
        confidence: 1,
        reasons:
          candidate.id === wukong.id
            ? [
                {
                  kind: "warning",
                  text: "Seam factor",
                  polarity: "positive",
                  strength: 1,
                  confidence: 1,
                },
              ]
            : [],
      }),
    };
    const engine = createEngine(meta, [seamFactor]);

    const result = await recommend(engine, createDraft());

    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual([
      "Wukong",
      "Ahri",
    ]);
    expect(result.recommendations[0].contributions.some((item) => item.factor === "seam")).toBe(
      false,
    );
  });

  it("reranks cached scored candidates when weights change without calling data sources", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.53, 1), laneEntry(wukong, 0.5, 3)];
    let options = createEngineOptions({
      weights: {
        meta: 1,
        laneCounter: 0,
        teamCounter: 0,
        synergy: 0,
        compFit: 0,
      },
    });
    const counterFactor: FactorModule = {
      key: "counter",
      enabled: true,
      contribute: async (candidate) => {
        counterFactorCalls += 1;
        return {
          factor: "laneCounter",
          delta: candidate.id === wukong.id ? DELTA_CAP : 0,
          confidence: 1,
          reasons:
            candidate.id === wukong.id
              ? [
                  {
                    kind: "lane-counter",
                    text: "Counter lift",
                    polarity: "positive",
                    strength: 1,
                    confidence: 1,
                  },
                ]
              : [],
        };
      },
    };
    let counterFactorCalls = 0;
    const engine = new RecommendationEngine(meta, [counterFactor], () => options);

    const initial = await recommend(engine, createDraft());
    expect(initial.recommendations[0].champion.name).toBe("Ahri");
    expect(meta.laneMetaCalls).toBe(1);
    expect(counterFactorCalls).toBe(2);

    meta.laneMetaCalls = 0;
    counterFactorCalls = 0;
    options = {
      ...options,
      weights: {
        meta: 0,
        laneCounter: 1,
        teamCounter: 0,
        synergy: 0,
        compFit: 0,
      },
    };
    const reranked = engine.rerankLatest();

    expect(reranked?.recommendations[0].champion.name).toBe("Wukong");
    expect(meta.laneMetaCalls).toBe(0);
    expect(counterFactorCalls).toBe(0);
  });

  it("builds TeamContext once for recommend and not for rerankLatest", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.53, 1), laneEntry(wukong, 0.5, 3)];
    const seenConfidences: number[] = [];
    const contextFactor: FactorModule = {
      key: "synergy",
      enabled: true,
      contribute: async (_candidate, _draft, _target, ctx) => {
        seenConfidences.push(ctx.confidence);
        return {
          factor: "synergy",
          delta: 0,
          confidence: 1,
          reasons: [],
        };
      },
    };
    let contextBuilds = 0;
    let poolBuilds = 0;
    const engine = new RecommendationEngine(
      meta,
      [contextFactor],
      createEngineOptions(),
      async () => {
        contextBuilds += 1;
        return contextWithConfidence(0.73);
      },
      async (input) => {
        poolBuilds += 1;
        return input.laneMeta;
      },
    );

    await recommend(engine, createDraft());
    expect(contextBuilds).toBe(1);
    expect(poolBuilds).toBe(1);
    expect(seenConfidences).toEqual([0.73, 0.73]);

    contextBuilds = 0;
    poolBuilds = 0;
    seenConfidences.length = 0;
    meta.laneMetaCalls = 0;
    const reranked = engine.rerankLatest();

    expect(reranked).not.toBeNull();
    expect(contextBuilds).toBe(0);
    expect(poolBuilds).toBe(0);
    expect(seenConfidences).toEqual([]);
    expect(meta.laneMetaCalls).toBe(0);
  });

  it("falls back to meta-only ordering when all weights are zero", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.53, 1), laneEntry(wukong, 0.5, 3)];
    const engine = createEngine(meta, [fixedFactor("counter", 0)], {
      weights: {
        meta: 0,
        laneCounter: 0,
        teamCounter: 0,
        synergy: 0,
        compFit: 0,
      },
    });

    const result = await recommend(engine, createDraft());

    expect(result.limitedDataNote).toBe("All weights are zero; showing meta-only fallback.");
    expect(result.recommendations.map((recommendation) => recommendation.champion.name)).toEqual([
      "Ahri",
      "Wukong",
    ]);
  });

  it("keeps recommendation order deterministic for the same draft and weights", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [
      laneEntry(jax, 0.5, 3),
      laneEntry(wukong, 0.53, 1),
      laneEntry(ahri, 0.52, 1),
    ];
    const engine = createEngine(meta, [fixedFactor("laneCounter", 0)]);
    const draft = createDraft();

    const first = await recommend(engine, draft);
    const second = await recommend(engine, draft);

    expect(second.recommendations.map((recommendation) => recommendation.champion.name)).toEqual(
      first.recommendations.map((recommendation) => recommendation.champion.name),
    );
  });

  it("marks older async runs as stale", async () => {
    const meta = new QueuedLaneMetaSource();
    const runner = new RecommendationRunner(createEngine(meta, []));
    const first = createDeferred<LaneMetaEntry[]>();
    const second = createDeferred<LaneMetaEntry[]>();
    meta.queue.push(first.promise, second.promise);

    const firstRun = runner.recommendLatest(createDraft(), target());
    const secondRun = runner.recommendLatest(createDraft(), target());
    second.resolve([laneEntry(ahri, 0.53, 1)]);
    const secondResult = await secondRun;
    first.resolve([laneEntry(darius, 0.53, 1)]);
    const firstResult = await firstRun;

    expect(secondResult?.recommendations[0].champion.name).toBe("Ahri");
    expect(firstResult).toBeNull();
  });

  it("recommends for an explicit top target after the local mid pick locks", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(ahri, 0.53, 1), laneEntry(wukong, 0.51, 2)];
    const localMid = player(0, "middle", ahri, true);
    const topAlly = player(1, "top", null, false, "ally");
    const draft = createDraft({
      allies: [localMid, topAlly],
      localPlayer: localMid,
    });

    const result = await recommend(engineFor(meta), draft, target(1, "top"));

    expect(meta.requestedRoles).toEqual(["top"]);
    expect(result.recommendations.map((item) => item.champion.name)).toEqual([
      "Wukong",
    ]);
  });

  it("scores every simultaneous allied target in one stale-safe batch", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(wukong, 0.52, 2)];
    const middle = player(0, "middle", null, true);
    const top = player(1, "top", null, false, "ally");
    const draft = createDraft({
      allies: [middle, top],
      localPlayer: middle,
      activeAllyPickCellIds: [0, 1],
    });
    const runner = new RecommendationRunner(engineFor(meta));

    const results = await runner.recommendTargetsLatest(draft, [
      target(0, "middle"),
      target(1, "top"),
    ]);

    expect(results).toHaveLength(2);
    expect(results?.every((result) => result.recommendations.length === 1)).toBe(true);
    expect(meta.requestedRoles).toEqual(["middle", "top"]);
  });

  it("keeps a target hover scoreable while locked champions stay excluded", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [
      laneEntry(ahri, 0.54, 1),
      laneEntry(wukong, 0.52, 2),
    ];
    const hoveredTarget = player(0, "middle", riven, true, "ally", "hovering");
    const lockedAlly = player(1, "top", ahri, false, "ally", "locked");
    const draft = createDraft({
      allies: [hoveredTarget, lockedAlly],
      localPlayer: hoveredTarget,
    });

    const result = await recommend(engineFor(meta), draft);

    expect(result.evaluation).toMatchObject({
      champion: expect.objectContaining({ name: "Riven" }),
      state: "hovering",
      strengths: ["Meta: no role-specific ranked baseline"],
    });
    expect(result.recommendations.map((item) => item.champion.name)).not.toContain(
      "Ahri",
    );
  });

  it("turns a locked target pick into a reusable strengths, risks, and team-fit evaluation", async () => {
    const meta = new FakeMetaDataSource();
    meta.laneMeta = [laneEntry(riven, 0.52, 2)];
    const lockedTarget = player(0, "middle", riven, true, "ally", "locked");
    const draft = createDraft({ allies: [lockedTarget], localPlayer: lockedTarget });

    const result = await recommend(engineFor(meta), draft);

    expect(result.recommendations).toEqual([]);
    expect(result.evaluation).toMatchObject({
      champion: expect.objectContaining({ name: "Riven" }),
      state: "locked",
      strengths: [expect.stringContaining("Meta:")],
      risks: [],
      teamFit: [],
      evidence: expect.any(Array),
    });
  });

  it("debounces hover recomputation and cancels the stale pending hover", async () => {
    vi.useFakeTimers();

    try {
      const meta = new FakeMetaDataSource();
      meta.laneMeta = [laneEntry(riven, 0.51, 2)];
      const runner = new RecommendationRunner(engineFor(meta));
      const hovered = player(0, "middle", riven, true, "ally", "hovering");
      const draft = createDraft({ allies: [hovered], localPlayer: hovered });
      const first = runner.recommendLatest(draft, target());
      const second = runner.recommendLatest(draft, target());

      await vi.advanceTimersByTimeAsync(HOVER_RECOMMENDATION_DEBOUNCE_MS - 1);
      expect(meta.laneMetaCalls).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      await expect(first).resolves.toBeNull();
      await expect(second).resolves.toMatchObject({
        evaluation: expect.objectContaining({ state: "hovering" }),
      });
      expect(meta.laneMetaCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function engineFor(meta: MetaDataSource): RecommendationEngine {
  return createEngine(meta, []);
}

function createEngine(
  meta: MetaDataSource,
  factors: FactorModule[],
  overrides: Partial<RecommendationEngineOptions> = {},
): RecommendationEngine {
  return new RecommendationEngine(meta, factors, createEngineOptions(overrides));
}

function createEngineOptions(
  overrides: Partial<RecommendationEngineOptions> = {},
): RecommendationEngineOptions {
  return {
    region: "global",
    rank: "emerald_plus",
    topN: 5,
    candidateCap: 30,
    weights: {
      meta: 1,
      laneCounter: 0.1,
      teamCounter: 0,
      synergy: 0.05,
      compFit: 0,
    },
    shrinkK: 1000,
    pickRateFloor: 0.005,
    metaRolePresenceFloor: 0.2,
    ...overrides,
  };
}

function fixedFactor(key: string, delta: number): FactorModule {
  return {
    key,
    enabled: true,
    contribute: async () => ({
      factor: key,
      delta,
      confidence: 1,
      reasons: [],
    }),
  };
}

function createDraft(overrides: Partial<DraftState> = {}): DraftState {
  return {
    phase: "champSelect",
    allies: [player(0, "middle", null, true)],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer: player(0, "middle", null, true),
    ...overrides,
  };
}

function player(
  cellId: number,
  role: Role | null,
  champion: ChampionRef | null,
  isLocalPlayer: boolean,
  side: DraftPlayer["side"] = isLocalPlayer ? "ally" : "enemy",
  pickState: DraftPlayer["pickState"] = champion ? "locked" : "empty",
): DraftPlayer {
  return {
    cellId,
    side,
    role,
    champion,
    pickState,
    isLocalPlayer,
  };
}

function target(cellId = 0, role: Role = "middle") {
  return {
    side: "ally" as const,
    cellId,
    role,
    source: "automatic" as const,
    purpose: "recommend" as const,
  };
}

function recommend(
  engine: RecommendationEngine,
  draft: DraftState,
  draftTarget = target(),
) {
  return engine.recommend(draft, draftTarget);
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

function contextWithConfidence(confidence: number): TeamContext {
  return {
    ally: emptyComposition(),
    enemy: emptyComposition(),
    allyNeeds: [],
    enemyThreats: [],
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

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

class FakeMetaDataSource implements MetaDataSource {
  laneMeta: LaneMetaEntry[] = [];
  laneMetaCalls = 0;
  requestedRoles: Role[] = [];

  async getLaneMeta(role: Role): Promise<LaneMetaEntry[]> {
    this.laneMetaCalls += 1;
    this.requestedRoles.push(role);
    return this.laneMeta;
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
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

class QueuedLaneMetaSource extends FakeMetaDataSource {
  queue: Array<Promise<LaneMetaEntry[]>> = [];

  override async getLaneMeta(): Promise<LaneMetaEntry[]> {
    const next = this.queue.shift();

    if (!next) {
      throw new Error("No queued lane meta result");
    }

    return next;
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });

  return {
    promise,
    resolve: resolveValue,
  };
}
