import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { DataDragonChampionCatalog } from "../src/main/catalog/championCatalog";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import {
  calculateProSnapshotChecksum,
  calculateRawProDraftChecksum,
  canonicalStringify,
  withRawProDraftChecksum,
} from "../src/main/data/pro/checksum";
import {
  LeaguepediaCargoAdapter,
  leaguepediaBotAuthenticationFromEnvironment,
} from "../src/main/data/pro/leaguepediaCargo";
import { OracleElixirCsvAdapter } from "../src/main/data/pro/oraclesElixirCsv";
import { deriveProPatchWindow } from "../src/main/data/pro/patchWindow";
import {
  validateProDataSnapshot,
  validateRawProDraftCollection,
} from "../src/main/data/pro/validation";
import {
  PRO_RAW_SCHEMA_VERSION,
  type ProDataSnapshot,
  type RawProDraftCollection,
} from "../src/shared/proData";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

void main().catch((error: unknown) => {
  console.error(toError(error).message);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (command === "fetch") {
    await fetchRawDrafts();
    return;
  }

  if (command === "build") {
    await buildSnapshot();
    return;
  }

  if (command === "import-oe") {
    await importOracleElixir();
    return;
  }

  if (command === "validate") {
    const value = await readJson(requiredArg("input"));
    const result = isRawCollection(value)
      ? validateRawProDraftCollection(value)
      : validateProDataSnapshot(value);

    if (!result.valid) {
      throw new Error(result.errors.join("; "));
    }

    const gameCount = isRawCollection(value)
      ? value.gameCount
      : (value as ProDataSnapshot).metadata.gameCount;
    console.log(`Valid professional data: ${gameCount} games`);
    return;
  }

  if (command === "checksum") {
    const value = await readJson(requiredArg("input"));
    console.log(
      isRawCollection(value)
        ? calculateRawProDraftChecksum(value)
        : calculateProSnapshotChecksum(value as ProDataSnapshot),
    );
    return;
  }

  throw new Error("Usage: pro-data.ts <fetch|build|import-oe|validate|checksum> [--key value]");
}

async function fetchRawDrafts(): Promise<void> {
  const output = resolve(args.output ?? "data/pro/raw-drafts.json");
  const cacheDirectory = resolve(args.catalogCache ?? ".cache/pro-data-catalog");
  const catalog = new DataDragonChampionCatalog(cacheDirectory);
  await catalog.ready();
  await catalog.refresh().catch((error: unknown) => {
    console.warn(`Data Dragon refresh failed; using cached catalog: ${toError(error).message}`);
  });

  if (catalog.all().length === 0) {
    throw new Error("Data Dragon champion catalog is unavailable");
  }

  const patches = args.patches
    ? args.patches.split(",").map((patch) => patch.trim())
    : deriveProPatchWindow(catalog.version());

  if (patches.length !== 3 || new Set(patches).size !== 3) {
    throw new Error("--patches must contain the current patch and exactly two previous patches");
  }

  const adapter = new LeaguepediaCargoAdapter(catalog, {
    authentication: leaguepediaBotAuthenticationFromEnvironment(process.env) ?? undefined,
  });
  const fetched = await adapter.fetchDrafts(patches, args.etag ?? null);

  if (fetched.notModified) {
    console.log("Leaguepedia data is unchanged");
    return;
  }

  const collection = withRawProDraftChecksum({
    schemaVersion: PRO_RAW_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: "Leaguepedia Cargo",
    sourceUrl: "https://lol.fandom.com/api.php",
    checksumAlgorithm: "sha256",
    checksum: "",
    coveredPatches: [...new Set(fetched.drafts.map((draft) => draft.patch))].sort(),
    competitions: [...new Set(fetched.drafts.map((draft) => draft.competition))].sort(),
    gameCount: fetched.drafts.length,
    complete: fetched.drafts.length > 0 && fetched.warnings.length === 0,
    warnings: fetched.warnings,
    etag: fetched.etag,
    drafts: fetched.drafts,
  });
  await writeJson(output, collection);
  console.log(`Fetched ${collection.gameCount} professional drafts to ${output}`);
}

async function buildSnapshot(): Promise<void> {
  const input = resolve(requiredArg("input"));
  const output = resolve(args.output ?? "data/pro/pro-snapshot.json");
  const rawValue = JSON.parse(await readFile(input, "utf8")) as unknown;
  const rawResult = validateRawProDraftCollection(rawValue);

  if (!rawResult.valid || !rawResult.collection) {
    throw new Error(rawResult.errors.join("; "));
  }
  const raw = rawResult.collection;

  const snapshot = buildProDataSnapshot(raw.drafts, {
    generatedAt: raw.generatedAt,
    source: raw.source,
    sourceUrl: raw.sourceUrl,
    warnings: raw.warnings,
    complete: raw.complete,
  });
  const result = validateProDataSnapshot(snapshot);

  if (!result.valid) {
    throw new Error(result.errors.join("; "));
  }

  await writeSnapshot(output, snapshot);
}

async function importOracleElixir(): Promise<void> {
  const input = resolve(requiredArg("input"));
  const output = resolve(args.output ?? "data/pro/local-oe-snapshot.json");
  const cacheDirectory = resolve(args.catalogCache ?? ".cache/pro-data-catalog");
  const catalog = new DataDragonChampionCatalog(cacheDirectory);
  await catalog.ready();
  await catalog.refresh().catch((error: unknown) => {
    console.warn(`Data Dragon refresh failed; using cached catalog: ${toError(error).message}`);
  });

  if (catalog.all().length === 0) {
    throw new Error("Data Dragon champion catalog is unavailable");
  }

  const patches = args.patches
    ? args.patches.split(",").map((patch) => patch.trim())
    : deriveProPatchWindow(catalog.version());

  if (patches.length !== 3 || new Set(patches).size !== 3) {
    throw new Error("--patches must contain the current patch and exactly two previous patches");
  }

  const imported = await new OracleElixirCsvAdapter(catalog).importFile(input, patches);
  const snapshot = buildProDataSnapshot(imported.drafts, {
    generatedAt: new Date().toISOString(),
    source: "Oracle's Elixir (local noncommercial import)",
    sourceUrl: "https://oracleselixir.com/tools/downloads",
    attribution: "Oracle's Elixir / Tim Sevenhuysen",
    warnings: imported.warnings,
    complete: true,
  });
  const result = validateProDataSnapshot(snapshot);

  if (!result.valid) {
    throw new Error(result.errors.join("; "));
  }

  await writeSnapshot(output, snapshot);
}

async function writeSnapshot(
  output: string,
  snapshot: ProDataSnapshot,
): Promise<void> {
  await writeJson(output, snapshot);
  await mkdir(dirname(`${output}.gz`), { recursive: true });
  await writeFile(`${output}.gz`, gzipSync(Buffer.from(canonicalStringify(snapshot)), { level: 9 }));
  console.log(`Built ${snapshot.metadata.gameCount}-game snapshot at ${output} and ${output}.gz`);
}

async function readJson(path: string): Promise<unknown> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const decoded = absolute.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return JSON.parse(decoded.toString("utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${canonicalStringify(value)}\n`, "utf8");
}

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];

    if (key && value) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function requiredArg(name: string): string {
  const value = args[name];

  if (!value) {
    throw new Error(`Missing --${name}`);
  }

  return value;
}

function isRawCollection(value: unknown): value is RawProDraftCollection {
  return Boolean(
    value &&
      typeof value === "object" &&
      "drafts" in value &&
      !('metadata' in value),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
