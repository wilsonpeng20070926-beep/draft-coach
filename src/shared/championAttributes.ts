import type { ChampionRef } from "./types";

export type DamageStyle = "ad" | "ap" | "hybrid" | "true" | "unknown";
export type ChampionRange = "melee" | "ranged" | "mixed" | "unknown";
export type PowerCurve = "early" | "mid" | "late" | "flat" | "unknown";

export interface ChampionAttributes {
  championId: number;
  damageStyle: DamageStyle;
  engage: number;
  peel: number;
  frontline: number;
  poke: number;
  waveclear: number;
  cc: number;
  mobility: number;
  range: ChampionRange;
  powerCurve: PowerCurve;
  carryPotential: number;
  primaryClass: string;
  attributeConfidence: number;
}

export interface TeamComposition {
  adWeight: number;
  apWeight: number;
  engage: number;
  peel: number;
  frontline: number;
  poke: number;
  waveclear: number;
  cc: number;
  mobility: number;
  carryPotential: number;
  rangedCount: number;
  powerCurve: {
    early: number;
    mid: number;
    late: number;
  };
  championCount: number;
  averageRoleConfidence: number;
  averageAttributeConfidence: number;
}

export type CompNeedKind =
  | "ap"
  | "ad"
  | "frontline"
  | "engage"
  | "peel"
  | "cc"
  | "waveclear"
  | "range";

export interface CompNeed {
  kind: CompNeedKind;
  severity: number;
}

export type CompThreatKind =
  | "dive"
  | "burst-ap"
  | "burst-ad"
  | "poke"
  | "hard-engage"
  | "scaling-carry";

export interface CompThreat {
  kind: CompThreatKind;
  severity: number;
}

export interface TeamContext {
  ally: TeamComposition;
  enemy: TeamComposition;
  allyNeeds: CompNeed[];
  enemyThreats: CompThreat[];
  confidence: number;
}

export type GetChampionAttributes = (
  champion: ChampionRef,
  damageStyle?: DamageStyle | null,
) => ChampionAttributes;
