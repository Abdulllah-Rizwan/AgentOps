// Layer 1 DESTRUCTIVE verification: prove an on-list delete actually deletes, through the real
// delete_repository tool, then confirm the repo is gone. Deletes exactly ONE repo (TARGET below),
// which must be on GITHUB_DELETABLE_REPOS. Irreversible - run only with explicit authorization.

import { createDeleteRepoTool } from "../src/agent/tools/delete-repo.js";
import { octokit } from "../src/github/client.js";

const TARGET = "Abdulllah-Rizwan/VectorDB";
const tool = createDeleteRepoTool();

async function exists(full: string): Promise<boolean> {
  const [owner, repo] = full.split("/");
  try {
    await octokit.rest.repos.get({ owner, repo });
    return true;
  } catch (err: any) {
    if (err?.status === 404) return false;
    throw err;
  }
}

console.log(`Before: ${TARGET} exists = ${await exists(TARGET)}`);

const result = JSON.parse(await tool.execute(JSON.stringify({ repo: TARGET })));
console.log(`Tool result: ${JSON.stringify(result)}`);

// GitHub's delete is async server-side; give it a moment, then confirm the 404.
await new Promise((r) => setTimeout(r, 2000));
const stillThere = await exists(TARGET);
console.log(`After:  ${TARGET} exists = ${stillThere}`);

const ok = result.ok === true && stillThere === false;
console.log(`\n${ok ? "PASS: on-list delete worked and the repo is gone." : "FAIL: see output above."}`);
process.exit(ok ? 0 : 1);
