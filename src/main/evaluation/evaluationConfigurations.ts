import {
  DEFAULT_APP_CONFIG,
  type FactorWeights,
} from "../../shared/config";

export type EvaluationConfigurationId =
  | "ranked-only"
  | "current-engine"
  | "blended-default"
  | "pro-forward";

export interface EvaluationConfiguration {
  id: EvaluationConfigurationId;
  label: string;
  description: string;
  weights: FactorWeights;
  proEvidenceEnabled: boolean;
  proInfluence: number;
}

export const EVALUATION_CONFIGURATIONS: readonly EvaluationConfiguration[] = [
  {
    id: "ranked-only",
    label: "Ranked-only",
    description: "Pure ranked meta anchor with draft and professional deltas disabled.",
    weights: {
      meta: 1,
      laneCounter: 0,
      teamCounter: 0,
      synergy: 0,
      compFit: 0,
    },
    proEvidenceEnabled: false,
    proInfluence: 0,
  },
  {
    id: "current-engine",
    label: "Current ranked engine",
    description: "Production draft-aware ranked factors with professional evidence disabled.",
    weights: { ...DEFAULT_APP_CONFIG.weights },
    proEvidenceEnabled: false,
    proInfluence: 0,
  },
  {
    id: "blended-default",
    label: "Blended default",
    description: "Production draft-aware ranked factors and confidence-shrunk pro evidence.",
    weights: { ...DEFAULT_APP_CONFIG.weights },
    proEvidenceEnabled: true,
    proInfluence: DEFAULT_APP_CONFIG.proInfluence,
  },
  {
    id: "pro-forward",
    label: "Pro-forward",
    description: "Sensitivity configuration with compressed ranked factors and maximum supported pro influence.",
    weights: {
      meta: 0.35,
      laneCounter: 0.3,
      teamCounter: 0.2,
      synergy: 0.3,
      compFit: 0.2,
    },
    proEvidenceEnabled: true,
    proInfluence: 1,
  },
] as const;

export function evaluationConfiguration(
  id: EvaluationConfigurationId,
): EvaluationConfiguration {
  const configuration = EVALUATION_CONFIGURATIONS.find((item) => item.id === id);

  if (!configuration) {
    throw new Error(`Unknown evaluation configuration ${id}`);
  }

  return configuration;
}
