import type { LaneMetaEntry, MetaDataSource } from "../data/metaDataSource";
import type { FactorWeights } from "../../shared/config";
import type { TeamContext } from "../../shared/championAttributes";
import type {
  ChampionRef,
  DraftState,
  FactorContribution,
  Recommendation,
  ScoreContribution,
} from "../../shared/types";
import { buildCandidatePool, type CandidatePoolInput } from "./candidatePool";
import { clamp01, clampDelta, metaBaseSpread } from "./scoringConstants";

export interface FactorModule {
  key: string;
  enabled: boolean;
  contribute(
    candidate: ChampionRef,
    draft: DraftState,
    ctx: TeamContext,
  ): Promise<FactorContribution>;
}

export interface RecommendationEngineOptions {
  region: string;
  rank: string;
  topN: number;
  candidateCap: number;
  weights: FactorWeights;
  shrinkK: number;
  pickRateFloor: number;
  metaRolePresenceFloor: number;
}

export type TeamContextProvider = (
  draft: DraftState,
  options: RecommendationEngineOptions,
) => Promise<TeamContext>;

export type CandidatePoolProvider = (input: CandidatePoolInput) => Promise<LaneMetaEntry[]>;

export interface RecommendationResult {
  recommendations: Recommendation[];
  limitedDataNote: string | null;
  teamContext: TeamContext | null;
}

interface ScoredCandidate {
  entry: LaneMetaEntry;
  factorContributions: FactorContribution[];
  factorFailure: boolean;
}

export class RecommendationEngine {
  private readonly getOptions: () => RecommendationEngineOptions;
  private latestScoredCandidates: ScoredCandidate[] | null = null;
  private latestHadFactorFailure = false;
  private latestTeamContext: TeamContext | null = null;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly factors: FactorModule[],
    options: RecommendationEngineOptions | (() => RecommendationEngineOptions),
    private readonly createTeamContext: TeamContextProvider = async () => createNeutralTeamContext(),
    private readonly createCandidatePool: CandidatePoolProvider = buildCandidatePool,
  ) {
    this.getOptions = typeof options === "function" ? options : () => options;
  }

  async recommend(draft: DraftState): Promise<RecommendationResult> {
    const options = this.getOptions();

    if (draft.phase !== "champSelect" || !draft.localPlayer?.role) {
      this.latestScoredCandidates = null;
      this.latestHadFactorFailure = false;
      this.latestTeamContext = null;
      return {
        recommendations: [],
        limitedDataNote: null,
        teamContext: null,
      };
    }

    const role = draft.localPlayer.role;
    let laneMeta: LaneMetaEntry[];

    try {
      laneMeta = await this.metaSource.getLaneMeta(role, options.region, options.rank);
    } catch {
      this.latestScoredCandidates = null;
      this.latestHadFactorFailure = false;
      this.latestTeamContext = null;
      return {
        recommendations: [],
        limitedDataNote: "OP.GG lane meta is unavailable right now.",
        teamContext: null,
      };
    }

    const ctx = await this.createContext(draft, options);
    this.latestTeamContext = ctx;
    const candidates = await this.createCandidatePool({
      laneMeta,
      draft,
      ctx,
      options,
      metaSource: this.metaSource,
      scoreMeta: (entry) => scoreLaneMetaEntry(entry, options),
    });
    const scored = await Promise.all(
      candidates.map((entry) => this.scoreCandidate(entry, draft, ctx)),
    );
    const hasLimitedData = scored.some((item) => item.factorFailure);
    this.latestScoredCandidates = scored;
    this.latestHadFactorFailure = hasLimitedData;

    return this.combineScoredCandidates(scored, hasLimitedData, options, ctx);
  }

  rerankLatest(): RecommendationResult | null {
    if (!this.latestScoredCandidates) {
      return null;
    }

    return this.combineScoredCandidates(
      this.latestScoredCandidates,
      this.latestHadFactorFailure,
      this.getOptions(),
      this.latestTeamContext,
    );
  }

  private async scoreCandidate(
    entry: LaneMetaEntry,
    draft: DraftState,
    ctx: TeamContext,
  ): Promise<ScoredCandidate> {
    const enabledFactors = this.factors.filter((factor) => factor.enabled);
    const factorResults = await Promise.all(
      enabledFactors.map(async (factor) => {
        try {
          return {
            contribution: await factor.contribute(entry.champion, draft, ctx),
            failed: false,
          };
        } catch {
          return {
            contribution: {
              factor: factor.key,
              delta: 0,
              confidence: 0,
              reasons: [],
            },
            failed: true,
          };
        }
      }),
    );

    return {
      entry,
      factorContributions: factorResults.map((result) => result.contribution),
      factorFailure: factorResults.some((result) => result.failed),
    };
  }

  private async createContext(
    draft: DraftState,
    options: RecommendationEngineOptions,
  ): Promise<TeamContext> {
    try {
      return await this.createTeamContext(draft, options);
    } catch {
      return createNeutralTeamContext();
    }
  }

  private combineScoredCandidates(
    scored: ScoredCandidate[],
    hasLimitedData: boolean,
    options: RecommendationEngineOptions,
    teamContext: TeamContext | null,
  ): RecommendationResult {
    const recommendations = scored
      .map((candidate) => createRecommendation(candidate, options))
      .sort((a, b) => b.total - a.total)
      .slice(0, options.topN);
    warnOnConstantSynergy(recommendations);

    return {
      recommendations,
      limitedDataNote: createLimitedDataNote(hasLimitedData, options.weights),
      teamContext,
    };
  }
}

export class RecommendationRunner {
  private latestRunId = 0;

  constructor(private readonly engine: RecommendationEngine) {}

  async recommendLatest(draft: DraftState): Promise<RecommendationResult | null> {
    const runId = (this.latestRunId += 1);
    const result = await this.engine.recommend(draft);

    return runId === this.latestRunId ? result : null;
  }

  rerankLatest(): RecommendationResult | null {
    this.latestRunId += 1;
    return this.engine.rerankLatest();
  }
}

function createRecommendation(
  scored: ScoredCandidate,
  options: RecommendationEngineOptions,
): Recommendation {
  const baseContribution = createMetaContribution(scored.entry, options);
  const allWeightsZero = areAllWeightsZero(options.weights);
  const metaWeight = allWeightsZero ? 1 : options.weights.meta;
  const metaBase = createMetaBase(baseContribution.score, metaWeight);
  const displayedBaseContribution: ScoreContribution = {
    ...baseContribution,
    score: metaBase,
    effectiveDelta: metaBase - 0.5,
  };
  const activeFactorContributions = scored.factorContributions
    .map((contribution) => ({
      contribution,
      weight: getFactorWeight(contribution.factor, options.weights),
      effectiveDelta:
        clampDelta(contribution.delta) *
        getFactorWeight(contribution.factor, options.weights) *
        clamp01(contribution.confidence),
    }))
    .filter((item) => item.weight > 0);
  const total = activeFactorContributions.reduce(
    (sum, item) =>
      sum +
      clampDelta(item.contribution.delta) *
        item.weight *
        clamp01(item.contribution.confidence),
    metaBase,
  );
  const outputContributions: ScoreContribution[] = [
    ...(metaWeight > 0 || allWeightsZero ? [displayedBaseContribution] : []),
    ...activeFactorContributions.map((item) =>
      toScoreContribution(item.contribution, item.effectiveDelta),
    ),
  ];

  return {
    champion: scored.entry.champion,
    total: clamp01(total),
    contributions: outputContributions,
  };
}

export function createMetaBase(metaScore: number, metaWeight: number): number {
  return clamp01(0.5 + (metaScore - 0.5) * metaBaseSpread(metaWeight));
}

function getFactorWeight(factor: string, weights: FactorWeights): number {
  if (factor === "laneCounter" || factor === "counter") {
    return weights.laneCounter;
  }

  if (factor === "teamCounter") {
    return weights.teamCounter;
  }

  if (factor === "synergy") {
    return weights.synergy;
  }

  if (factor === "compFit") {
    return weights.compFit;
  }

  return 0;
}

function createLimitedDataNote(hasLimitedData: boolean, weights: FactorWeights): string | null {
  if (areAllWeightsZero(weights)) {
    return "All weights are zero; showing meta-only fallback.";
  }

  return hasLimitedData ? "Some OP.GG factor data was unavailable; base meta filled the gaps." : null;
}

function areAllWeightsZero(weights: FactorWeights): boolean {
  return (
    weights.meta === 0 &&
    weights.laneCounter === 0 &&
    weights.teamCounter === 0 &&
    weights.synergy === 0 &&
    weights.compFit === 0
  );
}

function toScoreContribution(
  contribution: FactorContribution,
  effectiveDelta: number,
): ScoreContribution {
  return {
    factor: contribution.factor,
    score: clamp01(0.5 + contribution.delta),
    reasons: contribution.reasons.map((reason) => reason.text),
    delta: contribution.delta,
    effectiveDelta,
    confidence: contribution.confidence,
    reasonChips: contribution.reasons,
    breakdown: contribution.breakdown,
  };
}

function warnOnConstantSynergy(recommendations: Recommendation[]): void {
  const synergyContributions = recommendations
    .map((recommendation) =>
      recommendation.contributions.find((contribution) => contribution.factor === "synergy"),
    )
    .filter((contribution): contribution is ScoreContribution => contribution !== undefined);

  if (synergyContributions.length < 2) {
    return;
  }

  const firstScore = synergyContributions[0].score;
  const hasIdenticalScores = synergyContributions.every(
    (contribution) => Math.abs(contribution.score - firstScore) < 0.000001,
  );
  const hasVisibleReason = synergyContributions.some((contribution) => contribution.reasons.length > 0);

  if (hasIdenticalScores && hasVisibleReason) {
    console.warn("[recommendations] synergy factor returned identical visible scores");
  }
}

export function createNeutralTeamContext(): TeamContext {
  const emptyComposition = {
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
    powerCurve: {
      early: 0,
      mid: 0,
      late: 0,
    },
    championCount: 0,
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };

  return {
    ally: emptyComposition,
    enemy: emptyComposition,
    allyNeeds: [],
    enemyThreats: [],
    confidence: 0,
  };
}

export function createMetaContribution(
  entry: LaneMetaEntry,
  options: Pick<RecommendationEngineOptions, "shrinkK" | "pickRateFloor"> = {
    shrinkK: 1000,
    pickRateFloor: 0.005,
  },
): ScoreContribution {
  const adjustedWinRate = adjustLaneMetaWinRate(entry, options.shrinkK);
  const score = scoreLaneMetaEntry(entry, options);

  return {
    factor: "meta",
    score,
    reasons: [formatMetaReason(entry, adjustedWinRate)],
  };
}

export function scoreLaneMetaEntry(
  entry: LaneMetaEntry,
  options: Pick<RecommendationEngineOptions, "shrinkK" | "pickRateFloor"> = {
    shrinkK: 1000,
    pickRateFloor: 0.005,
  },
): number {
  const adjustedWinRate = adjustLaneMetaWinRate(entry, options.shrinkK);
  const winScore = normalizeRange(adjustedWinRate, 0.47, 0.54);
  const tierScore = normalizeRange(6 - entry.tier, 1, 5);
  const rawScore = clamp01(winScore * 0.7 + tierScore * 0.3);
  const pickConfidence = pickRateConfidence(entry.pickRate, options.pickRateFloor);

  return clamp01(0.5 + (rawScore - 0.5) * pickConfidence);
}

export function adjustLaneMetaWinRate(entry: LaneMetaEntry, pseudoGames: number): number {
  const play = entry.play ?? 0;

  if (!Number.isFinite(play) || play <= 0 || pseudoGames <= 0) {
    return entry.winRate;
  }

  return (play * entry.winRate + pseudoGames * 0.5) / (play + pseudoGames);
}

export function formatMetaReason(entry: LaneMetaEntry, winRate = entry.winRate): string {
  const parts = [`${formatPercent(winRate, 0)} WR`];

  if (entry.pickRate !== undefined) {
    parts.push(`${formatPercent(entry.pickRate, 1)} pick`);
  }

  if (Number.isInteger(entry.tier)) {
    parts.push(`tier ${entry.tier}`);
  }

  return `Meta: ${parts.join(" · ")}`;
}

function pickRateConfidence(pickRate: number | undefined, floor: number): number {
  if (floor <= 0 || pickRate === undefined) {
    return 1;
  }

  if (pickRate >= floor) {
    return 1;
  }

  return clamp01(pickRate / floor) * 0.4;
}

function formatPercent(value: number, digits: number): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function normalizeRange(value: number, low: number, high: number): number {
  if (high <= low) {
    return 0.5;
  }

  return clamp01((value - low) / (high - low));
}
