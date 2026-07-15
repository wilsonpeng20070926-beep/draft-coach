import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalStringify,
  withRawProDraftChecksum,
} from "../src/main/data/pro/checksum";
import type {
  NormalizedProDraft,
  RawProDraftCollection,
} from "../src/shared/proData";

const runFile = promisify(execFile);
const directories: string[] = [];
const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const proDataCli = resolve("scripts/pro-data.ts");

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("professional data CLI", () => {
  it("validates checksummed raw data and builds deterministic JSON and gzip snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-pro-cli-"));
    directories.push(directory);
    const rawPath = join(directory, "raw.json");
    const firstPath = join(directory, "first.json");
    const secondPath = join(directory, "second.json");
    const raw = rawCollection();
    await writeFile(rawPath, `${canonicalStringify(raw)}\n`, "utf8");

    await runCli("validate", "--input", rawPath);
    await runCli("build", "--input", rawPath, "--output", firstPath);
    await runCli("build", "--input", rawPath, "--output", secondPath);
    await runCli("validate", "--input", firstPath);
    await runCli("validate", "--input", `${firstPath}.gz`);

    expect(await readFile(secondPath)).toEqual(await readFile(firstPath));
    expect(await readFile(`${secondPath}.gz`)).toEqual(
      await readFile(`${firstPath}.gz`),
    );

    const snapshot = JSON.parse(await readFile(firstPath, "utf8")) as {
      metadata: { checksum: string };
    };
    const checksum = (await runCli("checksum", "--input", firstPath)).stdout.trim();
    expect(checksum).toBe(snapshot.metadata.checksum);
  }, 30_000);
});

async function runCli(...args: string[]) {
  return runFile(process.execPath, [tsxCli, proDataCli, ...args], {
    cwd: process.cwd(),
  });
}

function rawCollection(): RawProDraftCollection {
  const generatedAt = new Date(Date.now() - 60_000).toISOString();
  const draft = normalizedDraft(generatedAt);

  return withRawProDraftChecksum({
    schemaVersion: 1,
    generatedAt,
    source: "Synthetic Leaguepedia fixture",
    sourceUrl: "https://lol.fandom.com/api.php",
    checksumAlgorithm: "sha256",
    checksum: "",
    coveredPatches: ["26.13"],
    competitions: ["2026 LCK Split 1"],
    gameCount: 1,
    complete: true,
    warnings: [],
    etag: null,
    drafts: [draft],
  });
}

function normalizedDraft(playedAt: string): NormalizedProDraft {
  const roles = ["top", "jungle", "middle", "bottom", "utility"] as const;
  const blueIds = [266, 56, 103, 222, 412];
  const redIds = [122, 62, 61, 67, 63];

  return {
    schemaVersion: 1,
    gameId: "synthetic-game",
    patch: "26.13",
    playedAt,
    competition: "2026 LCK Split 1",
    competitionTier: "major",
    stage: "Regular Season",
    format: "Standard",
    fearless: false,
    blueTeam: "Blue Team",
    redTeam: "Red Team",
    winner: "blue",
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
