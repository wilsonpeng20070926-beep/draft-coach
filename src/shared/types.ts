export type Role = "top" | "jungle" | "middle" | "bottom" | "utility";

export interface ChampionRef {
  id: number;
  slug: string;
  name: string;
  tags: string[];
  iconUrl: string;
}

export interface DraftPlayer {
  cellId: number;
  role: Role | null;
  champion: ChampionRef | null;
  isLocalPlayer: boolean;
  roleSource?: "assigned" | "inferred";
  roleConfidence?: number;
}

export interface DraftState {
  phase: "none" | "champSelect" | "inProgress" | "other";
  allies: DraftPlayer[];
  enemies: DraftPlayer[];
  bans: ChampionRef[];
  localPlayer: DraftPlayer | null;
  laneOpponent: DraftPlayer | null;
}

export interface ScoreContribution {
  factor: string;
  score: number;
  reasons: string[];
  delta?: number;
  effectiveDelta?: number;
  confidence?: number;
  reasonChips?: ReasonChip[];
  breakdown?: FactorBreakdown[];
}

export type ReasonKind = "meta" | "lane-counter" | "team-counter" | "synergy" | "comp-fit" | "warning";

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
}

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
  loading: boolean;
  limitedDataNote: string | null;
  teamContext: TeamContextProjection | null;
}
