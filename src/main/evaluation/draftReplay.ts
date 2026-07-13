import type {
  NormalizedProDraft,
  ProDraftPick,
} from "../../shared/proData";
import type { EvaluationConfigurationId } from "./evaluationConfigurations";

export interface ReplayPrediction {
  championIds: number[];
  categories?: Record<string, number[]>;
  riskProbabilityByChampionId?: Record<number, number>;
  traceByChampionId?: Record<number, string[]>;
  top1Confidence?: number;
}

export interface ReplayStepContext {
  configuration: EvaluationConfigurationId;
  trainingDrafts: readonly NormalizedProDraft[];
  heldOutDraft: NormalizedProDraft;
  revealedPicks: readonly ProDraftPick[];
  nextPick: ProDraftPick;
  stepIndex: number;
}

export type ReplayPredictor = (
  context: ReplayStepContext,
) => Promise<ReplayPrediction> | ReplayPrediction;

export interface HistoricalReplayOptions {
  configurations: readonly EvaluationConfigurationId[];
  minTrainingGames?: number;
  minimumRevealedPicks?: number;
  now?: () => number;
}

export interface ReplayLatencyMetrics {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface ReplayConfigurationMetrics {
  configuration: EvaluationConfigurationId;
  evaluatedSteps: number;
  top1Recall: number;
  top3Recall: number;
  top5Recall: number;
  meanReciprocalRank: number;
  categoryCoverage: number;
  traceabilityRate: number;
  top1CalibrationBrier: number | null;
  riskCalibrationBrier: number | null;
  latency: ReplayLatencyMetrics;
}

export interface ReplayWindowEvidence {
  heldOutGameId: string;
  heldOutPlayedAt: string;
  trainingGames: number;
  latestTrainingPlayedAt: string | null;
  leakageFree: boolean;
}

export interface HistoricalReplayReport {
  schemaVersion: 1;
  leakagePolicy: "strictly-earlier-games";
  evaluatedGames: number;
  skippedGames: number;
  windows: ReplayWindowEvidence[];
  configurations: ReplayConfigurationMetrics[];
}

interface MetricAccumulator {
  evaluatedSteps: number;
  top1Hits: number;
  top3Hits: number;
  top5Hits: number;
  reciprocalRank: number;
  categoryHits: number;
  traceableRecommendations: number;
  visibleRecommendations: number;
  top1CalibrationSquaredError: number;
  top1CalibrationObservations: number;
  riskCalibrationSquaredError: number;
  riskCalibrationObservations: number;
  latencies: number[];
}

export async function evaluateHistoricalReplay(
  drafts: readonly NormalizedProDraft[],
  predictor: ReplayPredictor,
  options: HistoricalReplayOptions,
): Promise<HistoricalReplayReport> {
  if (options.configurations.length === 0) {
    throw new Error("Historical replay requires at least one configuration");
  }

  const minTrainingGames = Math.max(1, options.minTrainingGames ?? 3);
  const minimumRevealedPicks = Math.max(0, options.minimumRevealedPicks ?? 0);
  const now = options.now ?? defaultNow;
  const orderedDrafts = orderDrafts(drafts);
  const metrics = new Map<EvaluationConfigurationId, MetricAccumulator>(
    options.configurations.map((configuration) => [configuration, emptyAccumulator()]),
  );
  const windows: ReplayWindowEvidence[] = [];
  let skippedGames = 0;

  for (const heldOutDraft of orderedDrafts) {
    const heldOutTime = parsedTime(heldOutDraft);
    const trainingDrafts = orderedDrafts.filter(
      (candidate) => parsedTime(candidate) < heldOutTime,
    );

    if (trainingDrafts.length < minTrainingGames) {
      skippedGames += 1;
      continue;
    }

    const latestTrainingPlayedAt = trainingDrafts.at(-1)?.playedAt ?? null;
    const leakageFree = trainingDrafts.every(
      (candidate) =>
        candidate.gameId !== heldOutDraft.gameId &&
        parsedTime(candidate) < heldOutTime,
    );

    if (!leakageFree) {
      throw new Error(`Replay leakage detected for ${heldOutDraft.gameId}`);
    }

    windows.push({
      heldOutGameId: heldOutDraft.gameId,
      heldOutPlayedAt: heldOutDraft.playedAt,
      trainingGames: trainingDrafts.length,
      latestTrainingPlayedAt,
      leakageFree,
    });

    const orderedPicks = [...heldOutDraft.picks].sort(
      (left, right) => left.order - right.order || left.championId - right.championId,
    );

    for (let stepIndex = minimumRevealedPicks; stepIndex < orderedPicks.length; stepIndex += 1) {
      const nextPick = orderedPicks[stepIndex];
      const revealedPicks = orderedPicks.slice(0, stepIndex);

      for (const configuration of options.configurations) {
        const startedAt = now();
        const prediction = normalizePrediction(
          await predictor({
            configuration,
            trainingDrafts,
            heldOutDraft,
            revealedPicks,
            nextPick,
            stepIndex,
          }),
        );
        const elapsed = Math.max(0, now() - startedAt);
        accumulate(
          metrics.get(configuration)!,
          prediction,
          nextPick,
          heldOutDraft,
          elapsed,
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    leakagePolicy: "strictly-earlier-games",
    evaluatedGames: windows.length,
    skippedGames,
    windows,
    configurations: options.configurations.map((configuration) =>
      finalizeMetrics(configuration, metrics.get(configuration)!),
    ),
  };
}

function accumulate(
  metrics: MetricAccumulator,
  prediction: ReplayPrediction,
  actual: ProDraftPick,
  heldOutDraft: NormalizedProDraft,
  latencyMs: number,
): void {
  const rankIndex = prediction.championIds.indexOf(actual.championId);
  const rank = rankIndex < 0 ? null : rankIndex + 1;
  metrics.evaluatedSteps += 1;
  metrics.top1Hits += rank === 1 ? 1 : 0;
  metrics.top3Hits += rank !== null && rank <= 3 ? 1 : 0;
  metrics.top5Hits += rank !== null && rank <= 5 ? 1 : 0;
  metrics.reciprocalRank += rank === null ? 0 : 1 / rank;
  metrics.categoryHits += categoryContains(
    prediction.categories,
    actual.championId,
  )
    ? 1
    : 0;
  metrics.latencies.push(latencyMs);

  for (const championId of prediction.championIds.slice(0, 5)) {
    metrics.visibleRecommendations += 1;
    const trace = prediction.traceByChampionId?.[championId] ?? [];
    metrics.traceableRecommendations += trace.some((item) => item.trim().length > 0)
      ? 1
      : 0;
  }

  if (prediction.top1Confidence !== undefined) {
    const confidence = clamp01(prediction.top1Confidence);
    const outcome = rank === 1 ? 1 : 0;
    metrics.top1CalibrationSquaredError += (confidence - outcome) ** 2;
    metrics.top1CalibrationObservations += 1;
  }

  const riskProbability = prediction.riskProbabilityByChampionId?.[actual.championId];
  if (riskProbability !== undefined) {
    const lost = heldOutDraft.winner === actual.side ? 0 : 1;
    metrics.riskCalibrationSquaredError += (clamp01(riskProbability) - lost) ** 2;
    metrics.riskCalibrationObservations += 1;
  }
}

function finalizeMetrics(
  configuration: EvaluationConfigurationId,
  metrics: MetricAccumulator,
): ReplayConfigurationMetrics {
  const count = metrics.evaluatedSteps;

  return {
    configuration,
    evaluatedSteps: count,
    top1Recall: ratio(metrics.top1Hits, count),
    top3Recall: ratio(metrics.top3Hits, count),
    top5Recall: ratio(metrics.top5Hits, count),
    meanReciprocalRank: ratio(metrics.reciprocalRank, count),
    categoryCoverage: ratio(metrics.categoryHits, count),
    traceabilityRate: ratio(
      metrics.traceableRecommendations,
      metrics.visibleRecommendations,
    ),
    top1CalibrationBrier:
      metrics.top1CalibrationObservations === 0
        ? null
        : metrics.top1CalibrationSquaredError /
          metrics.top1CalibrationObservations,
    riskCalibrationBrier:
      metrics.riskCalibrationObservations === 0
        ? null
        : metrics.riskCalibrationSquaredError /
          metrics.riskCalibrationObservations,
    latency: latencyMetrics(metrics.latencies),
  };
}

function normalizePrediction(prediction: ReplayPrediction): ReplayPrediction {
  return {
    ...prediction,
    championIds: uniquePositiveIntegers(prediction.championIds),
    categories: prediction.categories
      ? Object.fromEntries(
          Object.entries(prediction.categories)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, values]) => [key, uniquePositiveIntegers(values)]),
        )
      : undefined,
  };
}

function orderDrafts(drafts: readonly NormalizedProDraft[]): NormalizedProDraft[] {
  const gameIds = new Set<string>();

  for (const draft of drafts) {
    parsedTime(draft);
    if (gameIds.has(draft.gameId)) {
      throw new Error(`Duplicate replay game id ${draft.gameId}`);
    }
    gameIds.add(draft.gameId);
  }

  return [...drafts].sort(
    (left, right) =>
      parsedTime(left) - parsedTime(right) ||
      left.gameId.localeCompare(right.gameId),
  );
}

function parsedTime(draft: NormalizedProDraft): number {
  const value = Date.parse(draft.playedAt);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid playedAt for replay game ${draft.gameId}`);
  }
  return value;
}

function categoryContains(
  categories: Record<string, number[]> | undefined,
  championId: number,
): boolean {
  return categories
    ? Object.values(categories).some((values) => values.includes(championId))
    : false;
}

function latencyMetrics(values: readonly number[]): ReplayLatencyMetrics {
  if (values.length === 0) {
    return { meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }

  const ordered = [...values].sort((left, right) => left - right);
  return {
    meanMs: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
    p50Ms: percentile(ordered, 0.5),
    p95Ms: percentile(ordered, 0.95),
    maxMs: ordered[ordered.length - 1],
  };
}

function percentile(ordered: readonly number[], percentileValue: number): number {
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * percentileValue) - 1),
  );
  return ordered[index];
}

function emptyAccumulator(): MetricAccumulator {
  return {
    evaluatedSteps: 0,
    top1Hits: 0,
    top3Hits: 0,
    top5Hits: 0,
    reciprocalRank: 0,
    categoryHits: 0,
    traceableRecommendations: 0,
    visibleRecommendations: 0,
    top1CalibrationSquaredError: 0,
    top1CalibrationObservations: 0,
    riskCalibrationSquaredError: 0,
    riskCalibrationObservations: 0,
    latencies: [],
  };
}

function uniquePositiveIntegers(values: readonly number[]): number[] {
  return [
    ...new Set(
      values.filter(
        (value) => Number.isInteger(value) && value > 0,
      ),
    ),
  ];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function defaultNow(): number {
  return performance.now();
}
