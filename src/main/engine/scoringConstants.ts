export const META_BASE_LOW = 0.35;
export const META_BASE_HIGH = 0.65;
export const META_BASE_MAX_SPREAD = (META_BASE_HIGH - 0.5) / 0.5;

export const DELTA_CAP = 0.16;
export const COUNTER_DELTA_SCALE = 0.16;
export const TEAM_COUNTER_DELTA_SCALE = 0.16;
export const SYNERGY_DELTA_SCALE = 0.7;
export const SYNERGY_NEUTRAL_SCORE = 0.5;
export const COMP_FIT_DELTA_SCALE = 0.14;

// Pro deltas enrich the analogous ranked factors while remaining smaller than
// the primary lane/synergy/meta evidence. These are calibration constants, not
// claims that professional play has a fixed universal value.
export const PRO_FACTOR_DELTA_SCALES = {
  lane: 0.075,
  synergy: 0.065,
  teamCounter: 0.055,
  composition: 0.045,
  priorityFlex: 0.04,
  success: 0.025,
} as const;

export const DEFAULT_EVIDENCE_ORDER = [
  "lane",
  "synergy",
  "ranked-meta",
  "enemy-answer",
  "allied-need",
  "pro-priority-flex",
  "tournament-success",
] as const;

export const CATEGORY_PROJECTION_LIMITS = {
  overall: 5,
  lane: 3,
  synergy: 3,
  composition: 3,
  pro: 3,
  risk: 3,
  overallSafetyFloor: 0.4,
  synergyConfidenceFloor: 0.45,
  proEffectiveSampleFloor: 3,
} as const;

export const RISK_THRESHOLDS = {
  avoidConfidence: 0.75,
  highRiskConfidence: 0.55,
  traceableNegativeDelta: -0.075,
  weakRoleRate: 0.08,
} as const;

export function metaBaseSpread(metaWeight: number): number {
  return clamp01(metaWeight) * META_BASE_MAX_SPREAD;
}

export function clampDelta(delta: number): number {
  return Math.min(DELTA_CAP, Math.max(-DELTA_CAP, delta));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
