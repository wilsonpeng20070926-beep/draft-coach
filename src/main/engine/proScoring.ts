import type { ChampionCatalog } from "../catalog/championCatalog";
import type { LaneMetaEntry } from "../data/metaDataSource";
import type {
  ProAnalyticsProvider,
  ProCandidateQuery,
} from "../data/pro/proAnalytics";
import type {
  ProCandidateAnalysis,
  ProEvidenceRecord,
  ProSignal,
} from "../../shared/proData";
import type {
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
  FactorContribution,
  ReasonChip,
  Role,
} from "../../shared/types";
import { PRO_FACTOR_DELTA_SCALES, clamp01, clampDelta } from "./scoringConstants";

export interface ProScoringProvider {
  candidateEntries(laneMeta: LaneMetaEntry[], role: Role): LaneMetaEntry[];
  contributions(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
  ): FactorContribution[];
}

export class SnapshotProScoringProvider implements ProScoringProvider {
  constructor(
    private readonly analytics: ProAnalyticsProvider,
    private readonly catalog: ChampionCatalog,
    private readonly getFavoriteTeams: () => string[],
  ) {}

  candidateEntries(laneMeta: LaneMetaEntry[], role: Role): LaneMetaEntry[] {
    const entriesById = new Map(
      laneMeta.map((entry) => [entry.champion.id, entry]),
    );

    return this.analytics
      .topRoleCandidateIds(role, this.getFavoriteTeams(), 8)
      .map((championId) => {
        const observed = entriesById.get(championId);

        if (observed) {
          return observed;
        }

        const champion = this.catalog.byId(championId);
        return champion ? createProSupportedEntry(champion) : null;
      })
      .filter((entry): entry is LaneMetaEntry => entry !== null);
  }

  contributions(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
  ): FactorContribution[] {
    const analysis = this.analytics.analyzeCandidate({
      championId: candidate.id,
      role: target.role,
      allies: lockedPicks(draft.allies, target.cellId),
      enemies: lockedPicks(draft.enemies),
      favoriteTeams: this.getFavoriteTeams(),
    });

    return analysis ? createProContributions(analysis) : [];
  }
}

export function createProContributions(
  analysis: ProCandidateAnalysis,
): FactorContribution[] {
  const contributions = [
    signalContribution("proLane", analysis.matchup, PRO_FACTOR_DELTA_SCALES.lane),
    signalContribution("proSynergy", analysis.synergy, PRO_FACTOR_DELTA_SCALES.synergy),
    signalContribution(
      "proTeamCounter",
      analysis.response,
      PRO_FACTOR_DELTA_SCALES.teamCounter,
    ),
    signalContribution(
      "proComposition",
      analysis.composition,
      PRO_FACTOR_DELTA_SCALES.composition,
    ),
    priorityContribution(analysis),
    signalContribution(
      "proSuccess",
      analysis.success,
      PRO_FACTOR_DELTA_SCALES.success,
    ),
  ];

  return contributions.filter(
    (contribution): contribution is FactorContribution => contribution !== null,
  );
}

export function createProSupportedEntry(champion: ChampionRef): LaneMetaEntry {
  return {
    champion,
    winRate: 0.5,
    tier: 5,
    dataQuality: "pro-supported",
  };
}

function signalContribution(
  factor: string,
  signal: ProSignal,
  scale: number,
): FactorContribution | null {
  if (signal.evidence.length === 0) {
    return null;
  }

  const delta = signal.material ? clampDelta(signal.value * scale) : 0;
  return contribution(factor, delta, signal.confidence, signal.evidence);
}

function priorityContribution(
  analysis: ProCandidateAnalysis,
): FactorContribution | null {
  const signals = [
    { signal: analysis.priority, weight: 0.45 },
    { signal: analysis.rolePresence, weight: 0.15 },
    { signal: analysis.flex, weight: 0.15 },
    { signal: analysis.favorite, weight: 0.25 },
  ].filter(({ signal }) => signal.evidence.length > 0);

  if (signals.length === 0) {
    return null;
  }

  const material = signals.filter(({ signal }) => signal.material);
  const totalWeight = material.reduce((sum, item) => sum + item.weight, 0);
  const value = totalWeight > 0
    ? material.reduce(
        (sum, item) => sum + Math.max(0, item.signal.value) * item.weight,
        0,
      ) / totalWeight
    : 0;
  const confidence = material.length > 0
    ? Math.max(...material.map(({ signal }) => signal.confidence))
    : Math.max(...signals.map(({ signal }) => signal.confidence));
  const evidence = uniqueEvidence(signals.flatMap(({ signal }) => signal.evidence));
  const delta = material.length > 0
    ? clampDelta(value * PRO_FACTOR_DELTA_SCALES.priorityFlex)
    : 0;

  return contribution("proPriority", delta, confidence, evidence);
}

function contribution(
  factor: string,
  delta: number,
  confidence: number,
  proEvidence: ProEvidenceRecord[],
): FactorContribution {
  const reason = bestReason(delta, confidence, proEvidence);

  return {
    factor,
    delta,
    confidence: clamp01(confidence),
    reasons: reason ? [reason] : [],
    source: "pro",
    proEvidence,
  };
}

function bestReason(
  delta: number,
  confidence: number,
  evidence: ProEvidenceRecord[],
): ReasonChip | null {
  const best = evidence[0];

  if (!best) {
    return null;
  }

  return {
    kind: "pro",
    text: best.text,
    polarity: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
    strength: clamp01(Math.abs(delta) / 0.08),
    confidence: clamp01(confidence),
  };
}

function lockedPicks(
  players: DraftPlayer[],
  excludedCellId?: number,
): ProCandidateQuery["allies"] {
  return players
    .filter(
      (player): player is DraftPlayer & { champion: ChampionRef; role: Role } =>
        player.cellId !== excludedCellId &&
        player.pickState === "locked" &&
        player.champion !== null &&
        player.role !== null,
    )
    .map((player) => ({
      championId: player.champion.id,
      role: player.role,
    }));
}

function uniqueEvidence(evidence: ProEvidenceRecord[]): ProEvidenceRecord[] {
  return [...new Map(evidence.map((item) => [`${item.kind}|${item.text}`, item])).values()]
    .sort(
      (left, right) =>
        Number(right.material) - Number(left.material) ||
        right.confidence - left.confidence ||
        left.kind.localeCompare(right.kind),
    );
}
