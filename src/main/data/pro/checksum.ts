import { createHash } from "node:crypto";
import type {
  ProDataSnapshot,
  RawProDraftCollection,
} from "../../../shared/proData";

export function calculateProSnapshotChecksum(snapshot: ProDataSnapshot): string {
  const checksumless: ProDataSnapshot = {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      checksum: "",
    },
  };

  return createHash("sha256").update(canonicalStringify(checksumless)).digest("hex");
}

export function withProSnapshotChecksum(snapshot: ProDataSnapshot): ProDataSnapshot {
  const checksum = calculateProSnapshotChecksum(snapshot);

  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      checksum,
    },
  };
}

export function calculateRawProDraftChecksum(
  collection: RawProDraftCollection,
): string {
  const checksumless: RawProDraftCollection = {
    ...collection,
    checksum: "",
  };

  return createHash("sha256")
    .update(canonicalStringify(checksumless))
    .digest("hex");
}

export function withRawProDraftChecksum(
  collection: RawProDraftCollection,
): RawProDraftCollection {
  return {
    ...collection,
    checksum: calculateRawProDraftChecksum(collection),
  };
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}
