import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type { ChampionCatalog } from "../../catalog/championCatalog";
import {
  PRO_RAW_SCHEMA_VERSION,
  type NormalizedProDraft,
  type ProDraftBan,
  type ProDraftPick,
  type ProSide,
} from "../../../shared/proData";
import type { ChampionRef, Role } from "../../../shared/types";
import { classifyProCompetition } from "./competitionPolicy";

type OracleCsvRow = Record<string, string>;

export interface OracleElixirImportResult {
  drafts: NormalizedProDraft[];
  warnings: string[];
  excludedPartialGames: number;
}

const pickOrders: Record<ProSide, number[]> = {
  blue: [1, 4, 5, 8, 9],
  red: [2, 3, 6, 7, 10],
};
const banOrders: Record<ProSide, number[]> = {
  blue: [1, 3, 5, 7, 9],
  red: [2, 4, 6, 8, 10],
};
const competitionNames: Record<string, string> = {
  EWC: "Esports World Cup",
  FST: "First Stand",
  MSI: "Mid-Season Invitational",
};

export class OracleElixirCsvAdapter {
  private readonly championLookup = new Map<string, ChampionRef>();

  constructor(private readonly catalog: ChampionCatalog) {
    for (const champion of catalog.all()) {
      this.championLookup.set(normalizeName(champion.name), champion);
      this.championLookup.set(normalizeName(champion.slug), champion);
    }
  }

  async importFile(
    inputPath: string,
    patches: readonly string[],
  ): Promise<OracleElixirImportResult> {
    if (this.championLookup.size === 0) {
      throw new Error("Data Dragon champion catalog is unavailable");
    }

    if (patches.length === 0) {
      throw new Error("At least one professional-data patch is required");
    }

    const includedPatches = new Set(patches.map(normalizePatch));
    const drafts: NormalizedProDraft[] = [];
    const seenGameIds = new Set<string>();
    let excludedPartialGames = 0;
    let currentGameId: string | null = null;
    let currentRows: OracleCsvRow[] = [];
    const parser = createReadStream(inputPath).pipe(
      parse({
        bom: true,
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true,
      }),
    );

    const finishGame = (): void => {
      if (!currentGameId || currentRows.length === 0) {
        return;
      }

      const result = this.normalizeGame(currentRows, includedPatches);

      if (result === "partial") {
        excludedPartialGames += 1;
      } else if (result) {
        drafts.push(result);
      }

      seenGameIds.add(currentGameId);
    };

    for await (const value of parser) {
      const row = toCsvRow(value);
      const gameId = row.gameid?.trim();

      if (!gameId) {
        throw new Error("Oracle's Elixir CSV contains a row without gameid");
      }

      if (currentGameId !== gameId) {
        finishGame();

        if (seenGameIds.has(gameId)) {
          throw new Error(`Oracle's Elixir CSV game ${gameId} is not contiguous`);
        }

        currentGameId = gameId;
        currentRows = [];
      }

      currentRows.push(row);
    }

    finishGame();

    if (drafts.length === 0) {
      throw new Error(
        `Oracle's Elixir CSV contains no complete included games for patches ${patches.join(", ")}`,
      );
    }

    return {
      drafts: drafts.sort(
        (left, right) =>
          left.playedAt.localeCompare(right.playedAt) ||
          left.gameId.localeCompare(right.gameId),
      ),
      warnings: [
        "Local noncommercial import from Oracle's Elixir; do not redistribute the source CSV or generated snapshot.",
        ...(excludedPartialGames > 0
          ? [`Excluded ${excludedPartialGames} source-marked partial games.`]
          : []),
      ],
      excludedPartialGames,
    };
  }

  private normalizeGame(
    rows: OracleCsvRow[],
    patches: ReadonlySet<string>,
  ): NormalizedProDraft | "partial" | null {
    const representative = rows[0];
    const patch = normalizePatch(requiredField(representative, "patch"));
    const competition = competitionName(representative);
    const competitionTier = classifyProCompetition(competition);

    if (!patches.has(patch) || !competitionTier) {
      return null;
    }

    if (rows.some((row) => row.datacompleteness?.trim().toLowerCase() !== "complete")) {
      return "partial";
    }

    const blueTeamRow = findTeamRow(rows, "blue");
    const redTeamRow = findTeamRow(rows, "red");
    const blueTeam = requiredField(blueTeamRow, "teamname");
    const redTeam = requiredField(redTeamRow, "teamname");
    const winner = parseResult(blueTeamRow) ? "blue" : parseResult(redTeamRow) ? "red" : null;

    if (!winner) {
      throw new Error(`Oracle's Elixir game ${representative.gameid} has no winner`);
    }

    return {
      schemaVersion: PRO_RAW_SCHEMA_VERSION,
      gameId: requiredField(representative, "gameid"),
      patch,
      playedAt: normalizePlayedAt(requiredField(representative, "date")),
      competition,
      competitionTier,
      stage: representative.playoffs?.trim() === "1" ? "Playoffs" : "Regular Season",
      format: null,
      fearless: null,
      blueTeam,
      redTeam,
      winner,
      picks: [
        ...this.createPicks(rows, blueTeamRow, "blue"),
        ...this.createPicks(rows, redTeamRow, "red"),
      ].sort((left, right) => left.order - right.order),
      bans: [
        ...this.createBans(blueTeamRow, "blue"),
        ...this.createBans(redTeamRow, "red"),
      ].sort((left, right) => left.order - right.order),
    };
  }

  private createPicks(
    rows: OracleCsvRow[],
    teamRow: OracleCsvRow,
    side: ProSide,
  ): ProDraftPick[] {
    const roleByChampion = new Map<string, Role>();

    for (const row of rows) {
      if (parseSide(row.side) !== side) {
        continue;
      }

      const role = parseRole(row.position);
      const championName = row.champion?.trim();

      if (role && championName) {
        roleByChampion.set(normalizeName(championName), role);
      }
    }

    return Array.from({ length: 5 }, (_, index) => {
      const championName = requiredField(teamRow, `pick${index + 1}`);
      const champion = this.resolveChampion(championName);
      const role = roleByChampion.get(normalizeName(championName));

      if (!role) {
        throw new Error(
          `Oracle's Elixir game ${teamRow.gameid} has no ${side} role for ${championName}`,
        );
      }

      return {
        order: pickOrders[side][index],
        side,
        role,
        championId: champion.id,
      };
    });
  }

  private createBans(teamRow: OracleCsvRow, side: ProSide): ProDraftBan[] {
    return Array.from({ length: 5 }, (_, index) => teamRow[`ban${index + 1}`]?.trim())
      .flatMap((championName, index) => {
        if (!championName) {
          return [];
        }

        return [{
          order: banOrders[side][index],
          side,
          championId: this.resolveChampion(championName).id,
        }];
      });
  }

  private resolveChampion(name: string): ChampionRef {
    const champion = this.championLookup.get(normalizeName(name));

    if (!champion) {
      throw new Error(`Oracle's Elixir CSV contains unknown champion ${name}`);
    }

    return champion;
  }
}

function findTeamRow(rows: OracleCsvRow[], side: ProSide): OracleCsvRow {
  const participantId = side === "blue" ? "100" : "200";
  const row = rows.find(
    (candidate) =>
      candidate.participantid?.trim() === participantId &&
      parseSide(candidate.side) === side,
  );

  if (!row) {
    throw new Error(`Oracle's Elixir game ${rows[0]?.gameid ?? "unknown"} lacks a ${side} team row`);
  }

  return row;
}

function competitionName(row: OracleCsvRow): string {
  const code = requiredField(row, "league");
  const league = competitionNames[code] ?? code;
  const year = row.year?.trim();
  const split = row.split?.trim();

  return [year, league, split].filter(Boolean).join(" ");
}

function normalizePatch(value: string): string {
  const [major, minor] = value.trim().split(".").slice(0, 2).map(Number);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error(`Oracle's Elixir CSV has invalid patch ${value}`);
  }

  return `${major}.${minor}`;
}

function normalizePlayedAt(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/u.test(normalized) ? normalized : `${normalized}Z`);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Oracle's Elixir CSV has invalid date ${value}`);
  }

  return new Date(timestamp).toISOString();
}

function parseRole(value: string | undefined): Role | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "top") return "top";
  if (normalized === "jng" || normalized === "jungle") return "jungle";
  if (normalized === "mid" || normalized === "middle") return "middle";
  if (normalized === "bot" || normalized === "adc" || normalized === "bottom") return "bottom";
  if (normalized === "sup" || normalized === "support" || normalized === "utility") return "utility";
  return null;
}

function parseSide(value: string | undefined): ProSide | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "blue" || normalized === "red" ? normalized : null;
}

function parseResult(row: OracleCsvRow): boolean {
  return row.result?.trim() === "1";
}

function requiredField(row: OracleCsvRow, name: string): string {
  const value = row[name]?.trim();

  if (!value) {
    throw new Error(
      `Oracle's Elixir game ${row.gameid?.trim() || "unknown"} is missing ${name}`,
    );
  }

  return value;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function toCsvRow(value: unknown): OracleCsvRow {
  if (!value || typeof value !== "object") {
    throw new Error("Oracle's Elixir CSV row is invalid");
  }

  return value as OracleCsvRow;
}
