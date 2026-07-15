import type { DamageStyle } from "../../shared/championAttributes";
import type { ChampionRef, Role } from "../../shared/types";

export type RoleFit = Record<Role, number>;

export interface LaneMetaEntry {
  champion: ChampionRef;
  winRate: number;
  tier: number;
  dataQuality?: "observed" | "target-fallback" | "pro-supported" | "catalog-fallback";
  pickRate?: number;
  play?: number;
  roleRate?: number;
}

export interface MatchupResult {
  winRate: number | null;
  sampleNote?: string;
}

export interface SynergyResult {
  score: number | null;
  winRate?: number;
  sampleSize?: number;
  notable?: boolean;
  tier?: number | null;
  confidence?: number;
}

export interface ChampionAnalysis {
  damageStyle: DamageStyle;
  synergies: ChampionSynergyAnalysis[];
}

export interface ChampionSynergyAnalysis {
  championId: number;
  championName: string;
  partnerChampionId: number;
  partnerChampionName: string;
  partnerPosition: Role | null;
  score: number;
  confidence: number;
  winRate?: number;
  sampleSize?: number;
  tier?: number | null;
  notable?: boolean;
}

export interface MetaDataSource {
  getLaneMeta(role: Role, region: string, rank: string): Promise<LaneMetaEntry[]>;
  getMatchup(
    candidate: ChampionRef,
    opponent: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<MatchupResult>;
  getSynergy(
    a: ChampionRef,
    b: ChampionRef,
    region: string,
    rank: string,
    aRole?: Role | null,
    bRole?: Role | null,
  ): Promise<SynergyResult>;
  getChampionRoleFit(champion: ChampionRef, region: string, rank: string): Promise<RoleFit>;
  getChampionAnalysis?(
    champion: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<ChampionAnalysis>;
}
