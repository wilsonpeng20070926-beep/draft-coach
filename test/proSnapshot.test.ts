import { describe, expect, it } from "vitest";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import {
  canonicalStringify,
  withRawProDraftChecksum,
  withProSnapshotChecksum,
} from "../src/main/data/pro/checksum";
import {
  validateProDataSnapshot,
  validateRawProDraftCollection,
} from "../src/main/data/pro/validation";
import { deriveProPatchWindow } from "../src/main/data/pro/patchWindow";
import type {
  NormalizedProDraft,
  ProDataSnapshot,
  RawProDraftCollection,
} from "../src/shared/proData";

const now = new Date("2026-07-11T00:00:00.000Z");

describe("professional snapshot aggregation and validation", () => {
  it("derives the current and two previous patches, including year rollover", () => {
    expect(deriveProPatchWindow("26.13.1")).toEqual(["26.13", "26.12", "26.11"]);
    expect(deriveProPatchWindow("26.2.1")).toEqual(["26.2", "26.1", "25.24"]);
  });

  it("builds deterministic compact aggregates independent of input order", () => {
    const drafts = [draft("game-1", "2026-07-01T00:00:00.000Z", "blue"), draft("game-2", "2026-07-02T00:00:00.000Z", "red")];
    const first = buildProDataSnapshot(drafts, { generatedAt: now.toISOString() });
    const second = buildProDataSnapshot([...drafts].reverse(), { generatedAt: now.toISOString() });

    expect(canonicalStringify(second)).toBe(canonicalStringify(first));
    expect(first.metadata).toMatchObject({
      schemaVersion: 1,
      gameCount: 2,
      coveredPatches: ["26.13"],
      competitions: ["2026 LCK Split 1"],
      complete: true,
    });
    expect(first.championRoles.length).toBeGreaterThan(0);
    expect(first.championPairs.length).toBeGreaterThan(0);
    expect(first.championOpponents.some((item) => item.sameRole)).toBe(true);
    expect(first.teamChampions.length).toBeGreaterThan(0);
    expect(first.teamPairs.length).toBeGreaterThan(0);
    expect(first.teamResponses.length).toBeGreaterThan(0);
    expect(first.draftRecords[0]).toMatchObject({
      competitionTier: "major",
      stage: "Regular Season",
      format: "Standard",
    });
    expect(validateProDataSnapshot(first, { now }).valid).toBe(true);
  });

  it("checksums and validates complete raw collections before aggregation", () => {
    const collection = rawCollection([draft("game-1", "2026-07-01T00:00:00.000Z", "blue")]);

    expect(validateRawProDraftCollection(collection, { now }).valid).toBe(true);

    const corrupt = {
      ...collection,
      drafts: [{ ...collection.drafts[0], gameId: "changed" }],
    };
    expect(validateRawProDraftCollection(corrupt, { now }).errors).toContain(
      "Raw collection checksum does not match its contents",
    );

    const partial = withRawProDraftChecksum({
      ...collection,
      complete: false,
      warnings: ["Dropped a partial row"],
    });
    expect(validateRawProDraftCollection(partial, { now }).errors).toContain(
      "Raw collection is partial",
    );
  });

  it.each([
    ["empty", (snapshot: ProDataSnapshot) => ({ ...snapshot, metadata: { ...snapshot.metadata, gameCount: 0 }, draftRecords: [] })],
    ["partial", (snapshot: ProDataSnapshot) => ({ ...snapshot, metadata: { ...snapshot.metadata, complete: false } })],
    ["future-dated", (snapshot: ProDataSnapshot) => ({ ...snapshot, metadata: { ...snapshot.metadata, generatedAt: "2026-07-12T00:00:00.000Z" } })],
    ["unknown schema", (snapshot: ProDataSnapshot) => ({ ...snapshot, metadata: { ...snapshot.metadata, schemaVersion: 99 } })],
  ])("rejects %s snapshots", (_label, mutate) => {
    const base = buildProDataSnapshot([draft("game-1", "2026-07-01T00:00:00.000Z", "blue")], { generatedAt: now.toISOString() });
    const mutated = withProSnapshotChecksum(mutate(base) as ProDataSnapshot);

    expect(validateProDataSnapshot(mutated, { now }).valid).toBe(false);
  });

  it("rejects corrupt checksums and implausibly smaller replacements", () => {
    const snapshot = buildProDataSnapshot([draft("game-1", "2026-07-01T00:00:00.000Z", "blue")], { generatedAt: now.toISOString() });
    const corrupt = {
      ...snapshot,
      metadata: { ...snapshot.metadata, checksum: "0".repeat(64) },
    };

    expect(validateProDataSnapshot(corrupt, { now }).errors).toContain(
      "Snapshot checksum does not match its contents",
    );
    expect(
      validateProDataSnapshot(snapshot, {
        now,
        previousGameCount: 100,
      }).errors,
    ).toContain("Snapshot is implausibly smaller than the last-known-good snapshot");
  });
});

function draft(
  gameId: string,
  playedAt: string,
  winner: "blue" | "red",
): NormalizedProDraft {
  const roles = ["top", "jungle", "middle", "bottom", "utility"] as const;
  const blueIds = [266, 56, 103, 222, 412];
  const redIds = [122, 62, 61, 67, 63];

  return {
    schemaVersion: 1,
    gameId,
    patch: "26.13",
    playedAt,
    competition: "2026 LCK Split 1",
    competitionTier: "major",
    stage: "Regular Season",
    format: "Standard",
    fearless: false,
    blueTeam: "Blue Team",
    redTeam: "Red Team",
    winner,
    picks: [
      ...blueIds.map((championId, index) => ({
        order: [1, 4, 5, 8, 9][index],
        side: "blue" as const,
        role: roles[index],
        championId,
      })),
      ...redIds.map((championId, index) => ({
        order: [2, 3, 6, 7, 10][index],
        side: "red" as const,
        role: roles[index],
        championId,
      })),
    ].sort((left, right) => left.order - right.order),
    bans: [
      { order: 1, side: "blue", championId: 24 },
      { order: 2, side: "red", championId: 92 },
    ],
  };
}

function rawCollection(drafts: NormalizedProDraft[]): RawProDraftCollection {
  return withRawProDraftChecksum({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    source: "Leaguepedia Cargo",
    sourceUrl: "https://lol.fandom.com/api.php",
    checksumAlgorithm: "sha256",
    checksum: "",
    coveredPatches: ["26.13"],
    competitions: ["2026 LCK Split 1"],
    gameCount: drafts.length,
    complete: true,
    warnings: [],
    etag: '"fixture"',
    drafts,
  });
}
