import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { APP_VERSION } from "../../../shared/appInfo";
import type {
  ProDataSnapshot,
  ProDataStatus,
} from "../../../shared/proData";
import { canonicalStringify } from "./checksum";
import { validateProDataSnapshot } from "./validation";

export interface ProDataSource {
  start(): Promise<void>;
  stop(): void;
  getSnapshot(): ProDataSnapshot | null;
  getStatus(): ProDataStatus;
  refresh(reason?: "startup" | "interval" | "manual"): Promise<ProDataSnapshot | null>;
}

export interface StaticProDataSourceOptions {
  cacheDirectory: string;
  remoteUrl: string;
  enabled?: boolean;
  networkAllowed?: boolean;
  staleAfterMs?: number;
  refreshIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: ProSnapshotFetch;
  now?: () => Date;
  allowDirectFallback?: boolean;
  directFallback?: () => Promise<ProDataSnapshot>;
  directFallbackMinIntervalMs?: number;
  onStatusChanged?: (status: ProDataStatus) => void;
}

export type ProSnapshotFetch = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const CACHE_FILE = "pro-snapshot.json";
const DEFAULT_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const DEFAULT_REFRESH_INTERVAL_MS = 2.5 * 60 * 60 * 1000;
const DEFAULT_DIRECT_FALLBACK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class StaticSnapshotProDataSource implements ProDataSource {
  private snapshot: ProDataSnapshot | null = null;
  private status: ProDataStatus;
  private refreshPromise: Promise<ProDataSnapshot | null> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private etag: string | null = null;
  private readonly enabled: boolean;
  private readonly networkAllowed: boolean;
  private readonly staleAfterMs: number;
  private readonly refreshIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ProSnapshotFetch;
  private readonly now: () => Date;
  private readonly directFallbackMinIntervalMs: number;
  private lastDirectFallbackAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: StaticProDataSourceOptions) {
    this.enabled = options.enabled ?? true;
    this.networkAllowed = options.networkAllowed ?? true;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? (fetch as ProSnapshotFetch);
    this.now = options.now ?? (() => new Date());
    this.directFallbackMinIntervalMs =
      options.directFallbackMinIntervalMs ??
      DEFAULT_DIRECT_FALLBACK_MIN_INTERVAL_MS;
    this.status = emptyStatus(this.enabled ? "ranked-only" : "disabled");
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      this.status = emptyStatus("disabled");
      this.emitStatus();
      return;
    }

    await this.loadLastKnownGood();
    this.updateReadyStatus();

    if (this.networkAllowed && this.isStale()) {
      void this.refresh("startup");
    }

    if (this.networkAllowed && this.refreshIntervalMs > 0 && !this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void this.refresh("interval");
      }, this.refreshIntervalMs);
      this.refreshTimer.unref?.();
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getSnapshot(): ProDataSnapshot | null {
    return this.snapshot;
  }

  getStatus(): ProDataStatus {
    return { ...this.status };
  }

  refresh(
    _reason: "startup" | "interval" | "manual" = "manual",
  ): Promise<ProDataSnapshot | null> {
    if (!this.enabled) {
      this.status = emptyStatus("disabled");
      this.emitStatus();
      return Promise.resolve(this.snapshot);
    }

    if (!this.networkAllowed) {
      this.updateReadyStatus();
      return Promise.resolve(this.snapshot);
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.status = {
      ...this.status,
      state: "refreshing",
      lastError: null,
    };
    this.emitStatus();
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async performRefresh(): Promise<ProDataSnapshot | null> {
    try {
      const downloaded = await this.downloadSnapshot();

      if (!downloaded) {
        this.updateReadyStatus();
        return this.snapshot;
      }

      await this.persistAtomically(downloaded);
      this.snapshot = downloaded;
      this.updateReadyStatus();
      return downloaded;
    } catch (error) {
      if (this.options.allowDirectFallback && this.options.directFallback) {
        try {
          const currentTime = this.now().getTime();

          if (
            currentTime - this.lastDirectFallbackAt <
            this.directFallbackMinIntervalMs
          ) {
            throw new Error("direct-source fallback is rate-limited");
          }

          this.lastDirectFallbackAt = currentTime;
          const fallback = await this.options.directFallback();
          const validated = this.validate(fallback);
          await this.persistAtomically(validated);
          this.snapshot = validated;
          this.updateReadyStatus();
          return validated;
        } catch (fallbackError) {
          this.setError(`${toError(error).message}; fallback: ${toError(fallbackError).message}`);
          return this.snapshot;
        }
      }

      this.setError(toError(error).message);
      return this.snapshot;
    }
  }

  private async downloadSnapshot(): Promise<ProDataSnapshot | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.options.remoteUrl, {
        method: "GET",
        headers: {
          Accept: "application/json, application/gzip",
          "User-Agent": `DraftCoach-Desktop/${APP_VERSION}`,
          ...(this.etag ? { "If-None-Match": this.etag } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 304) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Professional snapshot request failed with status ${response.status}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const decoded = isGzip(bytes) ? gunzipSync(bytes) : bytes;
      const parsed = JSON.parse(decoded.toString("utf8")) as unknown;
      const snapshot = this.validate(parsed);
      this.etag = response.headers.get("etag") ?? this.etag;
      return snapshot;
    } finally {
      clearTimeout(timeout);
    }
  }

  private validate(value: unknown): ProDataSnapshot {
    const result = validateProDataSnapshot(value, {
      now: this.now(),
      previousGameCount: this.snapshot?.metadata.gameCount,
    });

    if (!result.valid || !result.snapshot) {
      throw new Error(result.errors.join("; "));
    }

    return result.snapshot;
  }

  private async loadLastKnownGood(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath(), "utf8")) as unknown;
      const result = validateProDataSnapshot(parsed, { now: this.now() });

      if (result.valid && result.snapshot) {
        this.snapshot = result.snapshot;
      }
    } catch {
      this.snapshot = null;
    }
  }

  private async persistAtomically(snapshot: ProDataSnapshot): Promise<void> {
    await mkdir(this.options.cacheDirectory, { recursive: true });
    const temporaryPath = `${this.cachePath()}.${process.pid}.${Date.now()}.tmp`;

    try {
      await writeFile(temporaryPath, `${canonicalStringify(snapshot)}\n`, "utf8");
      await rename(temporaryPath, this.cachePath());
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private updateReadyStatus(): void {
    if (!this.snapshot) {
      this.status = emptyStatus("ranked-only");
      this.emitStatus();
      return;
    }

    this.status = {
      state: this.isStale() ? "stale" : "ready",
      source: this.snapshot.metadata.source,
      generatedAt: this.snapshot.metadata.generatedAt,
      gameCount: this.snapshot.metadata.gameCount,
      lastError: null,
    };
    this.emitStatus();
  }

  private setError(message: string): void {
    this.status = {
      state: this.snapshot ? (this.isStale() ? "stale" : "ready") : "error",
      source: this.snapshot?.metadata.source ?? null,
      generatedAt: this.snapshot?.metadata.generatedAt ?? null,
      gameCount: this.snapshot?.metadata.gameCount ?? 0,
      lastError: message,
    };
    this.emitStatus();
  }

  private isStale(): boolean {
    if (!this.snapshot) {
      return true;
    }

    return (
      this.now().getTime() - Date.parse(this.snapshot.metadata.generatedAt) >=
      this.staleAfterMs
    );
  }

  private cachePath(): string {
    return join(this.options.cacheDirectory, CACHE_FILE);
  }

  private emitStatus(): void {
    this.options.onStatusChanged?.(this.getStatus());
  }
}

function emptyStatus(state: ProDataStatus["state"]): ProDataStatus {
  return {
    state,
    source: null,
    generatedAt: null,
    gameCount: 0,
    lastError: null,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
