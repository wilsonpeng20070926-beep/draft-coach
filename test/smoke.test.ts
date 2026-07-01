import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect("pong").toBe("pong");
  });
});
