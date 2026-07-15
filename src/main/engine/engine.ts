import type { LaneMetaEntry, MetaDataSource } from "../data/metaDataSource";
import type { FactorWeights } from "../../shared/config";
import type { TeamContext } from "../../shared/championAttributes";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftState,
  DraftTarget,
  FactorContribution,
  PickEvaluation,
  Recommendation,
  RecommendationCategory,
  ScoreContribution,
  EvidenceBalance,
} from "../../shared/types";
import { draftTargetKey } from "../draft/targetSelection";
import {
  buildCandidatePool,
  createTargetFallbackEntry,
  type CandidatePoolInput,
} from "./candidatePool";
import { clamp01, clampDelta, metaBaseSpread } from "./scoringConstants";
import type { ProScoringProvider } from "./proScoring";
import {
  assessRecommendationRisk,
  calculateEvidenceBalance,
  projectRecommendationCategories,
} from "./categoryProjection";

export interface FactorModule {
  key: string;
  enabled: boolean;
  contribute(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
    ctx: TeamContext,
    threats: AnticipatedThreat[],
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
  proEvidenceEnabled?: boolean;
  proInfluence?: number;
}

export type TeamContextProvider = (
  draft: DraftState,
  target: DraftTarget,
  options: RecommendationEngineOptions,
) => Promise<TeamContext>;

export type CandidatePoolProvider = (input: CandidatePoolInput) => Promise<LaneMetaEntry[]>;

export interface RecommendationResult {
  recommendations: Recommendation[];
  evaluation: PickEvaluation | null;
  limitedDataNote: string | null;
  teamContext: TeamContext | null;
  categories: RecommendationCategory[];
  evidenceBalance: EvidenceBalance;
}

interface ScoredCandidate {
  entry: LaneMetaEntry;
  factorContributions: FactorContribution[];
  factorFailure: boolean;
}

interface LatestTargetScore {
  scored: ScoredCandidate[];
  hadFactorFailure: boolean;
  usedCatalogFallback: boolean;
  teamContext: TeamContext;
  targetPlayer: DraftState["allies"][number];
}

export class RecommendationEngine {
  private readonly getOptions: () => RecommendationEngineOptions;
  private readonly latestByTarget = new Map<string, LatestTargetScore>();
  private latestTargetKey: string | null = null;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly factors: FactorModule[],
    options: RecommendationEngineOptions | (() => RecommendationEngineOptions),
    private readonly createTeamContext: TeamContextProvider = async () => createNeutralTeamContext(),
    private readonly createCandidatePool: CandidatePoolProvider = buildCandidatePool,
    private readonly proScoring: ProScoringProvider | null = null,
  ) {
    this.getOptions = typeof options === "function" ? options : () => options;
  }

  async recommend(
    draft: DraftState,
    target: DraftTarget,
    threats: AnticipatedThreat[] = [],
  ): Promise<RecommendationResult> {
    const options = this.getOptions();
    const targetPlayer = draft.allies.find((ally) => ally.cellId === target.cellId) ?? null;

    if (
      draft.phase !== "champSelect" ||
      target.side !== "ally" ||
      target.purpose !== "recommend" ||
      !targetPlayer ||
      targetPlayer.role !== target.role
    ) {
      return {
        recommendations: [],
        evaluation: null,
        limitedDataNote: null,
        teamContext: null,
        categories: [],
        evidenceBalance: emptyEvidenceBalance(),
      };
    }

    let laneMeta: LaneMetaEntry[];

    try {
      laneMeta = await this.metaSource.getLaneMeta(target.role, options.region, options.rank);
    } catch {
      return {
        recommendations: [],
        evaluation: null,
        limitedDataNote: "OP.GG lane meta is unavailable right now.",
        teamContext: null,
        categories: [],
        evidenceBalance: emptyEvidenceBalance(),
      };
    }

    const usedCatalogFallback = laneMeta.some(
      (entry) => entry.dataQuality === "catalog-fallback",
    );

    const ctx = await this.createContext(draft, target, options);
    const proEntries = this.safeProCandidateEntries(
      laneMeta,
      target.role,
      options,
    );
    const candidates =
      targetPlayer.pickState === "locked" && targetPlayer.champion
        ? [
            laneMeta.find(
              (entry) => entry.champion.id === targetPlayer.champion?.id,
            ) ?? createTargetFallbackEntry(targetPlayer.champion),
          ]
        : await this.createCandidatePool({
            laneMeta,
            draft,
            target,
            threats,
            ctx,
            options,
            metaSource: this.metaSource,
            scoreMeta: (entry) => scoreLaneMetaEntry(entry, options),
            proEntries,
          });
    const scored = await Promise.all(
      candidates.map((entry) =>
        this.scoreCandidate(entry, draft, target, ctx, threats, options),
      ),
    );
    const hasLimitedData = scored.some((item) => item.factorFailure);
    const key = draftTargetKey(target);
    this.latestByTarget.set(key, {
      scored,
      hadFactorFailure: hasLimitedData,
      usedCatalogFallback,
      teamContext: ctx,
      targetPlayer,
    });
    this.latestTargetKey = key;

    return this.combineScoredCandidates(
      scored,
      hasLimitedData,
      usedCatalogFallback,
      options,
      ctx,
      targetPlayer,
    );
  }

  rerankLatest(target?: DraftTarget): RecommendationResult | null {
    const key = target ? draftTargetKey(target) : this.latestTargetKey;
    const latest = key ? this.latestByTarget.get(key) : null;

    if (!latest) {
      return null;
    }

    return this.combineScoredCandidates(
      latest.scored,
      latest.hadFactorFailure,
      latest.usedCatalogFallback,
      this.getOptions(),
      latest.teamContext,
      latest.targetPlayer,
    );
  }

  private async scoreCandidate(
    entry: LaneMetaEntry,
    draft: DraftState,
    target: DraftTarget,
    ctx: TeamContext,
    threats: AnticipatedThreat[],
    options: RecommendationEngineOptions,
  ): Promise<ScoredCandidate> {
    const enabledFactors = this.factors.filter((factor) => factor.enabled);
    const factorResults = await Promise.all(
      enabledFactors.map(async (factor) => {
        try {
          return {
            contribution: await factor.contribute(
              entry.champion,
              draft,
              target,
              ctx,
              threats,
            ),
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
    const proContributions = this.safeProContributions(
      entry.champion,
      draft,
      target,
      options,
    );

    return {
      entry,
      factorContributions: [
        ...factorResults.map((result) => result.contribution),
        ...proContributions,
      ],
      factorFailure: factorResults.some((result) => result.failed),
    };
  }

  private async createContext(
    draft: DraftState,
    target: DraftTarget,
    options: RecommendationEngineOptions,
  ): Promise<TeamContext> {
    try {
      return await this.createTeamContext(draft, target, options);
    } catch {
      return createNeutralTeamContext();
    }
  }

  private safeProCandidateEntries(
    laneMeta: LaneMetaEntry[],
    role: DraftTarget["role"],
    options: RecommendationEngineOptions,
  ): LaneMetaEntry[] {
    if (options.proEvidenceEnabled === false || !this.proScoring) {
      return [];
    }

    try {
      return this.proScoring.candidateEntries(laneMeta, role);
    } catch {
      return [];
    }
  }

  private safeProContributions(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
    options: RecommendationEngineOptions,
  ): FactorContribution[] {
    if (options.proEvidenceEnabled === false || !this.proScoring) {
      return [];
    }

    try {
      return this.proScoring.contributions(candidate, draft, target);
    } catch {
      return [];
    }
  }

  private combineScoredCandidates(
    scored: ScoredCandidate[],
    hasLimitedData: boolean,
    usedCatalogFallback: boolean,
    options: RecommendationEngineOptions,
    teamContext: TeamContext | null,
    targetPlayer: DraftState["allies"][number],
  ): RecommendationResult {
    const allRecommendations = scored
      .map((candidate) => createRecommendation(candidate, options, teamContext))
      .sort((a, b) => b.total - a.total || a.champion.id - b.champion.id);
    const evaluation = createTargetPickEvaluation(allRecommendations, targetPlayer);
    const categories = targetPlayer.pickState === "locked"
      ? []
      : projectRecommendationCategories(allRecommendations);
    const overall = categories.find((category) => category.key === "overall")?.recommendations ?? [];
    const recommendations =
      targetPlayer.pickState === "locked"
        ? []
        : overall.slice(0, options.topN);
    const evidenceBalance = calculateEvidenceBalance(recommendations);
    warnOnConstantSynergy(recommendations);

    return {
      recommendations,
      evaluation,
      limitedDataNote: createLimitedDataNote(
        hasLimitedData,
        usedCatalogFallback,
        options.weights,
      ),
      teamContext,
      categories,
      evidenceBalance,
    };
  }
}

export class RecommendationRunner {
  private latestRunId = 0;
  private latestTargets: DraftTarget[] = [];
  private pendingHoverTimer: ReturnType<typeof setTimeout> | null = null;
  private resolvePendingHover: ((active: boolean) => void) | null = null;

  constructor(
    private readonly engine: RecommendationEngine,
    private readonly hoverDebounceMs = HOVER_RECOMMENDATION_DEBOUNCE_MS,
  ) {}

  async recommendLatest(
    draft: DraftState,
    target: DraftTarget,
    threats: AnticipatedThreat[] = [],
  ): Promise<RecommendationResult | null> {
    const results = await this.recommendTargetsLatest(draft, [target], threats);

    return results?.[0] ?? null;
  }

  async recommendTargetsLatest(
    draft: DraftState,
    targets: DraftTarget[],
    threats: AnticipatedThreat[] = [],
  ): Promise<RecommendationResult[] | null> {
    const runId = (this.latestRunId += 1);
    this.cancelPendingHover();
    this.latestTargets = [...targets];

    if (targets.some((target) => targetIsHovering(draft, target))) {
      const stillCurrent = await this.waitForHoverDebounce(runId);

      if (!stillCurrent) {
        return null;
      }
    }

    const results = await Promise.all(
      targets.map((target) => this.engine.recommend(draft, target, threats)),
    );

    return runId === this.latestRunId ? results : null;
  }

  rerankLatest(): RecommendationResult | null {
    this.latestRunId += 1;
    this.cancelPendingHover();
    const target = this.latestTargets[0];

    return target ? this.engine.rerankLatest(target) : this.engine.rerankLatest();
  }

  rerankTargetsLatest(): RecommendationResult[] {
    this.latestRunId += 1;
    this.cancelPendingHover();

    return this.latestTargets
      .map((target) => this.engine.rerankLatest(target))
      .filter((result): result is RecommendationResult => result !== null);
  }

  private waitForHoverDebounce(runId: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolvePendingHover = resolve;
      this.pendingHoverTimer = setTimeout(() => {
        this.pendingHoverTimer = null;
        this.resolvePendingHover = null;
        resolve(runId === this.latestRunId);
      }, this.hoverDebounceMs);
    });
  }

  private cancelPendingHover(): void {
    if (this.pendingHoverTimer) {
      clearTimeout(this.pendingHoverTimer);
      this.pendingHoverTimer = null;
    }

    this.resolvePendingHover?.(false);
    this.resolvePendingHover = null;
  }
}

export const HOVER_RECOMMENDATION_DEBOUNCE_MS = 400;

function targetIsHovering(draft: DraftState, target: DraftTarget): boolean {
  return draft.allies.some(
    (ally) => ally.cellId === target.cellId && ally.pickState === "hovering",
  );
}

function createTargetPickEvaluation(
  recommendations: Recommendation[],
  targetPlayer: DraftState["allies"][number],
): PickEvaluation | null {
  if (
    !targetPlayer.champion ||
    (targetPlayer.pickState !== "hovering" && targetPlayer.pickState !== "locked")
  ) {
    return null;
  }

  const recommendation = recommendations.find(
    (candidate) => candidate.champion.id === targetPlayer.champion?.id,
  );

  if (!recommendation) {
    return null;
  }

  const chips = recommendation.contributions.flatMap(
    (contribution) => contribution.reasonChips ?? [],
  );
  const teamFitKinds = new Set(["synergy", "comp-fit"]);
  const strengths = unique(
    chips
      .filter((chip) => chip.polarity === "positive" && !teamFitKinds.has(chip.kind))
      .map((chip) => chip.text),
  );
  const risks = unique(
    chips.filter((chip) => chip.polarity === "negative").map((chip) => chip.text),
  );
  const teamFit = unique(
    chips.filter((chip) => teamFitKinds.has(chip.kind)).map((chip) => chip.text),
  );

  if (strengths.length === 0) {
    const metaReason = recommendation.contributions.find(
      (contribution) => contribution.factor === "meta",
    )?.reasons[0];

    if (metaReason) {
      strengths.push(metaReason);
    }
  }

  return {
    champion: targetPlayer.champion,
    state: targetPlayer.pickState,
    total: recommendation.total,
    strengths,
    risks,
    teamFit,
    evidence: recommendation.contributions,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function createRecommendation(
  scored: ScoredCandidate,
  options: RecommendationEngineOptions,
  teamContext: TeamContext | null,
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
      weight: getContributionWeight(contribution, options, allWeightsZero),
      effectiveDelta:
        clampDelta(contribution.delta) *
        getContributionWeight(contribution, options, allWeightsZero) *
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
    risk: assessRecommendationRisk(
      { total: clamp01(total), contributions: outputContributions },
      scored.entry,
      teamContext ?? createNeutralTeamContext(),
    ),
  };
}

export function createMetaBase(metaScore: number, metaWeight: number): number {
  return clamp01(0.5 + (metaScore - 0.5) * metaBaseSpread(metaWeight));
}

function getContributionWeight(
  contribution: FactorContribution,
  options: RecommendationEngineOptions,
  allWeightsZero: boolean,
): number {
  if (contribution.factor.startsWith("pro")) {
    return allWeightsZero ? 0 : clamp01(options.proInfluence ?? 1);
  }

  return getFactorWeight(contribution.factor, options.weights);
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

function createLimitedDataNote(
  hasLimitedData: boolean,
  usedCatalogFallback: boolean,
  weights: FactorWeights,
): string | null {
  if (areAllWeightsZero(weights)) {
    return "All weights are zero; showing meta-only fallback.";
  }

  if (usedCatalogFallback) {
    return "Live OP.GG data is unavailable; showing a tag-based offline fallback.";
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
    source: contribution.source ?? "ranked",
    proEvidence: contribution.proEvidence,
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
  if (
    entry.dataQuality === "target-fallback" ||
    entry.dataQuality === "pro-supported" ||
    entry.dataQuality === "catalog-fallback"
  ) {
    return {
      factor: "meta",
      score: 0.5,
      reasons: [
        entry.dataQuality === "pro-supported"
          ? "Ranked meta: no role-specific baseline"
          : entry.dataQuality === "catalog-fallback"
            ? "Offline role fit: catalog tag prior"
            : "Meta: no role-specific ranked baseline",
      ],
      source: "ranked",
    };
  }

  const adjustedWinRate = adjustLaneMetaWinRate(entry, options.shrinkK);
  const score = scoreLaneMetaEntry(entry, options);

  return {
    factor: "meta",
    score,
    reasons: [formatMetaReason(entry, adjustedWinRate)],
    source: "ranked",
  };
}

function emptyEvidenceBalance(): EvidenceBalance {
  return {
    rankedPercent: 100,
    proPercent: 0,
    rankedMagnitude: 0,
    proMagnitude: 0,
  };
}

export function scoreLaneMetaEntry(
  entry: LaneMetaEntry,
  options: Pick<RecommendationEngineOptions, "shrinkK" | "pickRateFloor"> = {
    shrinkK: 1000,
    pickRateFloor: 0.005,
  },
): number {
  if (
    entry.dataQuality === "target-fallback" ||
    entry.dataQuality === "pro-supported" ||
    entry.dataQuality === "catalog-fallback"
  ) {
    return 0.5;
  }

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
