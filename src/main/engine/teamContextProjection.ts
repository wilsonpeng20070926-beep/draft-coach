import type { TeamComposition, TeamContext } from "../../shared/championAttributes";
import type { TeamContextProjection } from "../../shared/types";

const SATISFIED_THRESHOLDS = {
  frontline: 0.45,
  engage: 0.35,
  peel: 0.45,
  cc: 0.35,
  waveclear: 0.35,
  rangeShare: 0.35,
} as const;

const MAX_SATISFIED_BADGES = 3;
const MAX_NEED_BADGES = 6;
const MAX_THREAT_BADGES = 3;

export function createTeamContextProjection(
  ctx: TeamContext | null,
): TeamContextProjection | null {
  if (!ctx) {
    return null;
  }

  const missingNeeds = ctx.allyNeeds.map((need) => ({
    kind: need.kind,
    severity: clamp01(need.severity),
    satisfied: false,
  }));
  const missingKinds = new Set<string>(missingNeeds.map((need) => need.kind));
  const satisfiedNeeds = deriveSatisfiedNeeds(ctx.ally)
    .filter((need) => !missingKinds.has(need.kind))
    .slice(0, MAX_SATISFIED_BADGES);

  return {
    allyDamage: {
      ad: clamp01(ctx.ally.adWeight),
      ap: clamp01(ctx.ally.apWeight),
      knownCount: ctx.ally.championCount,
    },
    needs: [...missingNeeds, ...satisfiedNeeds].slice(0, MAX_NEED_BADGES),
    enemyThreats: ctx.enemyThreats
      .slice(0, MAX_THREAT_BADGES)
      .map((threat) => ({
        kind: threat.kind,
        severity: clamp01(threat.severity),
      })),
    confidence: clamp01(ctx.confidence),
  };
}

function deriveSatisfiedNeeds(
  ally: TeamComposition,
): TeamContextProjection["needs"] {
  if (ally.championCount === 0) {
    return [];
  }

  const rangeShare = ally.rangedCount / ally.championCount;
  const satisfied = [
    createSatisfiedNeed("frontline", ally.frontline, SATISFIED_THRESHOLDS.frontline),
    createSatisfiedNeed("engage", ally.engage, SATISFIED_THRESHOLDS.engage),
    createSatisfiedNeed("peel", ally.peel, SATISFIED_THRESHOLDS.peel),
    createSatisfiedNeed("cc", ally.cc, SATISFIED_THRESHOLDS.cc),
    createSatisfiedNeed("waveclear", ally.waveclear, SATISFIED_THRESHOLDS.waveclear),
    createSatisfiedNeed("range", rangeShare, SATISFIED_THRESHOLDS.rangeShare),
  ].filter((need): need is TeamContextProjection["needs"][number] => need !== null);

  return satisfied.sort((left, right) => right.severity - left.severity);
}

function createSatisfiedNeed(
  kind: string,
  value: number,
  threshold: number,
): TeamContextProjection["needs"][number] | null {
  if (value < threshold) {
    return null;
  }

  return {
    kind,
    severity: clamp01(value),
    satisfied: true,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
