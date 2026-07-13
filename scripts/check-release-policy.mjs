import { readFile } from "node:fs/promises";

const scope = process.argv[2] ?? "report";
const allowedScopes = new Set(["report", "preview", "public", "commercial"]);

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
const preview = policy.uncertifiedPreview;

console.log(`Release policy review: ${policy.reviewedAt}`);
for (const gate of selected) {
  console.log(`[${gate.status.toUpperCase()}] ${gate.id}: ${gate.summary}`);
  if (gate.status === "blocked") console.log(`  Owner action: ${gate.ownerAction}`);
}

if (scope === "preview") {
  const acknowledged = new Set(preview.acknowledgedGateIds);
  const unacknowledged = blocked.filter((gate) => !acknowledged.has(gate.id));
  const releaseTag = process.env.GITHUB_REF_NAME;

  if (releaseTag && !new RegExp(preview.requiredTagPattern).test(releaseTag)) {
    console.error(
      `uncertified preview tag ${releaseTag} does not match ${preview.requiredTagPattern}`,
    );
    process.exit(1);
  }

  if (unacknowledged.length > 0) {
    console.error(
      `uncertified preview is missing explicit acknowledgement for ${unacknowledged.length} blocked gate(s)`,
    );
    process.exit(1);
  }

  console.warn(`[UNCERTIFIED PREVIEW] ${preview.requiredDisclosure}`);
  console.log("Uncertified preview release status: owner-authorized prerelease");
} else if (scope !== "report" && blocked.length > 0) {
  console.error(`${scope} release is blocked by ${blocked.length} unresolved policy gate(s)`);
  process.exit(1);
}

if (scope === "report") {
  console.log(`Public release status: ${blocked.length === 0 ? "clear" : "blocked"}`);
}

function validatePolicy(value) {
  const findings = [];
  if (!value || typeof value !== "object") return ["root must be an object"];
  if (value.schemaVersion !== 2) findings.push("schemaVersion must be 2");
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
  const preview = value.uncertifiedPreview;
  if (!preview || typeof preview !== "object") {
    findings.push("uncertifiedPreview must be an object");
  } else {
    if (preview.status !== "owner-authorized") {
      findings.push("uncertifiedPreview status must be owner-authorized");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preview.ownerAuthorizedAt ?? "")) {
      findings.push("uncertifiedPreview ownerAuthorizedAt must be YYYY-MM-DD");
    }
    if (preview.requiredReleaseType !== "prerelease") {
      findings.push("uncertifiedPreview requiredReleaseType must be prerelease");
    }
    for (const field of ["summary", "requiredDisclosure", "requiredTagPattern"]) {
      if (typeof preview[field] !== "string" || preview[field].trim().length === 0) {
        findings.push(`uncertifiedPreview is missing ${field}`);
      }
    }
    if (typeof preview.requiredTagPattern === "string") {
      try {
        new RegExp(preview.requiredTagPattern);
      } catch {
        findings.push("uncertifiedPreview requiredTagPattern must be a valid regular expression");
      }
    }
    if (!Array.isArray(preview.acknowledgedGateIds) || preview.acknowledgedGateIds.length === 0) {
      findings.push("uncertifiedPreview acknowledgedGateIds must be a non-empty array");
    } else {
      const gateIds = new Set(
        Array.isArray(value.publicRelease) ? value.publicRelease.map((gate) => gate.id) : [],
      );
      for (const id of preview.acknowledgedGateIds) {
        if (typeof id !== "string" || !gateIds.has(id)) {
          findings.push(`uncertifiedPreview acknowledges unknown gate ${String(id)}`);
        }
      }
    }
  }
  return findings;
}
