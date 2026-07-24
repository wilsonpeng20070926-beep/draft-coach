import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import { OracleElixirCsvAdapter } from "../src/main/data/pro/oraclesElixirCsv";
import { validateProDataSnapshot } from "../src/main/data/pro/validation";
import { createFixtureCatalog } from "./fixtures/championFixture";

const directories: string[] = [];
const columns = [
  "gameid",
  "datacompleteness",
  "league",
  "year",
  "split",
  "playoffs",
  "date",
  "patch",
  "participantid",
  "side",
  "position",
  "teamname",
  "champion",
  "ban1",
  "ban2",
  "ban3",
  "ban4",
  "ban5",
  "pick1",
  "pick2",
  "pick3",
  "pick4",
  "pick5",
  "result",
];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Oracle's Elixir local CSV import", () => {
  it("normalizes complete included games into a valid noncommercial snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-oe-"));
    directories.push(directory);
    const input = join(directory, "oracle.csv");
    await writeFile(input, fixtureCsv(), "utf8");

    const imported = await new OracleElixirCsvAdapter(
      createFixtureCatalog(),
    ).importFile(input, ["16.14", "16.13", "16.12"]);

    expect(imported.drafts).toHaveLength(1);
    expect(imported.warnings[0]).toContain("Local noncommercial import");
    expect(imported.drafts[0]).toMatchObject({
      gameId: "OE-TEST-1",
      patch: "16.14",
      competition: "2026 LCK Summer",
      competitionTier: "major",
      blueTeam: "Blue Team",
      redTeam: "Red Team",
      winner: "blue",
    });
    expect(imported.drafts[0].picks.map((pick) => [
      pick.order,
      pick.side,
      pick.role,
      pick.championId,
    ])).toEqual([
      [1, "blue", "top", 266],
      [2, "red", "top", 122],
      [3, "red", "jungle", 62],
      [4, "blue", "jungle", 56],
      [5, "blue", "middle", 103],
      [6, "red", "middle", 61],
      [7, "red", "bottom", 67],
      [8, "blue", "bottom", 222],
      [9, "blue", "utility", 412],
      [10, "red", "utility", 63],
    ]);

    const snapshot = buildProDataSnapshot(imported.drafts, {
      generatedAt: "2026-07-24T00:00:00.000Z",
      source: "Oracle's Elixir (local noncommercial import)",
      sourceUrl: "https://oracleselixir.com/tools/downloads",
      attribution: "Oracle's Elixir / Tim Sevenhuysen",
      warnings: imported.warnings,
      complete: true,
    });

    expect(
      validateProDataSnapshot(snapshot, {
        now: new Date("2026-07-24T00:01:00.000Z"),
      }).valid,
    ).toBe(true);
  });
});

function fixtureCsv(): string {
  const blue = [
    ["1", "top", "Aatrox"],
    ["2", "jng", "Nocturne"],
    ["3", "mid", "Ahri"],
    ["4", "bot", "Jinx"],
    ["5", "sup", "Thresh"],
  ];
  const red = [
    ["6", "top", "Darius"],
    ["7", "jng", "Wukong"],
    ["8", "mid", "Orianna"],
    ["9", "bot", "Vayne"],
    ["10", "sup", "Brand"],
  ];
  const rows = [
    ...blue.map(([participantid, position, champion]) =>
      row({ participantid, side: "Blue", position, champion, teamname: "Blue Team", result: "1" }),
    ),
    ...red.map(([participantid, position, champion]) =>
      row({ participantid, side: "Red", position, champion, teamname: "Red Team", result: "0" }),
    ),
    row({
      participantid: "100",
      side: "Blue",
      position: "team",
      teamname: "Blue Team",
      result: "1",
      ban1: "Jax",
      ban2: "Riven",
      ban3: "Yasuo",
      ban4: "Fizz",
      ban5: "Vladimir",
      pick1: "Aatrox",
      pick2: "Nocturne",
      pick3: "Ahri",
      pick4: "Jinx",
      pick5: "Thresh",
    }),
    row({
      participantid: "200",
      side: "Red",
      position: "team",
      teamname: "Red Team",
      result: "0",
      ban1: "Dr. Mundo",
      ban2: "Jarvan IV",
      ban3: "Gragas",
      ban4: "Lissandra",
      ban5: "Sett",
      pick1: "Darius",
      pick2: "Wukong",
      pick3: "Orianna",
      pick4: "Vayne",
      pick5: "Brand",
    }),
  ];

  return `${columns.join(",")}\n${rows.join("\n")}\n`;
}

function row(values: Record<string, string>): string {
  const base: Record<string, string> = {
    gameid: "OE-TEST-1",
    datacompleteness: "complete",
    league: "LCK",
    year: "2026",
    split: "Summer",
    playoffs: "0",
    date: "2026-07-20 10:00:00",
    patch: "16.14",
    participantid: "",
    side: "",
    position: "",
    teamname: "",
    champion: "",
    ban1: "",
    ban2: "",
    ban3: "",
    ban4: "",
    ban5: "",
    pick1: "",
    pick2: "",
    pick3: "",
    pick4: "",
    pick5: "",
    result: "",
    ...values,
  };

  return columns.map((column) => base[column]).join(",");
}
