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
  EVALUATION_CONFIGURATIONS,
  type EvaluationConfiguration,
} from "../src/main/evaluation/evaluationConfigurations";
import type {
  ChampionRef,
  DraftState,
  DraftTarget,
  Role,
} from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const metaLeader = mustChampion(103);
const draftFit = mustChampion(92);

describe("production-engine configuration comparison", () => {
  it("shows draft-aware and blended configurations complementing the ranked-only baseline", async () => {
    const results = new Map<string, Awaited<ReturnType<RecommendationEngine["recommend"]>>>();

    for (const configuration of EVALUATION_CONFIGURATIONS) {
      const engine = createEngine(configuration);
      results.set(
        configuration.id,
        await engine.recommend(draft(), target()),
      );
    }

    expect(results.get("ranked-only")?.recommendations[0].champion.id).toBe(
      metaLeader.id,
    );
    expect(results.get("current-engine")?.recommendations[0].champion.id).toBe(
      draftFit.id,
    );
    expect(results.get("blended-default")?.recommendations[0].champion.id).toBe(
      draftFit.id,
    );
    expect(results.get("pro-forward")?.recommendations[0].champion.id).toBe(
      draftFit.id,
    );
    expect(results.get("pro-forward")!.evidenceBalance.proPercent).toBeGreaterThan(
      results.get("blended-default")!.evidenceBalance.proPercent,
    );

    for (const result of results.values()) {
      expect(
        result.recommendations.slice(0, 5).every((recommendation) =>
          recommendation.contributions.some((contribution) =>
            contribution.reasons.some((reason) => reason.trim().length > 0),
          ),
        ),
      ).toBe(true);
    }
  });
});

function createEngine(configuration: EvaluationConfiguration): RecommendationEngine {
  const factors = [draftFactor()];
  if (configuration.proEvidenceEnabled) {
    factors.push(proFactor());
  }

  return new RecommendationEngine(
    new FakeMeta([
      laneEntry(metaLeader, 0.525),
      laneEntry(draftFit, 0.515),
    ]),
    factors,
    {
      region: "global",
      rank: "emerald_plus",
      topN: 5,
      candidateCap: 40,
      weights: configuration.weights,
      shrinkK: 0,
      pickRateFloor: 0,
      metaRolePresenceFloor: 0,
      proEvidenceEnabled: configuration.proEvidenceEnabled,
      proInfluence: configuration.proInfluence,
    },
    async () => createNeutralTeamContext(),
    buildCandidatePool,
  );
}

function draftFactor(): FactorModule {
  return {
    key: "synergy",
    enabled: true,
    contribute: async (candidate) => ({
      factor: "synergy",
      delta: candidate.id === draftFit.id ? 0.12 : 0,
      confidence: 0.9,
      reasons: candidate.id === draftFit.id
        ? [{
            kind: "synergy",
            text: "Strong deterministic ally fit",
            polarity: "positive",
            strength: 0.8,
            confidence: 0.9,
          }]
        : [],
    }),
  };
}

function proFactor(): FactorModule {
  return {
    key: "proPriority",
    enabled: true,
    contribute: async (candidate) => ({
      factor: "proPriority",
      delta: candidate.id === draftFit.id ? 0.035 : 0,
      confidence: 0.72,
      source: "pro",
      reasons: candidate.id === draftFit.id
        ? [{
            kind: "pro",
            text: "Repeated current-patch professional priority",
            polarity: "positive",
            strength: 0.7,
            confidence: 0.72,
          }]
        : [],
    }),
  };
}

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

function laneEntry(champion: ChampionRef, winRate: number): LaneMetaEntry {
  return {
    champion,
    winRate,
    tier: 2,
    pickRate: 0.08,
    play: 20_000,
    roleRate: 1,
  };
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);
  if (!champion) throw new Error(`Missing fixture champion ${id}`);
  return champion;
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
