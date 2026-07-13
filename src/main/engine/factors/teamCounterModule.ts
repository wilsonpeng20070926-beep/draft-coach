import type { ChampionAttributeProvider } from "../../catalog/championAttributes";
import type { MetaDataSource } from "../../data/metaDataSource";
import type {
  ChampionAttributes,
  CompThreat,
  CompThreatKind,
  TeamContext,
} from "../../../shared/championAttributes";
import type {
  AnticipatedThreat,
  ChampionRef,
  DraftState,
  DraftTarget,
  FactorBreakdown,
  FactorContribution,
  ReasonChip,
  Role,
} from "../../../shared/types";
import type { FactorModule } from "../engine";
import { TEAM_COUNTER_DELTA_SCALE, clamp01 } from "../scoringConstants";

interface ThreatMatch {
  threat: CompThreat;
  answer: number;
  vulnerability: number;
  net: number;
  impact: number;
}

interface ThreatShape {
  answer: (attributes: ChampionAttributes) => number;
  vulnerability: (attributes: ChampionAttributes) => number;
  positiveChip: (attributes: ChampionAttributes) => string;
  negativeChip: string;
}

const MAX_TEAM_COUNTER_CHIPS = 2;
const MIN_TEAM_COUNTER_CHIP_IMPACT = 0.08;
const ANTICIPATED_THREAT_DELTA_SCALE = 0.14;

export const HIGH_HEALTH_THREAT_IDS = new Set([14, 36, 154, 223, 420]);
export const ANTI_HEALTH_CHAMPION_IDS = new Set([48, 63, 67, 96, 114, 145, 887]);

export const TEAM_COUNTER_THREAT_WEIGHTS: Record<CompThreatKind, ThreatShape> = {
  dive: {
    answer: (attributes) =>
      weightedSum([
        [attributes.peel, 0.45],
        [attributes.frontline, 0.35],
        [attributes.mobility, 0.2],
      ]),
    vulnerability: squishyImmobile,
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [attributes.frontline, "Frontline answers their dive"],
        [attributes.peel, "Peel answers their dive"],
        [attributes.mobility, "Mobility helps into their dive"],
      ]),
    negativeChip: "Squishy into their dive",
  },
  "burst-ap": {
    answer: (attributes) =>
      weightedSum([
        [attributes.frontline, 0.35],
        [rangeAnswer(attributes), 0.35],
        [attributes.mobility, 0.3],
      ]),
    vulnerability: (attributes) =>
      weightedSum([
        [1 - attributes.frontline, 0.45],
        [meleeExposure(attributes), 0.3],
        [1 - attributes.mobility, 0.25],
      ]),
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [attributes.frontline, "Frontline absorbs their AP burst"],
        [rangeAnswer(attributes), "Range helps into their AP burst"],
        [attributes.mobility, "Mobility dodges their AP burst"],
      ]),
    negativeChip: "Squishy into their AP burst",
  },
  "burst-ad": {
    answer: (attributes) =>
      weightedSum([
        [attributes.frontline, 0.55],
        [rangeAnswer(attributes), 0.25],
        [attributes.mobility, 0.2],
      ]),
    vulnerability: (attributes) =>
      weightedSum([
        [1 - attributes.frontline, 0.45],
        [1 - attributes.mobility, 0.35],
        [meleeExposure(attributes), 0.2],
      ]),
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [attributes.frontline, "Frontline absorbs their AD burst"],
        [rangeAnswer(attributes), "Range helps into their AD burst"],
        [attributes.mobility, "Mobility helps into their AD burst"],
      ]),
    negativeChip: "Squishy into their AD burst",
  },
  poke: {
    answer: (attributes) =>
      weightedSum([
        [attributes.engage, 0.5],
        [attributes.mobility, 0.25],
        [attributes.peel, 0.25],
      ]),
    vulnerability: (attributes) =>
      weightedSum([
        [lowRange(attributes), 0.55],
        [1 - attributes.mobility, 0.45],
      ]),
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [attributes.engage, "Engage punishes their poke"],
        [attributes.mobility, "Mobility helps into their poke"],
        [attributes.peel, "Disengage helps into their poke"],
      ]),
    negativeChip: "Low mobility into their poke",
  },
  "hard-engage": {
    answer: (attributes) =>
      weightedSum([
        [attributes.peel, 0.45],
        [attributes.mobility, 0.35],
        [attributes.frontline, 0.2],
      ]),
    vulnerability: (attributes) =>
      weightedSum([
        [1 - attributes.mobility, 0.5],
        [1 - attributes.frontline, 0.3],
        [lowRange(attributes), 0.2],
      ]),
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [attributes.peel, "Peel answers their hard engage"],
        [attributes.mobility, "Mobility avoids their hard engage"],
        [attributes.frontline, "Frontline absorbs their hard engage"],
      ]),
    negativeChip: "Immobile into their hard engage",
  },
  "scaling-carry": {
    answer: (attributes) =>
      weightedSum([
        [powerCurveAnswer(attributes, "early"), 0.45],
        [attributes.cc, 0.3],
        [attributes.engage, 0.25],
      ]),
    vulnerability: (attributes) =>
      weightedSum([
        [powerCurveAnswer(attributes, "late") * attributes.carryPotential, 0.65],
        [1 - attributes.engage, 0.2],
        [1 - attributes.cc, 0.15],
      ]),
    positiveChip: (attributes) =>
      strongestAnswerLabel(attributes, [
        [powerCurveAnswer(attributes, "early"), "Early pressure punishes their scaling carry"],
        [attributes.cc, "Pick threat punishes their scaling carry"],
        [attributes.engage, "Engage punishes their scaling carry"],
      ]),
    negativeChip: "Scaling pick may not punish their carry",
  },
};

export class TeamCounterModule implements FactorModule {
  readonly key = "teamCounter";
  readonly enabled = true;

  constructor(
    private readonly metaSource: MetaDataSource,
    private readonly attributeProvider: ChampionAttributeProvider,
    private readonly getRegion: () => string,
    private readonly getRank: () => string,
    private readonly getMinChipConfidence: () => number,
  ) {}

  async contribute(
    candidate: ChampionRef,
    draft: DraftState,
    target: DraftTarget,
    ctx: TeamContext,
    threats: AnticipatedThreat[] = [],
  ): Promise<FactorContribution> {
    const unlockedThreats = threats.filter(
      (threat) =>
        !draft.enemies.some(
          (enemy) =>
            enemy.pickState === "locked" &&
            enemy.champion?.id === threat.champion.id,
        ),
    );

    if (ctx.enemyThreats.length === 0 && unlockedThreats.length === 0) {
      return createTeamCounterContribution(0, 0, [], []);
    }

    const role = target.role;
    const attributes = await this.loadCandidateAttributes(candidate, role);

    const compositionContribution = scoreCandidateTeamCounter(
      candidate,
      attributes,
      ctx,
      this.getMinChipConfidence(),
    );
    const anticipatedContribution = scoreCandidateAnticipatedThreats(
      candidate,
      attributes,
      unlockedThreats,
    );

    return combineTeamCounterContributions(
      compositionContribution,
      anticipatedContribution,
    );
  }

  private async loadCandidateAttributes(
    candidate: ChampionRef,
    role: Role | null | undefined,
  ): Promise<ChampionAttributes> {
    if (!role || !this.metaSource.getChampionAnalysis) {
      return this.attributeProvider.getAttributes(candidate);
    }

    const analysis = await this.metaSource.getChampionAnalysis(
      candidate,
      role,
      this.getRegion(),
      this.getRank(),
    );

    return this.attributeProvider.getAttributes(candidate, analysis.damageStyle);
  }
}

export function scoreCandidateAnticipatedThreats(
  candidate: ChampionRef,
  attributes: ChampionAttributes,
  threats: AnticipatedThreat[],
): FactorContribution {
  if (threats.length === 0) {
    return createTeamCounterContribution(0, 0, [], []);
  }

  const matches = threats
    .map((threat) => {
      const answer = anticipatedThreatAnswer(candidate, attributes, threat);
      const confidence = effectiveThreatConfidence(threat);

      return {
        threat,
        answer,
        confidence,
        impact: answer * confidence,
      };
    })
    .filter((match) => match.answer > 0.05)
    .sort(
      (left, right) =>
        right.impact - left.impact ||
        left.threat.champion.id - right.threat.champion.id,
    );

  if (matches.length === 0) {
    return createTeamCounterContribution(0, 0, [], []);
  }

  const best = matches[0];
  const combinedAnswer = clamp01(
    1 - matches.reduce((remaining, match) => remaining * (1 - match.answer), 1),
  );
  const confidence = Math.max(...matches.map((match) => match.confidence));
  const delta = combinedAnswer * ANTICIPATED_THREAT_DELTA_SCALE;
  const reason: ReasonChip = {
    kind: "team-counter",
    text: formatAnticipatedThreatReason(candidate, best.threat),
    polarity: "positive",
    strength: clamp01(best.answer),
    confidence: best.confidence,
  };
  const breakdown: FactorBreakdown[] = matches.slice(0, 3).map((match) => ({
    kind: "team-counter",
    label: `Hypothetical answer into ${match.threat.champion.name}`,
    value: match.answer,
    confidence: match.confidence,
    polarity: "positive",
    strength: match.answer,
    championId: match.threat.champion.id,
    championName: match.threat.champion.name,
  }));

  return createTeamCounterContribution(delta, confidence, [reason], breakdown);
}

export function effectiveThreatConfidence(threat: AnticipatedThreat): number {
  const sourceCap: Record<AnticipatedThreat["source"], number> = {
    forecast: 0.45,
    manual: 0.7,
    simulation: 0.62,
  };

  return Math.min(clamp01(threat.confidence), sourceCap[threat.source]);
}

function anticipatedThreatAnswer(
  candidate: ChampionRef,
  attributes: ChampionAttributes,
  threat: AnticipatedThreat,
): number {
  if (HIGH_HEALTH_THREAT_IDS.has(threat.champion.id)) {
    if (ANTI_HEALTH_CHAMPION_IDS.has(candidate.id)) {
      return 1;
    }

    return clamp01(
      attributes.carryPotential * 0.25 +
        (attributes.range === "ranged" ? 0.1 : 0),
    );
  }

  if (threat.champion.tags.includes("Assassin")) {
    return weightedSum([
      [attributes.peel, 0.5],
      [attributes.frontline, 0.3],
      [attributes.mobility, 0.2],
    ]);
  }

  if (threat.champion.tags.includes("Tank")) {
    return clamp01(
      attributes.carryPotential * 0.55 +
        (attributes.range === "ranged" ? 0.2 : 0),
    );
  }

  if (threat.champion.tags.includes("Mage")) {
    return weightedSum([
      [attributes.mobility, 0.45],
      [rangeAnswer(attributes), 0.35],
      [attributes.engage, 0.2],
    ]);
  }

  return weightedSum([
    [attributes.frontline, 0.35],
    [attributes.peel, 0.35],
    [attributes.carryPotential, 0.3],
  ]);
}

function formatAnticipatedThreatReason(
  candidate: ChampionRef,
  threat: AnticipatedThreat,
): string {
  if (
    HIGH_HEALTH_THREAT_IDS.has(threat.champion.id) &&
    ANTI_HEALTH_CHAMPION_IDS.has(candidate.id)
  ) {
    return `Hypothetical anti-health answer into ${threat.champion.name}`;
  }

  return `Hypothetical answer into ${threat.champion.name}`;
}

function combineTeamCounterContributions(
  composition: FactorContribution,
  anticipated: FactorContribution,
): FactorContribution {
  if (anticipated.confidence <= 0) {
    return composition;
  }

  if (composition.confidence <= 0) {
    return anticipated;
  }

  return createTeamCounterContribution(
    composition.delta * composition.confidence +
      anticipated.delta * anticipated.confidence,
    1,
    [...composition.reasons, ...anticipated.reasons].slice(0, MAX_TEAM_COUNTER_CHIPS),
    [...composition.breakdown ?? [], ...anticipated.breakdown ?? []],
  );
}

export function scoreCandidateTeamCounter(
  candidate: ChampionRef,
  attributes: ChampionAttributes,
  ctx: TeamContext,
  minChipConfidence = 0.58,
): FactorContribution {
  if (ctx.enemyThreats.length === 0) {
    return createTeamCounterContribution(0, 0, [], []);
  }

  const matches = ctx.enemyThreats.map((threat) =>
    createThreatMatch(threat, attributes),
  );
  const raw = matches.reduce((sum, match) => sum + match.impact, 0);
  const delta = raw * TEAM_COUNTER_DELTA_SCALE;
  const confidence = clamp01(ctx.confidence);
  const breakdown = matches.map((match) =>
    createThreatBreakdown(candidate, match),
  );
  const reasons = createThreatReasons(matches, attributes, confidence, minChipConfidence);

  return createTeamCounterContribution(delta, confidence, reasons, breakdown);
}

export function candidateAnswers(
  threatKind: CompThreatKind,
  attributes: ChampionAttributes,
): number {
  return clamp01(TEAM_COUNTER_THREAT_WEIGHTS[threatKind].answer(attributes));
}

export function candidateVulnerability(
  threatKind: CompThreatKind,
  attributes: ChampionAttributes,
): number {
  return clamp01(TEAM_COUNTER_THREAT_WEIGHTS[threatKind].vulnerability(attributes));
}

function createThreatMatch(
  threat: CompThreat,
  attributes: ChampionAttributes,
): ThreatMatch {
  const answer = candidateAnswers(threat.kind, attributes);
  const vulnerability = candidateVulnerability(threat.kind, attributes);
  const net = answer - vulnerability;

  return {
    threat,
    answer,
    vulnerability,
    net,
    impact: net * threat.severity,
  };
}

function createThreatReasons(
  matches: ThreatMatch[],
  attributes: ChampionAttributes,
  confidence: number,
  minChipConfidence: number,
): ReasonChip[] {
  return matches
    .filter((match) => Math.abs(match.impact) >= MIN_TEAM_COUNTER_CHIP_IMPACT)
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, MAX_TEAM_COUNTER_CHIPS)
    .map((match) => createThreatReason(match, attributes, confidence, minChipConfidence));
}

function createThreatReason(
  match: ThreatMatch,
  attributes: ChampionAttributes,
  confidence: number,
  minChipConfidence: number,
): ReasonChip {
  const polarity = match.impact >= 0 ? "positive" : "negative";
  const baseText =
    polarity === "positive"
      ? TEAM_COUNTER_THREAT_WEIGHTS[match.threat.kind].positiveChip(attributes)
      : TEAM_COUNTER_THREAT_WEIGHTS[match.threat.kind].negativeChip;
  const text = confidence < minChipConfidence ? `Possibly ${lowerFirst(baseText)}` : baseText;

  return {
    kind: "team-counter",
    text,
    polarity,
    strength: clamp01(Math.abs(match.impact)),
    confidence,
  };
}

function createThreatBreakdown(
  candidate: ChampionRef,
  match: ThreatMatch,
): FactorBreakdown {
  return {
    kind: "team-counter",
    label: `Answers ${formatThreatKind(match.threat.kind)}`,
    value: match.impact,
    confidence: clamp01(Math.max(match.answer, match.vulnerability)),
    polarity: match.impact > 0.02 ? "positive" : match.impact < -0.02 ? "negative" : "neutral",
    strength: clamp01(Math.abs(match.impact)),
    championId: candidate.id,
    championName: candidate.name,
  };
}

function squishyImmobile(attributes: ChampionAttributes): number {
  return weightedSum([
    [1 - attributes.frontline, 0.35],
    [1 - attributes.mobility, 0.25],
    [1 - attributes.peel, 0.4],
  ]);
}

function rangeAnswer(attributes: ChampionAttributes): number {
  if (attributes.range === "ranged") {
    return 1;
  }

  if (attributes.range === "mixed") {
    return 0.65;
  }

  return 0;
}

function lowRange(attributes: ChampionAttributes): number {
  return 1 - rangeAnswer(attributes);
}

function meleeExposure(attributes: ChampionAttributes): number {
  if (attributes.range === "melee") {
    return 1;
  }

  if (attributes.range === "mixed") {
    return 0.45;
  }

  return 0;
}

function powerCurveAnswer(
  attributes: ChampionAttributes,
  curve: "early" | "late",
): number {
  if (attributes.powerCurve === curve) {
    return 1;
  }

  if (attributes.powerCurve === "mid" || attributes.powerCurve === "flat") {
    return 0.45;
  }

  return 0;
}

function weightedSum(values: Array<[number, number]>): number {
  return clamp01(values.reduce((sum, [value, weight]) => sum + clamp01(value) * weight, 0));
}

function strongestAnswerLabel(
  _attributes: ChampionAttributes,
  labels: Array<[number, string]>,
): string {
  return [...labels].sort((left, right) => right[0] - left[0])[0]?.[1] ?? "Answers their comp";
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function formatThreatKind(kind: CompThreatKind): string {
  return kind.replace(/-/g, " ");
}

function createTeamCounterContribution(
  delta: number,
  confidence: number,
  reasons: ReasonChip[],
  breakdown: FactorBreakdown[],
): FactorContribution {
  return {
    factor: "teamCounter",
    delta,
    confidence,
    reasons,
    breakdown,
  };
}
