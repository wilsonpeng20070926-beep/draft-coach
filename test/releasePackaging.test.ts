import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/shared/appInfo";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("release packaging", () => {
  it("keeps the displayed app version aligned with package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };

    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("checksums only the current platform artifact and detects tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-coach-release-"));
    directories.push(directory);
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const currentArtifact =
      process.platform === "win32"
        ? `draft-coach-${packageJson.version}-win-${process.arch}.exe`
        : `draft-coach-${packageJson.version}-mac-${process.arch}.zip`;
    await writeFile(join(directory, currentArtifact), "current artifact", "utf8");
    await writeFile(join(directory, "Draft Coach-0.1.0-mac-arm64.zip"), "stale", "utf8");

    await execFileAsync(process.execPath, ["scripts/write-checksums.mjs", directory]);
    const checksums = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");

    expect(checksums).toContain(currentArtifact);
    expect(checksums).not.toContain("0.1.0");
    await expect(
      execFileAsync(process.execPath, ["scripts/verify-checksums.mjs", directory]),
    ).resolves.toMatchObject({ stdout: expect.stringContaining(`${currentArtifact}: OK`) });

    await writeFile(join(directory, currentArtifact), "tampered artifact", "utf8");
    await expect(
      execFileAsync(process.execPath, ["scripts/verify-checksums.mjs", directory]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Checksum mismatch") });
  });

  it("keeps the Windows packaging workflow private and launch-tested", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github/workflows/private-windows-package.yml"),
      "utf8",
    );
    const normalizedWorkflow = workflow.replace(/\r\n/g, "\n");

    expect(normalizedWorkflow).toContain("runs-on: windows-latest");
    expect(normalizedWorkflow).toContain("pull_request:");
    expect(normalizedWorkflow).toContain("push:");
    expect(normalizedWorkflow).toContain("permissions:\n  contents: read");
    expect(normalizedWorkflow).toContain("name: Verify source\n        shell: bash");
    expect(normalizedWorkflow).toContain("npm run dist:dir");
    expect(normalizedWorkflow).toContain("DRAFT_COACH_SMOKE");
    expect(normalizedWorkflow).toContain("Get-AuthenticodeSignature");
    expect(normalizedWorkflow).toContain("actions/upload-artifact@v7");
    expect(normalizedWorkflow).not.toContain("softprops/action-gh-release");
    expect(normalizedWorkflow).not.toContain("npm run release:policy:assert");
  });
});
