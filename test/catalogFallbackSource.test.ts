import { describe, expect, it } from "vitest";
import {
  CatalogFallbackMetaDataSource,
  ResilientMetaDataSource,
} from "../src/main/data/catalogFallbackSource";
import type { MetaDataSource } from "../src/main/data/metaDataSource";
import { createFixtureCatalog } from "./fixtures/championFixture";

describe("catalog ranked-data fallback", () => {
  it("provides honest neutral candidates for every role when live data is unavailable", async () => {
    const source = new CatalogFallbackMetaDataSource(createFixtureCatalog());
    const bottom = await source.getLaneMeta("bottom");
    const support = await source.getLaneMeta("utility");

    expect(bottom.some((entry) => entry.champion.name === "Jinx")).toBe(true);
    expect(support.some((entry) => entry.champion.name === "Thresh")).toBe(true);
    expect(bottom.every((entry) => entry.winRate === 0.5)).toBe(true);
    expect(bottom.every((entry) => entry.dataQuality === "catalog-fallback")).toBe(true);
  });

  it("uses the catalog source only after the primary source fails", async () => {
    const fallback = new CatalogFallbackMetaDataSource(createFixtureCatalog());
    const primary = failingSource();
    const source = new ResilientMetaDataSource(primary, fallback);

    await expect(source.getLaneMeta("middle", "global", "emerald_plus")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          champion: expect.objectContaining({ name: "Ahri" }),
          dataQuality: "catalog-fallback",
        }),
      ]),
    );
  });
});

function failingSource(): MetaDataSource {
  const fail = async (): Promise<never> => {
    throw new Error("offline");
  };

  return {
    getLaneMeta: fail,
    getMatchup: fail,
    getSynergy: fail,
    getChampionRoleFit: fail,
    getChampionAnalysis: fail,
  };
}
