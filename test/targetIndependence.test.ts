import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const targetSensitiveFiles = [
  "src/main/engine/engine.ts",
  "src/main/engine/candidatePool.ts",
  "src/main/engine/factors/counterModule.ts",
  "src/main/engine/factors/synergyModule.ts",
  "src/main/engine/factors/compFitModule.ts",
  "src/main/engine/factors/teamCounterModule.ts",
];

describe("target-independent recommendation paths", () => {
  it("does not read the local player's role as the recommendation target", () => {
    for (const relativePath of targetSensitiveFiles) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");

      expect(source, relativePath).not.toMatch(/draft\.localPlayer(?:\?|)\.role/);
    }
  });
});
