// Layer 2 verification: the allow-list reads are LIVE from the repo-store, inside ONE running
// process with NO restart. It seeds the store from .env, prints the lists, prunes one target via
// removeRepoEverywhere() (the exact in-memory mutation a real delete triggers in Layer 3), then
// prints again - the pruned repo is gone from every allow-list function immediately. The agent's
// system prompt is rebuilt per reply from these same functions, so the next turn's prompt reflects
// it too. Restores the store afterwards so running this never changes your real lists.
// Run: node ./node_modules/tsx/dist/cli.mjs scripts/verify-repo-store.ts

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { allowedRepos, deletableRepos, resolveAllowedRepo, assertRepoAllowed } from "../src/github/client.js";
import { getTargetRepos, removeRepoEverywhere, repoStorePath } from "../src/config/repo-store.js";
import { repoKey } from "../src/types/index.js";

const storePath = repoStorePath();
const existedBefore = existsSync(storePath);
const snapshot = existedBefore ? readFileSync(storePath, "utf8") : null;

function show(label: string): void {
  console.log(`\n== ${label} ==`);
  console.log("allowed  :", allowedRepos().join(", ") || "(none)");
  console.log("deletable:", deletableRepos().join(", ") || "(none)");
}

console.log("repo store:", storePath);
show("initial (seeded from .env)");

const victim = getTargetRepos()[0];
if (!victim) {
  console.log("\nNo target repos configured - add one to ALLOWED_TARGET_REPOS in .env to run this proof.");
} else {
  const key = repoKey(victim);
  console.log(`\n-> removeRepoEverywhere("${key}")   (same in-process mutation a delete will trigger)`);
  removeRepoEverywhere(victim);

  show("after prune - SAME process, no restart");

  const resolvesGone = resolveAllowedRepo(key) === null;
  console.log("\nresolveAllowedRepo:", resolvesGone ? "null (correctly gone)" : "STILL RESOLVES (bug!)");
  let refused = false;
  try {
    assertRepoAllowed(victim);
  } catch {
    refused = true;
  }
  console.log("assertRepoAllowed :", refused ? "refuses it (correct)" : "STILL ALLOWS (bug!)");
  console.log(
    "\nnote: Agent.buildSystemPrompt() reads allowedRepos()/deletableRepos() per reply, so the next\n" +
      "      turn's injected prompt no longer lists this repo either - no restart."
  );
}

// Non-destructive: put the store back exactly as it was (or remove the file we seeded).
if (snapshot !== null) {
  writeFileSync(storePath, snapshot, "utf8");
  console.log("\n(restored repo store to its prior contents)");
} else if (existsSync(storePath)) {
  rmSync(storePath);
  console.log("\n(removed the seeded repo store - it re-seeds from .env next run)");
}
