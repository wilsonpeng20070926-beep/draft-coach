import type {
  ChampionAnalysis,
  ChampionSynergyAnalysis,
  MetaDataSource,
} from "../../data/metaDataSource";
import type { TeamContext } from "../../../shared/championAttributes";
import type {
  ChampionRef,
  DraftState,
  DraftTarget,
  FactorBreakdown,
  FactorContribution,
  ReasonChip,
  Role,
} from "../../../shared/types";
import type { FactorModule } from "../engine";
import {
  SYNERGY_DELTA_SCALE,
  SYNERGY_NEUTRAL_SCORE,
  clamp01,
} from "../scoringConstants";

export interface SynergyAlly {
  champion: ChampionRef;
  role: Role | null;
}

const NOTABLE_SYNERGY_MIN_SAMPLE = 500;
const NEUTRAL_PAIR_CONFIDENCE = 0.15;
const SYNERGY_MAX_WEIGHT = 0.7;
const SYNERGY_MEAN_WEIGHT = 1 - SYNERGY_MAX_WEIGHT;

export class SynergyModule implements FactorModule {
  readonly key = "synergy";
  readonly enabled = true;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly getRegion: () => string,
    private readonly getRank: () => string,
    private readonly getMinChipConfidence: () => number,
  ) {}

  async contribute(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
    _ctx: TeamContext,
  ): Promise<FactorContribution> {
    const role = target.role;
    const allies = collectAllies(draft, target, candidate);

    if (!role || allies.length === 0) {
      return createSynergyContribution(0, 0, [], []);
    }

    const analysis = await this.loadCandidateAnalysis(candidate, role);

    return scoreCandidateSynergy(
      candidate,
      allies,
      analysis,
      this.getMinChipConfidence(),
    );
  }

  private async loadCandidateAnalysis(
    candidate: ChampionRef,
    role: Role,
  ): Promise<ChampionAnalysis> {
    if (!this.metaSource.getChampionAnalysis) {
      return { damageStyle: "unknown", synergies: [] };
    }

    return this.metaSource.getChampionAnalysis(
      candidate,
      role,
      this.getRegion(),
      this.getRank(),
    );
  }
}

export function scoreCandidateSynergy(
  _candidate: ChampionRef,
  allies: ReadonlyArray<SynergyAlly>,
  analysis: ChampionAnalysis,
  minChipConfidence: number,
): FactorContribution {
  if (allies.length === 0) {
    return createSynergyContribution(0, 0, [], []);
  }

  const breakdown = allies.map((ally) =>
    createAllyBreakdown(ally, findBestSynergy(analysis.synergies, ally)),
  );
  const knownBreakdown = breakdown.filter((entry) => entry.confidence > NEUTRAL_PAIR_CONFIDENCE);

  if (knownBreakdown.length === 0) {
    return createSynergyContribution(0, 0, [], breakdown);
  }

  const scores = breakdown.map((entry) => entry.value);
  const maxScore = Math.max(...scores);
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const combinedScore = maxScore * SYNERGY_MAX_WEIGHT + meanScore * SYNERGY_MEAN_WEIGHT;
  const delta = (combinedScore - SYNERGY_NEUTRAL_SCORE) * SYNERGY_DELTA_SCALE;
  const confidence = synergyContributionConfidence(knownBreakdown, allies.length);
  const reasons = createSynergyReasons(knownBreakdown, minChipConfidence);

  return createSynergyContribution(delta, confidence, reasons, breakdown);
}

function collectAllies(
  draft: DraftState,
  target: DraftTarget,
  candidate: ChampionRef,
): SynergyAlly[] {
  return draft.allies
    .filter(
      (player) =>
        player.pickState === "locked" && player.cellId !== target.cellId,
    )
    .map((player): SynergyAlly | null =>
      player.champion
        ? {
            champion: player.champion,
            role: player.role,
          }
        : null,
    )
    .filter((ally): ally is SynergyAlly => ally !== null)
    .filter((ally) => ally.champion.id !== candidate.id);
}

function findBestSynergy(
  synergies: ReadonlyArray<ChampionSynergyAnalysis>,
  ally: SynergyAlly,
): ChampionSynergyAnalysis | null {
  const matches = synergies.filter(
    (synergy) =>
      synergy.partnerChampionId === ally.champion.id ||
      normalizeLookupName(synergy.partnerChampionName) === normalizeLookupName(ally.champion.name),
  );

  if (matches.length === 0) {
    return null;
  }

  const roleMatches = ally.role
    ? matches.filter((synergy) => synergy.partnerPosition === ally.role)
    : [];
  const preferred = roleMatches.length > 0 ? roleMatches : matches;

  return [...preferred].sort((left, right) => right.score - left.score)[0];
}

function createAllyBreakdown(
  ally: SynergyAlly,
  synergy: ChampionSynergyAnalysis | null,
): FactorBreakdown {
  if (!synergy) {
    return {
      kind: "synergy",
      label: `No listed synergy with ${ally.champion.name}`,
      value: SYNERGY_NEUTRAL_SCORE,
      confidence: NEUTRAL_PAIR_CONFIDENCE,
      polarity: "neutral",
      strength: 0,
      championId: ally.champion.id,
      championName: ally.champion.name,
      tier: null,
    };
  }

  const score = clamp01(synergy.score);
  const strength = clamp01(
    Math.abs(score - SYNERGY_NEUTRAL_SCORE) / (1 - SYNERGY_NEUTRAL_SCORE),
  );

  return {
    kind: "synergy",
    label: `${formatTierLabel(synergy.tier)} with ${ally.champion.name}`,
    value: score,
    confidence: clamp01(synergy.confidence),
    polarity: score >= 0.55 ? "positive" : score <= 0.47 ? "negative" : "neutral",
    strength,
    championId: ally.champion.id,
    championName: ally.champion.name,
    tier: synergy.tier ?? null,
    sampleSize: synergy.sampleSize,
    winRate: synergy.winRate,
  };
}

function synergyContributionConfidence(
  knownBreakdown: FactorBreakdown[],
  allyCount: number,
): number {
  const maxConfidence = Math.max(...knownBreakdown.map((entry) => entry.confidence));
  const meanConfidence =
    knownBreakdown.reduce((sum, entry) => sum + entry.confidence, 0) /
    knownBreakdown.length;
  const coverage = clamp01(knownBreakdown.length / allyCount);

  return clamp01((maxConfidence * 0.7 + meanConfidence * 0.3) * (0.65 + coverage * 0.35));
}

function createSynergyReasons(
  breakdown: FactorBreakdown[],
  minChipConfidence: number,
): ReasonChip[] {
  return breakdown
    .filter(
      (entry) =>
        entry.tier !== null &&
        entry.tier !== undefined &&
        entry.tier <= 1 &&
        (entry.sampleSize ?? 0) >= NOTABLE_SYNERGY_MIN_SAMPLE,
    )
    .sort((left, right) => right.value - left.value)
    .slice(0, 2)
    .map((entry) => createSynergyReason(entry, minChipConfidence));
}

function createSynergyReason(
  entry: FactorBreakdown,
  minChipConfidence: number,
): ReasonChip {
  const text = formatSynergyReasonText(entry, minChipConfidence);

  return {
    kind: "synergy",
    text,
    polarity: "positive",
    strength: entry.strength ?? 0,
    confidence: entry.confidence,
  };
}

function formatSynergyReasonText(
  entry: FactorBreakdown,
  minChipConfidence: number,
): string {
  const tierLabel = formatTierLabel(entry.tier);
  const prefix = entry.confidence < minChipConfidence ? "Possible " : "";

  return `${prefix}${tierLabel} synergy with ${entry.championName}`;
}

function formatTierLabel(tier: number | null | undefined): string {
  if (tier === 0) {
    return "OP-tier";
  }

  if (tier === 1) {
    return "S-tier";
  }

  if (tier === 2) {
    return "A-tier";
  }

  if (tier === 3) {
    return "B-tier";
  }

  if (tier === 4) {
    return "C-tier";
  }

  return "Listed";
}

function createSynergyContribution(
  delta: number,
  confidence: number,
  reasons: ReasonChip[],
  breakdown: FactorBreakdown[],
): FactorContribution {
  return {
    factor: "synergy",
    delta,
    confidence,
    reasons,
    breakdown,
  };
}

function normalizeLookupName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
