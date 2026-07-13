export type Role = "top" | "jungle" | "middle" | "bottom" | "utility";

export interface ChampionRef {
  id: number;
  slug: string;
  name: string;
  tags: string[];
  iconUrl: string;
}

export type PickState = "empty" | "hovering" | "locked";

export interface DraftPlayer {
  cellId: number;
  side: "ally" | "enemy";
  role: Role | null;
  champion: ChampionRef | null;
  pickState: PickState;
  isLocalPlayer: boolean;
  roleSource?: "assigned" | "inferred" | "manual";
  roleConfidence?: number;
}

export interface DraftPickAction {
  id: number | null;
  groupIndex: number;
  order: number;
  actorCellId: number;
  championId: number;
  completed: boolean;
  isInProgress: boolean;
}

export interface DraftTarget {
  side: "ally" | "enemy";
  cellId: number;
  role: Role;
  source: "automatic" | "manual" | "simulation";
  purpose: "recommend" | "anticipate";
}

export interface AnticipatedThreat {
  champion: ChampionRef;
  role: Role | null;
  source: "forecast" | "manual" | "simulation";
  confidence: number;
  targetCellId?: number;
  pinned?: boolean;
  evidence?: string[];
}

export interface DraftState {
  phase: "none" | "champSelect" | "inProgress" | "other";
  allies: DraftPlayer[];
  enemies: DraftPlayer[];
  bans: ChampionRef[];
  pickActions: DraftPickAction[];
  activeAllyPickCellIds: number[];
  localPlayer: DraftPlayer | null;
}

import type { ProEvidenceRecord } from "./proData";

export type EvidenceSource = "ranked" | "pro";

export interface ScoreContribution {
  factor: string;
  score: number;
  reasons: string[];
  delta?: number;
  effectiveDelta?: number;
  confidence?: number;
  reasonChips?: ReasonChip[];
  breakdown?: FactorBreakdown[];
  source?: EvidenceSource;
  proEvidence?: ProEvidenceRecord[];
}

export type ReasonKind = "meta" | "lane-counter" | "team-counter" | "synergy" | "comp-fit" | "pro" | "warning";

export interface ReasonChip {
  kind: ReasonKind;
  text: string;
  polarity: "positive" | "negative" | "neutral";
  strength: number;
  confidence: number;
}

export interface FactorContribution {
  factor: string;
  delta: number;
  confidence: number;
  reasons: ReasonChip[];
  breakdown?: FactorBreakdown[];
  source?: EvidenceSource;
  proEvidence?: ProEvidenceRecord[];
}

export interface FactorBreakdown {
  kind: ReasonKind;
  label: string;
  value: number;
  confidence: number;
  polarity?: ReasonChip["polarity"];
  strength?: number;
  championId?: number;
  championName?: string;
  tier?: number | null;
  sampleSize?: number;
  winRate?: number;
}

export interface Recommendation {
  champion: ChampionRef;
  total: number;
  contributions: ScoreContribution[];
  risk: RecommendationRisk | null;
}

export type RecommendationCategoryKey =
  | "overall"
  | "lane"
  | "synergy"
  | "composition"
  | "pro"
  | "risk";

export interface RecommendationCategory {
  key: RecommendationCategoryKey;
  label: string;
  recommendations: Recommendation[];
}

export type RecommendationRiskLabel = "Avoid" | "High risk" | "Poor fit";

export interface RecommendationRisk {
  label: RecommendationRiskLabel;
  confidence: number;
  reasons: string[];
  traceableFactors: string[];
}

export interface EvidenceBalance {
  rankedPercent: number;
  proPercent: number;
  rankedMagnitude: number;
  proMagnitude: number;
}

export interface PickEvaluation {
  champion: ChampionRef;
  state: Extract<PickState, "hovering" | "locked">;
  total: number;
  strengths: string[];
  risks: string[];
  teamFit: string[];
  evidence: ScoreContribution[];
}

export interface SimulationSnapshot {
  draft: DraftState;
  target: DraftTarget | null;
  threats: AnticipatedThreat[];
}

export interface DraftSimulationState extends SimulationSnapshot {
  history: SimulationSnapshot[];
}

export type SimulationCommand =
  | {
      type: "assignRole";
      side: DraftPlayer["side"];
      cellId: number;
      role: Role | null;
    }
  | {
      type: "setPick";
      side: DraftPlayer["side"];
      cellId: number;
      championId: number;
      pickState: PickState;
    }
  | {
      type: "clearPick";
      side: DraftPlayer["side"];
      cellId: number;
    }
  | { type: "ban"; championId: number }
  | { type: "unban"; championId: number }
  | {
      type: "setTarget";
      side: DraftPlayer["side"];
      cellId: number;
      role?: Role | null;
    }
  | {
      type: "pinThreat";
      championId: number;
      role?: Role | null;
      source?: AnticipatedThreat["source"];
      confidence?: number;
    }
  | { type: "removeThreat"; championId: number }
  | { type: "undo" }
  | { type: "reset" };

export interface TeamContextProjection {
  allyDamage: {
    ad: number;
    ap: number;
    knownCount: number;
  };
  needs: Array<{
    kind: string;
    severity: number;
    satisfied: boolean;
  }>;
  enemyThreats: Array<{
    kind: string;
    severity: number;
  }>;
  confidence: number;
}

export interface RecommendationUpdate {
  recommendations: Recommendation[];
  categories: RecommendationCategory[];
  evidenceBalance: EvidenceBalance;
  targets: DraftTarget[];
  target: DraftTarget | null;
  evaluation: PickEvaluation | null;
  threats: AnticipatedThreat[];
  loading: boolean;
  limitedDataNote: string | null;
  teamContext: TeamContextProjection | null;
}
