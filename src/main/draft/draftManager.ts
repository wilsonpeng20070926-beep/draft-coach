import type { ChampionCatalog } from "../catalog/championCatalog";
import type { RoleFit } from "../data/metaDataSource";
import type { Phase } from "../lcu/lcuAdapter";
import type { DraftPlayer, DraftState, Role } from "../../shared/types";
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
  championId?: unknown;
  type?: unknown;
  completed?: unknown;
}

const roles: ReadonlySet<string> = new Set(["top", "jungle", "middle", "bottom", "utility"]);

export function toDraftState(
  raw: RawChampSelectSession | unknown,
  phase: Phase | null,
  catalog: ChampionCatalog,
): DraftState {
  const session = asRawChampSelectSession(raw);
  const localPlayerCellId = toNullableNumber(session.localPlayerCellId);
  const allies = normalizeTeam(session.myTeam, localPlayerCellId, catalog);
  const enemies = normalizeTeam(session.theirTeam, null, catalog);
  const localPlayer =
    localPlayerCellId === null
      ? null
      : allies.find((player) => player.cellId === localPlayerCellId) ?? null;

  return {
    phase: normalizePhase(phase),
    allies,
    enemies,
    bans: collectBans(session.actions, catalog),
    localPlayer,
    laneOpponent: resolveLaneOpponent(localPlayer, enemies),
  };
}

export function createEmptyDraftState(phase: Phase | null = null): DraftState {
  return {
    phase: normalizePhase(phase),
    allies: [],
    enemies: [],
    bans: [],
    localPlayer: null,
    laneOpponent: null,
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
    enemies,
    laneOpponent: resolveLaneOpponent(draftState.localPlayer, enemies),
  };
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
  localPlayerCellId: number | null,
  catalog: ChampionCatalog,
): DraftPlayer[] {
  if (!Array.isArray(rawTeam)) {
    return [];
  }

  return rawTeam.map((rawPlayer) => {
    const player = asRawChampSelectPlayer(rawPlayer);
    const cellId = toNullableNumber(player.cellId) ?? -1;
    const championId = toNullableNumber(player.championId) ?? 0;

    const role = normalizeRole(player.assignedPosition);

    return {
      cellId,
      role,
      champion: catalog.byId(championId),
      isLocalPlayer: localPlayerCellId !== null && cellId === localPlayerCellId,
      roleSource: role ? "assigned" : undefined,
      roleConfidence: role ? 1 : undefined,
    };
  });
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

function resolveLaneOpponent(
  localPlayer: DraftPlayer | null,
  enemies: DraftPlayer[],
): DraftPlayer | null {
  if (!localPlayer?.role) {
    return null;
  }

  const roleMatches = enemies.filter((enemy) => enemy.role === localPlayer.role);

  return roleMatches.length === 1 ? roleMatches[0] : null;
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
