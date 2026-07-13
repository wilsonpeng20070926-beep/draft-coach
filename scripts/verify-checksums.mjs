import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const targetDirectory = process.argv[2] ?? "release";
const checksumFile = join(targetDirectory, "SHA256SUMS.txt");
const lines = (await readFile(checksumFile, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (lines.length === 0) {
  throw new Error(`${checksumFile} contains no checksums`);
}

for (const line of lines) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);

  if (!match) {
    throw new Error(`Invalid checksum line: ${line}`);
  }

  const [, expected, artifactName] = match;

  if (basename(artifactName) !== artifactName) {
    throw new Error(`Unsafe artifact path in checksum file: ${artifactName}`);
  }

  const actual = createHash("sha256")
    .update(await readFile(join(targetDirectory, artifactName)))
    .digest("hex");

  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${artifactName}`);
  }

  console.log(`${artifactName}: OK`);
}
