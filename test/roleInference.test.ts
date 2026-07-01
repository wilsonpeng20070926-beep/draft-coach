import { describe, expect, it } from "vitest";
import {
  createEmptyRoleFit,
  inferEnemyRoles,
  type EnemyRoleMap,
} from "../src/main/draft/roleInference";
import type { RoleFit } from "../src/main/data/metaDataSource";
import type { ChampionRef, DraftPlayer, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();
const ahri = mustChampion(103);
const yasuo = mustChampion(157);
const wukong = mustChampion(62);
const jinx = mustChampion(222);

describe("role inference", () => {
  it("assigns one overwhelming single-role champion with high confidence", async () => {
    const result = await inferEnemyRoles([enemy(1, wukong)], async () =>
      roleFit({ jungle: 1, top: 0.05 }),
    );

    expect(inferred(result, wukong)).toMatchObject({
      role: "jungle",
    });
    expect(inferred(result, wukong).confidence).toBeGreaterThan(0.9);
  });

  it("solves flex picks into distinct roles", async () => {
    const result = await inferEnemyRoles(
      [enemy(1, ahri), enemy(2, yasuo)],
      async (champion) =>
        champion.id === ahri.id
          ? roleFit({ middle: 1, utility: 0.35 })
          : roleFit({ middle: 0.85, top: 0.8 }),
    );

    expect(inferred(result, ahri).role).toBe("middle");
    expect(inferred(result, yasuo).role).toBe("top");
    expect(new Set([...result.values()].map((item) => item.role)).size).toBe(2);
  });

  it("respects locked LCU assigned roles", async () => {
    const result = await inferEnemyRoles(
      [enemy(1, ahri), enemy(2, yasuo)],
      async (champion) =>
        champion.id === ahri.id
          ? roleFit({ middle: 1, utility: 0.2 })
          : roleFit({ middle: 1, top: 0.4 }),
      { [yasuo.id]: "middle" },
    );

    expect(inferred(result, yasuo)).toEqual({
      role: "middle",
      confidence: 1,
    });
    expect(inferred(result, ahri).role).toBe("utility");
  });

  it("falls back to champion tags with low confidence when role data is absent", async () => {
    const result = await inferEnemyRoles([enemy(1, jinx)], async () => createEmptyRoleFit());

    expect(inferred(result, jinx)).toEqual({
      role: "bottom",
      confidence: 0.4,
    });
  });

  it("handles fewer than five known enemies", async () => {
    const result = await inferEnemyRoles(
      [enemy(1, ahri), enemy(2, null), enemy(3, wukong)],
      async (champion) =>
        champion.id === ahri.id ? roleFit({ middle: 1 }) : roleFit({ jungle: 1 }),
    );

    expect([...result.values()].map((item) => item.role).sort()).toEqual(["jungle", "middle"]);
  });
});

function enemy(cellId: number, champion: ChampionRef | null): DraftPlayer {
  return {
    cellId,
    champion,
    role: null,
    isLocalPlayer: false,
  };
}

function roleFit(values: Partial<RoleFit>): RoleFit {
  return {
    ...createEmptyRoleFit(),
    ...values,
  };
}

function inferred(result: EnemyRoleMap, champion: ChampionRef) {
  const item = result.get(champion.id);

  if (!item) {
    throw new Error(`Missing inferred role for ${champion.name}`);
  }

  return item;
}

function mustChampion(id: number): ChampionRef {
  const champion = catalog.byId(id);

  if (!champion) {
    throw new Error(`Missing fixture champion ${id}`);
  }

  return champion;
}
