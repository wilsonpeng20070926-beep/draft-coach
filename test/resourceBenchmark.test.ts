import { describe, expect, it } from "vitest";
import {
  benchmarkRecommendationOperation,
  type ResourceSample,
} from "../src/main/evaluation/resourceBenchmark";

describe("recommendation resource benchmark", () => {
  it("separates cold and warm latency and records bounded memory growth", async () => {
    const durations = [10, 4, 2];
    let clock = 0;
    let memoryIndex = 0;
    const memory: ResourceSample[] = [
      { heapUsedBytes: 1_000, residentSetBytes: 5_000 },
      { heapUsedBytes: 1_400, residentSetBytes: 5_200 },
      { heapUsedBytes: 1_700, residentSetBytes: 5_400 },
      { heapUsedBytes: 1_500, residentSetBytes: 5_450 },
      { heapUsedBytes: 1_450, residentSetBytes: 5_500 },
    ];

    const report = await benchmarkRecommendationOperation(
      (iteration) => {
        clock += durations[iteration];
      },
      {
        iterations: 3,
        now: () => clock,
        memoryUsage: () => memory[Math.min(memoryIndex++, memory.length - 1)],
      },
    );

    expect(report).toEqual({
      iterations: 3,
      coldLatencyMs: 10,
      warmMeanLatencyMs: 3,
      warmP95LatencyMs: 4,
      peakHeapDeltaBytes: 700,
      residentSetDeltaBytes: 500,
    });
  });
});
