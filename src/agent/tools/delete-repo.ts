// The delete_repository tool: the ONE irreversible action the agent can take. It is gated by its
// own narrow allow-list (GITHUB_DELETABLE_REPOS), kept separate from the read/write allow-list -
// being willing to receive a PR into a repo is not the same as being willing to destroy it. The
// model must name a FULL "owner/repo"; a name that isn't explicitly on the delete list is refused
// here (and again in github/writes.ts) before any GitHub call is made. There is no force path.

import { deleteRepository } from "../../github/writes.js";
import { resolveDeletableRepo, deletableRepos } from "../../github/client.js";
import type { AgentTool } from "./types.js";

export function createDeleteRepoTool(): AgentTool {
  return {
    definition: {
      type: "function",
      function: {
        name: "delete_repository",
        description:
          "Permanently delete a GitHub repository. This is IRREVERSIBLE and cannot be undone. You " +
          "may only delete a repository that is explicitly on your deletable-repository list; any " +
          "other repository will be refused. Only use this when a person has clearly asked for that " +
          "specific repository to be deleted.",
        parameters: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description: "The repository to delete, as a full 'owner/repo' (must be on the deletable list).",
            },
          },
          required: ["repo"],
        },
      },
    },

    async execute(argsJson: string): Promise<string> {
      let repoName = "";
      try {
        const parsed = JSON.parse(argsJson || "{}");
        if (typeof parsed.repo === "string") repoName = parsed.repo.trim();
      } catch {
        return JSON.stringify({ error: "arguments were not valid JSON" });
      }

      if (!repoName) return JSON.stringify({ error: "a repository name ('owner/repo') is required" });

      // The gate: resolve against the deletable list only. An off-list (or bare) name never resolves,
      // so it is refused here without any network call - the safe default.
      const repo = resolveDeletableRepo(repoName);
      if (!repo) {
        const list = deletableRepos();
        return JSON.stringify({
          error:
            `"${repoName}" is not a repository you may delete. ` +
            (list.length > 0
              ? `Deletable repositories: ${list.join(", ")}.`
              : "No repositories are on the deletable list, so nothing can be deleted."),
        });
      }

      try {
        await deleteRepository(repo);
      } catch (err) {
        // Includes the re-assertion in writes.ts and any GitHub-side failure (e.g. PAT lacks delete
        // rights). Return an error-shaped result so the model reports it rather than the loop throwing.
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }

      return JSON.stringify({ ok: true, deleted: `${repo.owner}/${repo.repo}` });
    },
  };
}
