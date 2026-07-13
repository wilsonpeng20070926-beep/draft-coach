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
} from "../src/main/engine/engine";
import { benchmarkRecommendationOperation } from "../src/main/evaluation/resourceBenchmark";
import { DEFAULT_APP_CONFIG } from "../src/shared/config";
import type { DraftState, DraftTarget, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

describe("recommendation performance gate", () => {
  it("measures a cold recommendation and warm network-free reranks within the champ-select budget", async () => {
    const catalog = createFixtureCatalog();
    const entries: LaneMetaEntry[] = [103, 92, 63, 67, 36].map((id, index) => ({
      champion: catalog.byId(id)!,
      winRate: 0.53 - index * 0.005,
      tier: index + 1,
      pickRate: 0.08,
      play: 20_000,
      roleRate: 1,
    }));
    const engine = new RecommendationEngine(
      new FakeMeta(entries),
      [],
      {
        region: "global",
        rank: "emerald_plus",
        topN: 5,
        candidateCap: 40,
        weights: DEFAULT_APP_CONFIG.weights,
        shrinkK: 0,
        pickRateFloor: 0,
        metaRolePresenceFloor: 0,
        proEvidenceEnabled: false,
        proInfluence: 0,
      },
      async () => createNeutralTeamContext(),
      buildCandidatePool,
    );
    const report = await benchmarkRecommendationOperation(
      async (iteration) => {
        if (iteration === 0) {
          await engine.recommend(draft(), target());
        } else {
          expect(engine.rerankLatest()).not.toBeNull();
        }
      },
      { iterations: 6 },
    );

    if (process.env.EVALUATION_REPORT === "1") {
      console.info(`[EvaluationBenchmark] ${JSON.stringify(report)}`);
    }

    expect(report.coldLatencyMs).toBeLessThan(1_000);
    expect(report.warmP95LatencyMs).toBeLessThan(100);
    expect(report.peakHeapDeltaBytes).toBeLessThan(50 * 1024 * 1024);
  });
});

function draft(): DraftState {
  const player = {
    cellId: 0,
    side: "ally" as const,
    role: "middle" as const,
    champion: null,
    pickState: "empty" as const,
    isLocalPlayer: true,
  };
  return {
    phase: "champSelect",
    allies: [player],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [0],
    localPlayer: player,
  };
}

function target(): DraftTarget {
  return {
    side: "ally",
    cellId: 0,
    role: "middle",
    source: "automatic",
    purpose: "recommend",
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

  async getChampionAnalysis(): Promise<ChampionAnalysis> {
    return { damageStyle: "ap", synergies: [] };
  }
}
