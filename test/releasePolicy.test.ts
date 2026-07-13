import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runPolicy(
  scope: "preview" | "public",
  refName = scope === "preview" ? "v0.2.0-preview.1" : "v0.2.0",
) {
  return execFileAsync(process.execPath, ["scripts/check-release-policy.mjs", scope], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITHUB_REF_NAME: refName,
    },
  });
}

describe("release policy channels", () => {
  it("allows the explicitly disclosed owner-authorized preview channel", async () => {
    await expect(runPolicy("preview")).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Uncertified preview release status: owner-authorized prerelease",
      ),
      stderr: expect.stringContaining("[UNCERTIFIED PREVIEW]"),
    });
  });

  it("continues to block stable publication while external reviews are unresolved", async () => {
    await expect(runPolicy("public")).rejects.toMatchObject({
      stderr: expect.stringContaining("public release is blocked by 3 unresolved policy gate(s)"),
    });
  });

  it("rejects preview authorization for a stable-looking tag", async () => {
    await expect(runPolicy("preview", "v0.2.0")).rejects.toMatchObject({
      stderr: expect.stringContaining("does not match"),
    });
  });
});
