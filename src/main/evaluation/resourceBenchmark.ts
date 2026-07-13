export interface ResourceSample {
  heapUsedBytes: number;
  residentSetBytes: number;
}

export interface RecommendationBenchmark {
  iterations: number;
  coldLatencyMs: number;
  warmMeanLatencyMs: number;
  warmP95LatencyMs: number;
  peakHeapDeltaBytes: number;
  residentSetDeltaBytes: number;
}

export interface RecommendationBenchmarkOptions {
  iterations?: number;
  now?: () => number;
  memoryUsage?: () => ResourceSample;
}

export async function benchmarkRecommendationOperation(
  operation: (iteration: number) => Promise<unknown> | unknown,
  options: RecommendationBenchmarkOptions = {},
): Promise<RecommendationBenchmark> {
  const iterations = Math.max(2, Math.floor(options.iterations ?? 6));
  const now = options.now ?? (() => performance.now());
  const memoryUsage = options.memoryUsage ?? processMemoryUsage;
  const initialMemory = memoryUsage();
  let peakHeapUsed = initialMemory.heapUsedBytes;
  const latencies: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = now();
    await operation(iteration);
    latencies.push(Math.max(0, now() - startedAt));
    peakHeapUsed = Math.max(peakHeapUsed, memoryUsage().heapUsedBytes);
  }

  const finalMemory = memoryUsage();
  const warmLatencies = latencies.slice(1).sort((left, right) => left - right);

  return {
    iterations,
    coldLatencyMs: latencies[0],
    warmMeanLatencyMs:
      warmLatencies.reduce((sum, value) => sum + value, 0) /
      warmLatencies.length,
    warmP95LatencyMs: percentile(warmLatencies, 0.95),
    peakHeapDeltaBytes: Math.max(0, peakHeapUsed - initialMemory.heapUsedBytes),
    residentSetDeltaBytes:
      finalMemory.residentSetBytes - initialMemory.residentSetBytes,
  };
}

function processMemoryUsage(): ResourceSample {
  const usage = process.memoryUsage();
  return {
    heapUsedBytes: usage.heapUsed,
    residentSetBytes: usage.rss,
  };
}

function percentile(ordered: readonly number[], percentileValue: number): number {
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * percentileValue) - 1),
  );
  return ordered[index] ?? 0;
}
