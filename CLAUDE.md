# CLAUDE.md — Project Context & Build Guide

> This is the living context document for this project. Read it fully before proposing a plan or writing code. It defines **what we're building, how to build it, and what not to do.** When in doubt, follow the build philosophy in Section 2 over your own instinct to scaffold broadly.

---

## 1. What we're building

A **Telegram-based autonomous agent that acts on GitHub.**

The developer sends an instruction to a Telegram bot. A server (the "agent" / "harness") receives that message, interprets it using an LLM (DeepSeek), and carries out a task on GitHub on the developer's behalf — e.g. creating an issue, or opening a pull request with a code change — then reports back over Telegram.

The client refers to this as the "DeepSeek agent harness." **The harness = the server-side agent we are building.** It will eventually be deployed to Vercel (by the client, on their end). During development it runs locally.

The message loop, end to end:

```
You (Telegram) → Telegram bot → our server (agent: interprets with DeepSeek) → GitHub action → reply back to you (Telegram)
```

---

## 2. Build philosophy — READ THIS FIRST (non-negotiable)

**Build the smallest thing that runs end to end, then grow it in thin layers.** Do not scaffold the whole agent up front. Do not generate a large multi-module skeleton on day one. Each layer must run and pass a concrete success test before the next layer begins.

Rules of engagement:

- **One layer at a time.** Get it working, prove it, then move on. Never build layer N+1 while layer N is unproven.
- **Every layer has a yes/no success criterion** (see Section 5). If you can't state a clear pass/fail test for what you're about to build, the slice is too big — shrink it.
- **Mint each secret only at the layer that needs it.** Don't create the GitHub token before the GitHub layer. An unused secret is just a liability to babysit.
- **Prefer boring and working over clever and half-done.** No premature abstractions, no frameworks we don't yet need, no "we'll need this later" code.
- **Explain trade-offs in plain language before making a non-obvious technical choice.** The developer is building their first end-to-end deployed product and wants to understand decisions, not just receive them. Favor incremental understanding over speed.
- **When a request is ambiguous, ask one sharp question — don't assume and build wide.**

"Autonomous agent" is the most scope-creep-prone phrase in this project. Resist it. v1 is a bot that does **one** GitHub task reliably.

---

## 3. How the system works (components)

| Piece | Role | How it connects |
|---|---|---|
| **Telegram bot** | The interface the developer talks to | Created via BotFather → gives a **bot token**. Server logs in with that token to send/receive messages. |
| **Server / agent (the harness)** | Receives messages, interprets with DeepSeek, decides and performs the GitHub action | This is the code we write. |
| **DeepSeek** | The LLM that interprets the instruction | Called via its API (OpenAI-compatible). API key in env. |
| **GitHub** | Where actions are carried out | Accessed via the GitHub REST API using a **fine-grained Personal Access Token (PAT)**, scoped to one repo only. |

---

## 4. Tech stack & key decisions

These are recommendations with reasoning. Confirm with the developer where flagged; verify current API/SDK/model names at build time (they change and may be newer than any training data).

- **Runtime/language: Node.js + TypeScript (recommended).** Vercel-native, first-class support for Telegram, GitHub (Octokit), and DeepSeek's HTTP API. Confirm with developer before committing.
- **DeepSeek:** provides an OpenAI-compatible API — verify the current base URL and model names live. Key stored as an env var.
- **GitHub:** use the official REST API (e.g. Octokit) with the fine-grained PAT.
- **Telegram — the one deploy-time gotcha:**
  - **Locally: use long-polling** (simplest — the server asks Telegram for new messages in a loop).
  - **On Vercel: polling won't work.** Vercel is serverless — there's no always-on process to poll. Production must use a **webhook** (Telegram calls a Vercel function URL when a message arrives). Plan the code so switching polling → webhook is a small change, not a rewrite.
- **Vercel execution limits (future constraint, not a v1 blocker):** serverless functions have short timeouts. Quick actions (create an issue, open a PR) fit fine. Heavier multi-step autonomy may exceed the limit later and need an async/background pattern. Note it; don't solve it yet.
- **State/memory: none for v1.** No database. Keep it stateless until there's a proven need.

---

## 5. Build roadmap (the layers)

Build in this order. Each layer ends with its success test passing before the next begins. This IS the recommended roadmap — refine implementation details within a layer, but do not reorder or merge layers to "save time."

**Layer 0 — Echo bot (local, polling).**
Bare pipe, no intelligence. Message the test bot → server receives → replies "I received: <text>".
✅ *Success: the echo comes back in Telegram.*

**Layer 1 — Sender allow-list.**
The bot only responds to specific Telegram user IDs (the developer's). All others are ignored. Do this before DeepSeek so random users can't burn LLM credits or reach the agent.
✅ *Success: allowed user gets a reply; a different account gets nothing.*

**Layer 2 — DeepSeek chatbot.**
Route the incoming message through DeepSeek, reply with its answer. Now it's a chatbot.
✅ *Success: sensible LLM replies in Telegram.*

**Layer 3 — One GitHub action.**
Give it a single capability: interpret a request and **create an issue** in the throwaway test repo (title + body from the message).
✅ *Success: the issue appears in the test repo; the bot confirms with a link.*

**Layer 4 — Pull request + approval flow.**
The agent makes a small change and **opens a pull request** (never commits to the main branch directly). A human reviews/merges.
✅ *Success: a PR appears in the test repo; nothing lands on main without human merge.*

**Layer 5 — Vercel deployment prep.**
Convert polling → webhook. Structure as Vercel serverless function(s). Write `.env.example`. Prepare deployment steps + screenshots for the client. Point at the real `afanoxai` repo only now.
✅ *Success: runs on Vercel with the client's injected secrets.*

**v1 demo to the client** lives around Layer 3–4: message the bot → it does one GitHub task → replies done.

---

## 6. Security & safety — non-negotiable defaults

These are design defaults, not optional add-ons. Build them in; if the developer or client ever wants to relax one, that must be an explicit, deliberate decision.

- **Fine-grained PAT, single repo only.** Permissions limited to repository **contents, pull requests, and issues**. Never widen to the whole account/org "just in case."
- **The agent opens pull requests — it does not push to `main` directly.** This keeps a human checkpoint in front of any change that lands.
- **Sender allow-list.** Only approved Telegram user IDs can command the bot. Enforced from Layer 1 onward.
- **Secrets live only in environment variables.** Never in code, never committed. Provide a `.env.example` with variable **names only** and blank values. Add `.env` to `.gitignore`.
- **Short token expiry + rotation.** The PAT should expire and be rotatable; don't create long-lived tokens.
- **Build against throwaway accounts.** Use the developer's personal Telegram + a **separate test bot** (via BotFather) and a **throwaway GitHub repo** during development. Do not point the agent at any repo that matters — and not at `afanoxai` — until Layer 5.

---

## 7. Environment & secrets

Expected env variables (final set grows by layer — add each when its layer arrives):

```
TELEGRAM_BOT_TOKEN=      # from BotFather (Layer 0)
ALLOWED_TELEGRAM_USER_IDS=   # comma-separated (Layer 1)
DEEPSEEK_API_KEY=        # (Layer 2)
GITHUB_PAT=              # fine-grained, single-repo (Layer 3)
GITHUB_REPO=             # owner/repo target (Layer 3)
```

Deployment: **Vercel Hobby plan, under the client's account.** The client imports the repo and injects the real secrets themselves — we never send real secret values. We provide `.env.example` + written deployment steps.

---

## 8. Out of scope for v1 (do not build these)

- Multiple simultaneous users / multi-tenant handling
- A database or persistent long-term memory
- Multi-repo or org-wide access
- Other messaging platforms (WhatsApp, Slack, Discord)
- Complex multi-step planning beyond the single defined action
- Direct-to-`main` writes of any kind
- Any UI beyond the Telegram chat itself

---

## 9. Current status

Nothing is built yet. The test bot, test repo, and tokens are **not created** — they are created on demand, at the layer that first needs them (Section 5). Start at Layer 0.

---

## 10. Open decisions to confirm with the developer

1. **Runtime:** Node/TypeScript (recommended) vs. Python. Confirm before scaffolding.
2. **First GitHub action for Layer 3:** "create an issue" (recommended — simplest reliable win) vs. something else. Confirm.
3. **DeepSeek specifics:** confirm current API base URL and model name at build time.

---

## 11. Working style with the developer

- Move in small, testable increments; show a working thing at each step.
- Explain non-obvious choices in plain language, with the trade-off, before committing to them.
- Push back if asked to skip a layer or widen scope — hold the ship-small discipline even under pressure.
- Keep the security defaults (Section 6) visible; they're easy to forget mid-build.
