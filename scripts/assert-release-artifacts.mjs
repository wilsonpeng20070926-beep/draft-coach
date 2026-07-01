import { readdir } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory = process.argv[2] ?? "release";
const entries = await readdir(releaseDirectory);

const expectations =
  process.platform === "win32"
    ? [/\.exe$/i]
  : process.platform === "darwin"
      ? [/\.zip$/i]
      : [];

if (expectations.length === 0) {
  console.log(`No platform artifact expectations for ${process.platform}`);
  process.exit(0);
}

const missing = expectations.filter((pattern) => !entries.some((entry) => pattern.test(entry)));

if (missing.length > 0) {
  console.error(`Release artifacts in ${join(process.cwd(), releaseDirectory)}:`);
  for (const entry of entries) {
    console.error(`- ${entry}`);
  }
  console.error(`Missing expected artifact pattern(s): ${missing.map(String).join(", ")}`);
  process.exit(1);
}

console.log(`Release artifacts verified in ${releaseDirectory}`);
