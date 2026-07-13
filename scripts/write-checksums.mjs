import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const targetDirectory = process.argv[2] ?? "release";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const artifactPrefix = `draft-coach-${packageJson.version}-`;
const artifactPatterns =
  process.platform === "win32"
    ? [/\.exe$/i]
    : process.platform === "darwin"
      ? [/\.zip$/i]
      : [/\.(?:exe|dmg|zip)$/i];

async function main() {
  const entries = await readdir(targetDirectory, { withFileTypes: true });
  const lines = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(artifactPrefix) ||
      !artifactPatterns.some((pattern) => pattern.test(entry.name))
    ) {
      continue;
    }

    const file = join(targetDirectory, entry.name);
    const fileStat = await stat(file);
    if (!fileStat.isFile()) {
      continue;
    }

    const data = await import("node:fs/promises").then(({ readFile }) => readFile(file));
    const hash = createHash("sha256").update(data).digest("hex");
    lines.push(`${hash}  ${entry.name}`);
  }

  if (lines.length === 0) {
    throw new Error(`No current ${artifactPrefix} artifacts found in ${targetDirectory}`);
  }

  lines.sort();
  await writeFile(join(targetDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${lines.length} checksums to ${join(targetDirectory, "SHA256SUMS.txt")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
