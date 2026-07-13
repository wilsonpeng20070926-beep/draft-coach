import type { ChampionAttributeProvider } from "../catalog/championAttributes";
import type {
  ChampionAnalysis,
  LaneMetaEntry,
  MetaDataSource,
} from "../data/metaDataSource";
import { buildTeamContext } from "../draft/teamContext";
import { collectExcludedChampionIds } from "./candidatePool";
import { scoreCandidateCompFit } from "./factors/compFitModule";
import { scoreLaneMetaEntry } from "./engine";
import type { ProAnalyticsProvider } from "../data/pro/proAnalytics";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  Role,
} from "../../shared/types";

export interface ThreatForecastOptions {
  region: string;
  rank: string;
  limit?: number;
  context?: "live" | "simulator";
  favoriteTeams?: string[];
}

export interface ThreatForecastProvider {
  forecast(
    draft: DraftState,
    target: DraftTarget,
    options: ThreatForecastOptions,
  ): Promise<AnticipatedThreat[]>;
}

interface ForecastScore {
  entry: LaneMetaEntry;
  score: number;
  confidence: number;
  evidence: string[];
}

const FORECAST_CANDIDATE_LIMIT = 12;
const DEFAULT_FORECAST_LIMIT = 5;

export class RankedThreatForecastProvider implements ThreatForecastProvider {
  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly attributeProvider: ChampionAttributeProvider,
    private readonly proAnalytics?: ProAnalyticsProvider,
  ) {}

  async forecast(
    draft: DraftState,
    target: DraftTarget,
    options: ThreatForecastOptions,
  ): Promise<AnticipatedThreat[]> {
    if (target.side !== "enemy" || target.purpose !== "anticipate") {
      return [];
    }

    const laneMeta = await this.metaSource.getLaneMeta(
      target.role,
      options.region,
      options.rank,
    );
    const excluded = collectExcludedChampionIds(draft);
    const rankedCandidates = laneMeta
      .filter((entry) => !excluded.has(entry.champion.id))
      .sort(compareMeta)
      .slice(0, FORECAST_CANDIDATE_LIMIT);
    const proAllowed =
      options.context === "simulator" ||
      (options.favoriteTeams?.length ?? 0) > 0;
    const proCandidateIds = proAllowed
      ? this.proAnalytics?.topRoleCandidateIds(
          target.role,
          options.favoriteTeams,
          8,
        ) ?? []
      : [];
    const proCandidateSet = new Set(proCandidateIds);
    const candidates = dedupeEntries([
      ...rankedCandidates,
      ...laneMeta.filter(
        (entry) =>
          proCandidateSet.has(entry.champion.id) &&
          !excluded.has(entry.champion.id),
      ),
    ]);
    const synergyScores = await this.loadLockedEnemySynergy(
      draft,
      target.role,
      options,
    );
    const laneAnswerScores = await this.loadLaneAnswerScores(
      candidates,
      draft,
      target.role,
      options,
    );
    const enemyContext = buildEnemyPlanningContext(draft, this.attributeProvider);
    const scores = candidates.map((entry) => {
      const meta = scoreLaneMetaEntry(entry);
      const rolePresence = clamp01(entry.roleRate ?? 0.5);
      const synergy = synergyScores.get(entry.champion.id) ?? 0;
      const laneAnswer = laneAnswerScores.get(entry.champion.id) ?? 0;
      const compFit = scoreCandidateCompFit(
        entry.champion,
        this.attributeProvider.getAttributes(entry.champion),
        enemyContext,
      );
      const comp = Math.max(0, compFit.delta * compFit.confidence) / 0.14;
      const proAnalysis = proAllowed
        ? this.proAnalytics?.analyzeCandidate({
            championId: entry.champion.id,
            role: target.role,
            allies: draft.enemies.filter(isLockedChampionWithRole).map((enemy) => ({
              championId: enemy.champion.id,
              role: enemy.role,
            })),
            enemies: draft.allies.filter(isLockedChampionWithRole).map((ally) => ({
              championId: ally.champion.id,
              role: ally.role,
            })),
            favoriteTeams: options.favoriteTeams,
          }) ?? null
        : null;
      const pro = proAnalysis?.proInspiredStrength ?? 0;
      const proEvidence = proAnalysis?.evidence
        .filter((item) => item.material || item.effectiveSample > 0)
        .slice(0, 2)
        .map((item) => item.text) ?? [];
      const evidence = createEvidence({
        entry,
        synergy,
        laneAnswer,
        comp,
        lockedEnemies: draft.enemies.filter(isLockedChampion),
        proEvidence,
      });
      const score = proAllowed
        ? meta * 0.44 +
          rolePresence * 0.13 +
          synergy * 0.13 +
          laneAnswer * 0.1 +
          comp * 0.08 +
          pro * 0.12
        : meta * 0.5 +
          rolePresence * 0.15 +
          synergy * 0.15 +
          laneAnswer * 0.12 +
          comp * 0.08;
      const confidence = clamp01(
        Math.min(
          0.55,
          0.22 +
            rolePresence * 0.12 +
            synergy * 0.1 +
            laneAnswer * 0.08 +
            comp * 0.06 +
            pro * 0.08,
        ),
      );

      return { entry, score, confidence, evidence } satisfies ForecastScore;
    });

    return scores
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareMeta(left.entry, right.entry) ||
          left.entry.champion.id - right.entry.champion.id,
      )
      .slice(0, options.limit ?? DEFAULT_FORECAST_LIMIT)
      .map((item) => ({
        champion: item.entry.champion,
        role: target.role,
        source: "forecast" as const,
        confidence: item.confidence,
        targetCellId: target.cellId,
        pinned: false,
        evidence: item.evidence,
      }));
  }

  private async loadLockedEnemySynergy(
    draft: DraftState,
    targetRole: Role,
    options: ThreatForecastOptions,
  ): Promise<Map<number, number>> {
    if (!this.metaSource.getChampionAnalysis) {
      return new Map();
    }

    const analyses = await Promise.all(
      draft.enemies.filter(isLockedChampionWithRole).map(async (enemy) => {
        try {
          return {
            enemy,
            analysis: await this.metaSource.getChampionAnalysis!(
              enemy.champion,
              enemy.role,
              options.region,
              options.rank,
            ),
          };
        } catch {
          return null;
        }
      }),
    );
    const scores = new Map<number, number>();

    for (const result of analyses) {
      if (!result) {
        continue;
      }

      addSynergyScores(scores, result.analysis, targetRole);
    }

    return scores;
  }

  private async loadLaneAnswerScores(
    candidates: LaneMetaEntry[],
    draft: DraftState,
    targetRole: Role,
    options: ThreatForecastOptions,
  ): Promise<Map<number, number>> {
    const roleMatches = draft.allies.filter(
      (ally) =>
        ally.pickState === "locked" &&
        ally.champion !== null &&
        ally.role === targetRole,
    );

    if (roleMatches.length !== 1) {
      return new Map();
    }

    const opponent = roleMatches[0].champion!;
    const results = await Promise.all(
      candidates.map(async (entry) => {
        try {
          const matchup = await this.metaSource.getMatchup(
            entry.champion,
            opponent,
            targetRole,
            options.region,
            options.rank,
          );

          return [
            entry.champion.id,
            matchup.winRate === null
              ? 0
              : clamp01((matchup.winRate - 0.48) / 0.1),
          ] as const;
        } catch {
          return [entry.champion.id, 0] as const;
        }
      }),
    );

    return new Map(results);
  }
}

function buildEnemyPlanningContext(
  draft: DraftState,
  attributeProvider: ChampionAttributeProvider,
) {
  const swapped: DraftState = {
    ...draft,
    allies: draft.enemies.map((player) => ({ ...player, side: "ally" as const })),
    enemies: draft.allies.map((player) => ({ ...player, side: "enemy" as const })),
    localPlayer: null,
    activeAllyPickCellIds: [],
  };

  return buildTeamContext(swapped, attributeProvider.getAttributes);
}

function addSynergyScores(
  scores: Map<number, number>,
  analysis: ChampionAnalysis,
  targetRole: Role,
): void {
  for (const synergy of analysis.synergies) {
    if (synergy.partnerPosition !== null && synergy.partnerPosition !== targetRole) {
      continue;
    }

    const effective = clamp01(synergy.score * synergy.confidence);
    scores.set(
      synergy.partnerChampionId,
      Math.max(scores.get(synergy.partnerChampionId) ?? 0, effective),
    );
  }
}

function createEvidence(input: {
  entry: LaneMetaEntry;
  synergy: number;
  laneAnswer: number;
  comp: number;
  lockedEnemies: Array<DraftPlayer & { champion: ChampionRef }>;
  proEvidence: string[];
}): string[] {
  const evidence = ["Ranked role presence"];

  if (input.synergy > 0.2 && input.lockedEnemies.length > 0) {
    evidence.push(`Pairs with ${input.lockedEnemies[0].champion.name}`);
  }

  if (input.laneAnswer > 0.2) {
    evidence.push("Answers the revealed lane pick");
  }

  if (input.comp > 0.2) {
    evidence.push("Completes the hypothetical enemy composition");
  }

  if ((input.entry.roleRate ?? 0) > 0.7) {
    evidence.push("Strong role presence");
  }

  evidence.push(...input.proEvidence);

  return evidence;
}

function dedupeEntries(entries: LaneMetaEntry[]): LaneMetaEntry[] {
  return [...new Map(entries.map((entry) => [entry.champion.id, entry])).values()];
}

function compareMeta(left: LaneMetaEntry, right: LaneMetaEntry): number {
  return (
    scoreLaneMetaEntry(right) - scoreLaneMetaEntry(left) ||
    left.tier - right.tier ||
    right.winRate - left.winRate ||
    left.champion.id - right.champion.id
  );
}

function isLockedChampion(
  player: DraftPlayer,
): player is DraftPlayer & { champion: ChampionRef } {
  return player.pickState === "locked" && player.champion !== null;
}

function isLockedChampionWithRole(
  player: DraftPlayer,
): player is DraftPlayer & { champion: ChampionRef; role: Role } {
  return isLockedChampion(player) && player.role !== null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
