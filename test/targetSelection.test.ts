import { describe, expect, it } from "vitest";
import {
  createDraftTargetSelectionState,
  deriveAutomaticDraftTargets,
  reconcileDraftTargetSelection,
  selectManualDraftTarget,
} from "../src/main/draft/targetSelection";
import type {
  DraftPickAction,
  DraftPlayer,
  DraftState,
  Role,
} from "../src/shared/types";

describe("draft target selection", () => {
  it("orders simultaneous active allies local-first, then by action order", () => {
    const draft = createDraft(
      [player(0, "top"), player(2, "middle"), player(4, "utility", true)],
      [action(40, 0, 0), action(42, 2, 1), action(44, 4, 2)],
    );

    expect(
      deriveAutomaticDraftTargets(draft).map((target) => target.cellId),
    ).toEqual([4, 0, 2]);
  });

  it("keeps a manual override for the current turn and resets it on a new active turn", () => {
    const firstTurn = createDraft(
      [player(0, "top"), player(2, "middle", true)],
      [action(10, 0, 0), action(11, 2, 1)],
    );
    const initial = reconcileDraftTargetSelection(
      firstTurn,
      createDraftTargetSelectionState(),
    );
    const manual = selectManualDraftTarget(firstTurn, initial.state, 0);
    const sameTurn = reconcileDraftTargetSelection(firstTurn, manual.state);

    expect(manual.selectedTarget).toMatchObject({
      cellId: 0,
      source: "manual",
    });
    expect(sameTurn.selectedTarget).toMatchObject({
      cellId: 0,
      source: "manual",
    });

    const nextTurn = createDraft(
      [player(0, "top"), player(2, "middle", true)],
      [action(20, 2, 0)],
    );
    const reset = reconcileDraftTargetSelection(nextTurn, sameTurn.state);

    expect(reset.state.manualCellId).toBeNull();
    expect(reset.selectedTarget).toMatchObject({
      cellId: 2,
      source: "automatic",
    });
  });
});

function createDraft(
  allies: DraftPlayer[],
  pickActions: DraftPickAction[],
): DraftState {
  const localPlayer = allies.find((ally) => ally.isLocalPlayer) ?? null;

  return {
    phase: "champSelect",
    allies,
    enemies: [],
    bans: [],
    pickActions,
    activeAllyPickCellIds: pickActions.map((action) => action.actorCellId),
    localPlayer,
  };
}

function player(cellId: number, role: Role, isLocalPlayer = false): DraftPlayer {
  return {
    cellId,
    side: "ally",
    role,
    champion: null,
    pickState: "empty",
    isLocalPlayer,
    roleSource: "assigned",
    roleConfidence: 1,
  };
}

function action(id: number, actorCellId: number, order: number): DraftPickAction {
  return {
    id,
    groupIndex: 0,
    order,
    actorCellId,
    championId: 0,
    completed: false,
    isInProgress: true,
  };
}
