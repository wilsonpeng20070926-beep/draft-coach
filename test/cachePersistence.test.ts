import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CachedMetaDataSource } from "../src/main/data/cache";
import type { MetaDataSource } from "../src/main/data/metaDataSource";
import type { ChampionRef } from "../src/shared/types";

const ahri: ChampionRef = {
  id: 103,
  slug: "Ahri",
  name: "Ahri",
  tags: ["Mage", "Assassin"],
  iconUrl: "https://example.test/Ahri.png",
};

describe("ranked data cache persistence", () => {
  it("restores a fresh OP.GG result across app restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-ranked-cache-"));
    const cacheFile = join(directory, "ranked-data-cache.json");
    let liveCalls = 0;

    try {
      const first = new CachedMetaDataSource(source(async () => {
        liveCalls += 1;
        return [laneEntry()];
      }), {
        ttlMs: 60_000,
        patchVersion: "16.13.1",
        cacheFile,
      });
      await first.getLaneMeta("middle", "global", "emerald_plus");

      const restarted = new CachedMetaDataSource(source(async () => {
        liveCalls += 1;
        throw new Error("should not refresh a fresh cache");
      }), {
        ttlMs: 60_000,
        patchVersion: "16.13.1",
        cacheFile,
      });
      const restored = await restarted.getLaneMeta("middle", "global", "emerald_plus");

      expect(restored[0].champion.name).toBe("Ahri");
      expect(liveCalls).toBe(1);
      expect(JSON.parse(await readFile(cacheFile, "utf8"))).toMatchObject({
        schemaVersion: 1,
        patchVersion: "16.13.1",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses an expired last-known-good result when a refresh fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-ranked-stale-"));
    const cacheFile = join(directory, "ranked-data-cache.json");

    try {
      const first = new CachedMetaDataSource(source(async () => [laneEntry()]), {
        ttlMs: 0,
        patchVersion: "16.13.1",
        cacheFile,
      });
      await first.getLaneMeta("middle", "global", "emerald_plus");

      const restarted = new CachedMetaDataSource(source(async () => {
        throw new Error("network unavailable");
      }), {
        ttlMs: 60_000,
        patchVersion: "16.13.1",
        cacheFile,
      });

      await expect(
        restarted.getLaneMeta("middle", "global", "emerald_plus"),
      ).resolves.toEqual([laneEntry()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function source(getLaneMeta: MetaDataSource["getLaneMeta"]): MetaDataSource {
  return {
    getLaneMeta,
    getMatchup: async () => ({ winRate: null }),
    getSynergy: async () => ({ score: null }),
    getChampionRoleFit: async () => ({
      top: 0,
      jungle: 0,
      middle: 1,
      bottom: 0,
      utility: 0,
    }),
  };
}

function laneEntry() {
  return {
    champion: ahri,
    winRate: 0.52,
    tier: 1,
    pickRate: 0.08,
    play: 20_000,
    roleRate: 0.96,
  };
}
