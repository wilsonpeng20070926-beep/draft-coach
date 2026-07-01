import type { ChampionRef, Role } from "../../shared/types";
import type {
  ChampionAnalysis,
  LaneMetaEntry,
  MatchupResult,
  MetaDataSource,
  RoleFit,
  SynergyResult,
} from "./metaDataSource";

interface CachedMetaDataSourceOptions {
  ttlMs: number;
  patchVersion: string;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class CachedMetaDataSource implements MetaDataSource {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly source: MetaDataSource,
    private readonly options: CachedMetaDataSourceOptions,
  ) {}

  getLaneMeta(role: Role, region: string, rank: string): Promise<LaneMetaEntry[]> {
    return this.getOrSet(["laneMeta", role, region, rank], () =>
      this.source.getLaneMeta(role, region, rank),
    );
  }

  getMatchup(
    candidate: ChampionRef,
    opponent: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<MatchupResult> {
    return this.getOrSet(
      ["matchup", candidate.id, opponent.id, role, region, rank],
      () => this.source.getMatchup(candidate, opponent, role, region, rank),
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
    return this.getOrSet(["synergy", a.id, b.id, region, rank, aRole ?? "none", bRole ?? "none"], () =>
      this.source.getSynergy(a, b, region, rank, aRole, bRole),
    );
  }

  getChampionRoleFit(champion: ChampionRef, region: string, rank: string): Promise<RoleFit> {
    return this.getOrSet(["roleFit", champion.id, region, rank], () =>
      this.source.getChampionRoleFit(champion, region, rank),
    );
  }

  getChampionAnalysis(
    champion: ChampionRef,
    role: Role,
    region: string,
    rank: string,
  ): Promise<ChampionAnalysis> {
    return this.getOrSet(["analysis", champion.id, role, region, rank], async () => {
      if (!this.source.getChampionAnalysis) {
        return { damageStyle: "unknown", synergies: [] };
      }

      return this.source.getChampionAnalysis(champion, role, region, rank);
    });
  }

  private async getOrSet<T>(keyParts: ReadonlyArray<string | number>, load: () => Promise<T>): Promise<T> {
    const key = this.createKey(keyParts);
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const pending = this.pending.get(key) as Promise<T> | undefined;

    if (pending) {
      return pending;
    }

    const promise = load()
      .then((value) => {
        this.cache.set(key, {
          expiresAt: Date.now() + this.options.ttlMs,
          value,
        });

        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  private createKey(keyParts: ReadonlyArray<string | number>): string {
    return JSON.stringify([this.options.patchVersion, ...keyParts]);
  }
}
