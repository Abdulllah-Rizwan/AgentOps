// The Agent: holds the tools and the system prompt, and runs the loop (CLAUDE_agent_v3.md Section
// 12: "an Agent that holds tools + loop"). It knows nothing about Telegram, and the loop knows
// nothing about which tools exist. As of Layer E the agent chooses which allowed repository to act
// on per tool call; each tool validates that choice against the allow-list.

import type OpenAI from "openai";
import { llm } from "../llm/client.js";
import { config } from "../config/env.js";
import { prompts } from "./prompts/index.js";
import { runAgentLoop } from "./loop.js";
import { createReadRepoTool } from "./tools/read-repo.js";
import { createListIssuesTool } from "./tools/list-issues.js";
import { createReadPullRequestTool } from "./tools/read-pull-request.js";
import { createCreateIssueTool } from "./tools/create-issue.js";
import { createOpenPrTool } from "./tools/open-pr.js";
import { createCreateRepoTool } from "./tools/create-repo.js";
import { createDeleteRepoTool } from "./tools/delete-repo.js";
import { allowedRepos, deletableRepos } from "../github/client.js";
import type { AgentTool } from "./tools/types.js";

// Bounded so a bad reasoning chain can't run forever (CLAUDE_agent_v3.md Section 5). Enough for a
// realistic turn: read one or two repos, then act.
const MAX_STEPS = 8;

export class Agent {
  private readonly tools: AgentTool[];
  private readonly systemPrompt: string;

  constructor() {
    this.tools = [
      createReadRepoTool(),
      createListIssuesTool(),
      createReadPullRequestTool(),
      createCreateIssueTool(),
      createOpenPrTool(),
      createCreateRepoTool(),
      createDeleteRepoTool(),
    ];

    // Inject the concrete allow-lists into the static safety prompt so the model knows its options.
    // Both lists are authoritative; every tool independently re-validates the repo the model picks.
    const repoList = allowedRepos()
      .map((r) => `- ${r}`)
      .join("\n");

    // The deletable list is SEPARATE from the read/write list (a repo may be deletable without
    // being workable, and vice versa). Without this block the model cannot see which repos it may
    // delete, so it refuses every delete request without ever calling the tool - the guard in the
    // tool is then never reached. Exact owner/repo spellings are shown so the model copies them
    // verbatim (the guard requires a full, exact match).
    const deletable = deletableRepos();
    const deletableBlock =
      deletable.length > 0
        ? `Repositories you may DELETE with delete_repository (IRREVERSIBLE; ONLY these, named as ` +
          `the exact owner/repo shown; this list is SEPARATE from the one above):\n` +
          deletable.map((r) => `- ${r}`).join("\n")
        : `You may not delete any repository: your deletable list is empty.`;

    this.systemPrompt =
      `${prompts.agent_system}\n\n` +
      `Repositories you may work with (use ONLY these; refuse any other):\n${repoList}\n\n` +
      `${deletableBlock}\n\n` +
      `${prompts.telegram_formatting}`;
  }

  /**
   * Produce a reply to `userMessage`, optionally continuing `priorTurns` of remembered conversation.
   */
  async reply(
    userMessage: string,
    priorTurns: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  ): Promise<string> {
    const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...priorTurns,
      { role: "user", content: userMessage },
    ];
    return runAgentLoop(
      { client: llm, model: config.llm.model, systemPrompt: this.systemPrompt, tools: this.tools, maxSteps: MAX_STEPS },
      conversation
    );
  }
}
