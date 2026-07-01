import type { ChampionRef, DraftPlayer, Role } from "../../shared/types";
import type { RoleFit } from "../data/metaDataSource";

export interface InferredRole {
  role: Role;
  confidence: number;
}

export type EnemyRoleMap = Map<number, InferredRole>;

const roles: Role[] = ["top", "jungle", "middle", "bottom", "utility"];
const minimumConfidence = 0.3;
const maximumConfidence = 0.95;
const fallbackMaximumConfidence = 0.4;

interface EnemyCandidate {
  champion: ChampionRef;
  roleFit: RoleFit;
  usedFallback: boolean;
}

export async function inferEnemyRoles(
  enemies: DraftPlayer[],
  getRoleFit: (champion: ChampionRef) => Promise<RoleFit>,
  knownRoles: Partial<Record<number, Role>> = {},
): Promise<EnemyRoleMap> {
  const candidates = await Promise.all(
    enemies
      .map((enemy) => enemy.champion)
      .filter((champion): champion is ChampionRef => champion !== null)
      .map(async (champion): Promise<EnemyCandidate> => {
        const fetchedFit = await getRoleFit(champion);
        const usedFallback = totalFit(fetchedFit) <= 0;

        return {
          champion,
          roleFit: usedFallback ? createTagPrior(champion) : fetchedFit,
          usedFallback,
        };
      }),
  );
  const assignments: EnemyRoleMap = new Map();
  const lockedRoles = new Set<Role>();
  const unlockedCandidates: EnemyCandidate[] = [];

  for (const candidate of candidates) {
    const knownRole = knownRoles[candidate.champion.id];

    if (knownRole) {
      assignments.set(candidate.champion.id, {
        role: knownRole,
        confidence: 1,
      });
      lockedRoles.add(knownRole);
    } else {
      unlockedCandidates.push(candidate);
    }
  }

  const remainingRoles = roles.filter((role) => !lockedRoles.has(role));
  const solvedAssignments = solveAssignments(unlockedCandidates, remainingRoles);

  for (const assignment of solvedAssignments) {
    assignments.set(assignment.candidate.champion.id, {
      role: assignment.role,
      confidence: calculateConfidence(
        assignment.candidate.roleFit,
        assignment.role,
        assignment.candidate.usedFallback,
      ),
    });
  }

  return assignments;
}

export function createEmptyRoleFit(): RoleFit {
  return {
    top: 0,
    jungle: 0,
    middle: 0,
    bottom: 0,
    utility: 0,
  };
}

export function createTagPrior(champion: ChampionRef): RoleFit {
  const fit = createEmptyRoleFit();

  if (champion.tags.includes("Marksman")) {
    fit.bottom = 1;
    fit.middle = 0.25;
  }

  if (champion.tags.includes("Support")) {
    fit.utility = Math.max(fit.utility, 1);
    fit.bottom = Math.max(fit.bottom, 0.25);
  }

  if (champion.tags.includes("Mage")) {
    fit.middle = Math.max(fit.middle, 1);
    fit.utility = Math.max(fit.utility, 0.35);
  }

  if (champion.tags.includes("Assassin")) {
    fit.middle = Math.max(fit.middle, 1);
    fit.jungle = Math.max(fit.jungle, 0.35);
  }

  if (champion.tags.includes("Fighter")) {
    fit.top = Math.max(fit.top, 1);
    fit.jungle = Math.max(fit.jungle, 0.55);
  }

  if (champion.tags.includes("Tank")) {
    fit.top = Math.max(fit.top, 1);
    fit.utility = Math.max(fit.utility, 0.45);
    fit.jungle = Math.max(fit.jungle, 0.35);
  }

  if (totalFit(fit) <= 0) {
    fit.middle = 1;
  }

  return fit;
}

function solveAssignments(
  candidates: EnemyCandidate[],
  availableRoles: Role[],
): Array<{ candidate: EnemyCandidate; role: Role }> {
  if (candidates.length === 0 || availableRoles.length === 0) {
    return [];
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestAssignments: Array<{ candidate: EnemyCandidate; role: Role }> = [];

  function search(
    index: number,
    remainingRoles: Role[],
    currentAssignments: Array<{ candidate: EnemyCandidate; role: Role }>,
    currentScore: number,
  ): void {
    if (index >= candidates.length || remainingRoles.length === 0) {
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestAssignments = [...currentAssignments];
      }
      return;
    }

    const candidate = candidates[index];

    for (const role of remainingRoles) {
      search(
        index + 1,
        remainingRoles.filter((remainingRole) => remainingRole !== role),
        [...currentAssignments, { candidate, role }],
        currentScore + candidate.roleFit[role],
      );
    }
  }

  search(0, availableRoles, [], 0);

  return bestAssignments;
}

function calculateConfidence(roleFit: RoleFit, role: Role, usedFallback: boolean): number {
  const sum = totalFit(roleFit);
  const rawConfidence = sum <= 0 ? minimumConfidence : roleFit[role] / sum;
  const upperBound = usedFallback ? fallbackMaximumConfidence : maximumConfidence;

  return Math.min(upperBound, Math.max(minimumConfidence, rawConfidence));
}

function totalFit(roleFit: RoleFit): number {
  return roles.reduce((sum, role) => sum + roleFit[role], 0);
}
