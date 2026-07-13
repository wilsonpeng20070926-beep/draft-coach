import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

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

    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("npm run dist:dir");
    expect(workflow).toContain("DRAFT_COACH_SMOKE");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).not.toContain("softprops/action-gh-release");
    expect(workflow).not.toContain("npm run release:policy:assert");
  });
});
