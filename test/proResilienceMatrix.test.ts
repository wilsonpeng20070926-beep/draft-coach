import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import { StaticSnapshotProDataSource } from "../src/main/data/pro/proDataSource";
import { validateProDataSnapshot } from "../src/main/data/pro/validation";
import type { NormalizedProDraft, ProDataSnapshot } from "../src/shared/proData";

const directories: string[] = [];
const now = new Date("2026-07-11T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("professional data resilience matrix", () => {
  it("degrades missing data to ranked-only and marks an old cache stale", async () => {
    const missingDirectory = await tempDirectory();
    const missing = new StaticSnapshotProDataSource({
      cacheDirectory: missingDirectory,
      remoteUrl: "https://example.test/pro.json",
      networkAllowed: false,
      refreshIntervalMs: 0,
      now: () => now,
    });
    await missing.start();
    expect(missing.getSnapshot()).toBeNull();
    expect(missing.getStatus().state).toBe("ranked-only");

    const staleDirectory = await tempDirectory();
    const staleSnapshot = snapshot("stale", "2026-07-11T07:00:00.000Z");
    await writeFile(
      join(staleDirectory, "pro-snapshot.json"),
      JSON.stringify(staleSnapshot),
      "utf8",
    );
    const stale = new StaticSnapshotProDataSource({
      cacheDirectory: staleDirectory,
      remoteUrl: "https://example.test/pro.json",
      networkAllowed: false,
      refreshIntervalMs: 0,
      staleAfterMs: 3 * 60 * 60 * 1_000,
      now: () => now,
    });
    await stale.start();
    expect(stale.getSnapshot()?.metadata.checksum).toBe(
      staleSnapshot.metadata.checksum,
    );
    expect(stale.getStatus().state).toBe("stale");
  });

  it("rejects corrupt and schema-changed snapshots", () => {
    const valid = snapshot("validation", "2026-07-11T11:00:00.000Z");
    const corrupt = structuredClone(valid);
    corrupt.metadata.checksum = "0".repeat(64);
    const schemaChanged = structuredClone(valid) as unknown as {
      metadata: { schemaVersion: number };
    };
    schemaChanged.metadata.schemaVersion = 999;

    expect(validateProDataSnapshot(corrupt, { now }).errors).toContain(
      "Snapshot checksum does not match its contents",
    );
    expect(
      validateProDataSnapshot(schemaChanged, {
        now,
        verifyChecksum: false,
      }).errors,
    ).toContain("Unknown schema version 999");
  });

  it("retains last-known-good when the remote source is rate-limited", async () => {
    const directory = await tempDirectory();
    const cached = snapshot("cached", "2026-07-11T11:00:00.000Z");
    await writeFile(
      join(directory, "pro-snapshot.json"),
      JSON.stringify(cached),
      "utf8",
    );
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro.json",
      refreshIntervalMs: 0,
      staleAfterMs: Number.MAX_SAFE_INTEGER,
      now: () => now,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }),
    });
    await source.start();
    await source.refresh("manual");

    expect(source.getSnapshot()?.metadata.checksum).toBe(cached.metadata.checksum);
    expect(source.getStatus()).toMatchObject({
      state: "ready",
      lastError: "Professional snapshot request failed with status 429",
    });
    source.stop();
  });
});

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "draft-coach-resilience-"));
  directories.push(directory);
  return directory;
}

function snapshot(gameId: string, generatedAt: string): ProDataSnapshot {
  return buildProDataSnapshot([draft(gameId)], { generatedAt });
}

function draft(gameId: string): NormalizedProDraft {
  return {
    schemaVersion: 1,
    gameId,
    patch: "26.13",
    playedAt: "2026-07-01T00:00:00.000Z",
    competition: "2026 LCK Split 1",
    competitionTier: "major",
    stage: null,
    format: null,
    fearless: false,
    blueTeam: "Blue",
    redTeam: "Red",
    winner: "blue",
    picks: [
      { order: 1, side: "blue", role: "middle", championId: 103 },
      { order: 2, side: "red", role: "middle", championId: 92 },
    ],
    bans: [],
  };
}
