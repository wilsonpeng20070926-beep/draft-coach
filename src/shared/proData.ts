import type { Role } from "./types";

export const PRO_RAW_SCHEMA_VERSION = 1;
export const PRO_SNAPSHOT_SCHEMA_VERSION = 1;

export type ProSide = "blue" | "red";
export type CompetitionTier = "international" | "major" | "included";

export interface ProDraftPick {
  order: number;
  side: ProSide;
  role: Role;
  championId: number;
}

export interface ProDraftBan {
  order: number;
  side: ProSide;
  championId: number;
}

export interface NormalizedProDraft {
  schemaVersion: typeof PRO_RAW_SCHEMA_VERSION;
  gameId: string;
  patch: string;
  playedAt: string;
  competition: string;
  competitionTier: CompetitionTier;
  stage: string | null;
  format: string | null;
  fearless: boolean | null;
  blueTeam: string;
  redTeam: string;
  winner: ProSide;
  picks: ProDraftPick[];
  bans: ProDraftBan[];
}

export interface RawProDraftCollection {
  schemaVersion: typeof PRO_RAW_SCHEMA_VERSION;
  generatedAt: string;
  source: string;
  sourceUrl: string;
  checksumAlgorithm: "sha256";
  checksum: string;
  coveredPatches: string[];
  competitions: string[];
  gameCount: number;
  complete: boolean;
  warnings: string[];
  etag: string | null;
  drafts: NormalizedProDraft[];
}

export interface ProSnapshotMetadata {
  schemaVersion: typeof PRO_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  source: string;
  sourceUrl: string;
  attribution: string;
  checksumAlgorithm: "sha256";
  checksum: string;
  coveredPatches: string[];
  competitions: string[];
  gameCount: number;
  complete: boolean;
  warnings: string[];
}

export interface ChampionRoleAggregate {
  patch: string;
  competition: string;
  championId: number;
  role: Role;
  picks: number;
  wins: number;
  bans: number;
  opportunities: number;
  flexRoleCount: number;
}

export interface ChampionPairAggregate {
  patch: string;
  competition: string;
  championAId: number;
  roleA: Role;
  championBId: number;
  roleB: Role;
  games: number;
  wins: number;
}

export interface ChampionOpponentAggregate {
  patch: string;
  competition: string;
  championId: number;
  opponentChampionId: number;
  role: Role;
  opponentRole: Role;
  sameRole: boolean;
  games: number;
  wins: number;
}

export interface TeamChampionAggregate {
  patch: string;
  competition: string;
  team: string;
  championId: number;
  role: Role;
  picks: number;
  wins: number;
}

export interface TeamPairAggregate {
  patch: string;
  competition: string;
  team: string;
  championAId: number;
  roleA: Role;
  championBId: number;
  roleB: Role;
  games: number;
  wins: number;
}

export interface TeamResponseAggregate {
  patch: string;
  competition: string;
  team: string;
  enemyChampionId: number;
  enemyRole: Role;
  responseChampionId: number;
  responseRole: Role;
  games: number;
  wins: number;
}

export interface CompactDraftRecord {
  gameId: string;
  patch: string;
  playedAt: string;
  competition: string;
  competitionTier: CompetitionTier;
  stage: string | null;
  format: string | null;
  blueTeam: string;
  redTeam: string;
  winner: ProSide;
  picks: Array<[number, ProSide, Role, number]>;
  bans: Array<[number, ProSide, number]>;
  fearless: boolean | null;
}

export interface ProDataSnapshot {
  metadata: ProSnapshotMetadata;
  championRoles: ChampionRoleAggregate[];
  championPairs: ChampionPairAggregate[];
  championOpponents: ChampionOpponentAggregate[];
  teamChampions: TeamChampionAggregate[];
  teamPairs: TeamPairAggregate[];
  teamResponses: TeamResponseAggregate[];
  draftRecords: CompactDraftRecord[];
}

export interface ProDataStatus {
  state: "disabled" | "ranked-only" | "ready" | "stale" | "refreshing" | "error";
  source: string | null;
  generatedAt: string | null;
  gameCount: number;
  lastError: string | null;
}

export type ProEvidenceKind =
  | "priority"
  | "role-presence"
  | "flex"
  | "synergy"
  | "matchup"
  | "response"
  | "composition"
  | "success"
  | "team-tendency";

export interface ProEvidenceStatistics {
  picks?: number;
  bans?: number;
  wins?: number;
  games?: number;
  opportunities?: number;
  rate?: number;
  lift?: number;
  roleCount?: number;
}

export interface ProEvidenceRecord {
  kind: ProEvidenceKind;
  text: string;
  statistics: ProEvidenceStatistics;
  patches: string[];
  competitions: string[];
  teams: string[];
  effectiveSample: number;
  confidence: number;
  ageDays: number;
  material: boolean;
}

export interface ProSignal {
  value: number;
  confidence: number;
  effectiveSample: number;
  material: boolean;
  evidence: ProEvidenceRecord[];
}

export interface ProCandidateAnalysis {
  championId: number;
  role: Role;
  priority: ProSignal;
  rolePresence: ProSignal;
  flex: ProSignal;
  synergy: ProSignal;
  matchup: ProSignal;
  response: ProSignal;
  composition: ProSignal;
  success: ProSignal;
  favorite: ProSignal;
  overallStrength: number;
  proInspiredStrength: number;
  evidence: ProEvidenceRecord[];
}
