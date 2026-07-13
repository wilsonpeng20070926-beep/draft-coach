import { describe, expect, it } from "vitest";
import {
  EVALUATION_CONFIGURATIONS,
  evaluationConfiguration,
} from "../src/main/evaluation/evaluationConfigurations";
import { DEFAULT_APP_CONFIG } from "../src/shared/config";

describe("evaluation configurations", () => {
  it("defines ranked-only, current, blended, and pro-forward comparisons explicitly", () => {
    expect(EVALUATION_CONFIGURATIONS.map((item) => item.id)).toEqual([
      "ranked-only",
      "current-engine",
      "blended-default",
      "pro-forward",
    ]);
    expect(evaluationConfiguration("ranked-only")).toMatchObject({
      proEvidenceEnabled: false,
      proInfluence: 0,
      weights: {
        meta: 1,
        laneCounter: 0,
        teamCounter: 0,
        synergy: 0,
        compFit: 0,
      },
    });
    expect(evaluationConfiguration("current-engine")).toMatchObject({
      proEvidenceEnabled: false,
      weights: DEFAULT_APP_CONFIG.weights,
    });
    expect(evaluationConfiguration("blended-default")).toMatchObject({
      proEvidenceEnabled: true,
      proInfluence: DEFAULT_APP_CONFIG.proInfluence,
    });
    expect(evaluationConfiguration("pro-forward")).toMatchObject({
      proEvidenceEnabled: true,
      proInfluence: 1,
    });
    expect(evaluationConfiguration("pro-forward").weights.meta).toBeLessThan(
      evaluationConfiguration("blended-default").weights.meta,
    );
  });
});
