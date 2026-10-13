// Verifies the open-PR cap's pure logic: "its own PR" = head branch under agent/, and the cap
// boundary (at or above the cap -> refuse). The live path (counting real open PRs via
// listPullRequests, then refusing with links) is enforced in the open_pull_request tool against
// config.github.maxOpenAgentPrs. Loads config on import (like the other verify scripts), so a .env
// must be present. Run: node ./node_modules/tsx/dist/cli.mjs scripts/verify-open-pr-cap.ts

import { filterOwnOpenPrs, type PullRequestSummary } from "../src/github/repos.js";

let failures = 0;
function check(label: string, got: boolean, want: boolean) {
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
  if (!pass) failures++;
}

function pr(number: number, headBranch: string): PullRequestSummary {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    author: "someone",
    createdAt: "2026-01-01T00:00:00Z",
    url: `https://github.com/o/r/pull/${number}`,
    headBranch,
    baseBranch: "main",
  };
}

// "Its own" = head branch starts with exactly `agent/`.
const mixed = [
  pr(1, "agent/1700000000000"),
  pr(2, "feature/human-work"),
  pr(3, "agent/1700000000001"),
  pr(4, "agents-club"), // must NOT match: prefix is "agent/", not "agent"
  pr(5, "fix/agent/typo"), // must NOT match: "agent/" not at the start
];
const own = filterOwnOpenPrs(mixed);
check("counts only agent/-prefixed branches", own.length === 2, true);
check("keeps PR #1", own.some((p) => p.number === 1), true);
check("keeps PR #3", own.some((p) => p.number === 3), true);
check("excludes a human feature branch", own.some((p) => p.number === 2), false);
check("excludes 'agents-club' (prefix must be agent/)", own.some((p) => p.number === 4), false);
check("excludes 'fix/agent/typo' (agent/ not at start)", own.some((p) => p.number === 5), false);

// Cap boundary (the check the tool makes: own-count >= cap -> refuse).
const CAP = 3;
const atCap = filterOwnOpenPrs([pr(1, "agent/a"), pr(2, "agent/b"), pr(3, "agent/c")]);
check("at the cap -> would refuse", atCap.length >= CAP, true);
const belowCap = filterOwnOpenPrs([pr(1, "agent/a"), pr(2, "agent/b")]);
check("below the cap -> would allow", belowCap.length >= CAP, false);

console.log(`\n${failures === 0 ? "ALL OPEN-PR-CAP CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
