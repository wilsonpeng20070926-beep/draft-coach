import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppConfigStore } from "../src/main/config/appConfigStore";
import { DEFAULT_APP_CONFIG } from "../src/shared/config";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AppConfigStore", () => {
  it("creates and persists defaults when config is missing", async () => {
    const { store, configPath } = await createStore();

    const config = await store.load();
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as unknown;

    expect(config).toEqual(DEFAULT_APP_CONFIG);
    expect(persisted).toEqual(DEFAULT_APP_CONFIG);
  });

  it("sanitizes invalid persisted values by clamping and filling defaults", async () => {
    const { store, configPath } = await createStore();
    await writeFile(
      configPath,
      JSON.stringify({
        version: 999,
        weights: {
          meta: 2,
          laneCounter: -1,
          teamCounter: 2,
          synergy: "heavy",
          compFit: -0.5,
        },
        region: "mars",
        rank: "challenger",
        topN: 99,
        pickRateFloor: -0.2,
        shrinkK: 12345.6,
        minChipConfidence: 9,
      }),
      "utf8",
    );

    const config = await store.load();

    expect(config).toEqual({
      ...DEFAULT_APP_CONFIG,
      weights: {
        meta: 1,
        laneCounter: 0,
        teamCounter: 1,
        synergy: DEFAULT_APP_CONFIG.weights.synergy,
        compFit: 0,
      },
      topN: 10,
      pickRateFloor: 0,
      shrinkK: 10000,
      minChipConfidence: 1,
    });
  });

  it("merges partial updates and writes the resulting config", async () => {
    const { store, configPath } = await createStore();
    await store.load();

    const config = await store.set({
      weights: {
        meta: 0.4,
      },
      rank: "diamond_plus",
      topN: 7,
    });
    const persisted = JSON.parse(await readFile(configPath, "utf8")) as typeof DEFAULT_APP_CONFIG;

    expect(config.weights).toEqual({
      ...DEFAULT_APP_CONFIG.weights,
      meta: 0.4,
    });
    expect(config.rank).toBe("diamond_plus");
    expect(config.topN).toBe(7);
    expect(persisted).toEqual(config);
  });

  it("migrates v1 counter weight to v2 laneCounter", async () => {
    const { store, configPath } = await createStore();
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        weights: {
          meta: 0.25,
          counter: 0.73,
          synergy: 0.41,
        },
        region: "kr",
        rank: "diamond_plus",
      }),
      "utf8",
    );

    const config = await store.load();

    expect(config.version).toBe(2);
    expect(config.weights).toEqual({
      ...DEFAULT_APP_CONFIG.weights,
      meta: 0.25,
      laneCounter: 0.73,
      synergy: 0.41,
    });
    expect(config.region).toBe("kr");
    expect(config.rank).toBe("diamond_plus");
  });
});

async function createStore(): Promise<{ store: AppConfigStore; configPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "league-smart-config-"));
  tempDirs.push(dir);

  return {
    store: new AppConfigStore(join(dir, "config.json")),
    configPath: join(dir, "config.json"),
  };
}
