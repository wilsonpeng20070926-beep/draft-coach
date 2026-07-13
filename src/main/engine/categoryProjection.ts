import type { LaneMetaEntry } from "../data/metaDataSource";
import type { TeamContext } from "../../shared/championAttributes";
import type {
  EvidenceBalance,
  Recommendation,
  RecommendationCategory,
  RecommendationRisk,
  ScoreContribution,
} from "../../shared/types";
import {
  CATEGORY_PROJECTION_LIMITS,
  RISK_THRESHOLDS,
  clamp01,
} from "./scoringConstants";

const laneFactors = new Set(["laneCounter", "counter", "proLane"]);
const synergyFactors = new Set(["synergy", "proSynergy"]);
const compositionFactors = new Set([
  "teamCounter",
  "compFit",
  "proTeamCounter",
  "proComposition",
]);
const riskFactors = new Set([
  "laneCounter",
  "counter",
  "teamCounter",
  "compFit",
  "proLane",
  "proTeamCounter",
  "proComposition",
]);

export function projectRecommendationCategories(
  recommendations: Recommendation[],
): RecommendationCategory[] {
  const ordered = [...recommendations].sort(compareOverall);
  const categories: RecommendationCategory[] = [];
  addCategory(
    categories,
    "overall",
    "Best overall",
    ordered.slice(0, CATEGORY_PROJECTION_LIMITS.overall),
  );
  addCategory(
    categories,
    "lane",
    "Best lane matchup",
    rankByContribution(ordered, laneFactors, {
      limit: CATEGORY_PROJECTION_LIMITS.lane,
      overallFloor: CATEGORY_PROJECTION_LIMITS.overallSafetyFloor,
    }),
  );
  addCategory(
    categories,
    "synergy",
    "Best synergy",
    rankByContribution(ordered, synergyFactors, {
      limit: CATEGORY_PROJECTION_LIMITS.synergy,
      confidenceFloor: CATEGORY_PROJECTION_LIMITS.synergyConfidenceFloor,
    }),
  );
  addCategory(
    categories,
    "composition",
    "Best composition answer",
    rankByContribution(ordered, compositionFactors, {
      limit: CATEGORY_PROJECTION_LIMITS.composition,
    }),
  );
  addCategory(
    categories,
    "pro",
    "Pro-inspired",
    rankProInspired(ordered),
  );
  addCategory(
    categories,
    "risk",
    "Avoid / High risk",
    ordered
      .filter((recommendation) => recommendation.risk !== null)
      .sort(compareRisk)
      .slice(0, CATEGORY_PROJECTION_LIMITS.risk),
  );

  return categories;
}

export function calculateEvidenceBalance(
  recommendations: Recommendation[],
): EvidenceBalance {
  let rankedMagnitude = 0;
  let proMagnitude = 0;

  for (const contribution of recommendations.flatMap((item) => item.contributions)) {
    const magnitude = Math.abs(effectiveDelta(contribution));

    if (evidenceSource(contribution) === "pro") {
      proMagnitude += magnitude;
    } else {
      rankedMagnitude += magnitude;
    }
  }

  const total = rankedMagnitude + proMagnitude;

  if (total <= 0) {
    return {
      rankedPercent: 100,
      proPercent: 0,
      rankedMagnitude,
      proMagnitude,
    };
  }

  const proPercent = Math.round((proMagnitude / total) * 100);
  return {
    rankedPercent: 100 - proPercent,
    proPercent,
    rankedMagnitude,
    proMagnitude,
  };
}

export function assessRecommendationRisk(
  recommendation: Pick<Recommendation, "contributions" | "total">,
  entry: LaneMetaEntry,
  ctx: TeamContext,
): RecommendationRisk | null {
  const traceable = recommendation.contributions
    .filter((contribution) => riskFactors.has(contribution.factor))
    .filter((contribution) => effectiveDelta(contribution) < 0)
    .filter((contribution) =>
      evidenceSource(contribution) !== "pro" ||
      (contribution.proEvidence ?? []).some((evidence) => evidence.material),
    )
    .map((contribution) => ({
      contribution,
      confidence: clamp01(contribution.confidence ?? 1),
      severity: Math.abs(effectiveDelta(contribution)),
      reason: negativeReason(contribution),
    }));
  const contextual: Array<{
    factor: string;
    confidence: number;
    severity: number;
    reason: string;
  }> = [];

  if (
    entry.dataQuality !== "pro-supported" &&
    entry.roleRate !== undefined &&
    entry.roleRate < RISK_THRESHOLDS.weakRoleRate
  ) {
    contextual.push({
      factor: "roleFit",
      confidence: clamp01(1 - entry.roleRate / RISK_THRESHOLDS.weakRoleRate),
      severity: 0.06,
      reason: "Weak evidence for this role",
    });
  }

  const compFit = recommendation.contributions.find(
    (contribution) => contribution.factor === "compFit",
  );
  if (
    ctx.allyNeeds.length > 0 &&
    ctx.confidence >= 0.55 &&
    (!compFit || effectiveDelta(compFit) <= 0)
  ) {
    contextual.push({
      factor: "compFit",
      confidence: ctx.confidence,
      severity: 0.04,
      reason: "Does not address the current allied composition need",
    });
  }

  const all = [
    ...traceable.map((item) => ({
      factor: item.contribution.factor,
      confidence: item.confidence,
      severity: item.severity,
      reason: item.reason,
    })),
    ...contextual,
  ].sort(
    (left, right) =>
      right.severity * right.confidence - left.severity * left.confidence ||
      left.factor.localeCompare(right.factor),
  );

  if (all.length === 0) {
    return null;
  }

  const confidence = Math.max(...all.map((item) => item.confidence));
  const hasAvoidEvidence = traceable.some(
    (item) =>
      item.confidence >= RISK_THRESHOLDS.avoidConfidence &&
      item.severity >= Math.abs(RISK_THRESHOLDS.traceableNegativeDelta),
  );
  const label = hasAvoidEvidence
    ? "Avoid"
    : confidence >= RISK_THRESHOLDS.highRiskConfidence
      ? "High risk"
      : "Poor fit";

  return {
    label,
    confidence,
    reasons: [...new Set(all.map((item) => item.reason))].slice(0, 3),
    traceableFactors: [...new Set(all.map((item) => item.factor))],
  };
}

function rankByContribution(
  recommendations: Recommendation[],
  factors: Set<string>,
  options: {
    limit: number;
    overallFloor?: number;
    confidenceFloor?: number;
  },
): Recommendation[] {
  return recommendations
    .map((recommendation) => {
      const contributions = recommendation.contributions.filter((item) =>
        factors.has(item.factor),
      );
      return {
        recommendation,
        score: contributions.reduce(
          (sum, contribution) => sum + effectiveDelta(contribution),
          0,
        ),
        confidence: contributions.length > 0
          ? Math.max(...contributions.map((item) => item.confidence ?? 1))
          : 0,
      };
    })
    .filter((item) => item.score > 0)
    .filter((item) => item.recommendation.total >= (options.overallFloor ?? 0))
    .filter((item) => item.confidence >= (options.confidenceFloor ?? 0))
    .sort(
      (left, right) =>
        right.score - left.score || compareOverall(left.recommendation, right.recommendation),
    )
    .slice(0, options.limit)
    .map((item) => item.recommendation);
}

function rankProInspired(recommendations: Recommendation[]): Recommendation[] {
  return recommendations
    .map((recommendation) => {
      const contributions = recommendation.contributions.filter(
        (contribution) => evidenceSource(contribution) === "pro",
      );
      const materialEvidence = contributions.flatMap(
        (contribution) => contribution.proEvidence ?? [],
      ).filter(
        (evidence) =>
          evidence.material &&
          evidence.effectiveSample >= CATEGORY_PROJECTION_LIMITS.proEffectiveSampleFloor,
      );
      return {
        recommendation,
        score: contributions.reduce(
          (sum, contribution) => sum + Math.max(0, effectiveDelta(contribution)),
          0,
        ),
        materialEvidence,
      };
    })
    .filter((item) => item.score > 0 && item.materialEvidence.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score || compareOverall(left.recommendation, right.recommendation),
    )
    .slice(0, CATEGORY_PROJECTION_LIMITS.pro)
    .map((item) => item.recommendation);
}

function addCategory(
  categories: RecommendationCategory[],
  key: RecommendationCategory["key"],
  label: string,
  recommendations: Recommendation[],
): void {
  if (recommendations.length > 0) {
    categories.push({ key, label, recommendations });
  }
}

function compareOverall(left: Recommendation, right: Recommendation): number {
  return right.total - left.total || left.champion.id - right.champion.id;
}

function compareRisk(left: Recommendation, right: Recommendation): number {
  return riskRank(right.risk) - riskRank(left.risk) ||
    (right.risk?.confidence ?? 0) - (left.risk?.confidence ?? 0) ||
    compareOverall(left, right);
}

function riskRank(risk: RecommendationRisk | null): number {
  if (risk?.label === "Avoid") return 3;
  if (risk?.label === "High risk") return 2;
  return risk ? 1 : 0;
}

function negativeReason(contribution: ScoreContribution): string {
  return contribution.reasonChips?.find((chip) => chip.polarity === "negative")?.text ??
    contribution.reasons[0] ??
    `Negative ${contribution.factor} evidence`;
}

function evidenceSource(contribution: ScoreContribution): "ranked" | "pro" {
  return contribution.source ?? (contribution.factor.startsWith("pro") ? "pro" : "ranked");
}

function effectiveDelta(contribution: ScoreContribution): number {
  return contribution.effectiveDelta ??
    (contribution.delta ?? 0) * (contribution.confidence ?? 1);
}
