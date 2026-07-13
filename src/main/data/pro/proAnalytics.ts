import type {
  ChampionOpponentAggregate,
  ChampionPairAggregate,
  ChampionRoleAggregate,
  CompetitionTier,
  ProCandidateAnalysis,
  ProDataSnapshot,
  ProEvidenceKind,
  ProEvidenceRecord,
  ProEvidenceStatistics,
  ProSignal,
  TeamChampionAggregate,
  TeamPairAggregate,
  TeamResponseAggregate,
} from "../../../shared/proData";
import type { Role } from "../../../shared/types";
import { deriveProPatchWindow } from "./patchWindow";
import { classifyProCompetition } from "./competitionPolicy";

export interface ProAnalyticsPick {
  championId: number;
  role: Role;
}

export interface ProCandidateQuery {
  championId: number;
  role: Role;
  allies?: ProAnalyticsPick[];
  enemies?: ProAnalyticsPick[];
  favoriteTeams?: string[];
}

export type ProArchetype =
  | "frontline"
  | "engage"
  | "peel"
  | "poke"
  | "scaling"
  | "carry"
  | "waveclear"
  | "range";

export interface ProAnalyticsOptions {
  currentPatch?: string;
  now?: Date;
  getArchetypes?: (championId: number, role: Role) => ProArchetype[];
}

export interface ProAnalyticsProvider {
  analyzeCandidate(query: ProCandidateQuery): ProCandidateAnalysis | null;
  topRoleCandidateIds(
    role: Role,
    favoriteTeams?: string[],
    limit?: number,
  ): number[];
}

export const PRO_ANALYTICS_CONSTANTS = {
  patchWeights: [1, 0.45, 0.2] as const,
  internationalMultiplier: 1.5,
  competitionTierMultiplier: {
    international: 1,
    major: 1,
    included: 0.9,
  } satisfies Record<CompetitionTier, number>,
  banDiscount: 0.55,
  minimumMaterialSample: 3,
  favoriteOverallWeight: 0.08,
  favoriteProInspiredWeight: 0.3,
} as const;

interface WeightedCounts {
  rawPicks: number;
  rawBans: number;
  rawWins: number;
  rawGames: number;
  rawOpportunities: number;
  picks: number;
  bans: number;
  wins: number;
  games: number;
  opportunities: number;
  patches: Set<string>;
  competitions: Set<string>;
  teams: Set<string>;
}

interface CompositionAggregate {
  patch: string;
  competition: string;
  team: string;
  championId: number;
  role: Role;
  archetype: ProArchetype;
  games: number;
  wins: number;
}

interface TeamOpponentAggregate {
  patch: string;
  competition: string;
  team: string;
  championId: number;
  role: Role;
  opponentChampionId: number;
  opponentRole: Role;
  sameRole: boolean;
  games: number;
  wins: number;
}

const roleOrder: Role[] = ["top", "jungle", "middle", "bottom", "utility"];

export class ProAnalytics implements ProAnalyticsProvider {
  private readonly currentPatch: string;
  private readonly now: Date;
  private readonly competitionTiers = new Map<string, CompetitionTier>();
  private readonly teamQuality = new Map<string, number>();
  private readonly roleRows = new Map<string, ChampionRoleAggregate[]>();
  private readonly championRoleRows = new Map<number, ChampionRoleAggregate[]>();
  private readonly pairRows = new Map<string, ChampionPairAggregate[]>();
  private readonly opponentRows = new Map<string, ChampionOpponentAggregate[]>();
  private readonly teamChampionRows = new Map<string, TeamChampionAggregate[]>();
  private readonly allTeamChampionRows = new Map<number, TeamChampionAggregate[]>();
  private readonly teamPairRows = new Map<string, TeamPairAggregate[]>();
  private readonly teamResponseRows = new Map<string, TeamResponseAggregate[]>();
  private readonly compositionRows = new Map<string, CompositionAggregate[]>();
  private readonly teamOpponentRows = new Map<string, TeamOpponentAggregate[]>();
  private readonly teamGameCounts = new Map<string, WeightedCounts>();
  private readonly pairPriors = new Map<string, { wins: number; games: number }>();
  private readonly opponentPriors = new Map<string, { wins: number; games: number }>();
  private readonly queryCache = new Map<string, ProCandidateAnalysis>();
  private readonly getArchetypes?: ProAnalyticsOptions["getArchetypes"];

  constructor(
    private readonly snapshot: ProDataSnapshot,
    options: ProAnalyticsOptions = {},
  ) {
    this.currentPatch = options.currentPatch ?? snapshot.metadata.coveredPatches[0] ?? "";
    this.now = options.now ?? new Date();
    this.getArchetypes = options.getArchetypes;
    this.indexCompetitionTiers();
    this.indexTeamQuality();
    this.indexAggregates();
    this.indexTeamOpponents();
    this.indexCompositionPatterns();
  }

  analyzeCandidate(query: ProCandidateQuery): ProCandidateAnalysis {
    const normalized = normalizeQuery(query);
    const cacheKey = canonicalQueryKey(normalized);
    const cached = this.queryCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const priority = this.prioritySignal(normalized.championId, normalized.role);
    const rolePresence = this.rolePresenceSignal(normalized.championId, normalized.role);
    const flex = this.flexSignal(normalized.championId);
    const synergy = this.synergySignal(normalized);
    const matchup = this.matchupSignal(normalized);
    const response = this.responseSignal(normalized);
    const composition = this.compositionSignal(normalized);
    const success = this.successSignal(normalized.championId, normalized.role);
    const favorite = this.favoriteSignal(normalized);
    const material = (signal: ProSignal): number =>
      signal.material ? signal.value * signal.confidence : 0;
    const overallStrength = clamp01(
      material(priority) * 0.28 +
        material(rolePresence) * 0.08 +
        material(flex) * 0.08 +
        Math.max(0, material(synergy)) * 0.16 +
        Math.max(0, material(matchup)) * 0.11 +
        Math.max(0, material(response)) * 0.09 +
        material(composition) * 0.07 +
        Math.max(0, material(success)) * 0.05 +
        material(favorite) * PRO_ANALYTICS_CONSTANTS.favoriteOverallWeight,
    );
    const proInspiredStrength = clamp01(
      material(priority) * 0.24 +
        material(rolePresence) * 0.08 +
        material(flex) * 0.14 +
        Math.max(0, material(synergy)) * 0.12 +
        Math.max(0, material(matchup)) * 0.06 +
        Math.max(0, material(response)) * 0.04 +
        material(composition) * 0.02 +
        material(favorite) * PRO_ANALYTICS_CONSTANTS.favoriteProInspiredWeight,
    );
    const evidence = [
      priority,
      rolePresence,
      flex,
      synergy,
      matchup,
      response,
      composition,
      success,
      favorite,
    ]
      .flatMap((signal) => signal.evidence)
      .sort(compareEvidence);
    const analysis: ProCandidateAnalysis = {
      championId: normalized.championId,
      role: normalized.role,
      priority,
      rolePresence,
      flex,
      synergy,
      matchup,
      response,
      composition,
      success,
      favorite,
      overallStrength,
      proInspiredStrength,
      evidence,
    };
    this.queryCache.set(cacheKey, analysis);
    return analysis;
  }

  topRoleCandidateIds(
    role: Role,
    favoriteTeams: string[] = [],
    limit = 8,
  ): number[] {
    const candidates = [...this.roleRows.keys()]
      .filter((key) => key.endsWith(`|${role}`))
      .map((key) => Number(key.split("|")[0]));

    return [...new Set(candidates)]
      .map((championId) => this.analyzeCandidate({ championId, role, favoriteTeams }))
      .filter(
        (analysis) =>
          analysis.proInspiredStrength > 0 &&
          (analysis.rolePresence.material || analysis.flex.material) &&
          analysis.priority.material,
      )
      .sort(
        (left, right) =>
          right.proInspiredStrength - left.proInspiredStrength ||
          right.priority.effectiveSample - left.priority.effectiveSample ||
          left.championId - right.championId,
      )
      .slice(0, Math.max(0, limit))
      .map((analysis) => analysis.championId);
  }

  private prioritySignal(championId: number, role: Role): ProSignal {
    const partitionCounts = this.weightRoleRows(
      this.roleRows.get(roleKey(championId, role)) ?? [],
    );
    const pickCounts = this.weightTeamChampionRows(
      this.teamChampionRows.get(roleKey(championId, role)) ?? [],
    );
    const counts = mergeCounts(pickCounts);
    counts.rawBans = partitionCounts.rawBans;
    counts.rawOpportunities = partitionCounts.rawOpportunities;
    counts.bans = partitionCounts.bans;
    counts.opportunities = partitionCounts.opportunities;
    partitionCounts.patches.forEach((patch) => counts.patches.add(patch));
    partitionCounts.competitions.forEach((competition) => counts.competitions.add(competition));
    const effectiveSample = counts.picks + counts.bans * PRO_ANALYTICS_CONSTANTS.banDiscount;
    const priorityRate = counts.opportunities > 0
      ? (counts.picks + counts.bans * PRO_ANALYTICS_CONSTANTS.banDiscount) /
        counts.opportunities
      : 0;

    return this.createSignal({
      kind: "priority",
      value: clamp01(priorityRate),
      effectiveSample,
      confidenceK: 5,
      counts,
      statistics: {
        picks: counts.rawPicks,
        bans: counts.rawBans,
        opportunities: counts.rawOpportunities,
        rate: priorityRate,
      },
    });
  }

  private rolePresenceSignal(championId: number, role: Role): ProSignal {
    const allRows = this.allTeamChampionRows.get(championId) ?? [];
    const target = this.weightTeamChampionRows(allRows.filter((row) => row.role === role));
    const all = this.weightTeamChampionRows(allRows);
    const presence = all.picks > 0 ? target.picks / all.picks : 0;

    return this.createSignal({
      kind: "role-presence",
      value: clamp01(presence),
      effectiveSample: target.picks,
      confidenceK: 4,
      counts: target,
      statistics: { picks: target.rawPicks, rate: presence },
    });
  }

  private flexSignal(championId: number): ProSignal {
    const rows = this.allTeamChampionRows.get(championId) ?? [];
    const counts = this.weightTeamChampionRows(rows);
    const activeRoles = roleOrder.filter((role) => {
      const roleCounts = this.weightTeamChampionRows(rows.filter((row) => row.role === role));
      return roleCounts.picks >= 1;
    });
    const value = clamp01((activeRoles.length - 1) / 2);

    return this.createSignal({
      kind: "flex",
      value,
      effectiveSample: counts.picks,
      confidenceK: 6,
      counts,
      statistics: { picks: counts.rawPicks, roleCount: activeRoles.length },
      forceMaterial: activeRoles.length > 1,
    });
  }

  private synergySignal(query: Required<ProCandidateQuery>): ProSignal {
    const rows = query.allies.flatMap(
      (ally) =>
        this.teamPairRows.get(pairKey(query.championId, query.role, ally.championId, ally.role)) ?? [],
    );
    const counts = this.weightGameRows(rows, true);
    const prior = this.pairPrior(query.role, query.allies.map((ally) => ally.role));
    const estimate = shrunkEstimate(counts.wins, counts.games, prior, 6);

    return this.createSignal({
      kind: "synergy",
      value: clampSigned((estimate.rate - prior) * 2),
      effectiveSample: counts.games,
      confidenceK: 6,
      counts,
      statistics: {
        games: counts.rawGames,
        wins: counts.rawWins,
        rate: estimate.rate,
        lift: estimate.rate - prior,
      },
    });
  }

  private matchupSignal(query: Required<ProCandidateQuery>): ProSignal {
    const laneEnemies = query.enemies.filter((enemy) => enemy.role === query.role);
    const rows = laneEnemies.flatMap(
      (enemy) =>
        this.teamOpponentRows.get(
          opponentKey(query.championId, query.role, enemy.championId, enemy.role),
        ) ?? [],
    ).filter((row) => row.sameRole);
    const counts = this.weightGameRows(rows, true);
    const prior = this.opponentPrior(query.role, [query.role]);
    const estimate = shrunkEstimate(counts.wins, counts.games, prior, 8);

    return this.createSignal({
      kind: "matchup",
      value: clampSigned((estimate.rate - prior) * 2),
      effectiveSample: counts.games,
      confidenceK: 8,
      counts,
      statistics: {
        games: counts.rawGames,
        wins: counts.rawWins,
        rate: estimate.rate,
        lift: estimate.rate - prior,
      },
    });
  }

  private responseSignal(query: Required<ProCandidateQuery>): ProSignal {
    const rows = query.enemies.flatMap(
      (enemy) =>
        this.teamOpponentRows.get(
          opponentKey(query.championId, query.role, enemy.championId, enemy.role),
        ) ?? [],
    ).filter((row) => !row.sameRole);
    const counts = this.weightGameRows(rows, true);
    const prior = this.opponentPrior(
      query.role,
      query.enemies.map((enemy) => enemy.role),
    );
    const estimate = shrunkEstimate(counts.wins, counts.games, prior, 8);

    return this.createSignal({
      kind: "response",
      value: clampSigned((estimate.rate - prior) * 2),
      effectiveSample: counts.games,
      confidenceK: 8,
      counts,
      statistics: {
        games: counts.rawGames,
        wins: counts.rawWins,
        rate: estimate.rate,
        lift: estimate.rate - prior,
      },
    });
  }

  private compositionSignal(query: Required<ProCandidateQuery>): ProSignal {
    if (!this.getArchetypes || query.allies.length === 0) {
      return emptySignal();
    }

    const archetypes = [...new Set(
      query.allies.flatMap((ally) => this.getArchetypes!(ally.championId, ally.role)),
    )].sort();
    const rows = archetypes.flatMap(
      (archetype) =>
        this.compositionRows.get(compositionKey(query.championId, query.role, archetype)) ?? [],
    );
    const counts = this.weightGameRows(rows, true);
    const candidatePicks = this.weightTeamChampionRows(
      this.teamChampionRows.get(roleKey(query.championId, query.role)) ?? [],
    ).picks;
    const normalizedGames = archetypes.length > 0 ? counts.games / archetypes.length : 0;
    const normalizedRawGames = archetypes.length > 0 ? counts.rawGames / archetypes.length : 0;
    const value = candidatePicks > 0 ? clamp01(normalizedGames / candidatePicks) : 0;
    const normalizedCounts = {
      ...counts,
      games: normalizedGames,
      rawGames: normalizedRawGames,
    };

    return this.createSignal({
      kind: "composition",
      value,
      effectiveSample: normalizedGames,
      confidenceK: 6,
      counts: normalizedCounts,
      statistics: { games: normalizedRawGames, rate: value },
    });
  }

  private successSignal(championId: number, role: Role): ProSignal {
    const counts = this.weightTeamChampionRows(
      this.teamChampionRows.get(roleKey(championId, role)) ?? [],
    );
    const estimate = shrunkEstimate(counts.wins, counts.picks, 0.5, 14);

    return this.createSignal({
      kind: "success",
      value: clampSigned((estimate.rate - 0.5) * 2),
      effectiveSample: counts.picks,
      confidenceK: 14,
      counts,
      statistics: {
        picks: counts.rawPicks,
        wins: counts.rawWins,
        rate: estimate.rate,
        lift: estimate.rate - 0.5,
      },
    });
  }

  private favoriteSignal(query: Required<ProCandidateQuery>): ProSignal {
    const favorites = new Set(query.favoriteTeams.map(normalizeTeam));

    if (favorites.size === 0) {
      return emptySignal();
    }

    const championRows = (this.teamChampionRows.get(roleKey(query.championId, query.role)) ?? [])
      .filter((row) => favorites.has(normalizeTeam(row.team)));
    const pairRows = query.allies.flatMap(
      (ally) =>
        (this.teamPairRows.get(
          pairKey(query.championId, query.role, ally.championId, ally.role),
        ) ?? []).filter((row) => favorites.has(normalizeTeam(row.team))),
    );
    const responseRows = query.enemies.flatMap(
      (enemy) =>
        (this.teamResponseRows.get(
          opponentKey(query.championId, query.role, enemy.championId, enemy.role),
        ) ?? []).filter((row) => favorites.has(normalizeTeam(row.team))),
    );
    const champion = this.weightTeamChampionRows(championRows);
    const pairs = this.weightGameRows(pairRows, true);
    const responses = this.weightGameRows(responseRows, true);
    const teamGames = [...favorites].reduce(
      (sum, team) => sum + (this.teamGameCounts.get(team)?.games ?? 0),
      0,
    );
    const effectiveSample = champion.picks + pairs.games + responses.games;
    const pickRate = teamGames > 0 ? champion.picks / teamGames : 0;
    const value = clamp01(
      pickRate * 5 +
        (pairs.games >= PRO_ANALYTICS_CONSTANTS.minimumMaterialSample ? 0.18 : 0) +
        (responses.games >= PRO_ANALYTICS_CONSTANTS.minimumMaterialSample ? 0.18 : 0),
    );
    const counts = mergeCounts(champion, pairs, responses);

    return this.createSignal({
      kind: "team-tendency",
      value,
      effectiveSample,
      confidenceK: 5,
      counts,
      statistics: {
        picks: champion.rawPicks,
        games: pairs.rawGames + responses.rawGames,
        rate: pickRate,
      },
    });
  }

  private createSignal(input: {
    kind: ProEvidenceKind;
    value: number;
    effectiveSample: number;
    confidenceK: number;
    counts: WeightedCounts;
    statistics: ProEvidenceStatistics;
    forceMaterial?: boolean;
  }): ProSignal {
    if (input.effectiveSample <= 0) {
      return emptySignal();
    }

    const material =
      input.effectiveSample >= PRO_ANALYTICS_CONSTANTS.minimumMaterialSample &&
      input.forceMaterial !== false;
    const confidence = sampleConfidence(input.effectiveSample, input.confidenceK);
    const evidence = createEvidenceRecord({
      kind: input.kind,
      statistics: input.statistics,
      patches: [...input.counts.patches].sort(comparePatch),
      competitions: [...input.counts.competitions].sort(),
      teams: [...input.counts.teams].sort(),
      effectiveSample: input.effectiveSample,
      confidence,
      ageDays: snapshotAgeDays(this.snapshot.metadata.generatedAt, this.now),
      material,
    });

    return {
      value: input.value,
      confidence,
      effectiveSample: input.effectiveSample,
      material,
      evidence: [evidence],
    };
  }

  private indexCompetitionTiers(): void {
    for (const record of this.snapshot.draftRecords) {
      this.competitionTiers.set(record.competition, record.competitionTier);
    }
  }

  private indexTeamQuality(): void {
    const teamResults = new Map<string, { wins: number; games: number }>();

    for (const record of this.snapshot.draftRecords) {
      const baseWeight = this.partitionWeight(record.patch, record.competition);

      if (baseWeight <= 0) {
        continue;
      }

      for (const [team, side] of [[record.blueTeam, "blue"], [record.redTeam, "red"]] as const) {
        const key = normalizeTeam(team);
        const current = teamResults.get(key) ?? { wins: 0, games: 0 };
        current.games += baseWeight;
        current.wins += record.winner === side ? baseWeight : 0;
        teamResults.set(key, current);
      }
    }

    for (const [team, result] of teamResults) {
      this.teamQuality.set(team, teamQualityMultiplier(result.wins, result.games));
    }

    for (const record of this.snapshot.draftRecords) {
      for (const team of [record.blueTeam, record.redTeam]) {
        const key = normalizeTeam(team);
        const counts = this.teamGameCounts.get(key) ?? createCounts();
        const weight = this.partitionWeight(record.patch, record.competition) *
          (this.teamQuality.get(key) ?? 1);
        counts.games += weight;
        counts.rawGames += 1;
        addCoverage(counts, record.patch, record.competition, team);
        this.teamGameCounts.set(key, counts);
      }
    }
  }

  private indexAggregates(): void {
    for (const row of this.snapshot.championRoles) {
      pushMap(this.roleRows, roleKey(row.championId, row.role), row);
      pushMap(this.championRoleRows, row.championId, row);
    }

    for (const row of this.snapshot.championPairs) {
      pushMap(this.pairRows, pairKey(row.championAId, row.roleA, row.championBId, row.roleB), row);
      pushMap(this.pairRows, pairKey(row.championBId, row.roleB, row.championAId, row.roleA), row);
    }

    for (const row of this.snapshot.championOpponents) {
      pushMap(this.opponentRows, opponentKey(row.championId, row.role, row.opponentChampionId, row.opponentRole), row);
    }

    for (const row of this.snapshot.teamChampions) {
      pushMap(this.teamChampionRows, roleKey(row.championId, row.role), row);
      pushMap(this.allTeamChampionRows, row.championId, row);
    }

    for (const row of this.snapshot.teamPairs) {
      pushMap(this.teamPairRows, pairKey(row.championAId, row.roleA, row.championBId, row.roleB), row);
      pushMap(this.teamPairRows, pairKey(row.championBId, row.roleB, row.championAId, row.roleA), row);
      addPrior(
        this.pairPriors,
        rolePairKey(row.roleA, row.roleB),
        row,
        this.partitionWeight(row.patch, row.competition) *
          (this.teamQuality.get(normalizeTeam(row.team)) ?? 1),
      );
    }

    for (const row of this.snapshot.teamResponses) {
      pushMap(this.teamResponseRows, opponentKey(row.responseChampionId, row.responseRole, row.enemyChampionId, row.enemyRole), row);
    }
  }

  private indexTeamOpponents(): void {
    const aggregates = new Map<string, TeamOpponentAggregate>();

    for (const record of this.snapshot.draftRecords) {
      const blue = record.picks.filter((pick) => pick[1] === "blue");
      const red = record.picks.filter((pick) => pick[1] === "red");

      for (const [side, team, picks, opponents] of [
        ["blue", record.blueTeam, blue, red],
        ["red", record.redTeam, red, blue],
      ] as const) {
        for (const pick of picks) {
          for (const opponent of opponents) {
            const key = [
              record.patch,
              record.competition,
              team,
              pick[3],
              pick[2],
              opponent[3],
              opponent[2],
            ].join("|");
            const current = aggregates.get(key) ?? {
              patch: record.patch,
              competition: record.competition,
              team,
              championId: pick[3],
              role: pick[2],
              opponentChampionId: opponent[3],
              opponentRole: opponent[2],
              sameRole: pick[2] === opponent[2],
              games: 0,
              wins: 0,
            };
            current.games += 1;
            current.wins += record.winner === side ? 1 : 0;
            aggregates.set(key, current);
          }
        }
      }
    }

    for (const row of aggregates.values()) {
      pushMap(
        this.teamOpponentRows,
        opponentKey(row.championId, row.role, row.opponentChampionId, row.opponentRole),
        row,
      );
      addPrior(
        this.opponentPriors,
        rolePairKey(row.role, row.opponentRole),
        row,
        this.partitionWeight(row.patch, row.competition) *
          (this.teamQuality.get(normalizeTeam(row.team)) ?? 1),
      );
    }
  }

  private indexCompositionPatterns(): void {
    if (!this.getArchetypes) {
      return;
    }

    const aggregates = new Map<string, CompositionAggregate>();

    for (const record of this.snapshot.draftRecords) {
      for (const side of ["blue", "red"] as const) {
        const team = side === "blue" ? record.blueTeam : record.redTeam;
        const picks = record.picks
          .filter((pick) => pick[1] === side)
          .map((pick) => ({ championId: pick[3], role: pick[2] }));

        for (const pick of picks) {
          const archetypes = [...new Set(
            picks
              .filter((ally) => ally.championId !== pick.championId)
              .flatMap((ally) => this.getArchetypes!(ally.championId, ally.role)),
          )];

          for (const archetype of archetypes) {
            const key = [
              record.patch,
              record.competition,
              team,
              pick.championId,
              pick.role,
              archetype,
            ].join("|");
            const current = aggregates.get(key) ?? {
              patch: record.patch,
              competition: record.competition,
              team,
              championId: pick.championId,
              role: pick.role,
              archetype,
              games: 0,
              wins: 0,
            };
            current.games += 1;
            current.wins += record.winner === side ? 1 : 0;
            aggregates.set(key, current);
          }
        }
      }
    }

    for (const row of aggregates.values()) {
      pushMap(this.compositionRows, compositionKey(row.championId, row.role, row.archetype), row);
    }
  }

  private weightRoleRows(rows: ChampionRoleAggregate[]): WeightedCounts {
    const counts = createCounts();

    for (const row of rows) {
      const weight = this.partitionWeight(row.patch, row.competition);

      if (weight <= 0) continue;
      counts.rawPicks += row.picks;
      counts.rawBans += row.bans;
      counts.rawWins += row.wins;
      counts.rawOpportunities += row.opportunities;
      counts.picks += row.picks * weight;
      counts.bans += row.bans * weight;
      counts.wins += row.wins * weight;
      counts.opportunities += row.opportunities * weight;
      addCoverage(counts, row.patch, row.competition);
    }

    return counts;
  }

  private weightGameRows(
    rows: Array<ChampionPairAggregate | ChampionOpponentAggregate | TeamPairAggregate | TeamResponseAggregate | CompositionAggregate | TeamOpponentAggregate>,
    applyTeamQuality = false,
  ): WeightedCounts {
    const counts = createCounts();

    for (const row of rows) {
      const team = "team" in row ? row.team : undefined;
      const weight = this.partitionWeight(row.patch, row.competition) *
        (applyTeamQuality && team ? this.teamQuality.get(normalizeTeam(team)) ?? 1 : 1);

      if (weight <= 0) continue;
      counts.rawGames += row.games;
      counts.rawWins += row.wins;
      counts.games += row.games * weight;
      counts.wins += row.wins * weight;
      addCoverage(counts, row.patch, row.competition, team);
    }

    return counts;
  }

  private weightTeamChampionRows(rows: TeamChampionAggregate[]): WeightedCounts {
    const counts = createCounts();

    for (const row of rows) {
      const weight = this.partitionWeight(row.patch, row.competition) *
        (this.teamQuality.get(normalizeTeam(row.team)) ?? 1);

      if (weight <= 0) continue;
      counts.rawPicks += row.picks;
      counts.rawWins += row.wins;
      counts.picks += row.picks * weight;
      counts.wins += row.wins * weight;
      addCoverage(counts, row.patch, row.competition, row.team);
    }

    return counts;
  }

  private pairPrior(role: Role, allyRoles: Role[]): number {
    const values = allyRoles
      .map((allyRole) => this.pairPriors.get(rolePairKey(role, allyRole)))
      .filter((value): value is { wins: number; games: number } => Boolean(value));
    const wins = values.reduce((sum, value) => sum + value.wins, 0);
    const games = values.reduce((sum, value) => sum + value.games, 0);
    return games > 0 ? wins / games : 0.5;
  }

  private opponentPrior(role: Role, enemyRoles: Role[]): number {
    const values = enemyRoles
      .map((enemyRole) => this.opponentPriors.get(rolePairKey(role, enemyRole)))
      .filter((value): value is { wins: number; games: number } => Boolean(value));
    const wins = values.reduce((sum, value) => sum + value.wins, 0);
    const games = values.reduce((sum, value) => sum + value.games, 0);
    return games > 0 ? wins / games : 0.5;
  }

  private partitionWeight(patch: string, competition: string): number {
    const tier = this.competitionTiers.get(competition) ?? classifyProCompetition(competition);
    return effectiveProWeight(patch, this.currentPatch, competition, tier);
  }
}

export class SnapshotProAnalyticsProvider implements ProAnalyticsProvider {
  private checksum: string | null = null;
  private analytics: ProAnalytics | null = null;

  constructor(
    private readonly getSnapshot: () => ProDataSnapshot | null,
    private readonly getOptions: () => ProAnalyticsOptions = () => ({}),
  ) {}

  analyzeCandidate(query: ProCandidateQuery): ProCandidateAnalysis | null {
    return this.resolve()?.analyzeCandidate(query) ?? null;
  }

  topRoleCandidateIds(
    role: Role,
    favoriteTeams: string[] = [],
    limit = 8,
  ): number[] {
    return this.resolve()?.topRoleCandidateIds(role, favoriteTeams, limit) ?? [];
  }

  private resolve(): ProAnalytics | null {
    const snapshot = this.getSnapshot();

    if (!snapshot) {
      this.analytics = null;
      this.checksum = null;
      return null;
    }

    if (!this.analytics || this.checksum !== snapshot.metadata.checksum) {
      this.analytics = new ProAnalytics(snapshot, this.getOptions());
      this.checksum = snapshot.metadata.checksum;
    }

    return this.analytics;
  }
}

export function patchWeight(patch: string, currentPatch: string): number {
  const index = deriveProPatchWindow(currentPatch).indexOf(patch);
  return index >= 0 ? PRO_ANALYTICS_CONSTANTS.patchWeights[index] : 0;
}

export function effectiveProWeight(
  patch: string,
  currentPatch: string,
  competition: string,
  tier: CompetitionTier | null,
  teamQuality = 1,
): number {
  if (!tier || classifyProCompetition(competition) === null) {
    return 0;
  }

  const international = tier === "international"
    ? PRO_ANALYTICS_CONSTANTS.internationalMultiplier
    : 1;
  return patchWeight(patch, currentPatch) *
    international *
    PRO_ANALYTICS_CONSTANTS.competitionTierMultiplier[tier] *
    clamp(teamQuality, 0.85, 1.15);
}

export function teamQualityMultiplier(wins: number, games: number): number {
  if (games <= 0) {
    return 1;
  }

  const shrunkWinRate = (wins + 5) / (games + 10);
  return clamp(1 + (shrunkWinRate - 0.5) * 0.3, 0.85, 1.15);
}

export function sampleConfidence(effectiveSample: number, k: number): number {
  return effectiveSample > 0 ? clamp01(effectiveSample / (effectiveSample + Math.max(0, k))) : 0;
}

export function createEvidenceRecord(input: {
  kind: ProEvidenceKind;
  statistics: ProEvidenceStatistics;
  patches: string[];
  competitions: string[];
  teams: string[];
  effectiveSample: number;
  confidence: number;
  ageDays: number;
  material: boolean;
}): ProEvidenceRecord {
  return {
    ...input,
    text: formatProEvidenceText(input),
  };
}

export function formatProEvidenceText(input: {
  kind: ProEvidenceKind;
  statistics: ProEvidenceStatistics;
  patches: string[];
  competitions: string[];
  teams: string[];
  material: boolean;
}): string {
  const prefix = input.material ? "" : "Observation · ";
  const source = input.kind === "team-tendency" && input.teams.length > 0
    ? `${input.teams.join("/")} tendency`
    : input.competitions.length === 1
      ? conciseCompetition(input.competitions[0])
      : "Pro";
  const patch = input.patches.length === 1 ? ` · patch ${input.patches[0]}` : "";
  const stats = input.statistics;
  let detail = "evidence";

  if (input.kind === "priority") {
    detail = `${formatCount(stats.picks)} picks / ${formatCount(stats.bans)} bans`;
  } else if (input.kind === "flex") {
    detail = `${formatCount(stats.roleCount)} roles`;
  } else if (input.kind === "role-presence") {
    detail = `${formatPercent(stats.rate)} role presence`;
  } else if (input.kind === "team-tendency") {
    detail = `${formatCount(stats.picks)} picks`;
  } else if (input.kind === "success") {
    detail = `${formatPercent(stats.rate)} win rate over ${formatCount(stats.picks)} picks`;
  } else if (input.kind === "composition") {
    detail = `${formatCount(stats.games)} matching drafts`;
  } else {
    const lift = stats.lift ?? 0;
    detail = `${formatCount(stats.games)} games · ${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}% lift`;
  }

  return `${prefix}${source}${patch} · ${detail}`;
}

function normalizeQuery(query: ProCandidateQuery): Required<ProCandidateQuery> {
  return {
    championId: query.championId,
    role: query.role,
    allies: uniquePicks(query.allies ?? []),
    enemies: uniquePicks(query.enemies ?? []),
    favoriteTeams: [...new Set((query.favoriteTeams ?? []).map((team) => team.trim()).filter(Boolean))].sort(),
  };
}

function canonicalQueryKey(query: Required<ProCandidateQuery>): string {
  return JSON.stringify(query);
}

function uniquePicks(picks: ProAnalyticsPick[]): ProAnalyticsPick[] {
  return [...new Map(
    picks.map((pick) => [`${pick.championId}|${pick.role}`, pick]),
  ).values()].sort(
    (left, right) =>
      left.championId - right.championId ||
      roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role),
  );
}

function createCounts(): WeightedCounts {
  return {
    rawPicks: 0,
    rawBans: 0,
    rawWins: 0,
    rawGames: 0,
    rawOpportunities: 0,
    picks: 0,
    bans: 0,
    wins: 0,
    games: 0,
    opportunities: 0,
    patches: new Set(),
    competitions: new Set(),
    teams: new Set(),
  };
}

function mergeCounts(...values: WeightedCounts[]): WeightedCounts {
  const result = createCounts();

  for (const value of values) {
    result.rawPicks += value.rawPicks;
    result.rawBans += value.rawBans;
    result.rawWins += value.rawWins;
    result.rawGames += value.rawGames;
    result.rawOpportunities += value.rawOpportunities;
    result.picks += value.picks;
    result.bans += value.bans;
    result.wins += value.wins;
    result.games += value.games;
    result.opportunities += value.opportunities;
    value.patches.forEach((patch) => result.patches.add(patch));
    value.competitions.forEach((competition) => result.competitions.add(competition));
    value.teams.forEach((team) => result.teams.add(team));
  }

  return result;
}

function addCoverage(
  counts: WeightedCounts,
  patch: string,
  competition: string,
  team?: string,
): void {
  counts.patches.add(patch);
  counts.competitions.add(competition);
  if (team) counts.teams.add(team);
}

function addPrior(
  map: Map<string, { wins: number; games: number }>,
  key: string,
  row: { wins: number; games: number },
  weight: number,
): void {
  if (weight <= 0) return;
  const current = map.get(key) ?? { wins: 0, games: 0 };
  current.wins += row.wins * weight;
  current.games += row.games * weight;
  map.set(key, current);
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function shrunkEstimate(
  wins: number,
  games: number,
  prior: number,
  k: number,
): { rate: number } {
  return {
    rate: games > 0 ? (wins + prior * k) / (games + k) : prior,
  };
}

function emptySignal(): ProSignal {
  return {
    value: 0,
    confidence: 0,
    effectiveSample: 0,
    material: false,
    evidence: [],
  };
}

function roleKey(championId: number, role: Role): string {
  return `${championId}|${role}`;
}

function pairKey(
  championId: number,
  role: Role,
  allyChampionId: number,
  allyRole: Role,
): string {
  return `${championId}|${role}|${allyChampionId}|${allyRole}`;
}

function opponentKey(
  championId: number,
  role: Role,
  enemyChampionId: number,
  enemyRole: Role,
): string {
  return `${championId}|${role}|${enemyChampionId}|${enemyRole}`;
}

function rolePairKey(left: Role, right: Role): string {
  return roleOrder.indexOf(left) <= roleOrder.indexOf(right)
    ? `${left}|${right}`
    : `${right}|${left}`;
}

function compositionKey(championId: number, role: Role, archetype: ProArchetype): string {
  return `${championId}|${role}|${archetype}`;
}

function normalizeTeam(team: string): string {
  return team.trim().toLowerCase();
}

function snapshotAgeDays(generatedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(generatedAt)) / 86_400_000));
}

function conciseCompetition(competition: string): string {
  if (/mid-season invitational|\bmsi\b/i.test(competition)) return "MSI";
  if (/world championship|worlds/i.test(competition)) return "Worlds";
  if (/first stand/i.test(competition)) return "First Stand";
  if (/esports world cup|\bewc\b/i.test(competition)) return "EWC";
  return competition;
}

function formatCount(value: number | undefined): string {
  const numeric = value ?? 0;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function formatPercent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function compareEvidence(left: ProEvidenceRecord, right: ProEvidenceRecord): number {
  return Number(right.material) - Number(left.material) ||
    right.confidence - left.confidence ||
    left.kind.localeCompare(right.kind) ||
    left.text.localeCompare(right.text);
}

function comparePatch(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);
  return rightMajor - leftMajor || rightMinor - leftMinor;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampSigned(value: number): number {
  return clamp(value, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
