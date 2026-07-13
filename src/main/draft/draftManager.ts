import type { ChampionCatalog } from "../catalog/championCatalog";
import type { RoleFit } from "../data/metaDataSource";
import type { Phase } from "../lcu/lcuAdapter";
import type {
  DraftPickAction,
  DraftPlayer,
  DraftState,
  DraftTarget,
  PickState,
  Role,
} from "../../shared/types";
import { inferEnemyRoles } from "./roleInference";

export interface RawChampSelectSession {
  localPlayerCellId?: unknown;
  myTeam?: unknown;
  theirTeam?: unknown;
  actions?: unknown;
}

interface RawChampSelectPlayer {
  cellId?: unknown;
  championId?: unknown;
  assignedPosition?: unknown;
}

interface RawChampSelectAction {
  id?: unknown;
  actorCellId?: unknown;
  championId?: unknown;
  type?: unknown;
  completed?: unknown;
  isInProgress?: unknown;
}

const roles: ReadonlySet<string> = new Set(["top", "jungle", "middle", "bottom", "utility"]);

export function toDraftState(
  raw: RawChampSelectSession | unknown,
  phase: Phase | null,
  catalog: ChampionCatalog,
): DraftState {
  const session = asRawChampSelectSession(raw);
  const localPlayerCellId = toNullableNumber(session.localPlayerCellId);
  const pickActions = normalizePickActions(session.actions);
  const allies = normalizeTeam(
    session.myTeam,
    "ally",
    localPlayerCellId,
    pickActions,
    catalog,
  );
  const enemies = normalizeTeam(
    session.theirTeam,
    "enemy",
    null,
    pickActions,
    catalog,
  );
  const localPlayer =
    localPlayerCellId === null
      ? null
      : allies.find((player) => player.cellId === localPlayerCellId) ?? null;

  return {
    phase: normalizePhase(phase),
    allies,
    enemies,
    bans: collectBans(session.actions, catalog),
    pickActions,
    activeAllyPickCellIds: collectActiveAllyPickCellIds(pickActions, allies),
    localPlayer,
  };
}

export function createEmptyDraftState(phase: Phase | null = null): DraftState {
  return {
    phase: normalizePhase(phase),
    allies: [],
    enemies: [],
    bans: [],
    pickActions: [],
    activeAllyPickCellIds: [],
    localPlayer: null,
  };
}

export async function inferDraftStateEnemyRoles(
  draftState: DraftState,
  getRoleFit: (champion: NonNullable<DraftPlayer["champion"]>) => Promise<RoleFit>,
): Promise<DraftState> {
  const knownRoles: Partial<Record<number, Role>> = {};

  for (const enemy of draftState.enemies) {
    if (enemy.champion && enemy.roleSource === "assigned" && enemy.role) {
      knownRoles[enemy.champion.id] = enemy.role;
    }
  }

  const inferredRoles = await inferEnemyRoles(draftState.enemies, getRoleFit, knownRoles);
  const enemies = draftState.enemies.map((enemy) => {
    if (!enemy.champion) {
      return enemy;
    }

    if (enemy.roleSource === "assigned" && enemy.role) {
      return {
        ...enemy,
        roleConfidence: 1,
      };
    }

    const inferred = inferredRoles.get(enemy.champion.id);

    if (!inferred) {
      return enemy;
    }

    return {
      ...enemy,
      role: inferred.role,
      roleSource: "inferred" as const,
      roleConfidence: inferred.confidence,
    };
  });

  return {
    ...draftState,
    enemies: inferRemainingUnpickedEnemyRoles(enemies),
  };
}

export function inferRemainingUnpickedEnemyRoles(
  enemies: DraftPlayer[],
): DraftPlayer[] {
  const assigned = new Set(
    enemies
      .map((enemy) => enemy.role)
      .filter((role): role is Role => role !== null),
  );
  const remainingRoles = [...roles]
    .map((role) => role as Role)
    .filter((role) => !assigned.has(role));
  const unassigned = enemies.filter((enemy) => enemy.role === null);

  if (remainingRoles.length !== 1 || unassigned.length !== 1) {
    return enemies;
  }

  const targetCellId = unassigned[0].cellId;

  return enemies.map((enemy) =>
    enemy.cellId === targetCellId
      ? {
          ...enemy,
          role: remainingRoles[0],
          roleSource: "inferred",
          roleConfidence: 0.55,
        }
      : enemy,
  );
}

export function resolveTargetLaneOpponent(
  draftState: DraftState,
  target: DraftTarget,
): DraftPlayer | null {
  if (target.side !== "ally") {
    return null;
  }

  const roleMatches = draftState.enemies.filter(
    (enemy) =>
      enemy.pickState === "locked" &&
      enemy.champion !== null &&
      enemy.role === target.role,
  );

  return roleMatches.length === 1 ? roleMatches[0] : null;
}

export function normalizePickActions(actions: unknown): DraftPickAction[] {
  if (!Array.isArray(actions)) {
    return [];
  }

  const normalized: DraftPickAction[] = [];

  actions.forEach((group, groupIndex) => {
    if (!Array.isArray(group)) {
      return;
    }

    group.forEach((rawAction, order) => {
      const action = asRawChampSelectAction(rawAction);
      const actorCellId = toNullableNumber(action.actorCellId);

      if (action.type !== "pick" || actorCellId === null) {
        return;
      }

      normalized.push({
        id: toNullableNumber(action.id),
        groupIndex,
        order,
        actorCellId,
        championId: toNullableNumber(action.championId) ?? 0,
        completed: action.completed === true,
        isInProgress: action.isInProgress === true,
      });
    });
  });

  return normalized;
}

export function normalizePhase(phase: Phase | null): DraftState["phase"] {
  if (!phase || phase === "None") {
    return "none";
  }

  if (phase === "ChampSelect") {
    return "champSelect";
  }

  if (phase === "InProgress" || phase === "GameStart") {
    return "inProgress";
  }

  return "other";
}

function normalizeTeam(
  rawTeam: unknown,
  side: DraftPlayer["side"],
  localPlayerCellId: number | null,
  pickActions: DraftPickAction[],
  catalog: ChampionCatalog,
): DraftPlayer[] {
  if (!Array.isArray(rawTeam)) {
    return [];
  }

  return rawTeam.map((rawPlayer) => {
    const player = asRawChampSelectPlayer(rawPlayer);
    const cellId = toNullableNumber(player.cellId) ?? -1;
    const rawChampionId = toNullableNumber(player.championId) ?? 0;
    const action = findLatestPickAction(pickActions, cellId);
    const championId = resolveChampionId(rawChampionId, action);
    const pickState = resolvePickState(championId, action);

    const role = normalizeRole(player.assignedPosition);

    return {
      cellId,
      side,
      role,
      champion: pickState === "empty" ? null : catalog.byId(championId),
      pickState,
      isLocalPlayer: localPlayerCellId !== null && cellId === localPlayerCellId,
      roleSource: role ? "assigned" : undefined,
      roleConfidence: role ? 1 : undefined,
    };
  });
}

function findLatestPickAction(
  pickActions: DraftPickAction[],
  cellId: number,
): DraftPickAction | null {
  const matches = pickActions.filter((action) => action.actorCellId === cellId);

  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function resolveChampionId(
  rawChampionId: number,
  action: DraftPickAction | null,
): number {
  if (action?.championId && action.championId > 0) {
    return action.championId;
  }

  return rawChampionId;
}

function resolvePickState(
  championId: number,
  action: DraftPickAction | null,
): PickState {
  if (action?.completed && action.championId > 0) {
    return "locked";
  }

  return championId > 0 ? "hovering" : "empty";
}

function collectActiveAllyPickCellIds(
  pickActions: DraftPickAction[],
  allies: DraftPlayer[],
): number[] {
  const allyCellIds = new Set(allies.map((ally) => ally.cellId));
  const seen = new Set<number>();
  const activeCellIds: number[] = [];

  for (const action of pickActions) {
    if (
      action.completed ||
      !action.isInProgress ||
      !allyCellIds.has(action.actorCellId) ||
      seen.has(action.actorCellId)
    ) {
      continue;
    }

    seen.add(action.actorCellId);
    activeCellIds.push(action.actorCellId);
  }

  return activeCellIds;
}

function collectBans(actions: unknown, catalog: ChampionCatalog): DraftState["bans"] {
  if (!Array.isArray(actions)) {
    return [];
  }

  const seenChampionIds = new Set<number>();
  const bans: DraftState["bans"] = [];

  for (const group of actions) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const rawAction of group) {
      const action = asRawChampSelectAction(rawAction);
      const championId = toNullableNumber(action.championId) ?? 0;

      if (
        action.type !== "ban" ||
        action.completed !== true ||
        championId <= 0 ||
        seenChampionIds.has(championId)
      ) {
        continue;
      }

      const champion = catalog.byId(championId);

      if (champion) {
        seenChampionIds.add(championId);
        bans.push(champion);
      }
    }
  }

  return bans;
}

function normalizeRole(value: unknown): Role | null {
  return typeof value === "string" && roles.has(value) ? (value as Role) : null;
}

function asRawChampSelectSession(raw: unknown): RawChampSelectSession {
  return raw && typeof raw === "object" ? (raw as RawChampSelectSession) : {};
}

function asRawChampSelectPlayer(raw: unknown): RawChampSelectPlayer {
  return raw && typeof raw === "object" ? (raw as RawChampSelectPlayer) : {};
}

function asRawChampSelectAction(raw: unknown): RawChampSelectAction {
  return raw && typeof raw === "object" ? (raw as RawChampSelectAction) : {};
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
