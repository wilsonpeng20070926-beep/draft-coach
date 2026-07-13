export interface FactorWeights {
  meta: number;
  laneCounter: number;
  teamCounter: number;
  synergy: number;
  compFit: number;
}

export interface AppConfig {
  version: number;
  weights: FactorWeights;
  region: string;
  rank: string;
  topN: number;
  pickRateFloor: number;
  shrinkK: number;
  minChipConfidence: number;
  favoriteTeams: string[];
  proEvidenceEnabled: boolean;
  proInfluence: number;
}

export type AppConfigPatch = Partial<Omit<AppConfig, "weights">> & {
  weights?: Partial<FactorWeights>;
};

export interface SelectOption {
  label: string;
  value: string;
}

export const APP_CONFIG_VERSION = 5;

export const FACTOR_WEIGHT_PRESETS = {
  coach: {
    meta: 0.8,
    laneCounter: 0.6,
    teamCounter: 0.4,
    synergy: 0.65,
    compFit: 0.4,
  },
  trustTheMeta: {
    meta: 1,
    laneCounter: 0.1,
    teamCounter: 0,
    synergy: 0.05,
    compFit: 0,
  },
  laneBully: {
    meta: 0.7,
    laneCounter: 1,
    teamCounter: 0.5,
    synergy: 0.1,
    compFit: 0,
  },
  teamComp: {
    meta: 0.55,
    laneCounter: 0.15,
    teamCounter: 0.25,
    synergy: 0.85,
    compFit: 0.75,
  },
} satisfies Record<string, FactorWeights>;

export const DEFAULT_APP_CONFIG: AppConfig = {
  version: APP_CONFIG_VERSION,
  weights: {
    meta: 0.55,
    laneCounter: 0.75,
    teamCounter: 0.35,
    synergy: 0.55,
    compFit: 0.3,
  },
  region: "global",
  rank: "emerald_plus",
  topN: 5,
  pickRateFloor: 0.005,
  shrinkK: 1000,
  minChipConfidence: 0.58,
  favoriteTeams: [],
  proEvidenceEnabled: true,
  proInfluence: 1,
};

export const INTERNAL_DATA_CONFIG = {
  candidateCap: 40,
  metaRolePresenceFloor: 0.2,
  opggCacheTtlMs: 6 * 60 * 60 * 1000,
  dataDragonCacheTtlMs: 24 * 60 * 60 * 1000,
} as const;

export const REGION_OPTIONS: SelectOption[] = [
  { label: "Global", value: "global" },
  { label: "North America", value: "na" },
  { label: "Europe West", value: "euw" },
  { label: "Korea", value: "kr" },
  { label: "Taiwan", value: "tw" },
];

export const RANK_OPTIONS: SelectOption[] = [
  { label: "All ranks", value: "all" },
  { label: "Gold+", value: "gold_plus" },
  { label: "Platinum+", value: "platinum_plus" },
  { label: "Emerald+", value: "emerald_plus" },
  { label: "Diamond+", value: "diamond_plus" },
  { label: "Master+", value: "master_plus" },
];

export function sanitizeAppConfig(value: unknown): AppConfig {
  const record = asRecord(value);
  const migrated = migrateConfig(record);
  const weights = asRecord(migrated.weights);

  return {
    version: APP_CONFIG_VERSION,
    weights: {
      meta: clampNumber(weights.meta, 0, 1, DEFAULT_APP_CONFIG.weights.meta),
      laneCounter: clampNumber(
        weights.laneCounter,
        0,
        1,
        DEFAULT_APP_CONFIG.weights.laneCounter,
      ),
      teamCounter: clampNumber(
        weights.teamCounter,
        0,
        1,
        DEFAULT_APP_CONFIG.weights.teamCounter,
      ),
      synergy: clampNumber(weights.synergy, 0, 1, DEFAULT_APP_CONFIG.weights.synergy),
      compFit: clampNumber(weights.compFit, 0, 1, DEFAULT_APP_CONFIG.weights.compFit),
    },
    region: sanitizeOption(migrated.region, REGION_OPTIONS, DEFAULT_APP_CONFIG.region),
    rank: sanitizeOption(migrated.rank, RANK_OPTIONS, DEFAULT_APP_CONFIG.rank),
    topN: Math.round(clampNumber(migrated.topN, 3, 10, DEFAULT_APP_CONFIG.topN)),
    pickRateFloor: clampNumber(
      migrated.pickRateFloor,
      0,
      0.05,
      DEFAULT_APP_CONFIG.pickRateFloor,
    ),
    shrinkK: Math.round(clampNumber(migrated.shrinkK, 0, 10000, DEFAULT_APP_CONFIG.shrinkK)),
    minChipConfidence: clampNumber(
      migrated.minChipConfidence,
      0,
      1,
      DEFAULT_APP_CONFIG.minChipConfidence,
    ),
    favoriteTeams: sanitizeFavoriteTeams(migrated.favoriteTeams),
    proEvidenceEnabled: sanitizeBoolean(
      migrated.proEvidenceEnabled,
      DEFAULT_APP_CONFIG.proEvidenceEnabled,
    ),
    proInfluence: clampNumber(
      migrated.proInfluence,
      0,
      1,
      DEFAULT_APP_CONFIG.proInfluence,
    ),
  };
}

export function mergeAppConfig(current: AppConfig, patch: AppConfigPatch): AppConfig {
  return sanitizeAppConfig({
    ...current,
    ...patch,
    weights: {
      ...current.weights,
      ...patch.weights,
    },
  });
}

export function isWeightOnlyPatch(patch: AppConfigPatch): boolean {
  const keys = Object.keys(patch);
  return (
    keys.length > 0 &&
    keys.every((key) => key === "weights" || key === "proInfluence")
  );
}

function migrateConfig(record: Record<string, unknown>): Record<string, unknown> {
  const rawWeights = asRecord(record.weights);
  const laneCounter = rawWeights.laneCounter ?? rawWeights.counter;

  return {
    ...DEFAULT_APP_CONFIG,
    ...record,
    weights: {
      ...DEFAULT_APP_CONFIG.weights,
      ...rawWeights,
      ...(laneCounter === undefined ? {} : { laneCounter }),
    },
  };
}

function sanitizeOption(value: unknown, options: SelectOption[], fallback: string): string {
  return typeof value === "string" && options.some((option) => option.value === value)
    ? value
    : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sanitizeFavoriteTeams(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((team): team is string => typeof team === "string")
      .map((team) => team.trim())
      .filter(Boolean),
  )]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 12);
}
