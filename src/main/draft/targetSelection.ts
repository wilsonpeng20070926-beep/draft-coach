import type { DraftPlayer, DraftState, DraftTarget } from "../../shared/types";

export interface DraftTargetSelectionState {
  activeTurnKey: string;
  manualCellId: number | null;
}

export interface DraftTargetSelection {
  state: DraftTargetSelectionState;
  automaticTargets: DraftTarget[];
  selectedTarget: DraftTarget | null;
}

export function createDraftTargetSelectionState(): DraftTargetSelectionState {
  return {
    activeTurnKey: "",
    manualCellId: null,
  };
}

export function reconcileDraftTargetSelection(
  draft: DraftState,
  previous: DraftTargetSelectionState,
): DraftTargetSelection {
  const activeTurnKey = createActiveTurnKey(draft);
  const manualCellId =
    previous.activeTurnKey === activeTurnKey ? previous.manualCellId : null;
  const state = { activeTurnKey, manualCellId };
  const automaticTargets = deriveAutomaticDraftTargets(draft);
  const selectedTarget =
    (manualCellId === null ? null : createAllyTarget(draft, manualCellId, "manual")) ??
    automaticTargets[0] ??
    createLocalInspectionTarget(draft);

  return {
    state,
    automaticTargets,
    selectedTarget,
  };
}

export function selectManualDraftTarget(
  draft: DraftState,
  previous: DraftTargetSelectionState,
  cellId: number,
): DraftTargetSelection {
  const reconciled = reconcileDraftTargetSelection(draft, previous);
  const manualTarget = createAllyTarget(draft, cellId, "manual");

  if (!manualTarget) {
    return reconciled;
  }

  return {
    state: {
      activeTurnKey: reconciled.state.activeTurnKey,
      manualCellId: cellId,
    },
    automaticTargets: reconciled.automaticTargets,
    selectedTarget: manualTarget,
  };
}

export function deriveAutomaticDraftTargets(draft: DraftState): DraftTarget[] {
  const orderedCellIds = [...draft.activeAllyPickCellIds].sort((left, right) => {
    if (left === draft.localPlayer?.cellId) {
      return -1;
    }

    if (right === draft.localPlayer?.cellId) {
      return 1;
    }

    return actionOrder(draft, left) - actionOrder(draft, right) || left - right;
  });

  return orderedCellIds
    .map((cellId) => createAllyTarget(draft, cellId, "automatic"))
    .filter((target): target is DraftTarget => target !== null);
}

export function draftTargetKey(target: DraftTarget): string {
  const surface = target.source === "simulation" ? "simulation" : "live";

  return `${surface}:${target.side}:${target.cellId}:${target.role}:${target.purpose}`;
}

function createActiveTurnKey(draft: DraftState): string {
  return draft.pickActions
    .filter(
      (action) =>
        action.isInProgress &&
        !action.completed &&
        draft.activeAllyPickCellIds.includes(action.actorCellId),
    )
    .map(
      (action) =>
        `${action.groupIndex}:${action.order}:${action.id ?? "none"}:${action.actorCellId}`,
    )
    .join("|");
}

function createAllyTarget(
  draft: DraftState,
  cellId: number,
  source: Extract<DraftTarget["source"], "automatic" | "manual">,
): DraftTarget | null {
  const player = draft.allies.find((ally) => ally.cellId === cellId);

  return player?.role ? targetFromPlayer(player, source) : null;
}

function createLocalInspectionTarget(draft: DraftState): DraftTarget | null {
  return draft.localPlayer?.role
    ? targetFromPlayer(draft.localPlayer, "automatic")
    : null;
}

function targetFromPlayer(
  player: DraftPlayer,
  source: Extract<DraftTarget["source"], "automatic" | "manual">,
): DraftTarget {
  return {
    side: "ally",
    cellId: player.cellId,
    role: player.role!,
    source,
    purpose: "recommend",
  };
}

function actionOrder(draft: DraftState, cellId: number): number {
  const action = draft.pickActions.find(
    (candidate) =>
      candidate.actorCellId === cellId &&
      candidate.isInProgress &&
      !candidate.completed,
  );

  return action ? action.groupIndex * 100 + action.order : Number.MAX_SAFE_INTEGER;
}
