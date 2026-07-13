import type {
  ChampionOpponentAggregate,
  ChampionPairAggregate,
  ChampionRoleAggregate,
  CompactDraftRecord,
  NormalizedProDraft,
  ProDataSnapshot,
  ProSide,
  TeamChampionAggregate,
  TeamPairAggregate,
  TeamResponseAggregate,
} from "../../../shared/proData";
import { PRO_SNAPSHOT_SCHEMA_VERSION } from "../../../shared/proData";
import type { Role } from "../../../shared/types";
import { withProSnapshotChecksum } from "./checksum";

export interface BuildProSnapshotOptions {
  generatedAt: string;
  source?: string;
  sourceUrl?: string;
  attribution?: string;
  warnings?: string[];
  complete?: boolean;
}

const roleOrder: Role[] = ["top", "jungle", "middle", "bottom", "utility"];

export function buildProDataSnapshot(
  drafts: NormalizedProDraft[],
  options: BuildProSnapshotOptions,
): ProDataSnapshot {
  const orderedDrafts = [...drafts].sort(
    (left, right) =>
      left.playedAt.localeCompare(right.playedAt) ||
      left.gameId.localeCompare(right.gameId),
  );
  const roleCounts = countChampionRoles(orderedDrafts);
  const championRoles = aggregateChampionRoles(orderedDrafts, roleCounts);
  const snapshot: ProDataSnapshot = {
    metadata: {
      schemaVersion: PRO_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: options.generatedAt,
      source: options.source ?? "Leaguepedia Cargo",
      sourceUrl: options.sourceUrl ?? "https://lol.fandom.com/api.php",
      attribution: options.attribution ?? "Leaguepedia contributors",
      checksumAlgorithm: "sha256",
      checksum: "",
      coveredPatches: [...new Set(orderedDrafts.map((draft) => draft.patch))].sort(comparePatch),
      competitions: [...new Set(orderedDrafts.map((draft) => draft.competition))].sort(),
      gameCount: orderedDrafts.length,
      complete: options.complete ?? true,
      warnings: [...(options.warnings ?? [])].sort(),
    },
    championRoles,
    championPairs: aggregatePairs(orderedDrafts),
    championOpponents: aggregateOpponents(orderedDrafts),
    teamChampions: aggregateTeamChampions(orderedDrafts),
    teamPairs: aggregateTeamPairs(orderedDrafts),
    teamResponses: aggregateTeamResponses(orderedDrafts),
    draftRecords: orderedDrafts.map(toCompactDraftRecord),
  };

  return withProSnapshotChecksum(snapshot);
}

function aggregateChampionRoles(
  drafts: NormalizedProDraft[],
  roleCounts: Map<string, number>,
): ChampionRoleAggregate[] {
  const map = new Map<string, ChampionRoleAggregate>();
  const gamesByPartition = countGamesByPartition(drafts);
  const flexRoles = countFlexRoles(drafts);

  for (const draft of drafts) {
    for (const pick of draft.picks) {
      const key = roleKey(draft.patch, draft.competition, pick.championId, pick.role);
      const current = map.get(key) ?? {
        patch: draft.patch,
        competition: draft.competition,
        championId: pick.championId,
        role: pick.role,
        picks: 0,
        wins: 0,
        bans: 0,
        opportunities: gamesByPartition.get(partitionKey(draft)) ?? 0,
        flexRoleCount:
          flexRoles.get(championPartitionKey(draft.patch, draft.competition, pick.championId))?.size ?? 1,
      };
      current.picks += 1;
      current.wins += draft.winner === pick.side ? 1 : 0;
      map.set(key, current);
    }

    for (const ban of draft.bans) {
      const role = primaryRole(roleCounts, ban.championId);

      if (!role) {
        continue;
      }

      const key = roleKey(draft.patch, draft.competition, ban.championId, role);
      const current = map.get(key) ?? {
        patch: draft.patch,
        competition: draft.competition,
        championId: ban.championId,
        role,
        picks: 0,
        wins: 0,
        bans: 0,
        opportunities: gamesByPartition.get(partitionKey(draft)) ?? 0,
        flexRoleCount: 1,
      };
      current.bans += 1;
      map.set(key, current);
    }
  }

  return [...map.values()].sort(compareChampionRoleAggregate);
}

function aggregatePairs(drafts: NormalizedProDraft[]): ChampionPairAggregate[] {
  const map = new Map<string, ChampionPairAggregate>();

  for (const draft of drafts) {
    for (const side of ["blue", "red"] as const) {
      const picks = draft.picks.filter((pick) => pick.side === side);

      for (let leftIndex = 0; leftIndex < picks.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < picks.length; rightIndex += 1) {
          const [left, right] = orderPair(picks[leftIndex], picks[rightIndex]);
          const key = [
            draft.patch,
            draft.competition,
            left.championId,
            left.role,
            right.championId,
            right.role,
          ].join("|");
          const current = map.get(key) ?? {
            patch: draft.patch,
            competition: draft.competition,
            championAId: left.championId,
            roleA: left.role,
            championBId: right.championId,
            roleB: right.role,
            games: 0,
            wins: 0,
          };
          current.games += 1;
          current.wins += draft.winner === side ? 1 : 0;
          map.set(key, current);
        }
      }
    }
  }

  return [...map.values()].sort(comparePairAggregate);
}

function aggregateOpponents(
  drafts: NormalizedProDraft[],
): ChampionOpponentAggregate[] {
  const map = new Map<string, ChampionOpponentAggregate>();

  for (const draft of drafts) {
    const blue = draft.picks.filter((pick) => pick.side === "blue");
    const red = draft.picks.filter((pick) => pick.side === "red");

    for (const bluePick of blue) {
      for (const redPick of red) {
        addOpponent(map, draft, bluePick, redPick, "blue");
        addOpponent(map, draft, redPick, bluePick, "red");
      }
    }
  }

  return [...map.values()].sort(compareOpponentAggregate);
}

function aggregateTeamChampions(
  drafts: NormalizedProDraft[],
): TeamChampionAggregate[] {
  const map = new Map<string, TeamChampionAggregate>();

  for (const draft of drafts) {
    for (const pick of draft.picks) {
      const team = pick.side === "blue" ? draft.blueTeam : draft.redTeam;
      const key = [draft.patch, draft.competition, team, pick.championId, pick.role].join("|");
      const current = map.get(key) ?? {
        patch: draft.patch,
        competition: draft.competition,
        team,
        championId: pick.championId,
        role: pick.role,
        picks: 0,
        wins: 0,
      };
      current.picks += 1;
      current.wins += draft.winner === pick.side ? 1 : 0;
      map.set(key, current);
    }
  }

  return [...map.values()].sort(compareTeamAggregate);
}

function aggregateTeamPairs(drafts: NormalizedProDraft[]): TeamPairAggregate[] {
  const map = new Map<string, TeamPairAggregate>();

  for (const draft of drafts) {
    for (const side of ["blue", "red"] as const) {
      const team = side === "blue" ? draft.blueTeam : draft.redTeam;
      const picks = draft.picks.filter((pick) => pick.side === side);

      for (let leftIndex = 0; leftIndex < picks.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < picks.length; rightIndex += 1) {
          const [left, right] = orderPair(picks[leftIndex], picks[rightIndex]);
          const key = [
            draft.patch,
            draft.competition,
            team,
            left.championId,
            left.role,
            right.championId,
            right.role,
          ].join("|");
          const current = map.get(key) ?? {
            patch: draft.patch,
            competition: draft.competition,
            team,
            championAId: left.championId,
            roleA: left.role,
            championBId: right.championId,
            roleB: right.role,
            games: 0,
            wins: 0,
          };
          current.games += 1;
          current.wins += draft.winner === side ? 1 : 0;
          map.set(key, current);
        }
      }
    }
  }

  return [...map.values()].sort(compareTeamPairAggregate);
}

function aggregateTeamResponses(
  drafts: NormalizedProDraft[],
): TeamResponseAggregate[] {
  const map = new Map<string, TeamResponseAggregate>();

  for (const draft of drafts) {
    for (const side of ["blue", "red"] as const) {
      const team = side === "blue" ? draft.blueTeam : draft.redTeam;
      const responses = draft.picks.filter((pick) => pick.side === side);
      const enemies = draft.picks.filter((pick) => pick.side !== side);

      for (const response of responses) {
        for (const enemy of enemies) {
          if (response.order <= enemy.order) {
            continue;
          }

          const key = [
            draft.patch,
            draft.competition,
            team,
            enemy.championId,
            enemy.role,
            response.championId,
            response.role,
          ].join("|");
          const current = map.get(key) ?? {
            patch: draft.patch,
            competition: draft.competition,
            team,
            enemyChampionId: enemy.championId,
            enemyRole: enemy.role,
            responseChampionId: response.championId,
            responseRole: response.role,
            games: 0,
            wins: 0,
          };
          current.games += 1;
          current.wins += draft.winner === side ? 1 : 0;
          map.set(key, current);
        }
      }
    }
  }

  return [...map.values()].sort(compareTeamResponseAggregate);
}

function addOpponent(
  map: Map<string, ChampionOpponentAggregate>,
  draft: NormalizedProDraft,
  pick: NormalizedProDraft["picks"][number],
  opponent: NormalizedProDraft["picks"][number],
  side: ProSide,
): void {
  const key = [
    draft.patch,
    draft.competition,
    pick.championId,
    pick.role,
    opponent.championId,
    opponent.role,
  ].join("|");
  const current = map.get(key) ?? {
    patch: draft.patch,
    competition: draft.competition,
    championId: pick.championId,
    opponentChampionId: opponent.championId,
    role: pick.role,
    opponentRole: opponent.role,
    sameRole: pick.role === opponent.role,
    games: 0,
    wins: 0,
  };
  current.games += 1;
  current.wins += draft.winner === side ? 1 : 0;
  map.set(key, current);
}

function countChampionRoles(drafts: NormalizedProDraft[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const pick of drafts.flatMap((draft) => draft.picks)) {
    const key = `${pick.championId}|${pick.role}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function countFlexRoles(drafts: NormalizedProDraft[]): Map<string, Set<Role>> {
  const map = new Map<string, Set<Role>>();

  for (const draft of drafts) {
    for (const pick of draft.picks) {
      const key = championPartitionKey(draft.patch, draft.competition, pick.championId);
      const roles = map.get(key) ?? new Set<Role>();
      roles.add(pick.role);
      map.set(key, roles);
    }
  }

  return map;
}

function countGamesByPartition(drafts: NormalizedProDraft[]): Map<string, number> {
  const map = new Map<string, number>();

  for (const draft of drafts) {
    const key = partitionKey(draft);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return map;
}

function primaryRole(counts: Map<string, number>, championId: number): Role | null {
  return roleOrder
    .map((role) => ({ role, count: counts.get(`${championId}|${role}`) ?? 0 }))
    .sort((left, right) => right.count - left.count || roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role))
    .find((item) => item.count > 0)?.role ?? null;
}

function toCompactDraftRecord(draft: NormalizedProDraft): CompactDraftRecord {
  return {
    gameId: draft.gameId,
    patch: draft.patch,
    playedAt: draft.playedAt,
    competition: draft.competition,
    competitionTier: draft.competitionTier,
    stage: draft.stage,
    format: draft.format,
    blueTeam: draft.blueTeam,
    redTeam: draft.redTeam,
    winner: draft.winner,
    picks: draft.picks.map((pick) => [pick.order, pick.side, pick.role, pick.championId]),
    bans: draft.bans.map((ban) => [ban.order, ban.side, ban.championId]),
    fearless: draft.fearless,
  };
}

function orderPair(
  left: NormalizedProDraft["picks"][number],
  right: NormalizedProDraft["picks"][number],
) {
  return roleOrder.indexOf(left.role) < roleOrder.indexOf(right.role) ||
    (left.role === right.role && left.championId < right.championId)
    ? [left, right]
    : [right, left];
}

function partitionKey(draft: Pick<NormalizedProDraft, "patch" | "competition">): string {
  return `${draft.patch}|${draft.competition}`;
}

function championPartitionKey(patch: string, competition: string, championId: number): string {
  return `${patch}|${competition}|${championId}`;
}

function roleKey(patch: string, competition: string, championId: number, role: Role): string {
  return `${patch}|${competition}|${championId}|${role}`;
}

function comparePatch(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);

  return rightMajor - leftMajor || rightMinor - leftMinor;
}

function compareChampionRoleAggregate(left: ChampionRoleAggregate, right: ChampionRoleAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.championId - right.championId || roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role);
}

function comparePairAggregate(left: ChampionPairAggregate, right: ChampionPairAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.championAId - right.championAId || left.championBId - right.championBId || roleOrder.indexOf(left.roleA) - roleOrder.indexOf(right.roleA) || roleOrder.indexOf(left.roleB) - roleOrder.indexOf(right.roleB);
}

function compareOpponentAggregate(left: ChampionOpponentAggregate, right: ChampionOpponentAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.championId - right.championId || left.opponentChampionId - right.opponentChampionId || roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role) || roleOrder.indexOf(left.opponentRole) - roleOrder.indexOf(right.opponentRole);
}

function compareTeamAggregate(left: TeamChampionAggregate, right: TeamChampionAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.team.localeCompare(right.team) || left.championId - right.championId || roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role);
}

function compareTeamPairAggregate(left: TeamPairAggregate, right: TeamPairAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.team.localeCompare(right.team) || left.championAId - right.championAId || left.championBId - right.championBId || roleOrder.indexOf(left.roleA) - roleOrder.indexOf(right.roleA) || roleOrder.indexOf(left.roleB) - roleOrder.indexOf(right.roleB);
}

function compareTeamResponseAggregate(left: TeamResponseAggregate, right: TeamResponseAggregate): number {
  return left.patch.localeCompare(right.patch) || left.competition.localeCompare(right.competition) || left.team.localeCompare(right.team) || left.enemyChampionId - right.enemyChampionId || left.responseChampionId - right.responseChampionId || roleOrder.indexOf(left.enemyRole) - roleOrder.indexOf(right.enemyRole) || roleOrder.indexOf(left.responseRole) - roleOrder.indexOf(right.responseRole);
}
