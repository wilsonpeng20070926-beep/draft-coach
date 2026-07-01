import { describe, expect, it } from "vitest";
import { championAttributeOverrides } from "../src/main/catalog/championAttributeOverrides";
import {
  createChampionAttributeProvider,
  deriveChampionAttributes,
} from "../src/main/catalog/championAttributes";
import type { ChampionRef } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();

describe("champion attributes", () => {
  it("derives coarse identity from Data Dragon tags", () => {
    const jinx = mustChampion(222);
    const attributes = deriveChampionAttributes(jinx);

    expect(attributes).toMatchObject({
      championId: 222,
      damageStyle: "ad",
      range: "ranged",
      primaryClass: "Marksman",
      powerCurve: "late",
    });
    expect(attributes.carryPotential).toBeGreaterThan(0.8);
    expect(attributes.frontline).toBeLessThan(0.2);
  });

  it("lets OP.GG damage style override the tag-derived damage prior", () => {
    const gragas = mustChampion(79);
    const tagOnly = deriveChampionAttributes(gragas);
    const opggBacked = deriveChampionAttributes(gragas, "ap");

    expect(tagOnly.damageStyle).toBe("hybrid");
    expect(opggBacked.damageStyle).toBe("ap");
    expect(opggBacked.attributeConfidence).toBeGreaterThan(tagOnly.attributeConfidence);
  });

  it("applies small curated overrides for clear tag misses", () => {
    const malphite = champion({
      id: 54,
      slug: "Malphite",
      name: "Malphite",
      tags: ["Tank", "Fighter"],
    });
    const attributes = deriveChampionAttributes(malphite);

    expect(attributes.damageStyle).toBe("ap");
    expect(attributes.engage).toBeGreaterThan(0.9);
    expect(attributes.cc).toBeGreaterThan(0.8);
  });

  it("returns safe unknown attributes for a synthetic champion with no usable tags", () => {
    const zaahenPreview = champion({
      id: 9904,
      slug: "ZaahenPreview",
      name: "Zaahen Preview",
      tags: [],
    });

    expect(deriveChampionAttributes(zaahenPreview)).toMatchObject({
      championId: 9904,
      damageStyle: "unknown",
      range: "unknown",
      powerCurve: "unknown",
      primaryClass: "Unknown",
    });
  });

  it("memoizes provider results by patch, champion, and damage style", () => {
    const provider = createChampionAttributeProvider("15.10.1");
    const jinx = mustChampion(222);
    const first = provider.getAttributes(jinx);
    const second = provider.getAttributes(jinx);
    const apOverride = provider.getAttributes(jinx, "ap");

    expect(second).toBe(first);
    expect(apOverride).not.toBe(first);
    expect(apOverride.damageStyle).toBe("ap");
  });

  it("keeps the curated override table small", () => {
    expect(Object.keys(championAttributeOverrides).length).toBeLessThanOrEqual(40);
  });
});

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}

function champion(value: Omit<ChampionRef, "iconUrl">): ChampionRef {
  return {
    ...value,
    iconUrl: "",
  };
}
