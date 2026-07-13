import { describe, expect, it } from "vitest";
import {
  assessRecommendationRisk,
  calculateEvidenceBalance,
  projectRecommendationCategories,
} from "../src/main/engine/categoryProjection";
import type { LaneMetaEntry } from "../src/main/data/metaDataSource";
import type { TeamContext } from "../src/shared/championAttributes";
import type { ProEvidenceRecord } from "../src/shared/proData";
import type {
  ChampionRef,
  Recommendation,
  ScoreContribution,
} from "../src/shared/types";

describe("recommendation category projection", () => {
  it("projects once-scored candidates with overlap, limits, floors, and omission", () => {
    const candidates = [
      recommendation(1, 0.82, [ranked("laneCounter", 0.08, 0.9), ranked("synergy", 0.06, 0.8), pro(0.03, 4)]),
      recommendation(2, 0.76, [ranked("laneCounter", 0.07, 0.9), ranked("compFit", 0.05, 0.8)]),
      recommendation(3, 0.68, [ranked("synergy", 0.05, 0.7), pro(0.025, 5)]),
      recommendation(4, 0.55, [ranked("teamCounter", 0.04, 0.8), pro(0, 1)]),
      recommendation(5, 0.45, [ranked("laneCounter", 0.03, 0.9)]),
      recommendation(6, 0.39, [ranked("laneCounter", 0.2, 1)]),
      recommendation(7, 0.44, [ranked("synergy", 0.2, 0.4)]),
    ];
    const categories = projectRecommendationCategories(candidates);
    const overall = category(categories, "overall");
    const lane = category(categories, "lane");
    const synergy = category(categories, "synergy");
    const proInspired = category(categories, "pro");

    expect(overall.recommendations).toHaveLength(5);
    expect(lane.recommendations).toHaveLength(3);
    expect(lane.recommendations.map((item) => item.champion.id)).not.toContain(6);
    expect(synergy.recommendations.map((item) => item.champion.id)).not.toContain(7);
    expect(proInspired.recommendations.map((item) => item.champion.id)).toEqual([1, 3]);
    expect(lane.recommendations[0]).toBe(synergy.recommendations[0]);

    const unsupported = projectRecommendationCategories([
      recommendation(10, 0.6, [ranked("meta", 0.1, 1)]),
    ]);
    expect(unsupported.map((item) => item.key)).toEqual(["overall"]);
  });

  it("uses traceable confidence and language thresholds for risk", () => {
    const avoid = assessRecommendationRisk(
      { total: 0.3, contributions: [negative("laneCounter", -0.1, 0.82, "Risky lane")] },
      laneEntry(0.5),
      neutralContext(),
    );
    const highRisk = assessRecommendationRisk(
      { total: 0.4, contributions: [negative("teamCounter", -0.05, 0.65, "Vulnerable to dive")] },
      laneEntry(0.5),
      neutralContext(),
    );
    const poorFit = assessRecommendationRisk(
      { total: 0.5, contributions: [] },
      laneEntry(0.04),
      neutralContext(),
    );

    expect(avoid).toMatchObject({ label: "Avoid", reasons: ["Risky lane"] });
    expect(highRisk).toMatchObject({ label: "High risk" });
    expect(poorFit).toMatchObject({ label: "Poor fit", reasons: ["Weak evidence for this role"] });
  });

  it("never condemns a candidate from a single non-material pro observation", () => {
    const observation = proEvidence(1, false);
    const risk = assessRecommendationRisk(
      {
        total: 0.5,
        contributions: [{
          factor: "proLane",
          score: 0.4,
          reasons: ["Observation only"],
          delta: -0.1,
          effectiveDelta: -0.1,
          confidence: 0.9,
          source: "pro",
          proEvidence: [observation],
        }],
      },
      { ...laneEntry(0.5), dataQuality: "pro-supported" },
      neutralContext(),
    );

    expect(risk).toBeNull();
  });

  it("computes ranked/pro balance from absolute evidence actually used", () => {
    const balance = calculateEvidenceBalance([
      recommendation(1, 0.7, [ranked("laneCounter", 0.2, 1), ranked("synergy", -0.1, 1), pro(0.1, 4)]),
    ]);

    expect(balance.rankedMagnitude).toBeCloseTo(0.3);
    expect(balance.proMagnitude).toBeCloseTo(0.1);
    expect(balance).toMatchObject({ rankedPercent: 75, proPercent: 25 });
  });
});

function category(
  categories: ReturnType<typeof projectRecommendationCategories>,
  key: string,
) {
  const value = categories.find((item) => item.key === key);
  if (!value) throw new Error(`Missing ${key} category`);
  return value;
}

function recommendation(
  id: number,
  total: number,
  contributions: ScoreContribution[],
): Recommendation {
  return {
    champion: champion(id),
    total,
    contributions,
    risk: null,
  };
}

function ranked(
  factor: string,
  effectiveDelta: number,
  confidence: number,
): ScoreContribution {
  return {
    factor,
    score: 0.5 + effectiveDelta,
    reasons: [],
    delta: confidence > 0 ? effectiveDelta / confidence : 0,
    effectiveDelta,
    confidence,
    source: "ranked",
  };
}

function pro(effectiveDelta: number, sample: number): ScoreContribution {
  return {
    factor: "proPriority",
    score: 0.5 + effectiveDelta,
    reasons: [],
    delta: effectiveDelta,
    effectiveDelta,
    confidence: 1,
    source: "pro",
    proEvidence: [proEvidence(sample, sample >= 3)],
  };
}

function negative(
  factor: string,
  effectiveDelta: number,
  confidence: number,
  reason: string,
): ScoreContribution {
  return {
    factor,
    score: 0.5 + effectiveDelta,
    reasons: [reason],
    delta: effectiveDelta / confidence,
    effectiveDelta,
    confidence,
    source: "ranked",
    reasonChips: [{
      kind: factor === "laneCounter" ? "lane-counter" : "team-counter",
      text: reason,
      polarity: "negative",
      strength: 1,
      confidence,
    }],
  };
}

function proEvidence(sample: number, material: boolean): ProEvidenceRecord {
  return {
    kind: "priority",
    text: `${sample} pro games`,
    statistics: { games: sample },
    patches: ["26.13"],
    competitions: ["MSI 2026"],
    teams: [],
    effectiveSample: sample,
    confidence: sample / (sample + 5),
    ageDays: 1,
    material,
  };
}

function laneEntry(roleRate: number): LaneMetaEntry {
  return {
    champion: champion(99),
    winRate: 0.5,
    tier: 3,
    roleRate,
  };
}

function champion(id: number): ChampionRef {
  return {
    id,
    slug: `Champion${id}`,
    name: `Champion ${id}`,
    tags: [],
    iconUrl: "",
  };
}

function neutralContext(): TeamContext {
  const composition = {
    adWeight: 0,
    apWeight: 0,
    engage: 0,
    peel: 0,
    frontline: 0,
    poke: 0,
    waveclear: 0,
    cc: 0,
    mobility: 0,
    carryPotential: 0,
    rangedCount: 0,
    powerCurve: { early: 0, mid: 0, late: 0 },
    championCount: 0,
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };
  return {
    ally: composition,
    enemy: composition,
    allyNeeds: [],
    enemyThreats: [],
    confidence: 0,
  };
}
