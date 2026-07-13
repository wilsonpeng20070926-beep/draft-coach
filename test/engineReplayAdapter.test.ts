import { describe, expect, it } from "vitest";
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
  createNeutralTeamContext,
  RecommendationEngine,
  type FactorModule,
} from "../src/main/engine/engine";
import {
  createEngineReplayPredictor,
  createReplayDraft,
} from "../src/main/evaluation/engineReplayAdapter";
import type { ReplayStepContext } from "../src/main/evaluation/draftReplay";
import type { NormalizedProDraft } from "../src/shared/proData";
import type { FactorWeights } from "../src/shared/config";
import type { ChampionRef, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();

describe("production engine replay adapter", () => {
  it("rebuilds a training-only snapshot and normalizes either pro side as the recommendation side", async () => {
    const context = replayContext();
    let observedTrainingGames = 0;
    const predictor = createEngineReplayPredictor({
      resolveChampion: (championId) => catalog.byId(championId) ?? null,
      createEngine: ({ configuration, trainingSnapshot }) => {
        observedTrainingGames = trainingSnapshot.metadata.gameCount;
        return engine(configuration.weights);
      },
    });
    const prediction = await predictor(context);
    const normalized = createReplayDraft(
      context,
      (championId) => catalog.byId(championId) ?? null,
    );

    expect(observedTrainingGames).toBe(2);
    expect(normalized.target).toMatchObject({
      side: "ally",
      role: "middle",
      source: "simulation",
    });
    expect(normalized.draft.allies.map((player) => player.champion?.id)).toContain(266);
    expect(normalized.draft.enemies.map((player) => player.champion?.id)).toContain(92);
    expect(prediction.championIds).toEqual([103]);
    expect(prediction.categories?.overall).toEqual([103, 63]);
    expect(prediction.categories?.risk).toEqual([63]);
    expect(prediction.riskProbabilityByChampionId?.[63]).toBeGreaterThan(0.5);
    expect(prediction.traceByChampionId?.[63]).toContain(
      "Severely punished in the revealed lane",
    );
    expect(prediction.traceByChampionId?.[103]).toContain(
      "Meta: 53% WR · 8.0% pick · tier 1",
    );
  });
});

function engine(weights: FactorWeights): RecommendationEngine {
  const entries = [laneEntry(103, 0.53, 1), laneEntry(63, 0.51, 2)];
  return new RecommendationEngine(
    new FakeMeta(entries),
    [riskFactor()],
    {
      region: "global",
      rank: "emerald_plus",
      topN: 1,
      candidateCap: 40,
      weights,
      shrinkK: 0,
      pickRateFloor: 0,
      metaRolePresenceFloor: 0,
      proEvidenceEnabled: false,
      proInfluence: 0,
    },
    async () => createNeutralTeamContext(),
    buildCandidatePool,
  );
}

function riskFactor(): FactorModule {
  return {
    key: "laneCounter",
    enabled: true,
    contribute: async (candidate) => ({
      factor: "laneCounter",
      delta: candidate.id === 63 ? -0.15 : 0,
      confidence: 0.9,
      reasons: candidate.id === 63
        ? [{
            kind: "lane-counter",
            text: "Severely punished in the revealed lane",
            polarity: "negative",
            strength: 0.9,
            confidence: 0.9,
          }]
        : [],
    }),
  };
}

function replayContext(): ReplayStepContext {
  const trainingDrafts = [
    draft("train-1", "2026-06-01T00:00:00.000Z"),
    draft("train-2", "2026-06-02T00:00:00.000Z"),
  ];
  const heldOutDraft = draft("held-out", "2026-06-03T00:00:00.000Z");
  return {
    configuration: "current-engine",
    trainingDrafts,
    heldOutDraft,
    revealedPicks: [
      { order: 1, side: "red", role: "top", championId: 266 },
      { order: 2, side: "blue", role: "top", championId: 92 },
    ],
    nextPick: { order: 3, side: "red", role: "middle", championId: 103 },
    stepIndex: 2,
  };
}

function laneEntry(championId: number, winRate: number, tier: number): LaneMetaEntry {
  return {
    champion: catalog.byId(championId)!,
    winRate,
    tier,
    pickRate: 0.08,
    play: 20_000,
    roleRate: 1,
  };
}

function draft(gameId: string, playedAt: string): NormalizedProDraft {
  return {
    schemaVersion: 1,
    gameId,
    patch: "26.13",
    playedAt,
    competition: "Synthetic replay league",
    competitionTier: "major",
    stage: null,
    format: null,
    fearless: false,
    blueTeam: "Blue",
    redTeam: "Red",
    winner: "red",
    picks: [
      { order: 1, side: "red", role: "top", championId: 266 },
      { order: 2, side: "blue", role: "top", championId: 92 },
      { order: 3, side: "red", role: "middle", championId: 103 },
    ],
    bans: [],
  };
}

class FakeMeta implements MetaDataSource {
  constructor(private readonly entries: LaneMetaEntry[]) {}

  async getLaneMeta(_role: Role): Promise<LaneMetaEntry[]> {
    return this.entries;
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null };
  }

  async getChampionRoleFit(): Promise<RoleFit> {
    return { top: 0, jungle: 0, middle: 1, bottom: 0, utility: 0 };
  }

  async getChampionAnalysis(_champion: ChampionRef): Promise<ChampionAnalysis> {
    return { damageStyle: "ap", synergies: [] };
  }
}
