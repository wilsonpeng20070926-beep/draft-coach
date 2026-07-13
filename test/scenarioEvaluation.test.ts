import { describe, expect, it } from "vitest";
import {
  DRAFT_SCENARIO_SIGNALS,
  evaluateDraftScenarios,
  type DraftScenarioFixture,
} from "../src/main/evaluation/scenarioEvaluation";

describe("deterministic Draft Intelligence scenarios", () => {
  it("covers every required signal and compares all four configurations", () => {
    const fixtures = DRAFT_SCENARIO_SIGNALS.map((signal, index) =>
      scenario(signal, index + 1),
    );
    const report = evaluateDraftScenarios(fixtures);

    expect(report.scenarioCount).toBe(DRAFT_SCENARIO_SIGNALS.length);
    expect(report.coveredSignals).toEqual(DRAFT_SCENARIO_SIGNALS);
    expect(report.missingSignals).toEqual([]);
    expect(report.configurations.map((item) => item.configuration)).toEqual([
      "ranked-only",
      "current-engine",
      "blended-default",
      "pro-forward",
    ]);
    expect(summary(report, "ranked-only").motivatedTop1Wins).toBe(0);
    expect(summary(report, "blended-default")).toMatchObject({
      motivatedTop1Wins: fixtures.length,
      motivatedTop3Coverage: fixtures.length,
      regressionsFromRankedBaseline: 0,
      traceabilityRate: 1,
    });
    expect(summary(report, "pro-forward").meanConfidence).toBeLessThanOrEqual(0.75);
  });

  it("rejects duplicate scenario identifiers", () => {
    const fixture = scenario("lane", 1);
    expect(() => evaluateDraftScenarios([fixture, fixture])).toThrow(
      "Duplicate draft scenario id",
    );
  });
});

function scenario(
  signal: (typeof DRAFT_SCENARIO_SIGNALS)[number],
  index: number,
): DraftScenarioFixture {
  const motivated = 100 + index;
  const baseline = 200 + index;
  const trace = {
    [motivated]: [`${signal} motivated evidence`],
    [baseline]: ["Ranked baseline evidence"],
  };

  return {
    id: `scenario-${signal}`,
    description: `Deterministic ${signal} fixture`,
    signals: [signal],
    motivatedChampionId: motivated,
    rankedBaselineChampionId: baseline,
    predictions: {
      "ranked-only": {
        championIds: [baseline, motivated],
        confidence: 0.62,
        traceByChampionId: trace,
      },
      "current-engine": {
        championIds: [motivated, baseline],
        confidence: 0.66,
        traceByChampionId: trace,
      },
      "blended-default": {
        championIds: [motivated, baseline],
        confidence: 0.7,
        traceByChampionId: trace,
      },
      "pro-forward": {
        championIds: [motivated, baseline],
        confidence: 0.74,
        traceByChampionId: trace,
      },
    },
  };
}

function summary(
  report: ReturnType<typeof evaluateDraftScenarios>,
  configuration: "ranked-only" | "current-engine" | "blended-default" | "pro-forward",
) {
  const value = report.configurations.find(
    (item) => item.configuration === configuration,
  );
  if (!value) throw new Error(`Missing ${configuration}`);
  return value;
}
