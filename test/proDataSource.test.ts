import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import { canonicalStringify } from "../src/main/data/pro/checksum";
import {
  StaticSnapshotProDataSource,
  type ProSnapshotFetch,
} from "../src/main/data/pro/proDataSource";
import { APP_VERSION } from "../src/shared/appInfo";
import type { NormalizedProDraft, ProDataSnapshot } from "../src/shared/proData";

const directories: string[] = [];
const now = new Date("2026-07-11T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("static professional data source", () => {
  it("treats an unpublished remote snapshot as an honest ranked-only state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-pro-unpublished-"));
    directories.push(directory);
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro-snapshot.json.gz",
      refreshIntervalMs: 0,
      fetchImpl: async () => response(404, Buffer.alloc(0)),
    });

    await source.start();
    await source.refresh("manual");

    expect(source.getStatus()).toMatchObject({
      state: "ranked-only",
      lastError: null,
      gameCount: 0,
    });
  });

  it("atomically retains last-known-good when a refresh is corrupt", async () => {
    const directory = await tempDirectory();
    const good = snapshot("good", 30);
    await writeFile(join(directory, "pro-snapshot.json"), `${canonicalStringify(good)}\n`, "utf8");
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro.json",
      staleAfterMs: Number.MAX_SAFE_INTEGER,
      refreshIntervalMs: 0,
      now: () => now,
      fetchImpl: async () => responseJson({ ...good, metadata: { ...good.metadata, checksum: "0".repeat(64) } }),
    });
    await source.start();

    const before = await readFile(join(directory, "pro-snapshot.json"), "utf8");
    const refreshed = await source.refresh("manual");
    const after = await readFile(join(directory, "pro-snapshot.json"), "utf8");

    expect(refreshed?.metadata.checksum).toBe(good.metadata.checksum);
    expect(after).toBe(before);
    expect(source.getStatus().lastError).toContain("checksum");
    expect(await readdir(directory)).toEqual(["pro-snapshot.json"]);
    source.stop();
  });

  it("supports disabled and explicit no-network modes", async () => {
    const disabledDirectory = await tempDirectory();
    const offlineDirectory = await tempDirectory();
    let fetchCalls = 0;
    const fetchImpl: ProSnapshotFetch = async () => {
      fetchCalls += 1;
      return responseJson(snapshot("remote", 2));
    };
    const disabled = new StaticSnapshotProDataSource({
      cacheDirectory: disabledDirectory,
      remoteUrl: "https://example.test/pro.json",
      enabled: false,
      fetchImpl,
    });
    const offline = new StaticSnapshotProDataSource({
      cacheDirectory: offlineDirectory,
      remoteUrl: "https://example.test/pro.json",
      networkAllowed: false,
      fetchImpl,
    });

    await disabled.start();
    await offline.start();
    await disabled.refresh();
    await offline.refresh();

    expect(disabled.getStatus().state).toBe("disabled");
    expect(offline.getStatus().state).toBe("ranked-only");
    expect(fetchCalls).toBe(0);
  });

  it("starts a stale refresh without delaying independent recommendation work", async () => {
    const directory = await tempDirectory();
    let resolveFetch!: (value: ReturnType<typeof responseJson>) => void;
    const pending = new Promise<ReturnType<typeof responseJson>>((resolve) => {
      resolveFetch = resolve;
    });
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro.json",
      refreshIntervalMs: 0,
      now: () => now,
      fetchImpl: async () => pending,
    });

    await source.start();

    expect(source.getStatus().state).toBe("refreshing");
    expect(source.getSnapshot()).toBeNull();
    const recommend = vi.fn(async () => ["ranked recommendation"]);
    await expect(recommend()).resolves.toEqual(["ranked recommendation"]);
    expect(recommend).toHaveBeenCalledOnce();

    resolveFetch(responseJson(snapshot("fresh", 2)));
    await source.refresh();
    expect(source.getStatus().state).toBe("ready");
    expect(source.getSnapshot()?.metadata.gameCount).toBe(2);
    source.stop();
  });

  it("uses direct-source fallback only when enabled and rate-limits repeat attempts", async () => {
    const directory = await tempDirectory();
    const good = snapshot("good", 30);
    await writeFile(join(directory, "pro-snapshot.json"), `${canonicalStringify(good)}\n`, "utf8");
    let fallbackCalls = 0;
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro.json",
      staleAfterMs: Number.MAX_SAFE_INTEGER,
      refreshIntervalMs: 0,
      now: () => now,
      allowDirectFallback: true,
      directFallbackMinIntervalMs: 60_000,
      directFallback: async () => {
        fallbackCalls += 1;
        return snapshot("fallback", 30);
      },
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: { get: () => null },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }),
    });
    await source.start();

    await source.refresh("manual");
    expect(fallbackCalls).toBe(1);
    expect(source.getSnapshot()?.draftRecords[0].gameId).toContain("fallback");

    await source.refresh("manual");
    expect(fallbackCalls).toBe(1);
    expect(source.getStatus().lastError).toContain("rate-limited");
    source.stop();
  });

  it("downloads and verifies compressed static snapshots", async () => {
    const directory = await tempDirectory();
    const remote = snapshot("compressed", 2);
    const bytes = gzipSync(Buffer.from(canonicalStringify(remote)));
    let requestInit: RequestInit | undefined;
    const source = new StaticSnapshotProDataSource({
      cacheDirectory: directory,
      remoteUrl: "https://example.test/pro-snapshot.json.gz",
      refreshIntervalMs: 0,
      now: () => now,
      fetchImpl: async (_input, init) => {
        requestInit = init;
        return responseBytes(bytes);
      },
    });

    await source.start();
    await source.refresh("manual");

    expect(source.getSnapshot()?.metadata.checksum).toBe(remote.metadata.checksum);
    expect(source.getStatus().state).toBe("ready");
    expect(requestInit?.headers).toMatchObject({
      "User-Agent": `DraftCoach-Desktop/${APP_VERSION}`,
    });
    source.stop();
  });
});

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "draft-coach-pro-"));
  directories.push(directory);
  return directory;
}

function responseJson(value: unknown) {
  return responseBytes(Buffer.from(JSON.stringify(value)));
}

function responseBytes(bytes: Buffer) {
  return response(200, bytes);
}

function response(status: number, bytes: Buffer) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async arrayBuffer() {
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return copy.buffer;
    },
  };
}

function snapshot(prefix: string, count: number): ProDataSnapshot {
  return buildProDataSnapshot(
    Array.from({ length: count }, (_, index) => draft(`${prefix}-${index}`)),
    { generatedAt: "2026-07-10T23:00:00.000Z" },
  );
}

function draft(gameId: string): NormalizedProDraft {
  const roles = ["top", "jungle", "middle", "bottom", "utility"] as const;

  return {
    schemaVersion: 1,
    gameId,
    patch: "26.13",
    playedAt: "2026-07-01T00:00:00.000Z",
    competition: "2026 LCK Split 1",
    competitionTier: "major",
    stage: null,
    format: null,
    fearless: null,
    blueTeam: "Blue",
    redTeam: "Red",
    winner: "blue",
    picks: [266, 56, 103, 222, 412].map((championId, index) => ({
      order: index + 1,
      side: "blue" as const,
      role: roles[index],
      championId,
    })),
    bans: [{ order: 1, side: "red", championId: 24 }],
  };
}
