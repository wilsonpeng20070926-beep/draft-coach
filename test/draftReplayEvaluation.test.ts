import { describe, expect, it } from "vitest";
import {
  evaluateHistoricalReplay,
  type ReplayPrediction,
} from "../src/main/evaluation/draftReplay";
import type { NormalizedProDraft } from "../src/shared/proData";

describe("historical draft replay evaluation", () => {
  it("uses strictly earlier training games and reports continuation, calibration, traceability, and latency", async () => {
    const drafts = [
      draft("game-1", "2026-06-01T00:00:00.000Z", 10),
      draft("game-2", "2026-06-02T00:00:00.000Z", 20),
      draft("game-3", "2026-06-03T00:00:00.000Z", 30),
      draft("game-4", "2026-06-04T00:00:00.000Z", 40),
    ];
    let clock = 0;
    const report = await evaluateHistoricalReplay(
      drafts,
      (context): ReplayPrediction => {
        expect(context.trainingDrafts).not.toContain(context.heldOutDraft);
        expect(
          context.trainingDrafts.every(
            (training) =>
              Date.parse(training.playedAt) <
              Date.parse(context.heldOutDraft.playedAt),
          ),
        ).toBe(true);
        clock += 2;
        const actual = context.nextPick.championId;
        const alternative = actual + 1_000;
        const championIds = context.configuration === "blended-default"
          ? [actual, alternative]
          : [alternative, actual];

        return {
          championIds,
          categories:
            context.configuration === "blended-default"
              ? { overall: championIds }
              : { overall: [alternative] },
          traceByChampionId: {
            [actual]: ["Traceable continuation evidence"],
            [alternative]: ["Traceable alternative evidence"],
          },
          top1Confidence: 0.8,
          riskProbabilityByChampionId: {
            [actual]: context.heldOutDraft.winner === context.nextPick.side ? 0.2 : 0.8,
          },
        };
      },
      {
        configurations: ["ranked-only", "blended-default"],
        minTrainingGames: 2,
        now: () => clock,
      },
    );

    expect(report).toMatchObject({
      leakagePolicy: "strictly-earlier-games",
      evaluatedGames: 2,
      skippedGames: 2,
    });
    expect(report.windows).toHaveLength(2);
    expect(report.windows.every((window) => window.leakageFree)).toBe(true);
    expect(report.windows.map((window) => window.trainingGames)).toEqual([2, 3]);

    const ranked = metric(report, "ranked-only");
    const blended = metric(report, "blended-default");
    expect(ranked).toMatchObject({
      evaluatedSteps: 4,
      top1Recall: 0,
      top3Recall: 1,
      top5Recall: 1,
      meanReciprocalRank: 0.5,
      categoryCoverage: 0,
      traceabilityRate: 1,
    });
    expect(blended).toMatchObject({
      evaluatedSteps: 4,
      top1Recall: 1,
      top3Recall: 1,
      top5Recall: 1,
      meanReciprocalRank: 1,
      categoryCoverage: 1,
      traceabilityRate: 1,
    });
    expect(blended.top1CalibrationBrier).toBeCloseTo(0.04);
    expect(blended.riskCalibrationBrier).toBeCloseTo(0.04);
    expect(blended.latency).toEqual({ meanMs: 2, p50Ms: 2, p95Ms: 2, maxMs: 2 });
  });

  it("rejects duplicate games and never trains on a game at the held-out timestamp", async () => {
    const first = draft("same-time-a", "2026-06-01T00:00:00.000Z", 1);
    const second = draft("same-time-b", "2026-06-01T00:00:00.000Z", 2);
    const later = draft("later", "2026-06-02T00:00:00.000Z", 3);
    const report = await evaluateHistoricalReplay(
      [first, second, later],
      ({ nextPick }) => ({ championIds: [nextPick.championId] }),
      { configurations: ["ranked-only"], minTrainingGames: 2 },
    );

    expect(report.evaluatedGames).toBe(1);
    expect(report.windows[0].trainingGames).toBe(2);
    await expect(
      evaluateHistoricalReplay(
        [first, { ...second, gameId: first.gameId }],
        () => ({ championIds: [] }),
        { configurations: ["ranked-only"] },
      ),
    ).rejects.toThrow("Duplicate replay game id");
  });
});

function metric(
  report: Awaited<ReturnType<typeof evaluateHistoricalReplay>>,
  configuration: "ranked-only" | "blended-default",
) {
  const value = report.configurations.find(
    (candidate) => candidate.configuration === configuration,
  );
  if (!value) throw new Error(`Missing ${configuration} metrics`);
  return value;
}

function draft(
  gameId: string,
  playedAt: string,
  championOffset: number,
): NormalizedProDraft {
  return {
    schemaVersion: 1,
    gameId,
    patch: "26.13",
    playedAt,
    competition: "Synthetic replay league",
    competitionTier: "major",
    stage: "Test",
    format: "Standard",
    fearless: false,
    blueTeam: "Blue",
    redTeam: "Red",
    winner: "blue",
    picks: [
      { order: 1, side: "blue", role: "middle", championId: championOffset + 1 },
      { order: 2, side: "red", role: "middle", championId: championOffset + 2 },
    ],
    bans: [],
  };
}
