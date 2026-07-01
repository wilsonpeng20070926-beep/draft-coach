import { mkdir, readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";
import type { ChampionRef } from "../../shared/types";

export interface ChampionCatalog {
  ready(): Promise<void>;
  refresh(): Promise<void>;
  version(): string;
  byId(championId: number): ChampionRef | null;
  bySlug(slug: string): ChampionRef | null;
  all(): ChampionRef[];
}

interface DataDragonChampion {
  key: string;
  id: string;
  name: string;
  tags: string[];
}

interface DataDragonChampionPayload {
  data: Record<string, DataDragonChampion>;
}

interface CatalogCache {
  version: string;
  champions: ChampionRef[];
}

const DATA_DRAGON_BASE_URL = "https://ddragon.leagueoflegends.com";
const CACHE_FILE_NAME = "champion-catalog.json";

export class DataDragonChampionCatalog implements ChampionCatalog {
  private currentVersion = "";
  private championsById = new Map<number, ChampionRef>();
  private championsBySlug = new Map<string, ChampionRef>();
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly cacheDirectory: string) {}

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.load();
    }

    return this.readyPromise;
  }

  async refresh(): Promise<void> {
    await this.refreshFromNetwork();
  }

  version(): string {
    return this.currentVersion;
  }

  byId(championId: number): ChampionRef | null {
    if (championId <= 0) {
      return null;
    }

    return this.championsById.get(championId) ?? null;
  }

  bySlug(slug: string): ChampionRef | null {
    return this.championsBySlug.get(slug) ?? null;
  }

  all(): ChampionRef[] {
    return [...this.championsById.values()];
  }

  private async load(): Promise<void> {
    const cache = await this.tryLoadCache();

    if (cache) {
      this.applyCache(cache);
      void this.refreshIfNeeded().catch((error: unknown) => {
        console.error("[Catalog] refresh failed", toError(error).message);
      });
      return;
    }

    try {
      await this.refreshFromNetwork();
    } catch (error) {
      console.error("[Catalog] failed to load Data Dragon catalog", toError(error).message);
    }
  }

  private async tryLoadCache(): Promise<CatalogCache | null> {
    try {
      const raw = await readFile(this.cachePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<CatalogCache>;

      if (
        typeof parsed.version === "string" &&
        Array.isArray(parsed.champions) &&
        parsed.champions.length > 0
      ) {
        return {
          version: parsed.version,
          champions: parsed.champions.filter(isChampionRef),
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  private async refreshIfNeeded(): Promise<void> {
    const latestVersion = await fetchLatestVersion();

    if (latestVersion !== this.currentVersion) {
      await this.refreshFromNetwork(latestVersion);
    }
  }

  private async refreshFromNetwork(version = ""): Promise<void> {
    const latestVersion = version || (await fetchLatestVersion());
    const payload = await fetchChampionPayload(latestVersion);
    const cache = createChampionCatalogCache(latestVersion, payload);
    this.applyCache(cache);
    await this.writeCache(cache);
  }

  private applyCache(cache: CatalogCache): void {
    this.currentVersion = cache.version;
    this.championsById = new Map(cache.champions.map((champion) => [champion.id, champion]));
    this.championsBySlug = new Map(cache.champions.map((champion) => [champion.slug, champion]));
  }

  private async writeCache(cache: CatalogCache): Promise<void> {
    await mkdir(this.cacheDirectory, { recursive: true });
    await writeFile(this.cachePath(), JSON.stringify(cache, null, 2), "utf8");
  }

  private cachePath(): string {
    return join(this.cacheDirectory, CACHE_FILE_NAME);
  }
}

export function createChampionCatalogFromDataDragonData(
  version: string,
  payload: DataDragonChampionPayload,
): ChampionCatalog {
  const cache = createChampionCatalogCache(version, payload);

  return new StaticChampionCatalog(cache);
}

function createChampionCatalogCache(
  version: string,
  payload: DataDragonChampionPayload,
): CatalogCache {
  const champions = Object.values(payload.data)
    .map((champion) => ({
      id: Number(champion.key),
      slug: champion.id,
      name: champion.name,
      tags: champion.tags,
      iconUrl: `${DATA_DRAGON_BASE_URL}/cdn/${version}/img/champion/${champion.id}.png`,
    }))
    .filter(isChampionRef)
    .sort((a, b) => a.id - b.id);

  return {
    version,
    champions,
  };
}

class StaticChampionCatalog implements ChampionCatalog {
  private readonly championsById: Map<number, ChampionRef>;
  private readonly championsBySlug: Map<string, ChampionRef>;

  constructor(private readonly cache: CatalogCache) {
    this.championsById = new Map(cache.champions.map((champion) => [champion.id, champion]));
    this.championsBySlug = new Map(cache.champions.map((champion) => [champion.slug, champion]));
  }

  async ready(): Promise<void> {
    return Promise.resolve();
  }

  async refresh(): Promise<void> {
    return Promise.resolve();
  }

  version(): string {
    return this.cache.version;
  }

  byId(championId: number): ChampionRef | null {
    if (championId <= 0) {
      return null;
    }

    return this.championsById.get(championId) ?? null;
  }

  bySlug(slug: string): ChampionRef | null {
    return this.championsBySlug.get(slug) ?? null;
  }

  all(): ChampionRef[] {
    return [...this.championsById.values()];
  }
}

async function fetchLatestVersion(): Promise<string> {
  const versions = await fetchJson<string[]>(`${DATA_DRAGON_BASE_URL}/api/versions.json`);
  const [latestVersion] = versions;

  if (!latestVersion) {
    throw new Error("Data Dragon did not return a current version");
  }

  return latestVersion;
}

async function fetchChampionPayload(version: string): Promise<DataDragonChampionPayload> {
  return fetchJson<DataDragonChampionPayload>(
    `${DATA_DRAGON_BASE_URL}/cdn/${version}/data/en_US/champion.json`,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    get(url, (response) => {
      const { statusCode = 0 } = response;
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Data Dragon request failed with status ${statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body) as T);
        } catch (error) {
          reject(toError(error));
        }
      });
    }).on("error", reject);
  });
}

function isChampionRef(value: unknown): value is ChampionRef {
  if (!value || typeof value !== "object") {
    return false;
  }

  const champion = value as Partial<ChampionRef>;

  return (
    typeof champion.id === "number" &&
    Number.isFinite(champion.id) &&
    champion.id > 0 &&
    typeof champion.slug === "string" &&
    typeof champion.name === "string" &&
    Array.isArray(champion.tags) &&
    champion.tags.every((tag) => typeof tag === "string") &&
    typeof champion.iconUrl === "string"
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
