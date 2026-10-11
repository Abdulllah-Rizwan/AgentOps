// Layer 1 verification: prove the delete_repository guard REFUSES an off-list repo before any
// GitHub call, and would ACCEPT only an explicitly-listed one. Runs the real tool execute() path
// and the real resolver - no mocks. It performs NO destructive deletion: the off-list cases are
// refused in-code (no network), and the on-list case is checked only up to "the guard passes"
// (resolver resolves it) without invoking the actual delete.
//
// Run: node ./node_modules/tsx/dist/cli.mjs scripts/verify-delete-guard.ts
// Requires .env with GITHUB_DELETABLE_REPOS set to exactly one repo (the sandbox).

import { createDeleteRepoTool } from "../src/agent/tools/delete-repo.js";
import { resolveDeletableRepo, deletableRepos } from "../src/github/client.js";

const tool = createDeleteRepoTool();

let failures = 0;
function check(label: string, pass: boolean, detail: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}\n      ${detail}`);
  if (!pass) failures++;
}

async function run(repo: string): Promise<{ ok?: boolean; error?: string }> {
  return JSON.parse(await tool.execute(JSON.stringify({ repo })));
}

console.log(`\nDeletable list in effect: ${deletableRepos().join(", ") || "(empty)"}\n`);

const onList = deletableRepos()[0];
if (!onList) {
  console.error("This test expects GITHUB_DELETABLE_REPOS to name exactly the sandbox repo. Aborting.");
  process.exit(1);
}

// 1. Off-list, fully-qualified owner/repo -> refused, no network. Use a name guaranteed NOT to be
//    on the configured delete list, so this holds regardless of what GITHUB_DELETABLE_REPOS contains.
const offList = "someowner/definitely-not-on-the-delete-list";
if (deletableRepos().some((r) => r.toLowerCase() === offList.toLowerCase())) {
  console.error("Test fixture clash: the off-list name is actually on the list. Pick another.");
  process.exit(1);
}
const r1 = await run(offList);
check(
  "off-list owner/repo is refused",
  r1.ok !== true && typeof r1.error === "string" && r1.error.includes("not a repository you may delete"),
  JSON.stringify(r1)
);

// 2. A bare repo name (no owner) never resolves onto the delete list -> refused.
const r2 = await run("AgentOpsDeleteSandbox");
check(
  "bare repo name (no owner) is refused",
  r2.ok !== true && typeof r2.error === "string",
  JSON.stringify(r2)
);

// 3. Empty / malformed input -> refused cleanly, never a delete.
const r3 = await run("");
check("empty repo name is refused", r3.ok !== true, JSON.stringify(r3));

// 4. The on-list repo RESOLVES through the guard (would be permitted). We assert the resolver,
//    NOT the destructive call - proving the guard is a discriminator, not a blanket "no".
const resolved = resolveDeletableRepo(onList);
check(
  "on-list owner/repo resolves (guard would permit)",
  resolved !== null,
  resolved ? `${resolved.owner}/${resolved.repo}` : "did not resolve"
);

// 5. Case-insensitivity: the guard shouldn't be dodged or broken by casing.
const resolvedCased = resolveDeletableRepo(onList.toUpperCase());
check("on-list match is case-insensitive", resolvedCased !== null, onList.toUpperCase());

console.log(`\n${failures === 0 ? "ALL GUARD CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
