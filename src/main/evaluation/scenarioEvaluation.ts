import type { EvaluationConfigurationId } from "./evaluationConfigurations";

export const DRAFT_SCENARIO_SIGNALS = [
  "lane",
  "synergy",
  "ranked-meta",
  "enemy-answer",
  "allied-need",
  "pro-priority",
  "international-weight",
  "favorite-team",
  "flex",
  "off-meta",
  "avoid",
  "hover",
  "anticipated-threat",
] as const;

export type DraftScenarioSignal = (typeof DRAFT_SCENARIO_SIGNALS)[number];

export interface ScenarioPrediction {
  championIds: number[];
  confidence: number;
  traceByChampionId: Record<number, string[]>;
}

export interface DraftScenarioFixture {
  id: string;
  description: string;
  signals: DraftScenarioSignal[];
  motivatedChampionId: number;
  rankedBaselineChampionId: number;
  predictions: Record<EvaluationConfigurationId, ScenarioPrediction>;
}

export interface ScenarioConfigurationSummary {
  configuration: EvaluationConfigurationId;
  scenarios: number;
  motivatedTop1Wins: number;
  motivatedTop3Coverage: number;
  regressionsFromRankedBaseline: number;
  traceabilityRate: number;
  meanConfidence: number;
}

export interface ScenarioEvaluationReport {
  schemaVersion: 1;
  scenarioCount: number;
  coveredSignals: DraftScenarioSignal[];
  missingSignals: DraftScenarioSignal[];
  configurations: ScenarioConfigurationSummary[];
}

export function evaluateDraftScenarios(
  fixtures: readonly DraftScenarioFixture[],
): ScenarioEvaluationReport {
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) {
      throw new Error(`Duplicate draft scenario id ${fixture.id}`);
    }
    ids.add(fixture.id);
  }

  const coveredSignals = DRAFT_SCENARIO_SIGNALS.filter((signal) =>
    fixtures.some((fixture) => fixture.signals.includes(signal)),
  );
  const missingSignals = DRAFT_SCENARIO_SIGNALS.filter(
    (signal) => !coveredSignals.includes(signal),
  );
  const configurations: EvaluationConfigurationId[] = [
    "ranked-only",
    "current-engine",
    "blended-default",
    "pro-forward",
  ];

  return {
    schemaVersion: 1,
    scenarioCount: fixtures.length,
    coveredSignals,
    missingSignals,
    configurations: configurations.map((configuration) =>
      summarizeConfiguration(configuration, fixtures),
    ),
  };
}

function summarizeConfiguration(
  configuration: EvaluationConfigurationId,
  fixtures: readonly DraftScenarioFixture[],
): ScenarioConfigurationSummary {
  let motivatedTop1Wins = 0;
  let motivatedTop3Coverage = 0;
  let regressionsFromRankedBaseline = 0;
  let traceable = 0;
  let visible = 0;
  let confidence = 0;

  for (const fixture of fixtures) {
    const prediction = fixture.predictions[configuration];
    const rankedPrediction = fixture.predictions["ranked-only"];
    motivatedTop1Wins += prediction.championIds[0] === fixture.motivatedChampionId ? 1 : 0;
    motivatedTop3Coverage += prediction.championIds
      .slice(0, 3)
      .includes(fixture.motivatedChampionId)
      ? 1
      : 0;
    regressionsFromRankedBaseline +=
      rankedPrediction.championIds.includes(fixture.rankedBaselineChampionId) &&
      !prediction.championIds.includes(fixture.rankedBaselineChampionId)
        ? 1
        : 0;
    confidence += clamp01(prediction.confidence);

    for (const championId of prediction.championIds.slice(0, 5)) {
      visible += 1;
      traceable += prediction.traceByChampionId[championId]?.some(
        (item) => item.trim().length > 0,
      )
        ? 1
        : 0;
    }
  }

  return {
    configuration,
    scenarios: fixtures.length,
    motivatedTop1Wins,
    motivatedTop3Coverage,
    regressionsFromRankedBaseline,
    traceabilityRate: visible === 0 ? 0 : traceable / visible,
    meanConfidence: fixtures.length === 0 ? 0 : confidence / fixtures.length,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
