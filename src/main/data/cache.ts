import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  cacheFile?: string;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface PersistedCache {
  schemaVersion: 1;
  patchVersion: string;
  entries: Record<string, CacheEntry<unknown>>;
}

export class CachedMetaDataSource implements MetaDataSource {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private loadPromise: Promise<void> | null = null;
  private persistPromise: Promise<void> = Promise.resolve();

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
    await this.ensureLoaded();
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
      .then(async (value) => {
        this.cache.set(key, {
          expiresAt: Date.now() + this.options.ttlMs,
          value,
        });
        await this.persist();
        return value;
      })
      .catch((error) => {
        if (cached) {
          console.warn("[RankedData] live refresh failed; using stale local cache", toError(error).message);
          return cached.value;
        }

        throw error;
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

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadPersistedCache();
    }

    return this.loadPromise;
  }

  private async loadPersistedCache(): Promise<void> {
    const cacheFile = this.options.cacheFile;

    if (!cacheFile) {
      return;
    }

    try {
      const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as Partial<PersistedCache>;

      if (
        parsed.schemaVersion !== 1 ||
        parsed.patchVersion !== this.options.patchVersion ||
        !parsed.entries ||
        typeof parsed.entries !== "object"
      ) {
        return;
      }

      for (const [key, entry] of Object.entries(parsed.entries)) {
        if (isCacheEntry(entry)) {
          this.cache.set(key, entry);
        }
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.warn("[RankedData] local cache could not be read", toError(error).message);
      }
    }
  }

  private persist(): Promise<void> {
    const cacheFile = this.options.cacheFile;

    if (!cacheFile) {
      return Promise.resolve();
    }

    this.persistPromise = this.persistPromise.then(async () => {
      const payload: PersistedCache = {
        schemaVersion: 1,
        patchVersion: this.options.patchVersion,
        entries: Object.fromEntries(this.cache),
      };
      const temporaryFile = `${cacheFile}.tmp`;

      try {
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(temporaryFile, `${JSON.stringify(payload)}\n`, "utf8");
        await rename(temporaryFile, cacheFile);
      } catch (error) {
        console.warn("[RankedData] local cache could not be saved", toError(error).message);
      }
    });

    return this.persistPromise;
  }
}

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<CacheEntry<unknown>>;
  return typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt) && "value" in entry;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
