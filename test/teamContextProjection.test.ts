import { describe, expect, it } from "vitest";
import { createTeamContextProjection } from "../src/main/engine/teamContextProjection";
import type { TeamComposition, TeamContext } from "../src/shared/championAttributes";

describe("TeamContext projection", () => {
  it("maps damage mix, missing needs, satisfied badges, and top threats", () => {
    const projection = createTeamContextProjection({
      ally: {
        ...emptyComposition(),
        adWeight: 0.82,
        apWeight: 0.18,
        frontline: 0.62,
        cc: 0.42,
        waveclear: 0.36,
        championCount: 3,
      },
      enemy: emptyComposition(),
      allyNeeds: [
        { kind: "ap", severity: 0.7 },
        { kind: "engage", severity: 0.4 },
      ],
      enemyThreats: [
        { kind: "dive", severity: 0.8 },
        { kind: "burst-ap", severity: 0.55 },
        { kind: "poke", severity: 0.35 },
        { kind: "hard-engage", severity: 0.2 },
      ],
      confidence: 0.64,
    });

    expect(projection?.allyDamage).toEqual({ ad: 0.82, ap: 0.18, knownCount: 3 });
    expect(projection?.needs.slice(0, 2)).toEqual([
      { kind: "ap", severity: 0.7, satisfied: false },
      { kind: "engage", severity: 0.4, satisfied: false },
    ]);
    expect(projection?.needs.some((need) => need.kind === "frontline" && need.satisfied)).toBe(
      true,
    );
    expect(projection?.enemyThreats.map((threat) => threat.kind)).toEqual([
      "dive",
      "burst-ap",
      "poke",
    ]);
  });

  it("returns null without a context", () => {
    expect(createTeamContextProjection(null)).toBeNull();
  });
});

function emptyComposition(): TeamComposition {
  return {
    adWeight: 0,
    apWeight: 0,
    engage: 0,
    peel: 0,
    frontline: 0,
    poke: 0,
    waveclear: 0,
    cc: 0,
    mobility: 0,
    carryPotential: 0,
    rangedCount: 0,
    powerCurve: { early: 0, mid: 0, late: 0 },
    championCount: 0,
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };
}
