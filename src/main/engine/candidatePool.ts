import { deriveChampionAttributes } from "../catalog/championAttributes";
import type { ChampionAttributeProvider } from "../catalog/championAttributes";
import type { ChampionAnalysis, LaneMetaEntry, MetaDataSource } from "../data/metaDataSource";
import type { ChampionAttributes, TeamContext } from "../../shared/championAttributes";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  Role,
} from "../../shared/types";
import { scoreCandidateCompFit } from "./factors/compFitModule";
import { scoreCandidateTeamCounter } from "./factors/teamCounterModule";

export interface CandidatePoolOptions {
  region: string;
  rank: string;
  candidateCap: number;
  pickRateFloor: number;
  metaRolePresenceFloor: number;
}

export interface CandidatePoolInput {
  laneMeta: LaneMetaEntry[];
  draft: DraftState;
  target: DraftTarget;
  threats?: AnticipatedThreat[];
  ctx: TeamContext;
  options: CandidatePoolOptions;
  metaSource: MetaDataSource;
  scoreMeta: (entry: LaneMetaEntry) => number;
  getAttributes?: ChampionAttributeProvider["getAttributes"];
  proEntries?: LaneMetaEntry[];
}

interface CandidatePoolContributor {
  name: "hover" | "meta" | "pro" | "synergy" | "compFit" | "teamCounter";
  entries: LaneMetaEntry[];
}

interface SynergyCandidateScore {
  entry: LaneMetaEntry;
  max: number;
  sum: number;
  count: number;
}

export const CANDIDATE_POOL_LIMITS = {
  meta: 20,
  pro: 8,
  synergy: 6,
  compFit: 6,
  teamCounter: 6,
  maxPoolSize: 40,
  pickRateFloor: 0.001,
  rolePresenceFloor: 0.05,
} as const;

export async function buildCandidatePool(input: CandidatePoolInput): Promise<LaneMetaEntry[]> {
  const excludedChampionIds = collectExcludedChampionIds(input.draft);
  const pickableRoster = input.laneMeta
    .filter((entry) => isRoleCandidate(entry, lowPresenceOptions(input.options)))
    .filter((entry) => !excludedChampionIds.has(entry.champion.id));
  const maxPoolSize = Math.min(
    CANDIDATE_POOL_LIMITS.maxPoolSize,
    Math.max(0, input.options.candidateCap),
  );

  if (
    maxPoolSize === 0 ||
    (pickableRoster.length === 0 && (input.proEntries?.length ?? 0) === 0)
  ) {
    return [];
  }

  const contributors: CandidatePoolContributor[] = [
    {
      name: "hover",
      entries: targetHoverEntries(input, excludedChampionIds),
    },
    {
      name: "pro",
      entries: (input.proEntries ?? [])
        .filter((entry) => !excludedChampionIds.has(entry.champion.id))
        .slice(0, CANDIDATE_POOL_LIMITS.pro),
    },
    {
      name: "meta",
      entries: topByMeta(input.laneMeta, input, excludedChampionIds),
    },
    {
      name: "synergy",
      entries: await topSynergyFits(pickableRoster, input),
    },
    {
      name: "compFit",
      entries: topCompFits(pickableRoster, input),
    },
    {
      name: "teamCounter",
      entries: topCounterFits(pickableRoster, input),
    },
  ];

  return dedupeContributors(contributors, maxPoolSize);
}

export function collectExcludedChampionIds(draft: DraftState): Set<number> {
  return new Set(
    [
      ...draft.bans,
      ...draft.allies
        .filter((player) => player.pickState === "locked")
        .map((player) => player.champion),
      ...draft.enemies
        .filter((player) => player.pickState === "locked")
        .map((player) => player.champion),
    ]
      .filter((champion): champion is ChampionRef => champion !== null)
      .map((champion) => champion.id),
  );
}

function targetHoverEntries(
  input: CandidatePoolInput,
  excludedChampionIds: Set<number>,
): LaneMetaEntry[] {
  const targetPlayer = input.draft.allies.find(
    (ally) => ally.cellId === input.target.cellId,
  );

  if (targetPlayer?.pickState !== "hovering" || !targetPlayer.champion) {
    return [];
  }

  const entry = input.laneMeta.find(
    (candidate) => candidate.champion.id === targetPlayer.champion?.id,
  );

  if (excludedChampionIds.has(targetPlayer.champion.id)) {
    return [];
  }

  return [entry ?? createTargetFallbackEntry(targetPlayer.champion)];
}

export function createTargetFallbackEntry(champion: ChampionRef): LaneMetaEntry {
  return {
    champion,
    winRate: 0.5,
    tier: 5,
    dataQuality: "target-fallback",
  };
}

export function isRoleCandidate(
  entry: LaneMetaEntry,
  options: Pick<CandidatePoolOptions, "pickRateFloor" | "metaRolePresenceFloor">,
): boolean {
  if (entry.pickRate !== undefined && entry.pickRate < options.pickRateFloor) {
    return false;
  }

  if (entry.roleRate !== undefined && entry.roleRate < options.metaRolePresenceFloor) {
    return false;
  }

  return true;
}

function topByMeta(
  laneMeta: LaneMetaEntry[],
  input: CandidatePoolInput,
  excludedChampionIds: Set<number>,
): LaneMetaEntry[] {
  return laneMeta
    .filter((entry) => isRoleCandidate(entry, input.options))
    .filter((entry) => !excludedChampionIds.has(entry.champion.id))
    .sort((a, b) => compareLaneMeta(a, b, input.scoreMeta))
    .slice(0, CANDIDATE_POOL_LIMITS.meta);
}

async function topSynergyFits(
  pickableRoster: LaneMetaEntry[],
  input: CandidatePoolInput,
): Promise<LaneMetaEntry[]> {
  const targetRole = input.target.role;
  const allies = input.draft.allies.filter(
    (player): player is DraftPlayer & { champion: ChampionRef; role: Role } =>
      player.pickState === "locked" &&
      player.cellId !== input.target.cellId &&
      hasChampionAndRole(player),
  );

  if (allies.length === 0 || !input.metaSource.getChampionAnalysis) {
    return [];
  }

  const rosterByChampionId = new Map(
    pickableRoster.map((entry) => [entry.champion.id, entry]),
  );
  const scoresByChampionId = new Map<number, SynergyCandidateScore>();
  const analyses = await Promise.all(
    allies.map((ally) => loadAllyAnalysis(input, ally)),
  );

  for (const analysis of analyses) {
    if (!analysis) {
      continue;
    }

    for (const synergy of analysis.synergies) {
      if (synergy.partnerPosition !== null && synergy.partnerPosition !== targetRole) {
        continue;
      }

      const entry = rosterByChampionId.get(synergy.partnerChampionId);

      if (!entry) {
        continue;
      }

      const pairScore = (synergy.score - 0.5) * Math.max(synergy.confidence, 0.15);
      const existing = scoresByChampionId.get(entry.champion.id) ?? {
        entry,
        max: Number.NEGATIVE_INFINITY,
        sum: 0,
        count: 0,
      };

      existing.max = Math.max(existing.max, pairScore);
      existing.sum += pairScore;
      existing.count += 1;
      scoresByChampionId.set(entry.champion.id, existing);
    }
  }

  return [...scoresByChampionId.values()]
    .filter((score) => score.max > 0)
    .sort((a, b) => combinedSynergyScore(b) - combinedSynergyScore(a))
    .slice(0, CANDIDATE_POOL_LIMITS.synergy)
    .map((score) => score.entry);
}

function topCompFits(
  pickableRoster: LaneMetaEntry[],
  input: CandidatePoolInput,
): LaneMetaEntry[] {
  if (input.ctx.allyNeeds.length === 0) {
    return [];
  }

  return pickableRoster
    .map((entry) => ({
      entry,
      score: effectiveDelta(
        scoreCandidateCompFit(
          entry.champion,
          getCandidateAttributes(input, entry.champion),
          input.ctx,
        ),
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareLaneMeta(a.entry, b.entry, input.scoreMeta))
    .slice(0, CANDIDATE_POOL_LIMITS.compFit)
    .map((item) => item.entry);
}

function topCounterFits(
  pickableRoster: LaneMetaEntry[],
  input: CandidatePoolInput,
): LaneMetaEntry[] {
  if (input.ctx.enemyThreats.length === 0) {
    return [];
  }

  return pickableRoster
    .map((entry) => ({
      entry,
      score: effectiveDelta(
        scoreCandidateTeamCounter(
          entry.champion,
          getCandidateAttributes(input, entry.champion),
          input.ctx,
        ),
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareLaneMeta(a.entry, b.entry, input.scoreMeta))
    .slice(0, CANDIDATE_POOL_LIMITS.teamCounter)
    .map((item) => item.entry);
}

function dedupeContributors(
  contributors: CandidatePoolContributor[],
  maxPoolSize: number,
): LaneMetaEntry[] {
  const selected: LaneMetaEntry[] = [];
  const seenChampionIds = new Set<number>();

  for (const contributor of contributors) {
    for (const entry of contributor.entries) {
      if (seenChampionIds.has(entry.champion.id)) {
        continue;
      }

      selected.push(entry);
      seenChampionIds.add(entry.champion.id);

      if (selected.length >= maxPoolSize) {
        return selected;
      }
    }
  }

  return selected;
}

async function loadAllyAnalysis(
  input: CandidatePoolInput,
  ally: DraftPlayer & { champion: ChampionRef; role: Role },
): Promise<ChampionAnalysis | null> {
  try {
    return await input.metaSource.getChampionAnalysis!(
      ally.champion,
      ally.role,
      input.options.region,
      input.options.rank,
    );
  } catch {
    return null;
  }
}

function getCandidateAttributes(
  input: CandidatePoolInput,
  champion: ChampionRef,
): ChampionAttributes {
  return input.getAttributes
    ? input.getAttributes(champion)
    : deriveChampionAttributes(champion);
}

function effectiveDelta(contribution: { delta: number; confidence: number }): number {
  return contribution.delta * contribution.confidence;
}

function combinedSynergyScore(score: SynergyCandidateScore): number {
  const mean = score.sum / score.count;

  return score.max * 0.7 + mean * 0.3;
}

function compareLaneMeta(
  a: LaneMetaEntry,
  b: LaneMetaEntry,
  scoreMeta: (entry: LaneMetaEntry) => number,
): number {
  const scoreDelta = scoreMeta(b) - scoreMeta(a);

  if (Math.abs(scoreDelta) > 0.000001) {
    return scoreDelta;
  }

  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }

  return b.winRate - a.winRate;
}

function lowPresenceOptions(options: CandidatePoolOptions): CandidatePoolOptions {
  return {
    ...options,
    pickRateFloor: Math.min(options.pickRateFloor, CANDIDATE_POOL_LIMITS.pickRateFloor),
    metaRolePresenceFloor: Math.min(
      options.metaRolePresenceFloor,
      CANDIDATE_POOL_LIMITS.rolePresenceFloor,
    ),
  };
}

function hasChampionAndRole(
  player: DraftPlayer,
): player is DraftPlayer & { champion: ChampionRef; role: Role } {
  return player.champion !== null && player.role !== null;
}
