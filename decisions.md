# decisions.md — Progress & Decision Log

> Reference this file at the start of every new session, alongside `CLAUDE.md` (the spec/build guide). This file tracks what's actually been decided and done so far — `CLAUDE.md` stays the plan; this stays the record.

---

## Decisions made

1. **Runtime: Node.js + TypeScript** (not FastAPI/Python). Reasoning: Vercel is Node-native for serverless deployment; Python on Vercel works but is second-class there (heavier cold starts, more setup for the ASGI/webhook adapter at Layer 5). Python had no capability gap otherwise — this was purely about deployment friction at Layer 5. Confirmed by developer 2026-09-09.
2. **Telegram library: Telegraf** (over `node-telegram-bot-api`). Reasoning: modern TS types, promise-based API, and its middleware pattern carries forward cleanly when Layer 5 switches long-polling → webhook.
3. **Git initialized at project root** (`C:\AgentOps`) from Layer 0 onward, so every later layer has version history.

---

## Progress so far

### Layer 0 — Echo bot (local, polling) — ✅ DONE, confirmed working

Built:
- `package.json`, `tsconfig.json` — Node/TS project, `strict: true`, ESM (`NodeNext`)
- `.gitignore` — excludes `node_modules/`, `dist/`, `.env`
- `.env.example` — `TELEGRAM_BOT_TOKEN=` (name only, per Section 7 of CLAUDE.md)
- `src/index.ts` — Telegraf bot, replies `I received: <text>` to any text message, long-polling via `bot.launch()`, graceful shutdown on SIGINT/SIGTERM

Verified:
- `npm run build` compiles clean
- End-to-end test passed: message sent to the test bot in Telegram → echo reply received

### Layer 1 — Sender allow-list — ✅ DONE, confirmed working

Built:
- `.env.example` / `.env` — added `ALLOWED_TELEGRAM_USER_IDS=` (comma-separated numeric Telegram user IDs)
- `src/index.ts` — parses `ALLOWED_TELEGRAM_USER_IDS` into a `Set<number>` at startup (throws if the env var is entirely missing, but an empty value is allowed for bootstrapping); added a `bot.use(...)` middleware ahead of the text handler that checks `ctx.from.id` against the set — allowed IDs call `next()` and proceed to the echo handler, everyone else is silently dropped (no reply) with the rejected ID logged server-side

Bootstrap trick used: ran the bot with an empty allow-list, sent it a message, read the developer's own numeric Telegram ID off the "Ignored message from unauthorized user ID: ..." console log, then pasted that ID into `.env`.

Verified:
- `npm run build` compiles clean
- End-to-end test passed: after adding the developer's own ID to `ALLOWED_TELEGRAM_USER_IDS` and restarting, messages from that account get the echo reply again
- Rejection path (a different account gets silence) verified by code review of the middleware logic, not by an actual second-account test

### Known environment gotcha — local dev requires a VPN

The developer is in Pakistan, where Telegram is blocked at the ISP level. This blocks the bot's long-polling connection to `api.telegram.org` locally (not a code issue — confirmed via raw TCP tests timing out against Telegram's own IP).

What did and didn't work:
- ❌ Browser-extension VPN (Edge) — only tunnels that browser's traffic, not Node.js
- ❌ Cloudflare WARP in full-tunnel modes (UDP / TLS / HTTPS) — ISP blocked these; only WARP's DNS-only modes connected (which don't route real traffic)
- ✅ **NordVPN (system-wide VPN client)** — worked, bot started replying immediately

**Rule going forward:** if the bot/server can't reach Telegram locally, check first whether a real system-wide VPN is connected before assuming it's a code bug. This is local-dev-only — production on Vercel runs from Vercel's own servers/network and is unaffected.

(Full detail also saved to persistent memory as `local-dev-vpn-requirement`.)

### Layer 2 — DeepSeek chatbot — ✅ DONE, confirmed working

Built:
- `openai` npm package added (DeepSeek's API is OpenAI-wire-compatible; no DeepSeek-specific SDK needed)
- `.env.example` / `.env` — added `DEEPSEEK_API_KEY=`
- `src/index.ts` — added a module-scope `OpenAI` client pointed at DeepSeek (`baseURL: "https://api.deepseek.com"`); fail-fast startup check for `DEEPSEEK_API_KEY` (same pattern as the other env vars); the `bot.on("text", ...)` handler now sends each message statelessly (no history) to `chat.completions.create` and replies with the model's answer instead of echoing; wrapped in try/catch so a DeepSeek failure replies with a friendly error instead of hanging

Live verification done at plan time (2026-09-10), since model/endpoint names on DeepSeek's API had drifted from what was cached:
- Base URL: `https://api.deepseek.com` (OpenAI-compatible endpoint)
- Model: `deepseek-v4-flash` — the old `deepseek-chat` alias was retired 2026-07-24

Verified:
- `npm run build` compiles clean
- End-to-end test passed: message sent to the test bot → real DeepSeek-generated reply received (not an echo)

### Known environment note — npm via bash is broken

Running `npm` through the Bash tool on this machine fails with `Error: Cannot find module '...npm-cli.js'` (a PATH/node-version-manager issue in that shell). PowerShell's `npm` works fine. Use PowerShell for all `npm` commands going forward.

### Layer 3 — One GitHub action (create issue) — ✅ DONE, confirmed working

Built:
- `@octokit/rest` npm package added
- `.env.example` / `.env` — added `GITHUB_PAT=` and `GITHUB_REPO=` (format `owner/repo`)
- `src/index.ts` — fail-fast startup checks for `GITHUB_PAT` and `GITHUB_REPO` (split into owner/repo, validated), module-scope `Octokit` client; every allowed text message is now interpreted via DeepSeek (JSON mode, `response_format: {type: "json_object"}`) into `{title, body}`, with a heuristic fallback (first line as title, full message as body) if DeepSeek returns empty/invalid JSON; the result is created as a GitHub issue via `octokit.rest.issues.create`, and the bot replies with `Created issue #N: <html_url>`; wrapped in try/catch so a DeepSeek or GitHub failure replies with a friendly error instead of hanging
- The generic Layer 2 chatbot behavior is now fully replaced — every allowed message is treated as an issue request, per the v1 "one task reliably" scope (no intent routing)

Test repo/token: throwaway repo `Abdulllah-Rizwan/AgentOpsThrowAway`, fine-grained PAT scoped to that repo only, Issues: Read & write permission, short expiry (per Section 6).

Bug hit and fixed during first test: `GITHUB_REPO` in `.env` was pasted as `Abdulllah-Rizwan/AgentOpsThrowAway.git` (trailing `.git` from the clone URL) instead of `owner/repo` — GitHub's API 404'd looking for a repo literally named `AgentOpsThrowAway.git`. Fixed by correcting the `.env` value (not a code bug — the format is documented as `owner/repo`).

Verified:
- `npm run build` compiles clean
- End-to-end test passed: message sent to the test bot → issue created in the throwaway repo with a sensible DeepSeek-generated title/body → bot replied with a working issue link

### Layer 4 — Pull request + approval flow — ✅ DONE, confirmed working

Design decision (asked developer directly, since CLAUDE.md flags this as a fork not to assume through): the "small change" the agent makes on each message is **free-form** — DeepSeek decides both the target file path and its full content from the message, rather than always appending to one fixed file. Chosen over the safer fixed-file-append option because the developer wanted something closer to real autonomous coding for this layer.

Built:
- `.env` / GitHub PAT — widened existing fine-grained PAT's permissions to add **Contents: Read & write** and **Pull requests: Read & write** (Issues permission from Layer 3 kept)
- `src/index.ts` — replaced the Layer 3 issue-creation handler entirely with a PR flow: DeepSeek (JSON mode) interprets the message into `{path, content, commitMessage, prTitle, prBody}`; `path` is validated (`isSafeRepoPath`: no leading `/`, no `..`) since it's untrusted LLM output feeding a GitHub API call; on invalid/unparseable output the bot replies asking the user to rephrase rather than guessing (no risky fallback, unlike Layer 3's heuristic). Flow: fetch the repo's actual default branch → branch `agent/<timestamp>` off it → create/update the file on that branch → open a PR from that branch into the default branch. The agent never writes to the default branch directly (Section 6).
- Same try/catch-and-reply-with-friendly-error pattern as prior layers.

Bugs hit and fixed during first tests (all environment/config, not code bugs):
1. PAT returned 403 "Resource not accessible" on the `git/ref` call — only "Pull requests" permission had been added, not "Contents" (the ref/branch/commit calls need Contents, separate from PR creation). Fixed by adding Contents: Read & write to the PAT.
2. `git/ref/heads/main` returned 409 "Git Repository is empty" — the throwaway repo had no initial commit, so `main` didn't exist yet for the agent to branch from. Fixed by adding an initial commit (README) on GitHub so `main` exists.

Verified:
- `npm run build` compiles clean
- End-to-end test passed: message sent to the test bot → branch created → file committed → PR opened in the throwaway repo → bot replied with a working PR link → nothing landed on the default branch without manual merge

### Post-Layer-4 — Intent routing (chat / issue / PR) — ✅ DONE, confirmed working, deliberate scope deviation

This deviates from CLAUDE.md Section 8 ("complex multi-step planning beyond the single defined action" is out of scope for v1). Per Section 11, pushed back and explained the trade-off (classification errors could silently trigger GitHub actions on an ambiguous chat message, undermining the "one task reliably" goal) before building. Developer heard the trade-off and explicitly asked to proceed anyway — recorded here as a deliberate, informed deviation, not an assumption.

Built:
- `src/index.ts` — added `classifyIntent()`: a DeepSeek JSON-mode call labeling each message `"chat" | "issue" | "pr"`, **defaulting to `"chat"`** whenever the response is empty, unparseable, or not confidently `issue`/`pr` — so an ambiguous message never silently touches GitHub
- The old Layer 2/3/4 bodies were split into three named handlers (`handleChat`, `handleIssueRequest`, `handlePrRequest`) that `bot.on("text", ...)` now dispatches to based on the classified intent, instead of one fixed capability per build

Verified: chat messages ("hi") get a conversational reply with no GitHub call; issue-shaped and PR-shaped messages still route correctly to their respective flows.

### Post-Layer-4 — "Thinking..." indicator — ✅ DONE, confirmed working

Developer asked for feedback while a request is processing (like WhatsApp/Meta AI's "thinking..." state), since replies only appeared once fully done. Considered Telegram's native typing-indicator chat action, but it expires after ~5s and would need repeated refreshing for slower PR-opening calls — instead:

Built:
- `src/index.ts` — `bot.on("text", ...)` now replies immediately with a placeholder "Thinking..." message, then edits that same message in place (`ctx.telegram.editMessageText`) with the real result once processing finishes, regardless of how long the DeepSeek/GitHub calls take
- Refactored `handleChat`/`handleIssueRequest`/`handlePrRequest` to return the result text instead of calling `ctx.reply` directly, so there's one single edit point

### Post-Layer-4 — PR flow bug fixes: grounding in real repo content — ✅ DONE, confirmed working

Developer reported two bugs after asking the agent to "update README.md with relevant details after reading the repo's files and folders": (1) DeepSeek replied with a refusal explaining it had no ability to browse GitHub — and the code opened a PR with that refusal text as the file content anyway; (2) despite the GitHub PAT having Contents: Read & write, the agent still couldn't "see" the repo. Root cause for both: `interpretAsCodeChange` only ever received the raw Telegram message — the code never actually called the GitHub API to fetch repo content before asking DeepSeek to write a file, and never checked whether DeepSeek's JSON was a real change vs. a refusal that happened to fit the same shape.

Fix — replaced the single-call `interpretAsCodeChange` with a plan → fetch → draft pipeline in `src/index.ts`:
- `fetchRepoFileList()` — pulls the real file tree via `octokit.rest.git.getTree` (recursive, capped at 300 entries; treats a 409 "empty repo" as an empty list rather than erroring)
- `planCodeChange()` — DeepSeek sees the real file list and returns a structured `{canFulfill: true, path}` or `{canFulfill: false, reason}`; a `false` short-circuits straight to a Telegram reply with **no PR opened**, fixing bug (1)
- `fetchFile()` — if `plan.path` already exists, fetches its real current content + sha, fixing bug (2): "update" requests are now grounded in what's actually there
- `draftCodeChange()` — DeepSeek writes the new content given the real file list + real existing content (or told the file is new)

Verified: asking to "turn the app into a robot" now correctly declines via Telegram instead of opening a nonsense PR; grounded file-update requests work correctly.

### Post-Layer-4 — Telegram formatting — ✅ DONE, confirmed working

Developer noticed DeepSeek's replies (chat answers, PR-decline reasons) used GitHub-flavored markdown (`##` headers, `**bold**`) that Telegram doesn't render — it showed literal asterisks/hashes.

Fix in `src/index.ts`:
- Added a shared `TELEGRAM_FORMATTING_NOTE` system-prompt fragment (Telegram Markdown: `*bold*` single-asterisk, `_italic_`, no headers/tables) applied only to the two places DeepSeek writes Telegram-facing text: `handleChat`'s replies and `planCodeChange`'s `reason` field. GitHub-bound text (issue/PR titles, bodies, file content) is left as normal markdown since GitHub renders that correctly.
- The final reply now sends with `parse_mode: "Markdown"`; if that throws (model output isn't valid Telegram Markdown), falls back to a plain-text edit so a formatting slip never eats the whole reply.

---

## Current status

Layers 0–4 are complete and verified, plus four post-Layer-4 fixes/enhancements (intent routing, "Thinking..." indicator, repo-grounded PR flow, Telegram formatting) are all built and confirmed working. The bot now handles chat, issue-creation, and PR-opening from one Telegram interface, feedback-loop tested against the real throwaway repo.

## Next step

Proceed to **Layer 5 — Vercel deployment prep** (CLAUDE.md Section 5): convert polling → webhook, structure as Vercel serverless function(s), write final `.env.example`, prepare deployment steps for the client, and point at the real `afanoxai` repo only at that point.
