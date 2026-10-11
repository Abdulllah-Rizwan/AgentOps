// Read-only: inspect every repo on GITHUB_DELETABLE_REPOS before any destructive test, and confirm
// the PAT can both read them and (via its scopes) would be allowed to delete. No deletion here.

import { octokit } from "../src/github/client.js";
import { config } from "../src/config/env.js";
import { repoKey } from "../src/types/index.js";

for (const ref of config.github.deletableRepos) {
  const key = repoKey(ref);
  try {
    const { data } = await octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });
    console.log(
      `${key}\n` +
        `   private=${data.private}  size=${data.size}KB  default=${data.default_branch}\n` +
        `   pushed=${data.pushed_at}  desc=${data.description ?? "(none)"}  permissions.admin=${data.permissions?.admin}`
    );
  } catch (err: any) {
    console.log(`${key}\n   ERROR reading: ${err?.status ?? ""} ${err?.message ?? err}`);
  }
}
