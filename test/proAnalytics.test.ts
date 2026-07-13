import { describe, expect, it } from "vitest";
import { buildProDataSnapshot } from "../src/main/data/pro/aggregate";
import {
  ProAnalytics,
  PRO_ANALYTICS_CONSTANTS,
  effectiveProWeight,
  formatProEvidenceText,
  patchWeight,
  teamQualityMultiplier,
} from "../src/main/data/pro/proAnalytics";
import type {
  CompetitionTier,
  NormalizedProDraft,
} from "../src/shared/proData";
import type { Role } from "../src/shared/types";

const now = new Date("2026-07-11T00:00:00.000Z");

describe("professional analytics", () => {
  it("applies exact patch, international, competition, and bounded team-quality weights", () => {
    expect(patchWeight("26.13", "26.13")).toBe(1);
    expect(patchWeight("26.12", "26.13")).toBe(0.45);
    expect(patchWeight("26.11", "26.13")).toBe(0.2);
    expect(patchWeight("26.10", "26.13")).toBe(0);
    expect(effectiveProWeight("26.13", "26.13", "MSI 2026", "international")).toBe(1.5);
    expect(effectiveProWeight("26.13", "26.13", "2026 CBLOL Split 2", "included")).toBe(0.9);
    expect(effectiveProWeight("26.13", "26.13", "2026 LCK Split 1", "major", 99)).toBe(1.15);
    expect(effectiveProWeight("26.13", "26.13", "2026 LCK Split 1", "major", -99)).toBe(0.85);
    expect(teamQualityMultiplier(20, 20)).toBeLessThanOrEqual(1.15);
    expect(teamQualityMultiplier(0, 20)).toBeGreaterThanOrEqual(0.85);
  });

  it("applies bounded team quality to candidate effective samples", () => {
    const strong = analytics(
      Array.from({ length: 6 }, (_, index) =>
        draft({ gameId: `strong-${index}`, winner: "blue" }),
      ),
    ).analyzeCandidate({ championId: 266, role: "top" });
    const weak = analytics(
      Array.from({ length: 6 }, (_, index) =>
        draft({ gameId: `weak-${index}`, winner: "red" }),
      ),
    ).analyzeCandidate({ championId: 266, role: "top" });

    expect(strong.rolePresence.effectiveSample).toBeGreaterThan(
      weak.rolePresence.effectiveSample,
    );
    expect(strong.rolePresence.effectiveSample).toBeLessThanOrEqual(6 * 1.15);
    expect(weak.rolePresence.effectiveSample).toBeGreaterThanOrEqual(6 * 0.85);
  });

  it("suppresses one-game material impact but activates repeated evidence", () => {
    const one = analytics([draft({ gameId: "one", winner: "blue" })]);
    const repeated = analytics(
      Array.from({ length: 4 }, (_, index) =>
        draft({ gameId: `repeat-${index}`, winner: "blue" }),
      ),
    );
    const oneGame = one.analyzeCandidate({ championId: 266, role: "top" });
    const repeatedGames = repeated.analyzeCandidate({ championId: 266, role: "top" });

    expect(oneGame.priority.effectiveSample).toBeCloseTo(
      oneGame.rolePresence.effectiveSample,
    );
    expect(oneGame.priority.material).toBe(false);
    expect(oneGame.priority.evidence[0].text).toContain("Observation");
    expect(oneGame.overallStrength).toBe(0);
    expect(one.topRoleCandidateIds("top")).not.toContain(266);
    expect(repeatedGames.priority.effectiveSample).toBeCloseTo(
      repeatedGames.rolePresence.effectiveSample,
    );
    expect(repeatedGames.priority.effectiveSample).toBeGreaterThan(3);
    expect(repeatedGames.priority.material).toBe(true);
    expect(repeatedGames.overallStrength).toBeGreaterThan(0);
    expect(repeated.topRoleCandidateIds("top")).toContain(266);
    expect(repeatedGames.success.confidence).toBeLessThan(
      repeatedGames.rolePresence.confidence,
    );
  });

  it("discounts bans and detects repeated flex roles", () => {
    const drafts = [
      draft({ gameId: "top-1", winner: "blue", blueTopId: 266, blueMidId: 103 }),
      draft({ gameId: "mid-1", winner: "blue", blueTopId: 24, blueMidId: 266 }),
      draft({ gameId: "top-2", winner: "red", blueTopId: 266, blueMidId: 103 }),
      draft({ gameId: "ban-1", winner: "red", blueTopId: 24, blueMidId: 103, extraBlueBanId: 266 }),
      draft({ gameId: "ban-2", winner: "blue", blueTopId: 24, blueMidId: 103, extraBlueBanId: 266 }),
      draft({ gameId: "ban-3", winner: "red", blueTopId: 24, blueMidId: 103, extraBlueBanId: 266 }),
      draft({ gameId: "ban-4", winner: "blue", blueTopId: 24, blueMidId: 103, extraBlueBanId: 266 }),
    ];
    const result = analytics(drafts).analyzeCandidate({ championId: 266, role: "top" });

    expect(result.priority.evidence[0].statistics.bans).toBe(4);
    expect(result.priority.effectiveSample).toBeCloseTo(
      result.rolePresence.effectiveSample + 4 * 0.55,
    );
    expect(result.flex.value).toBeGreaterThan(0);
    expect(result.flex.evidence[0].statistics.roleCount).toBe(2);
  });

  it("shrinks pair and matchup estimates toward their role-pair priors", () => {
    const result = analytics(
      Array.from({ length: 5 }, (_, index) =>
        draft({ gameId: `win-${index}`, winner: "blue" }),
      ),
    ).analyzeCandidate({
      championId: 266,
      role: "top",
      allies: [{ championId: 56, role: "jungle" }],
      enemies: [
        { championId: 122, role: "top" },
        { championId: 61, role: "middle" },
      ],
    });

    expect(result.synergy.material).toBe(true);
    expect(result.synergy.value).toBeGreaterThan(0);
    expect(result.synergy.value).toBeLessThan(1);
    expect(result.matchup.material).toBe(true);
    expect(result.matchup.value).toBeGreaterThan(0);
    expect(result.matchup.value).toBeLessThan(1);
    expect(result.response.material).toBe(true);
  });

  it("supports no favorite by default and deterministic multiple-favorite tendencies", () => {
    const source = analytics([
      draft({ gameId: "a-1", blueTeam: "T1", winner: "blue" }),
      draft({ gameId: "a-2", blueTeam: "T1", winner: "blue" }),
      draft({ gameId: "b-1", blueTeam: "Bilibili Gaming", winner: "blue" }),
      draft({ gameId: "b-2", blueTeam: "Bilibili Gaming", winner: "red" }),
    ]);
    const none = source.analyzeCandidate({ championId: 266, role: "top" });
    const multipleInput = {
      championId: 266,
      role: "top" as const,
      allies: [{ championId: 56, role: "jungle" as const }],
      favoriteTeams: ["T1", "Bilibili Gaming"],
    };
    const multiple = source.analyzeCandidate(multipleInput);
    const repeated = source.analyzeCandidate({
      ...multipleInput,
      favoriteTeams: ["Bilibili Gaming", "T1", "T1"],
    });

    expect(none.favorite.effectiveSample).toBe(0);
    expect(multiple.favorite.effectiveSample).toBeGreaterThan(0);
    expect(multiple.favorite.evidence[0].teams).toEqual(["Bilibili Gaming", "T1"]);
    expect(PRO_ANALYTICS_CONSTANTS.favoriteProInspiredWeight).toBeGreaterThan(
      PRO_ANALYTICS_CONSTANTS.favoriteOverallWeight,
    );
    expect(repeated).toEqual(multiple);
  });

  it("derives composition-pattern evidence from an offline archetype index", () => {
    const source = new ProAnalytics(snapshot([
      draft({ gameId: "comp-1", winner: "blue" }),
      draft({ gameId: "comp-2", winner: "blue" }),
      draft({ gameId: "comp-3", winner: "red" }),
    ]), {
      currentPatch: "26.13",
      now,
      getArchetypes: (championId) => championId === 56 ? ["engage"] : ["carry"],
    });
    const result = source.analyzeCandidate({
      championId: 266,
      role: "top",
      allies: [{ championId: 56, role: "jungle" }],
    });

    expect(result.composition.material).toBe(true);
    expect(result.composition.value).toBeGreaterThan(0);
    expect(result.composition.evidence[0].kind).toBe("composition");
  });

  it("formats concise evidence with exact expandable statistics", () => {
    expect(formatProEvidenceText({
      kind: "priority",
      statistics: { picks: 7, bans: 2, opportunities: 10, rate: 0.81 },
      patches: ["26.13"],
      competitions: ["MSI 2026"],
      teams: [],
      material: true,
    })).toBe("MSI · patch 26.13 · 7 picks / 2 bans");
  });

  it("gives excluded leagues and old patches zero influence", () => {
    expect(effectiveProWeight("26.13", "26.13", "LCK Challengers League 2026", "major")).toBe(0);
    expect(effectiveProWeight("26.10", "26.13", "2026 LCK Split 1", "major")).toBe(0);
  });

  it("produces identical evidence for identical normalized input", () => {
    const source = analytics(
      Array.from({ length: 4 }, (_, index) => draft({ gameId: `same-${index}` })),
    );
    const input = {
      championId: 266,
      role: "top" as const,
      allies: [{ championId: 56, role: "jungle" as const }],
      enemies: [{ championId: 122, role: "top" as const }],
    };

    expect(JSON.stringify(source.analyzeCandidate(input))).toBe(
      JSON.stringify(source.analyzeCandidate(input)),
    );
  });

  it("indexes composition records once and serves cached offline queries", () => {
    let archetypeCalls = 0;
    const source = new ProAnalytics(snapshot([
      draft({ gameId: "cached-1" }),
      draft({ gameId: "cached-2" }),
      draft({ gameId: "cached-3" }),
    ]), {
      currentPatch: "26.13",
      now,
      getArchetypes: () => {
        archetypeCalls += 1;
        return ["engage"];
      },
    });
    const indexedCalls = archetypeCalls;
    const query = {
      championId: 266,
      role: "top" as const,
      allies: [{ championId: 56, role: "jungle" as const }],
    };

    source.analyzeCandidate(query);
    const callsAfterFirstQuery = archetypeCalls;
    source.analyzeCandidate(query);

    expect(callsAfterFirstQuery).toBe(indexedCalls + 1);
    expect(archetypeCalls).toBe(callsAfterFirstQuery);
  });
});

function analytics(drafts: NormalizedProDraft[]): ProAnalytics {
  return new ProAnalytics(snapshot(drafts), { currentPatch: "26.13", now });
}

function snapshot(drafts: NormalizedProDraft[]) {
  return buildProDataSnapshot(drafts, { generatedAt: "2026-07-10T00:00:00.000Z" });
}

function draft(options: {
  gameId: string;
  patch?: string;
  competition?: string;
  competitionTier?: CompetitionTier;
  blueTeam?: string;
  redTeam?: string;
  winner?: "blue" | "red";
  blueTopId?: number;
  blueMidId?: number;
  extraBlueBanId?: number;
}): NormalizedProDraft {
  const roles: Role[] = ["top", "jungle", "middle", "bottom", "utility"];
  const blueIds = [options.blueTopId ?? 266, 56, options.blueMidId ?? 103, 222, 412];
  const redIds = [122, 62, 61, 67, 63];

  return {
    schemaVersion: 1,
    gameId: options.gameId,
    patch: options.patch ?? "26.13",
    playedAt: "2026-07-01T00:00:00.000Z",
    competition: options.competition ?? "2026 LCK Split 1",
    competitionTier: options.competitionTier ?? "major",
    stage: "Regular Season",
    format: "Standard",
    fearless: false,
    blueTeam: options.blueTeam ?? "Blue Team",
    redTeam: options.redTeam ?? "Red Team",
    winner: options.winner ?? "blue",
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
      ...(options.extraBlueBanId
        ? [{ order: 3, side: "blue" as const, championId: options.extraBlueBanId }]
        : []),
    ],
  };
}
