export const META_BASE_LOW = 0.35;
export const META_BASE_HIGH = 0.65;
export const META_BASE_MAX_SPREAD = (META_BASE_HIGH - 0.5) / 0.5;

export const DELTA_CAP = 0.16;
export const COUNTER_DELTA_SCALE = 0.16;
export const TEAM_COUNTER_DELTA_SCALE = 0.16;
export const SYNERGY_DELTA_SCALE = 0.7;
export const SYNERGY_NEUTRAL_SCORE = 0.5;
export const COMP_FIT_DELTA_SCALE = 0.14;

export function metaBaseSpread(metaWeight: number): number {
  return clamp01(metaWeight) * META_BASE_MAX_SPREAD;
}

export function clampDelta(delta: number): number {
  return Math.min(DELTA_CAP, Math.max(-DELTA_CAP, delta));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
