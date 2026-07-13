import type {
  ProDataSnapshot,
  RawProDraftCollection,
} from "../../../shared/proData";
import {
  PRO_RAW_SCHEMA_VERSION,
  PRO_SNAPSHOT_SCHEMA_VERSION,
} from "../../../shared/proData";
import {
  calculateProSnapshotChecksum,
  calculateRawProDraftChecksum,
} from "./checksum";

export interface ProSnapshotValidationOptions {
  now?: Date;
  previousGameCount?: number;
  verifyChecksum?: boolean;
  futureToleranceMs?: number;
  minimumRetainedRatio?: number;
}

export interface ProSnapshotValidationResult {
  valid: boolean;
  snapshot: ProDataSnapshot | null;
  errors: string[];
}

export interface RawProDraftValidationResult {
  valid: boolean;
  collection: RawProDraftCollection | null;
  errors: string[];
}

export function validateRawProDraftCollection(
  value: unknown,
  options: Pick<ProSnapshotValidationOptions, "now" | "futureToleranceMs"> = {},
): RawProDraftValidationResult {
  const errors: string[] = [];
  const collection = asRawCollection(value);

  if (!collection) {
    return { valid: false, collection: null, errors: ["Raw collection shape is invalid"] };
  }

  if (collection.schemaVersion !== PRO_RAW_SCHEMA_VERSION) {
    errors.push(`Unknown raw schema version ${collection.schemaVersion}`);
  }

  if (!collection.complete || collection.warnings.length > 0) {
    errors.push("Raw collection is partial");
  }

  if (collection.gameCount <= 0 || collection.drafts.length <= 0) {
    errors.push("Raw collection is empty");
  }

  if (collection.gameCount !== collection.drafts.length) {
    errors.push("Raw collection game count does not match drafts");
  }

  if (collection.coveredPatches.length === 0 || collection.competitions.length === 0) {
    errors.push("Raw collection coverage is empty");
  }

  const generatedAt = Date.parse(collection.generatedAt);
  const now = options.now?.getTime() ?? Date.now();
  const futureTolerance = options.futureToleranceMs ?? 5 * 60 * 1000;

  if (!Number.isFinite(generatedAt)) {
    errors.push("Raw collection generated time is invalid");
  } else if (generatedAt > now + futureTolerance) {
    errors.push("Raw collection is future-dated");
  }

  if (!/^[a-f0-9]{64}$/.test(collection.checksum)) {
    errors.push("Raw collection checksum is missing or malformed");
  } else if (calculateRawProDraftChecksum(collection) !== collection.checksum) {
    errors.push("Raw collection checksum does not match its contents");
  }

  return {
    valid: errors.length === 0,
    collection: errors.length === 0 ? collection : null,
    errors,
  };
}

export function validateProDataSnapshot(
  value: unknown,
  options: ProSnapshotValidationOptions = {},
): ProSnapshotValidationResult {
  const errors: string[] = [];
  const snapshot = asSnapshot(value);

  if (!snapshot) {
    return { valid: false, snapshot: null, errors: ["Snapshot shape is invalid"] };
  }

  if (snapshot.metadata.schemaVersion !== PRO_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(`Unknown schema version ${snapshot.metadata.schemaVersion}`);
  }

  if (!snapshot.metadata.complete) {
    errors.push("Snapshot is marked partial");
  }

  if (snapshot.metadata.gameCount <= 0 || snapshot.draftRecords.length <= 0) {
    errors.push("Snapshot is empty");
  }

  if (snapshot.metadata.gameCount !== snapshot.draftRecords.length) {
    errors.push("Snapshot game count does not match draft records");
  }

  if (
    snapshot.metadata.coveredPatches.length === 0 ||
    snapshot.metadata.competitions.length === 0
  ) {
    errors.push("Snapshot coverage is empty");
  }

  const generatedAt = Date.parse(snapshot.metadata.generatedAt);
  const now = options.now?.getTime() ?? Date.now();
  const futureTolerance = options.futureToleranceMs ?? 5 * 60 * 1000;

  if (!Number.isFinite(generatedAt)) {
    errors.push("Snapshot generated time is invalid");
  } else if (generatedAt > now + futureTolerance) {
    errors.push("Snapshot is future-dated");
  }

  const previousGameCount = options.previousGameCount ?? 0;
  const minimumRetainedRatio = options.minimumRetainedRatio ?? 0.5;

  if (
    previousGameCount >= 20 &&
    snapshot.metadata.gameCount < previousGameCount * minimumRetainedRatio
  ) {
    errors.push("Snapshot is implausibly smaller than the last-known-good snapshot");
  }

  if (options.verifyChecksum !== false) {
    if (!/^[a-f0-9]{64}$/.test(snapshot.metadata.checksum)) {
      errors.push("Snapshot checksum is missing or malformed");
    } else if (calculateProSnapshotChecksum(snapshot) !== snapshot.metadata.checksum) {
      errors.push("Snapshot checksum does not match its contents");
    }
  }

  return {
    valid: errors.length === 0,
    snapshot: errors.length === 0 ? snapshot : null,
    errors,
  };
}

function asSnapshot(value: unknown): ProDataSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<ProDataSnapshot>;
  const metadata = snapshot.metadata;

  if (
    !metadata ||
    typeof metadata !== "object" ||
    typeof metadata.schemaVersion !== "number" ||
    typeof metadata.generatedAt !== "string" ||
    typeof metadata.source !== "string" ||
    typeof metadata.sourceUrl !== "string" ||
    typeof metadata.attribution !== "string" ||
    metadata.checksumAlgorithm !== "sha256" ||
    typeof metadata.checksum !== "string" ||
    !Array.isArray(metadata.coveredPatches) ||
    !metadata.coveredPatches.every((patch) => typeof patch === "string") ||
    !Array.isArray(metadata.competitions) ||
    !metadata.competitions.every((competition) => typeof competition === "string") ||
    typeof metadata.gameCount !== "number" ||
    typeof metadata.complete !== "boolean" ||
    !Array.isArray(metadata.warnings) ||
    !Array.isArray(snapshot.championRoles) ||
    !Array.isArray(snapshot.championPairs) ||
    !Array.isArray(snapshot.championOpponents) ||
    !Array.isArray(snapshot.teamChampions) ||
    !Array.isArray(snapshot.teamPairs) ||
    !Array.isArray(snapshot.teamResponses) ||
    !Array.isArray(snapshot.draftRecords)
  ) {
    return null;
  }

  return snapshot as ProDataSnapshot;
}

function asRawCollection(value: unknown): RawProDraftCollection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const collection = value as Partial<RawProDraftCollection>;

  if (
    typeof collection.schemaVersion !== "number" ||
    typeof collection.generatedAt !== "string" ||
    typeof collection.source !== "string" ||
    typeof collection.sourceUrl !== "string" ||
    collection.checksumAlgorithm !== "sha256" ||
    typeof collection.checksum !== "string" ||
    !Array.isArray(collection.coveredPatches) ||
    !collection.coveredPatches.every((patch) => typeof patch === "string") ||
    !Array.isArray(collection.competitions) ||
    !collection.competitions.every((competition) => typeof competition === "string") ||
    typeof collection.gameCount !== "number" ||
    typeof collection.complete !== "boolean" ||
    !Array.isArray(collection.warnings) ||
    !collection.warnings.every((warning) => typeof warning === "string") ||
    !Array.isArray(collection.drafts)
  ) {
    return null;
  }

  return collection as RawProDraftCollection;
}
