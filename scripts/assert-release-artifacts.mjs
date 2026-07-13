import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory = process.argv[2] ?? "release";
const entries = await readdir(releaseDirectory);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;

const expectedArtifacts =
  process.platform === "win32"
    ? [`draft-coach-${version}-win-${process.arch}.exe`]
  : process.platform === "darwin"
      ? [`draft-coach-${version}-mac-${process.arch}.zip`]
      : [];

if (expectedArtifacts.length === 0) {
  console.log(`No platform artifact expectations for ${process.platform}`);
  process.exit(0);
}

const missing = expectedArtifacts.filter((artifact) => !entries.includes(artifact));

if (missing.length > 0) {
  console.error(`Release artifacts in ${join(process.cwd(), releaseDirectory)}:`);
  for (const entry of entries) {
    console.error(`- ${entry}`);
  }
  console.error(`Missing current artifact(s): ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Verified ${expectedArtifacts.join(", ")} in ${releaseDirectory}`);
