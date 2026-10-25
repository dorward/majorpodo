import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const command = (args, body, allowMissing = false) => {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing && result.stderr.includes("HTTP 404")) return null;
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const api = (route, method = "GET", body, allowMissing = false) =>
  command(
    ["api", "--method", method, route, ...(body === undefined ? [] : ["--input", "-"])],
    body,
    allowMissing,
  );
const repository = command(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
const info = api(`repos/${repository}`);
assert.equal(
  info.visibility,
  "public",
  "Only public repositories are supported by this free security setup",
);
assert.ok(info.permissions?.admin, "Repository admin rights are required");
api(`repos/${repository}/vulnerability-alerts`, "PUT");
api(`repos/${repository}/automated-security-fixes`, "PUT");
api(`repos/${repository}`, "PATCH", {
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
  },
});
console.log("Enabled Dependabot alerts/security fixes, secret scanning and push protection.");
const branch = encodeURIComponent(info.default_branch);
for (const workflow of ["ci", "security", "release"]) {
  assert.ok(
    api(
      `repos/${repository}/contents/.github/workflows/${workflow}.yml?ref=${branch}`,
      "GET",
      undefined,
      true,
    ),
    "Push/merge the v2 workflows into the default branch before installing required status checks",
  );
}
const contexts = [
  "Checks",
  "Docker smoke",
  "Dependency audit",
  "Dependency review",
  "CodeQL",
  "Container scan (http)",
  "Container scan (scanner)",
  "Container scan (postgres)",
];
const endpoint = `repos/${repository}/branches/${branch}/protection`;
const protection = api(endpoint, "GET", undefined, true);
const appId = api("apps/github-actions").id;
const checks = new Map(
  (protection?.required_status_checks?.contexts ?? []).map((context) => [
    context,
    { context, app_id: -1 },
  ]),
);
for (const check of protection?.required_status_checks?.checks ?? [])
  checks.set(check.context, { context: check.context, app_id: check.app_id ?? -1 });
for (const context of contexts)
  if (!checks.has(context)) checks.set(context, { context, app_id: appId });
if (protection) {
  // Update only status-check protection, retaining review/admin/push restrictions
  // and the existing GitHub App bindings on unrelated checks.
  api(endpoint + "/required_status_checks", "PATCH", {
    strict: true,
    checks: [...checks.values()],
  });
} else {
  api(endpoint, "PUT", {
    required_status_checks: { strict: true, checks: [...checks.values()] },
    enforce_admins: false,
    required_pull_request_reviews: { required_approving_review_count: 0 },
    restrictions: null,
  });
}
console.log(`Required security/CI checks configured on ${info.default_branch}.`);
