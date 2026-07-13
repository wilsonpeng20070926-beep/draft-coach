import type { ChampionCatalog } from "../catalog/championCatalog";
import type {
  AnticipatedThreat,
  DraftPlayer,
  DraftSimulationState,
  DraftState,
  DraftTarget,
  Role,
  SimulationCommand,
  SimulationSnapshot,
} from "../../shared/types";

const roles: Role[] = ["top", "jungle", "middle", "bottom", "utility"];
const MAX_SIMULATION_HISTORY = 50;

export function createDraftSimulationState(
  assignDefaultRoles = true,
): DraftSimulationState {
  return {
    draft: {
      phase: "champSelect",
      allies: createSimulationTeam("ally", assignDefaultRoles),
      enemies: createSimulationTeam("enemy", assignDefaultRoles),
      bans: [],
      pickActions: [],
      activeAllyPickCellIds: [],
      localPlayer: null,
    },
    target: null,
    threats: [],
    history: [],
  };
}

export function applySimulationCommand(
  state: DraftSimulationState,
  command: SimulationCommand,
  catalog: Pick<ChampionCatalog, "byId">,
): DraftSimulationState {
  if (command.type === "undo") {
    return undoSimulation(state);
  }

  if (command.type === "reset") {
    return createDraftSimulationState();
  }

  if (command.type === "assignRole") {
    const next = updatePlayer(state, command.side, command.cellId, (player) => ({
      ...player,
      role: command.role,
      roleSource: command.role ? "manual" : undefined,
      roleConfidence: command.role ? 1 : undefined,
    }));

    return next.target?.side === command.side && next.target.cellId === command.cellId
      ? {
          ...next,
          target: command.role
            ? { ...next.target, role: command.role }
            : null,
        }
      : next;
  }

  if (command.type === "setPick") {
    const champion = catalog.byId(command.championId);

    if (
      !champion ||
      state.draft.bans.some((banned) => banned.id === champion.id) ||
      isLockedElsewhere(state.draft, command.side, command.cellId, champion.id)
    ) {
      return state;
    }

    return updatePlayer(state, command.side, command.cellId, (player) => ({
      ...player,
      champion: command.pickState === "empty" ? null : champion,
      pickState: command.pickState,
    }));
  }

  if (command.type === "clearPick") {
    return updatePlayer(state, command.side, command.cellId, (player) => ({
      ...player,
      champion: null,
      pickState: "empty",
    }));
  }

  if (command.type === "ban") {
    const champion = catalog.byId(command.championId);

    if (!champion || state.draft.bans.some((banned) => banned.id === champion.id)) {
      return state;
    }

    return withHistory(state, {
      ...snapshot(state),
      draft: {
        ...state.draft,
        bans: [...state.draft.bans, champion],
      },
    });
  }

  if (command.type === "unban") {
    return withHistory(state, {
      ...snapshot(state),
      draft: {
        ...state.draft,
        bans: state.draft.bans.filter((champion) => champion.id !== command.championId),
      },
    });
  }

  if (command.type === "setTarget") {
    return setSimulationTarget(
      state,
      command.side,
      command.cellId,
      command.role ?? null,
    );
  }

  if (command.type === "pinThreat") {
    const champion = catalog.byId(command.championId);

    return champion
      ? addSimulationThreat(state, {
          champion,
          role: command.role ?? null,
          source: command.source ?? "simulation",
          confidence: clamp01(command.confidence ?? 0.7),
          pinned: true,
          evidence: ["Pinned hypothetical threat"],
        })
      : state;
  }

  return removeSimulationThreat(state, command.championId);
}

export function setSimulationTarget(
  state: DraftSimulationState,
  side: DraftPlayer["side"],
  cellId: number,
  manualRole: Role | null = null,
): DraftSimulationState {
  const inferred = inferRemainingEnemyRoles(state);
  const players = side === "ally" ? inferred.draft.allies : inferred.draft.enemies;
  const player = players.find((candidate) => candidate.cellId === cellId);
  const role = manualRole ?? player?.role ?? null;

  if (!player || !role) {
    return inferred;
  }

  const target: DraftTarget = {
    side,
    cellId,
    role,
    source: "simulation",
    purpose: side === "ally" ? "recommend" : "anticipate",
  };
  const nextDraft =
    manualRole && player.role !== manualRole
      ? replacePlayer(inferred.draft, side, cellId, {
          ...player,
          role: manualRole,
          roleSource: "manual",
          roleConfidence: 1,
        })
      : inferred.draft;

  return withHistory(state, {
    draft: nextDraft,
    target,
    threats: inferred.threats,
  });
}

export function inferRemainingEnemyRoles(
  state: DraftSimulationState,
): DraftSimulationState {
  const assignedRoles = new Set(
    state.draft.enemies
      .map((enemy) => enemy.role)
      .filter((role): role is Role => role !== null),
  );
  const remainingRoles = roles.filter((role) => !assignedRoles.has(role));
  const unassigned = state.draft.enemies.filter((enemy) => enemy.role === null);

  if (remainingRoles.length !== 1 || unassigned.length !== 1) {
    return state;
  }

  const player = unassigned[0];

  return {
    ...state,
    draft: replacePlayer(state.draft, "enemy", player.cellId, {
      ...player,
      role: remainingRoles[0],
      roleSource: "inferred",
      roleConfidence: 0.65,
    }),
  };
}

export function addSimulationThreat(
  state: DraftSimulationState,
  threat: AnticipatedThreat,
): DraftSimulationState {
  const threats = rankAnticipatedThreats([
    ...state.threats.filter((existing) => existing.champion.id !== threat.champion.id),
    {
      ...threat,
      confidence: clamp01(threat.confidence),
      pinned: true,
    },
  ]);

  return withHistory(state, {
    ...snapshot(state),
    threats,
  });
}

export function removeSimulationThreat(
  state: DraftSimulationState,
  championId: number,
): DraftSimulationState {
  if (!state.threats.some((threat) => threat.champion.id === championId)) {
    return state;
  }

  return withHistory(state, {
    ...snapshot(state),
    threats: state.threats.filter((threat) => threat.champion.id !== championId),
  });
}

export function rankAnticipatedThreats(
  threats: AnticipatedThreat[],
): AnticipatedThreat[] {
  const sourceRank: Record<AnticipatedThreat["source"], number> = {
    manual: 3,
    simulation: 2,
    forecast: 1,
  };

  return [...threats].sort(
    (left, right) =>
      sourceRank[right.source] - sourceRank[left.source] ||
      Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
      right.confidence - left.confidence ||
      left.champion.id - right.champion.id,
  );
}

export function undoSimulation(state: DraftSimulationState): DraftSimulationState {
  const previous = state.history[state.history.length - 1];

  return previous
    ? {
        ...previous,
        history: state.history.slice(0, -1),
      }
    : state;
}

function updatePlayer(
  state: DraftSimulationState,
  side: DraftPlayer["side"],
  cellId: number,
  update: (player: DraftPlayer) => DraftPlayer,
): DraftSimulationState {
  const players = side === "ally" ? state.draft.allies : state.draft.enemies;
  const player = players.find((candidate) => candidate.cellId === cellId);

  if (!player) {
    return state;
  }

  return withHistory(state, {
    ...snapshot(state),
    draft: replacePlayer(state.draft, side, cellId, update(player)),
  });
}

function replacePlayer(
  draft: DraftState,
  side: DraftPlayer["side"],
  cellId: number,
  player: DraftPlayer,
): DraftState {
  return side === "ally"
    ? {
        ...draft,
        allies: draft.allies.map((candidate) =>
          candidate.cellId === cellId ? player : candidate,
        ),
      }
    : {
        ...draft,
        enemies: draft.enemies.map((candidate) =>
          candidate.cellId === cellId ? player : candidate,
        ),
      };
}

function withHistory(
  state: DraftSimulationState,
  next: SimulationSnapshot,
): DraftSimulationState {
  if (sameSnapshot(snapshot(state), next)) {
    return state;
  }

  return {
    ...next,
    history: [...state.history, snapshot(state)].slice(-MAX_SIMULATION_HISTORY),
  };
}

function snapshot(state: DraftSimulationState): SimulationSnapshot {
  return {
    draft: state.draft,
    target: state.target,
    threats: state.threats,
  };
}

function sameSnapshot(left: SimulationSnapshot, right: SimulationSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createSimulationTeam(
  side: DraftPlayer["side"],
  assignDefaultRoles: boolean,
): DraftPlayer[] {
  const offset = side === "ally" ? 0 : 5;

  return roles.map((role, index) => ({
    cellId: offset + index,
    side,
    role: assignDefaultRoles ? role : null,
    champion: null,
    pickState: "empty",
    isLocalPlayer: false,
    roleSource: assignDefaultRoles ? "manual" : undefined,
    roleConfidence: assignDefaultRoles ? 1 : undefined,
  }));
}

function isLockedElsewhere(
  draft: DraftState,
  side: DraftPlayer["side"],
  cellId: number,
  championId: number,
): boolean {
  return [...draft.allies, ...draft.enemies].some(
    (player) =>
      (player.side !== side || player.cellId !== cellId) &&
      player.pickState === "locked" &&
      player.champion?.id === championId,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
