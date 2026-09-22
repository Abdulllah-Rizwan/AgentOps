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

### Layer 5 — Vercel deployment prep — ✅ DONE, confirmed working

Live-verified against current Vercel/Telegraf docs before building (Hobby duration limit is now 300s, comfortably covers the multi-call PR pipeline; zero-config `/api` Web-standard handlers need no `vercel.json` normally; `bot.handleUpdate()` processes a parsed Update directly, must be awaited fully before the function returns).

Built:
- `src/bot.ts` (new) — all bot logic (env validation, DeepSeek/Octokit clients, intent classification, the three handlers) moved here, exporting a configured but un-launched `Telegraf` instance
- `src/index.ts` (trimmed) — now just the local long-polling entrypoint (`bot.launch()` + graceful shutdown), unchanged local dev workflow
- `api/telegram.ts` (new) — Vercel webhook entrypoint: verifies `X-Telegram-Bot-Api-Secret-Token` against a new `TELEGRAM_WEBHOOK_SECRET` env var, calls `await bot.handleUpdate(update)`, returns 200/401/405
- `.env.example` — added `TELEGRAM_WEBHOOK_SECRET=`
- `README.md` (new) — project overview, setup, env vars, structure
- Webhook registered via a one-time `setWebhook` curl call (no script file, matches how every other one-off setup step in this project has been handled) — not code that runs per-request

Smoke-tested end-to-end against a throwaway Vercel project (developer's own account) pointed at the existing throwaway GitHub repo, per the plan's "prove it on low-stakes infra before writing client docs" approach. Four real bugs hit and fixed along the way, all environment/config, not code bugs in the final design:

1. **"No Output Directory named public found"** — Vercel's "Other" framework preset auto-ran `package.json`'s `"build"` script (`tsc`, meant only for local dev — Vercel independently compiles `api/*.ts` itself and never runs `dist/`/`npm start`), then expected a `public/` folder to serve statically, which doesn't exist since this project has no frontend. Fixed by adding `vercel.json` with `"buildCommand": ""` to skip the irrelevant build step (per Vercel's documented "Skip Build Step" guidance for API-only projects).
2. **`401 Protected deployment`** — the generated per-deployment URL (`agent-<hash>-...vercel.app`) is covered by Vercel's default Standard Protection on Hobby, which blocks everything except the actual production domain. Telegram's webhook calls were hitting that wall before ever reaching our code. Fixed by pointing the webhook at the stable production domain (`agent-ops-gamma.vercel.app`) instead, which is public by default on Hobby.
3. **`FUNCTION_INVOCATION_FAILED` → `TelegramError: 404: Not Found` on Telegraf's internal `getMe` call** — the `TELEGRAM_BOT_TOKEN` value entered into Vercel's environment variables didn't match the real token (copy-paste error), even though the same token worked fine everywhere else (local `.env`, the `setWebhook` call). Fixed by correcting the value in Vercel's env vars and redeploying (env var changes need a redeploy to take effect).
4. Two `curl` copy-paste mistakes on the developer's end while registering the webhook (a literal placeholder left in instead of the real token; a multi-line backslash-continued command getting mangled in terminal paste) — resolved by running the corrected commands directly rather than iterating on paste formatting further.

Verified: `setWebhook` succeeded against the production domain; a simulated Telegram update posted directly to `https://agent-ops-gamma.vercel.app/api/telegram` (bypassing the need for the developer's VPN, since the deployed function's outbound calls to Telegram aren't blocked) round-tripped correctly once the token was fixed; developer confirmed real messages through Telegram now work end-to-end via the deployed webhook.

Known operational note: this same test bot token can't run local `npm run dev` (polling) at the same time its webhook is registered — Telegram only allows one receive mode per token. Not a bug, just something to remember when switching between local dev and testing the deployed version.

`DEPLOYMENT.md` written: client-facing step-by-step guide (prerequisites → env vars → deploy → find production domain → register webhook → test → troubleshooting table → rollback to local dev), derived directly from the four real issues hit and fixed above rather than written speculatively.

---

## Current status

Layers 0–5 are complete and verified, and `DEPLOYMENT.md` is written. CLAUDE.md's Layer 5 deliverables are all done: webhook conversion, Vercel serverless structure, final `.env.example`, and a deployment guide for the client. The bot runs both locally (long-polling, `npm run dev`) and on Vercel (webhook, `api/telegram.ts`) from the same shared `src/bot.ts`, handling chat, issue-creation, and PR-opening from one Telegram interface. Currently deployed and tested against the throwaway repo/bot, not yet `afanoxai` — per CLAUDE.md Section 7, the real repo/secrets are the client's to configure in their own Vercel project.

## Next step

Layer 5 is complete — v1 is functionally done per the CLAUDE.md roadmap (Section 5's roadmap ends at Layer 5). Remaining work is handoff-shaped, not build-shaped: hand `DEPLOYMENT.md` + this repo to the client so they can deploy under their own Vercel account with real `afanoxai`/secrets, following the exact proven procedure.

---

## v2 progress

### Open decisions from CLAUDE.md Section 10 — confirmed with developer

1. **Playground shape:** single shared playground repo (not per-project). Confirmed.
2. **Repo-creation:** deferred, not built this pass. Confirmed — no workflow surfaced that needs it.
3. **`GITHUB_REPO` migration:** replaced entirely by `GITHUB_PLAYGROUND_REPO` + `GITHUB_TARGET_REPO`, no dangling old var. Confirmed.

### Layer A — Multiple approved users — ⚠️ CODE READY, live verification still pending

`ALLOWED_TELEGRAM_USER_IDS` parsing already handles a comma-separated set (confirmed by code review — no code change needed, matches CLAUDE.md Section 3's expectation). Live two-account test is **blocked**: Telegram registration is blocked in Pakistan, so the developer can't stand up a second account locally. Agreed workaround (not yet executed): ask the client for their existing numeric Telegram ID and add it to the throwaway bot's allow-list, rather than registering a new account — gives a real distinct second ID without needing new registration, and as a side effect lets the client see the agent working firsthand. Waiting on the developer to get that ID from the client.

### Layer B — Two-repo plumbing — ✅ DONE, confirmed working

Built:
- `.env` / `.env.example` — `GITHUB_REPO` replaced by `GITHUB_PLAYGROUND_REPO` (`Abdulllah-Rizwan/AgentOpsThrowAway`, reusing v1's repo) and `GITHUB_TARGET_REPO` (`Abdulllah-Rizwan/Target_Repo_For_AgentOps`, new)
- `src/bot.ts` — `RepoRef`/`parseRepoEnv` replace the old single owner/repo constants; every repo-touching function now takes a `RepoRef` param; `assertRepoAllowed()` checks every call against an explicit `Set` built from just the playground + target repos (mirrors the Telegram user allow-list philosophy — never "all repos")
- Verified the fine-grained PAT's scope covers **exactly** these two repos (developer confirmed via GitHub's token settings), not "all repositories" — flagged and checked explicitly per Section 5 before proceeding

Design decisions made along the way:
- **Issues go to target, not playground** — an issue is metadata, not a code change; it can't break anything, so there's no safety reason to route it through the sandbox first. Confirmed with developer.
- **First implementation (superseded, see below):** draft content committed directly to playground, then immediately promoted to a target PR in the same request — the developer caught that this didn't actually gate anything (playground write always "succeeds," so the promotion was unconditional). Fixed by splitting into an explicit two-step draft → human-approval → promote flow, which was itself later superseded by the full pipeline below once the plan/test requirements were added.

Verified: end-to-end via local long-polling — chat, issue creation (in target), and a full draft→promote flow all round-tripped correctly against the throwaway repos before the design was extended further.

### Operational discovery — local polling silently deletes the Vercel webhook

Telegraf's `bot.launch()` (used by local `npm run dev`/`tsx watch`) calls `telegram.deleteWebhook()` before it starts polling (confirmed by reading `node_modules/telegraf/lib/telegraf.js`). Starting the bot locally this session silently unregistered the webhook pointed at the developer's own throwaway Vercel deployment (project `agent-ops`, `agent-ops-gamma.vercel.app`) — explaining a "why am I talking to the wrong instance" moment mid-session. That Vercel deployment still runs pre-v2 code with the old `GITHUB_REPO` var, since nothing from this session has been pushed/deployed yet. Decision: keep developing against local long-polling for now; re-point the webhook and redeploy once v2 is ready to prove there too.

### Major redesign — plan-first, tested pipeline (supersedes the Layer B draft/promote flow)

Developer wanted something more deliberate than a single-shot code draft: an architecture-level plan proposal for senior-engineer review first, then code *and tests*, with tests actually executed (not just written) before anything reaches target, plus a manual "deploy playground and check it" gate before promotion. Full design conversation and rationale captured in the approved plan mode transcript; summary of what got built:

Pipeline stages in `src/bot.ts`:
1. **Plan** (`pr`-style request, no pending state) — `draftPlan()`: DeepSeek proposes architecture/tech-stack/edge-case reasoning, no code. Stored via `writeState`.
2. **Plan review loop** — `classifyPlanResponse()` (approve / revise / unrelated) + `revisePlan()`. Loops until approved; an unrelated message falls through to normal chat/issue handling without disturbing the pending plan.
3. **Code + tests** — `draftCodeAndTests()` extends the old single-file draft to also produce a test file (Node's built-in `node:test`, run via `tsx --test`), grounded in the approved plan. Committed to a **fresh branch in playground** (`agent/<chatId>/<timestamp>`) via `commitDraftToPlaygroundBranch()` — not a direct commit to playground's default branch, so CI has something concrete to run and concurrent chats don't collide.
4. **CI status, checked on demand** — `checkCiStatus()` queries `octokit.rest.actions.listWorkflowRunsForRepo` for that branch whenever the human's *next* message arrives; no background polling (a serverless webhook invocation can't run one). Passed → asks the human to deploy playground separately and verify by hand. Failed → reports the run link, waits for revision feedback.
5. **Manual verification gate** — `classifyVerificationResponse()` (promote / revise / unrelated). Only `promote` here reaches `handlePromoteFromState()`, which opens the PR into target using the exact drafted bytes (feature file **and** test file, so the reviewer sees what was actually tested) — never a direct write to target's default branch.

Persistence: replaced the earlier in-memory `pendingDrafts` Map with `PipelineState` stored as a JSON file inside **playground itself** (`.agent-state/<chatId>.json`, via `readState`/`writeState`/`clearState`). Reasoning recorded explicitly: a Vercel serverless invocation shares no memory with the next one, and this pipeline can span minutes (CI) to hours (human review) — in-memory state is provably broken for that environment. Chosen over adding a real database because CLAUDE.md Section 8 rules databases out of scope for this pass; storing state as a file in a repo we already have access to gets the needed durability without new infrastructure or credentials. Developer explicitly agreed a real persistent datastore is a later, separate decision.

Authorship line drawn deliberately: the CI workflow file itself is one-time human/developer setup, never something the agent generates at runtime — flagged to the developer as a safety boundary before building (auto-generating and auto-running CI config for an unknown stack is a materially different risk than the agent writing test *content* inside scaffolding a human already set up).

One-time playground bootstrap (via a scratch script using the project's own Octokit client, not committed to this repo):
- `package.json` — `tsx --test test/*.test.ts` as the `test` script, `tsx` as the only new dependency
- `test/sample.test.ts` — placeholder so the test command has something to run
- `.github/workflows/test.yml` — `on: push`, `npm install && npm test`

Bugs/scope surprises hit and resolved:
1. **Wrong assumption caught before it caused damage:** initially assumed playground mirrored target's codebase (based on files seen in early log output). Checked playground's actual file tree via the GitHub API before bootstrapping and found it's a generic, unrelated scratch repo (`hello.html`, `psx_morning_picks.py`, `tip.js`, `src/calculator.ts`, no `package.json`) — target is the one that's a copy of this AgentOps codebase. Bootstrap was built against the real state, not the wrong assumption. **Known limitation, explicitly deferred:** this pipeline only works because playground now has its own matching Node/TS toolchain; a future target on a different stack would need its own matching playground bootstrap (same bucket as "N named targets," already out of scope).
2. **403 writing `.github/workflows/test.yml` via the PAT** — GitHub gates workflow-file writes behind a separate `workflows: write` permission, distinct from `Contents`. Flagged rather than silently requesting broader scope; developer chose to add the file manually via GitHub's web UI (one-time, no PAT change) over widening the token.
3. **403 reading Actions run status** — `checkCiStatus()` needs `Actions: Read-only` on the PAT for playground, which the original Section 5 scope (Contents + PRs + Issues) didn't include. Unlike the workflow file, this one's genuinely needed at runtime by the deployed agent, not just one-time setup — flagged explicitly, developer added it to the fine-grained PAT for playground only (target still doesn't have it, since CI never runs there).

Verified so far: `tsc --noEmit` clean; the placeholder test ran and passed in GitHub Actions on the first push (confirms the CI wiring itself works). **Not yet verified:** a full live run of the pipeline end-to-end through Telegram (plan → revise → approve → code+tests drafted → CI checked → pass/fail reporting → manual-verification gate → promote → PR with both files in target) — that's the immediate next step.

### Operational — local dev stability (hang + repeated low-memory kills)

While attempting the first live pipeline test, the developer hit a hang: a PR-style prompt left "Thinking..." forever after a laptop sleep/resume + VPN reconnect cycle, with zero trace of the request on DeepSeek's own dashboard — while a plain chat message sent right after resume worked fine. Separately, the local `tsx watch` process was killed by the harness for low system memory three times in a row.

Diagnosis:
- The machine has 8GB total RAM and was down to ~0.5GB free, running Claude Code (~416MB), Cursor (~313MB), several Edge windows (~1GB+ combined), Windows Defender (~302MB), a VPN client, and Windows' own memory compression (~427MB, itself a symptom of the pressure) all at once. The bot's own Node process is tiny (~5-7MB) — it isn't the cause of the pressure, just the thing getting picked off by it.
- Found **two** stray `node` processes running simultaneously, hours apart in start time — the harness's "killed" signal on the earlier background tasks didn't fully take down the process tree, leaving orphans. Two long-pollers racing for Telegram's single-consumer slot, plus a process left alive across a sleep/resume cycle holding a now-dead TCP connection, fits the exact symptom: a GitHub API call hanging on a stale socket before ever reaching DeepSeek, with neither Octokit nor the OpenAI client having any request timeout configured — so a stuck call just hangs forever with no error and no trace anywhere.

Fix in `src/bot.ts`:
- Added `timeout: 30_000` to the DeepSeek `OpenAI` client constructor (a real, documented per-request option there — verified in `openai`'s own type defs).
- For Octokit: **first attempt was wrong** — passed `request: { timeout: 30_000 }` to the constructor, which type-checked but is a silent no-op (grepped Octokit's actual request implementation; it has no `timeout` handling at all, only `signal`). Fixed properly with `octokit.hook.before("request", (options) => { options.request.signal = AbortSignal.timeout(30_000); })`, which applies a *fresh* abort signal to every call automatically (a single static `AbortSignal.timeout()` set once at construction would fire once and then leave every subsequent request pre-aborted forever — has to be re-created per request, which the hook does).
- Killed both stray `node` processes and confirmed a clean single instance afterward.

Verified: exactly one `node`/`tsx` process pair running post-fix; `tsc --noEmit` clean. **Not yet verified:** whether the timeout fix actually resolves the original hang (developer restarted and immediately noticed other "strange behaviour" still being evaluated — not yet diagnosed, picking back up next session) — and free memory was still only ~1.2GB even after cleanup, so the underlying system-wide RAM pressure is unresolved, not just the symptom. Two options on the table, undecided: close other local apps to free RAM, or move testing to the throwaway Vercel deployment (which wouldn't consume local RAM at all, and is on the roadmap anyway) — developer wants to evaluate the strange behaviour further before deciding.

### Bug — Telegram MESSAGE_TOO_LONG crashing the process — ✅ FIXED, confirmed working

First live pipeline test (a real PSX-stock-screener MVP request) crashed the process. Root cause: Telegram rejects any single message over 4096 characters, and DeepSeek's drafted plan text was longer than that. The existing "formatted reply failed, fall back to plain text" `try/catch` (built earlier for a Markdown-formatting bug) caught the *first* `MESSAGE_TOO_LONG` throw, but the plain-text retry hit the exact same length error with no `catch` of its own — an unhandled rejection that took the whole process down, not just that one reply.

Fix in `src/bot.ts`:
- `splitForTelegram()` — splits any reply over 4096 chars into multiple messages, preferring to break on the last newline before the limit.
- The reply block now sends `chunks[0]` via `editMessageText` (with a plain-text fallback) and any remaining chunks via `ctx.reply` — every fallback attempt is now individually wrapped in `try/catch` so a failed send is logged, never left to crash the process.

Verified: `tsc --noEmit` clean; the same long-plan prompt subsequently arrived as multiple Telegram messages instead of crashing.

### Multi-file PRs, then superseded by the milestone-roadmap redesign below

Developer asked why the agent declined to build a multi-file PSX MVP in one PR ("that's not one small file change"). Root cause: `planCodeChange`/`draftCodeAndTests` were still running Layer 4's original "single small file change" framing, never widened when the plan-first pipeline was layered on top. First fix: widened to a bounded set of files per PR (`paths: string[]`, `MAX_FILES_PER_CHANGE = 8`, shared `commitFilesToBranch` helper). This was **immediately superseded** by the larger redesign below once the developer pushed further on autonomy and per-PR scope — recorded here only because it's the change that made the real problem (one-file-per-PR, not "how many files") visible.

### Major redesign — milestone roadmap pipeline (supersedes the single-plan/single-PR pipeline) — ✅ implemented, type-checked

Developer's ask, in his own words: the agent should understand a request, plan it as milestones, get approval on each one, build+test it in playground, report pass/fail and propose the next milestone, and only open a real PR once everything is done — with more autonomy per step than before, since this all happens on throwaway infra with no customer-facing risk. Also flagged two concrete problems with the prior design: no context/memory carried across a multi-step build (pipeline state was deleted on every promote), and an arbitrary `MAX_FILES_PER_CHANGE = 8` cap that wasn't derived from anything principled.

Design, confirmed with developer before building (per Section 11 - explained the fork, asked one sharp question): **one playground branch persists across the whole roadmap** (not a fresh branch per change), and **one PR is opened into target only once every milestone has passed CI** - not a PR per milestone. Chosen over "PR per milestone, human merges between each" specifically because it means target is never touched mid-build and the human only has to review once, at the end, with everything in context.

Pipeline stages in `src/bot.ts` (`readState`/`writeState`/`clearState` unchanged in mechanism, only the `PipelineState` shape changed):
1. **Roadmap** (`draftRoadmap`/`reviseRoadmap`) - breaks a `"pr"`-style request into an ordered list of milestones (2-5, DeepSeek's judgement, never padded), rendered as text and approved/revised via the existing generic `classifyPlanResponse`/`revisePlan` (reused as-is - both were already generic enough to not need a roadmap-specific version).
2. **Roadmap approved** (`handleRoadmapApproval`) - creates the one persistent playground branch (`agent/<chatId>/<timestamp>`) the whole roadmap builds on.
3. **Per-milestone plan** (`draftMilestonePlan`) - a detailed plan for just that slice, grounded in the playground branch's current files *and* a running human-readable log of what earlier milestones built (see below) - approved/revised the same generic way as the roadmap.
4. **Per-milestone build** (`planMilestoneFiles` + `draftCodeAndTests`) - decides which files this milestone touches and drafts them plus tests, committed onto the shared branch, CI starts.
5. **CI, checked on demand** (`handleMilestoneCiCheck`) - on failure, redrafts just this milestone from feedback (`handleMilestoneCiFailureRevision`); on success, appends a summary to the project log and **immediately drafts the next milestone's plan**, reporting "milestone N passed, here's milestone N+1, should I start?" - no manual "deploy and eyeball it" gate anymore, CI passing is the checkpoint.
6. **Promotion** (`handleRoadmapPromote`), reachable only once every milestone has passed - copies the *final* content of every path touched anywhere in the roadmap (`touchedPaths`, accumulated per milestone) straight from the playground branch into one fresh target branch, opens one PR. Feedback at this gate (`handleRoadmapPromoteRevision`) becomes one more ad-hoc milestone appended to the list, reusing the exact same plan→build→CI loop rather than a separate code path.

Two things fixed on the way, both explicitly requested:
- **No more arbitrary per-PR file cap.** Replaced `MAX_FILES_PER_CHANGE = 8` with `MAX_FILES_SANITY_CEILING = 30`, explicitly documented as a malformed-output guard, not a scope-control mechanism - scope is now controlled by the milestone boundary + human approval, not a file count.
- **No content duplicated into the JSON state file.** `CodeStateFields` used to carry full drafted file content; the new `MilestoneCodeFields` carries only `filePaths`/`testPaths` (strings) - actual content is re-fetched from the playground branch when needed (e.g. for CI-failure revision). The pipeline state file now only ever holds small text and paths, addressing the developer's "stuffing everything into JSON isn't good engineering" pushback directly.
- **Persistent project context**, addressing the "does it hold context across milestones" question: `.agent-plan/<chatId>.md`, a human-readable running log committed onto the same playground branch as the code (same pattern this project uses on itself via `decisions.md`, just scoped to one agent-built roadmap) - read into every milestone's plan/draft prompt, updated after each milestone passes CI.

Verified: `tsc --noEmit` clean after the full rewrite; old single-shot pipeline code confirmed fully removed (no dangling references).

### Bug found on first live milestone test — Telegraf's own 90s handler timeout crashing the process — ✅ FIXED

Approved a roadmap, approved milestone 1's plan (a PSX data-ingest slice that turned out to need 16 files), and the process crashed again - different cause from the earlier MESSAGE_TOO_LONG bug. Root cause: Telegraf wraps *every* update in its own internal timeout (`node_modules/telegraf/lib/telegraf.js`, `handlerTimeout: 90000`), and its **default** error handler logs `"Unhandled error while processing"` and then `throw err` - crashing the process outright, entirely outside our own `try/catch` (which lives inside the handler that just got timed out around). Milestone 1's 16 files, each needing a separate GitHub existence-check *and* commit call, blew past that 90s budget.

Fix in `src/bot.ts`:
- `new Telegraf(token, { handlerTimeout: 280_000 })` - raised to just under Vercel Hobby's hard 300s function-duration cap (see Layer 5 notes above), so local dev hits the same wall the deployed version will, not a tighter artificial one.
- `bot.catch(...)` registered - any unexpected error (this timeout included) now logs and replies with a friendly message instead of crashing the process.

### Performance/correctness fix — atomic commits instead of N sequential ones — ✅ done

Root cause of *why* 16 files took so long: `commitFilesToBranch` committed files one at a time in a sequential `for` loop, each needing its own existence-check GET plus a create/update PUT - 2N sequential GitHub round trips. Rewritten to build **one atomic commit via the Git Data API**: blobs created in parallel (blob creation doesn't touch branch state, so no race), then one tree, one commit, one ref update - O(1) sequential round trips regardless of file count, plus cleaner history (one commit per milestone instead of N). Applies to both the playground milestone commits and the final target promotion, since both call the same helper.

### Bug + design change — CI was TypeScript-only, milestones can be any language — ✅ done

The Python-drift bug: nothing in the drafting prompts constrained DeepSeek to the project's actual stack, so a "scraping" milestone reasonably reached for Python - files CI (`tsx --test` only) would never execute, silently unverified. First fix was a `STACK_NOTE` forcing TypeScript/Node only. Developer immediately pushed back: requests can call for any language, so CI itself should adapt, not force everything into one stack.

Flagged explicitly before building (per Section 11 - this runs directly into a boundary this project already set on purpose): `decisions.md`'s own record of the original CI build states "the CI workflow file itself is one-time human/developer setup, never something the agent generates at runtime... auto-generating and auto-running CI config for an unknown stack is a materially different risk than the agent writing test content inside scaffolding a human already set up." Built the version that stays on the safe side of that line: a human-authored (not agent-generated), **multi-ecosystem** workflow that detects a known marker file (`package.json`, `requirements.txt`/`pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, `*.csproj`/`*.sln`) and runs that ecosystem's fixed, human-written test command - the agent picks *which* supported ecosystem and what the files contain, never what command CI executes. A final step deliberately fails the run if no marker file matches anything, so an unsupported choice is a loud CI failure, not a silent "0 tests, all green."

Built:
- New `.github/workflows/test.yml` content for playground covering 7 ecosystems (Node/TS, Python, Go, Rust, Java/Maven, Ruby, .NET) - **not yet pasted in** (PAT still lacks `workflows: write`, same gap as the original CI build; developer to paste manually via GitHub's web UI as before, content handed over, saved to session scratchpad too).
- `src/bot.ts` - `STACK_NOTE`/`SUPPORTED_ECOSYSTEMS` replaced the TS-only version, listing all 7 ecosystems with their marker file and idiomatic test convention; `draftCodeAndTests`'s hardcoded Node-specific test-path instruction removed in favor of pointing at `STACK_NOTE`.

Verified: `tsc --noEmit` clean. **Not yet verified:** the new workflow file hasn't been pasted into playground yet, and no milestone has been drafted against it - first real test of multi-ecosystem detection is still pending.

### Bug found on next live test — DeepSeek's own 30s timeout too tight for large milestone drafts — ✅ FIXED

Retried the PSX prompt after the workflow/atomic-commit fixes above. This time the process didn't crash (confirms `bot.catch()` + the try/catch are working as intended - error was caught, logged, and replied to normally) but `draftCodeAndTests` failed with `APIConnectionTimeoutError` while drafting an 11-file milestone. Root cause: the DeepSeek client and Octokit shared one `REQUEST_TIMEOUT_MS = 30_000` constant, originally added purely to catch a genuinely stuck connection (a dead socket after laptop sleep/VPN reconnect - see the "local dev stability" entry above). Once milestones could legitimately ask for a dozen-plus files in one `draftCodeAndTests` completion, real generation time started exceeding that same 30s budget - the timeout was firing on live, still-progressing work, not a hang.

Fix in `src/bot.ts`: split into two ceilings instead of one shared value - `OCTOKIT_TIMEOUT_MS = 30_000` (unchanged, still appropriate for small metadata/blob round trips) and `DEEPSEEK_TIMEOUT_MS = 180_000` (real headroom for large generations, still comfortably under Telegraf's 280s handler ceiling). No milestone-size change - consistent with "no arbitrary file-count limits," the fix widens the budget rather than shrinking the work.

Verified: `tsc --noEmit` clean, no dangling references to the old shared constant. **Not yet verified:** a milestone this large actually completing within the new 180s DeepSeek budget - next live retry will confirm.

### Bug found on next retry — DeepSeek connection reset (ECONNRESET), not a code bug — ✅ mitigated

Retried again after the timeout-split fix above. Process didn't crash (same `bot.catch()`/try-catch working as intended), but `draftCodeAndTests` failed with `TypeError: terminated` / `ECONNRESET` partway through generating a 14-file milestone. Traced into the `openai` SDK's own source (`node_modules/openai/src/client.ts`): it already retries connection-level errors automatically (default `maxRetries: 2`, 3 total attempts, confirmed by reading the retry logic directly) - so this wasn't a missing-retry bug, it was all 3 attempts hitting a connection reset back to back, consistent with the known VPN-over-unstable-ISP situation already on record (see "Known environment gotcha" and "local dev stability" entries above), not a logic bug to fix.

Fix in `src/bot.ts`: `maxRetries: 5` on the DeepSeek client (up from the SDK's default 2) - more attempts against a flaky link, not different error handling, since the failure mode is genuinely transient network instability rather than something the code got wrong.

Verified: `tsc --noEmit` clean. **Not yet verified:** whether 5 attempts is enough headroom for this connection - next live retry will confirm, and if it still fails consistently the real fix is a more stable connection (or moving testing to the deployed Vercel version, already flagged as an open option) rather than an ever-higher retry count.

### Aside — clarified a question about whether the crash was a database problem

Developer asked if the MESSAGE_TOO_LONG/timeout crashes were caused by lacking a persistent database. Answered directly: no - state-across-messages was already solved via GitHub-file state (no DB needed for that, and it worked correctly throughout both crashes). Both crashes were "too much synchronous work inside one Telegram update," unrelated to persistence. Noted the one place a database *would* genuinely help: decoupling "reply fast" from "do slow work in the background" (ack immediately, run the build as a job, push the result back later) - a real architecture change, still out of scope per CLAUDE.md unless opened up as its own deliberate decision.

---

## v2 — Current status

Layer A is still code-complete but not live-verified (blocked on getting the client's Telegram ID - unchanged from before, not touched this session). The pipeline itself was substantially redesigned this session: single-plan/single-PR → milestone roadmap (plan → N milestones, each individually approved, built, and CI-tested, one final PR after all pass). Three real bugs were hit and fixed during the first live test of the new pipeline (MESSAGE_TOO_LONG crash, Telegraf's 90s handler-timeout crash, slow sequential commits) plus one design gap (CI was TypeScript-only) that's fixed in code but whose CI-side half (the new workflow file) hasn't been pasted into playground yet. No milestone has successfully completed a full build+CI+promote cycle end-to-end yet - the PSX MVP test that surfaced all of this hasn't finished a single milestone successfully.

## v2 — Next step

1. **Pick up here:** paste the new multi-ecosystem `.github/workflows/test.yml` into playground (content is in this session's chat and in the scratchpad), then retry the same PSX MVP prompt from the start.
2. Confirm milestone 1 now completes within the handler-timeout window (atomic commits should make this a non-issue even for a large milestone) and that CI correctly detects and runs whichever ecosystem it picks.
3. Live-test the full milestone loop end-to-end at least once: roadmap → per-milestone plan/approve/build/CI (both pass and fail paths) → next-milestone loop → final promote → target PR with everything the roadmap touched.
4. Once proven, get the client's Telegram ID and complete Layer A's live multi-user verification.
5. Only after both are solid: push/deploy v2 to the throwaway Vercel project and prove the whole thing again there (not just local polling) before writing any client-facing v2 setup steps - per CLAUDE.md's "prove on throwaway infra first."
