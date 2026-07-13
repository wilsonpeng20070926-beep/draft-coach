import { describe, expect, it } from "vitest";
import {
  applySimulationCommand,
  createDraftSimulationState,
  rankAnticipatedThreats,
} from "../src/main/draft/draftSimulator";
import type { DraftState, Role } from "../src/shared/types";
import { createFixtureCatalog } from "./fixtures/championFixture";

const catalog = createFixtureCatalog();

describe("draft simulator", () => {
  it("supports picks, hovers, bans, undo, and reset without mutating live state", () => {
    const live = liveDraft();
    const originalLive = JSON.stringify(live);
    let simulation = createDraftSimulationState();

    simulation = applySimulationCommand(
      simulation,
      { type: "setPick", side: "ally", cellId: 0, championId: 103, pickState: "hovering" },
      catalog,
    );
    simulation = applySimulationCommand(
      simulation,
      { type: "setPick", side: "enemy", cellId: 5, championId: 36, pickState: "locked" },
      catalog,
    );
    simulation = applySimulationCommand(
      simulation,
      { type: "ban", championId: 122 },
      catalog,
    );

    expect(simulation.draft.allies[0]).toMatchObject({
      pickState: "hovering",
      champion: expect.objectContaining({ name: "Ahri" }),
    });
    expect(simulation.draft.enemies[0]).toMatchObject({
      pickState: "locked",
      champion: expect.objectContaining({ name: "Dr. Mundo" }),
    });
    expect(simulation.draft.bans.map((champion) => champion.name)).toEqual(["Darius"]);
    expect(JSON.stringify(live)).toBe(originalLive);

    const undone = applySimulationCommand(simulation, { type: "undo" }, catalog);
    expect(undone.draft.bans).toEqual([]);
    expect(undone.draft.enemies[0].champion?.name).toBe("Dr. Mundo");

    const reset = applySimulationCommand(undone, { type: "reset" }, catalog);
    expect(reset.history).toEqual([]);
    expect(reset.draft.bans).toEqual([]);
    expect([...reset.draft.allies, ...reset.draft.enemies].every((player) => player.champion === null)).toBe(true);
    expect(JSON.stringify(live)).toBe(originalLive);
  });

  it("infers the only remaining enemy role and supports manual enemy targeting", () => {
    let simulation = createDraftSimulationState(false);
    const assigned: Array<[number, Role]> = [
      [5, "top"],
      [6, "jungle"],
      [7, "middle"],
      [8, "bottom"],
    ];

    for (const [cellId, role] of assigned) {
      simulation = applySimulationCommand(
        simulation,
        { type: "assignRole", side: "enemy", cellId, role },
        catalog,
      );
    }

    simulation = applySimulationCommand(
      simulation,
      { type: "setTarget", side: "enemy", cellId: 9 },
      catalog,
    );

    expect(simulation.target).toEqual({
      side: "enemy",
      cellId: 9,
      role: "utility",
      source: "simulation",
      purpose: "anticipate",
    });
    expect(simulation.draft.enemies[4]).toMatchObject({
      role: "utility",
      roleSource: "inferred",
      roleConfidence: 0.65,
    });

    simulation = applySimulationCommand(
      simulation,
      { type: "setTarget", side: "enemy", cellId: 9, role: "top" },
      catalog,
    );
    expect(simulation.target?.role).toBe("top");
    expect(simulation.draft.enemies[4]).toMatchObject({
      role: "top",
      roleSource: "manual",
      roleConfidence: 1,
    });
  });

  it("ranks manual hypothetical threats above forecasts", () => {
    const manual = {
      champion: catalog.byId(36)!,
      role: "top" as const,
      source: "manual" as const,
      confidence: 0.4,
      pinned: false,
    };
    const forecast = {
      champion: catalog.byId(103)!,
      role: "middle" as const,
      source: "forecast" as const,
      confidence: 0.55,
      pinned: true,
    };

    expect(rankAnticipatedThreats([forecast, manual])[0]).toBe(manual);
  });
});

function liveDraft(): DraftState {
  return {
    phase: "champSelect",
    allies: [],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer: null,
  };
}
