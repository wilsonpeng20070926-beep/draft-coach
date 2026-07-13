import { readFile } from "node:fs/promises";

const scope = process.argv[2] ?? "report";
const allowedScopes = new Set(["report", "public", "commercial"]);

if (!allowedScopes.has(scope)) {
  console.error(`Unknown release-policy scope ${scope}`);
  process.exit(2);
}

const policyPath = new URL("../docs/RELEASE_POLICY_STATUS.json", import.meta.url);
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const errors = validatePolicy(policy);

if (errors.length > 0) {
  console.error("Release policy status is invalid:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const publicGates = policy.publicRelease;
const commercialGates = [...publicGates, ...policy.commercialRelease];
const selected = scope === "commercial" ? commercialGates : publicGates;
const blocked = selected.filter((gate) => gate.status === "blocked");

console.log(`Release policy review: ${policy.reviewedAt}`);
for (const gate of selected) {
  console.log(`[${gate.status.toUpperCase()}] ${gate.id}: ${gate.summary}`);
  if (gate.status === "blocked") console.log(`  Owner action: ${gate.ownerAction}`);
}

if (scope !== "report" && blocked.length > 0) {
  console.error(`${scope} release is blocked by ${blocked.length} unresolved policy gate(s)`);
  process.exit(1);
}

if (scope === "report") {
  console.log(`Public release status: ${blocked.length === 0 ? "clear" : "blocked"}`);
}

function validatePolicy(value) {
  const findings = [];
  if (!value || typeof value !== "object") return ["root must be an object"];
  if (value.schemaVersion !== 1) findings.push("schemaVersion must be 1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt ?? "")) {
    findings.push("reviewedAt must be YYYY-MM-DD");
  }
  for (const group of ["publicRelease", "commercialRelease"]) {
    if (!Array.isArray(value[group])) {
      findings.push(`${group} must be an array`);
      continue;
    }
    const ids = new Set();
    for (const gate of value[group]) {
      if (!gate || typeof gate !== "object") {
        findings.push(`${group} contains a non-object gate`);
        continue;
      }
      if (typeof gate.id !== "string" || gate.id.length === 0) {
        findings.push(`${group} gate is missing id`);
      } else if (ids.has(gate.id)) {
        findings.push(`${group} contains duplicate id ${gate.id}`);
      } else {
        ids.add(gate.id);
      }
      if (!new Set(["approved", "blocked", "not-applicable"]).has(gate.status)) {
        findings.push(`${gate.id ?? group} has invalid status`);
      }
      for (const field of ["summary", "ownerAction"]) {
        if (typeof gate[field] !== "string" || gate[field].trim().length === 0) {
          findings.push(`${gate.id ?? group} is missing ${field}`);
        }
      }
      if (!Array.isArray(gate.sourceUrls) || gate.sourceUrls.length === 0) {
        findings.push(`${gate.id ?? group} must cite at least one source`);
      }
    }
  }
  return findings;
}
