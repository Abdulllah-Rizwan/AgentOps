# AgentOps

A Telegram-commanded GitHub agent. It **reasons** over a plain-language request, picks from its own tools, reads real repo content before acting, remembers the conversation across turns, and reports back over Telegram.

This is the **v3 rebuild** — a real agent loop, not the v1/v2 keyword classifier. See `CLAUDE_agent_v3.md` for the spec/build philosophy and `decisions.md` for the full decision log.

## How it works

```
Telegram message (allow-listed senders only)
  → load this chat's conversation memory
  → send to the LLM with: system prompt + tool definitions + memory + message
  → the LLM either replies, or calls a tool → run it → feed the result back → loop
  → final reply → save to memory → send back to Telegram
```

The LLM is handed its tools every turn (function/tool calling) and decides which to use — no magic keywords, no hardcoded chat/issue/PR buckets. The loop is capped at **8 steps** per message (`MAX_STEPS` in `src/agent/agent.ts`) so a bad reasoning chain can't run away.

### Tools the agent can call

| Tool | Access | What it does |
|---|---|---|
| `read_repo` | read | Lists files / reads real file content so answers are grounded |
| `list_issues` | read | Lists recent issues (filters out PRs), newest-first |
| `read_pull_request` | read | Lists recent PRs, or a full PR with per-file diffs (review only — never merges/comments) |
| `create_issue` | write | Files a GitHub issue in an allowed repo |
| `open_pull_request` | write | Commits the agent-reasoned file contents to a fresh branch and opens a PR |
| `create_repository` | write | Creates a new repo (private by default) under the token owner's account |

The agent **never commits directly to a default branch** — real-repo changes land as reviewable PRs. Every model-chosen repo name is re-validated against the allow-list inside the tool; anything off-list is refused.

### Memory

Per-chat conversation history is persisted in **Upstash Redis** (keyed per `chatId`, last 20 messages, no cross-chat bleed), so context survives across turns and serverless cold starts. If the Upstash vars are unset, it falls back to an in-memory store — fine for local dev only, does not persist across cold starts.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm run dev` — runs the bot locally via long-polling.

> Note: a single Telegram bot token can only be in **one** receive mode at a time (polling *or* webhook). Running `npm run dev` locally deletes any registered production webhook; re-register it when you go back to the deployed version.

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local bot via long-polling |
| `npm run build` | `tsc` compile + copy `prompts.txt` into `dist` |
| `npm run config:check` | Validate env/config loads correctly |
| `npm run verify:tools` | Confirm the LLM's tool-calling round-trips live |
| `npm run try:agent -- "<msg>"` | Drive the agent loop once from the CLI |
| `npm run try:memory -- "<msg>"` | Exercise the persistent memory path |

## Environment variables

All env vars are read and validated in one place: `src/config/env.ts` (fail-fast at startup).

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | From [BotFather](https://t.me/BotFather) |
| `ALLOWED_TELEGRAM_USER_IDS` | yes | Comma-separated numeric Telegram IDs allowed to use the bot |
| `DEEPSEEK_API_KEY` | yes | DeepSeek API key |
| `GITHUB_PAT` | yes | Fine-grained PAT scoped to exactly the playground + allowed repos (short expiry) |
| `GITHUB_PLAYGROUND_REPO` | yes | `owner/repo` the agent may write to freely |
| `ALLOWED_TARGET_REPOS` | yes | Comma-separated `owner/repo` allow-list the agent may PR/issue into (never org-wide) |
| `LLM_MODEL` | no | Model name; defaults to `deepseek-v4-flash`. Swappable by config alone |
| `LLM_BASE_URL` | no | Defaults to `https://api.deepseek.com` |
| `UPSTASH_REDIS_REST_URL` | no\* | Upstash Redis REST URL for persistent memory |
| `UPSTASH_REDIS_REST_TOKEN` | no\* | Upstash Redis REST token |
| `TELEGRAM_WEBHOOK_SECRET` | prod | Verifies webhook requests in production. Not needed for local polling |
| `GITHUB_PR_REPOS` | no | v2 fallback; used only if `ALLOWED_TARGET_REPOS` is empty |

\* Memory persists across cold starts only when both Upstash vars are set; otherwise an in-memory fallback is used (local dev only).

## Project structure

One job per module — all GitHub calls go through `github/`, all model calls through `llm/`, all memory through `memory/` (`CLAUDE_agent_v3.md` Section 12).

```
src/
  index.ts              # local entry (long-polling) — wiring only
  agent/
    agent.ts            # assembles tools + system prompt; registers the toolset
    loop.ts             # the reasoning loop (orchestration only, maxSteps cap)
    conversation.ts     # builds the message list sent to the model
    tools/              # one file per tool (read-repo, list-issues, read-pull-request,
                        #   create-issue, open-pr, create-repo) + shared tool types
    prompts/            # externalized prompts (prompts.txt + loader); [SAFETY-CRITICAL]/[TUNABLE] labels
  llm/client.ts         # DeepSeek client + tool-call plumbing — only place that calls the model
  github/               # client.ts (Octokit), repos.ts (reads), writes.ts (branches/commits/PRs)
  memory/store.ts       # Upstash-backed per-chat history (in-memory fallback)
  telegram/             # bot.ts (send/receive), format.ts (Telegram Markdown + 4096-char split)
  config/               # env.ts (load + validate once), check.ts (config:check script)
  utils/paths.ts        # pure validation helpers (safe repo paths, repo-name checks)
  types/index.ts        # shared TypeScript interfaces
api/
  telegram.ts           # Vercel webhook entry — acks fast, runs the agent via waitUntil()
```

## Prompts

Prompts live in `src/agent/prompts/prompts.txt` (plain text, so messy multi-line prompts don't break). Lines are labelled `[SAFETY-CRITICAL]` (do not edit — these are load-bearing safety rules like default-to-safe and allow-list enforcement) or `[TUNABLE]` (style/tone, safe to adjust). The build copies this file into `dist`, and `vercel.json` bundles it for the webhook function.

## Deployment

Production runs on Vercel via `api/telegram.ts` (webhook), which acknowledges Telegram immediately and runs the agent in the background with `waitUntil()` so slow work doesn't trigger duplicate retries. Env-var changes only take effect on a **redeploy**. See `DEPLOYMENT.md` for the full guide.
