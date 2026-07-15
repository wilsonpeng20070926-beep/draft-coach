import type { ChampionCatalog } from "../catalog/championCatalog";
import type { ChampionRef, Role } from "../../shared/types";
import type {
  ChampionAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "./metaDataSource";

const roles: Role[] = ["top", "jungle", "middle", "bottom", "utility"];
const minimumRolePresence = 0.05;

/**
 * A deliberately neutral, tag-derived source used only when live OP.GG data and
 * its last-known-good cache are both unavailable. It keeps champ select usable
 * without pretending that catalog tags are observed ranked statistics.
 */
export class CatalogFallbackMetaDataSource implements MetaDataSource {
  constructor(private readonly catalog: ChampionCatalog) {}

  async getLaneMeta(role: Role): Promise<LaneMetaEntry[]> {
    return this.catalog
      .all()
      .map((champion) => ({ champion, fit: createCatalogRoleFit(champion) }))
      .map(({ champion, fit }) => ({
        champion,
        roleRate: normalizedRolePresence(fit, role),
      }))
      .filter(({ roleRate }) => roleRate >= minimumRolePresence)
      .sort((left, right) =>
        right.roleRate - left.roleRate || left.champion.name.localeCompare(right.champion.name),
      )
      .map(({ champion, roleRate }, index) => ({
        champion,
        winRate: 0.5,
        tier: 5 + Math.floor(index / 10),
        pickRate: Math.max(0.005, roleRate * 0.01),
        roleRate,
        dataQuality: "catalog-fallback" as const,
      }));
  }

  async getMatchup(): Promise<MatchupResult> {
    return { winRate: null };
  }

  async getSynergy(): Promise<SynergyResult> {
    return { score: null, notable: false };
  }

  async getChampionRoleFit(champion: ChampionRef): Promise<RoleFit> {
    return normalizeRoleFit(createCatalogRoleFit(champion));
  }

  async getChampionAnalysis(): Promise<ChampionAnalysis> {
    return { damageStyle: "unknown", synergies: [] };
  }
}

export class ResilientMetaDataSource implements MetaDataSource {
  constructor(
    private readonly primary: MetaDataSource,
    private readonly fallback: MetaDataSource,
  ) {}

  getLaneMeta(role: Role, region: string, rank: string): Promise<LaneMetaEntry[]> {
    return this.withFallback(
      () => this.primary.getLaneMeta(role, region, rank),
      () => this.fallback.getLaneMeta(role, region, rank),
    );
  }

  getMatchup(
    candidate: ChampionRef,
    opponent: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<MatchupResult> {
    return this.withFallback(
      () => this.primary.getMatchup(candidate, opponent, role, region, rank),
      () => this.fallback.getMatchup(candidate, opponent, role, region, rank),
    );
  }

  getSynergy(
    a: ChampionRef,
    b: ChampionRef,
    region: string,
    rank: string,
    aRole?: Role | null,
    bRole?: Role | null,
  ): Promise<SynergyResult> {
    return this.withFallback(
      () => this.primary.getSynergy(a, b, region, rank, aRole, bRole),
      () => this.fallback.getSynergy(a, b, region, rank, aRole, bRole),
    );
  }

  getChampionRoleFit(
    champion: ChampionRef,
    region: string,
    rank: string,
  ): Promise<RoleFit> {
    return this.withFallback(
      () => this.primary.getChampionRoleFit(champion, region, rank),
      () => this.fallback.getChampionRoleFit(champion, region, rank),
    );
  }

  getChampionAnalysis(
    champion: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<ChampionAnalysis> {
    return this.withFallback(
      () =>
        this.primary.getChampionAnalysis
          ? this.primary.getChampionAnalysis(champion, role, region, rank)
          : Promise.reject(new Error("Primary source has no champion analysis")),
      () =>
        this.fallback.getChampionAnalysis
          ? this.fallback.getChampionAnalysis(champion, role, region, rank)
          : Promise.resolve({ damageStyle: "unknown", synergies: [] }),
    );
  }

  private async withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      console.warn("[RankedData] using catalog fallback", toError(error).message);
      return fallback();
    }
  }
}

export function createCatalogRoleFit(champion: ChampionRef): RoleFit {
  const fit = emptyRoleFit();

  if (champion.tags.includes("Marksman")) {
    fit.bottom = 1;
    fit.middle = 0.25;
  }

  if (champion.tags.includes("Support")) {
    fit.utility = Math.max(fit.utility, 1);
    fit.bottom = Math.max(fit.bottom, 0.25);
  }

  if (champion.tags.includes("Mage")) {
    fit.middle = Math.max(fit.middle, 1);
    fit.utility = Math.max(fit.utility, 0.35);
  }

  if (champion.tags.includes("Assassin")) {
    fit.middle = Math.max(fit.middle, 1);
    fit.jungle = Math.max(fit.jungle, 0.35);
  }

  if (champion.tags.includes("Fighter")) {
    fit.top = Math.max(fit.top, 1);
    fit.jungle = Math.max(fit.jungle, 0.55);
  }

  if (champion.tags.includes("Tank")) {
    fit.top = Math.max(fit.top, 1);
    fit.utility = Math.max(fit.utility, 0.45);
    fit.jungle = Math.max(fit.jungle, 0.35);
  }

  if (sumFit(fit) <= 0) {
    fit.middle = 1;
  }

  return fit;
}

function normalizedRolePresence(fit: RoleFit, role: Role): number {
  const sum = sumFit(fit);
  return sum <= 0 ? 0 : fit[role] / sum;
}

function normalizeRoleFit(fit: RoleFit): RoleFit {
  const sum = sumFit(fit);

  if (sum <= 0) {
    return emptyRoleFit();
  }

  return {
    top: fit.top / sum,
    jungle: fit.jungle / sum,
    middle: fit.middle / sum,
    bottom: fit.bottom / sum,
    utility: fit.utility / sum,
  };
}

function emptyRoleFit(): RoleFit {
  return { top: 0, jungle: 0, middle: 0, bottom: 0, utility: 0 };
}

function sumFit(fit: RoleFit): number {
  return roles.reduce((sum, role) => sum + fit[role], 0);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
