import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const blockedPathFragments = [
  ".claude/",
  ".env",
  "handoff.md",
  "HANDOFF",
  "node_modules/",
  "out/",
  "release/",
  ".DS_Store",
];

const blockedFilePatterns = [
  /(?:^|\/)(?:\d{4}_)?LoL_esports_match_data_from_OraclesElixir\.csv$/i,
  /(?:^|\/)local-oe-snapshot\.json(?:\.gz)?$/i,
];

const contentRules = [
  { label: "local macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+/ },
  { label: "private key block", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

const { stdout } = await execFileAsync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
]);

const files = stdout.split("\0").filter(Boolean);
const findings = [];

for (const file of files) {
  try {
    await access(file);
  } catch {
    continue;
  }

  if (
    blockedPathFragments.some((fragment) => file.includes(fragment)) ||
    blockedFilePatterns.some((pattern) => pattern.test(file))
  ) {
    findings.push(`${file}: blocked public-snapshot path`);
    continue;
  }

  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue;
  }

  for (const rule of contentRules) {
    const match = rule.pattern.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line}: ${rule.label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Public snapshot scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Public snapshot scan passed for ${files.length} candidate files`);
