import { describe, expect, it } from "vitest";
import {
  formatReasonChip,
  sortReasonChips,
} from "../src/renderer/formatters/reasonChips";
import type { ReasonChip } from "../src/shared/types";

describe("reason chip formatter", () => {
  it("applies one shared confidence hedge and strips older hedge text", () => {
    expect(
      formatReasonChip(chip("synergy", "Possible OP-tier synergy with Amumu", 0.95)).text,
    ).toBe("OP-tier synergy with Amumu");
    expect(
      formatReasonChip(chip("comp-fit", "Adds AP to an AD-heavy team", 0.7)).text,
    ).toBe("Likely adds AP to an AD-heavy team");
    expect(
      formatReasonChip(
        chip("team-counter", "Possibly Squishy into their dive", 0.35, "negative"),
      ).text,
    ).toBe("Possibly squishy into their dive");
  });

  it("sorts by strength and marks negative chips distinctly", () => {
    const weak = chip("comp-fit", "Adds AP", 1, "positive", 0.2);
    const strongRisk = chip("team-counter", "Squishy into their dive", 1, "negative", 0.8);

    expect(sortReasonChips([weak, strongRisk])).toEqual([strongRisk, weak]);
    expect(formatReasonChip(strongRisk).className).toContain("reason-chip-negative");
  });
});

function chip(
  kind: ReasonChip["kind"],
  text: string,
  confidence: number,
  polarity: ReasonChip["polarity"] = "positive",
  strength = 0.5,
): ReasonChip {
  return {
    kind,
    text,
    polarity,
    strength,
    confidence,
  };
}
