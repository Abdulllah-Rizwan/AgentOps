# CLAUDE.md — v2 Context & Build Guide (Multi-User + Cross-Repo)

> Read this fully before proposing a plan or writing code. It builds on the completed v1 (see `decisions.md` for the v1 record). It defines the two v2 features, **how to build them safely, and — most importantly — what NOT to do.** When in doubt, follow the build philosophy in Section 2 and the security line in Section 5 over any instinct to build broad.

---

## 0. Where we are (v1 is done)

v1 is complete, deployed, and verified. The agent already:
- Takes Telegram messages from **approved users only** (allow-list middleware).
- Classifies each message as `chat` / `issue` / `pr`, defaulting to `chat` when unsure so an ambiguous message never touches GitHub.
- Creates issues and opens **pull requests** (never writes to the default branch directly), grounded in the repo's real file list and file contents.
- Runs both locally (long-polling, `src/index.ts`) and on Vercel (webhook, `api/telegram.ts`) from one shared `src/bot.ts`.
- Currently points at **one** repo via a single `GITHUB_REPO` env var and a fine-grained PAT scoped to that one repo.

**v2 changes exactly two things. Nothing else.** Do not refactor, re-architect, or "improve" v1 systems that already work while adding these.

---

## 1. What we're adding in v2

Two features, requested by the client:

1. **Multiple approved users.** Right now the allow-list contains the client. Add the developer (Abdu) too, so both can command the agent. (This is nearly already supported — see Section 3.)
2. **Cross-repo capability, done safely.** Today the agent works on one repo. The client wants it to work across more than one project. This is the high-risk feature and the reason this document exists. Build it as the **playground + PR-into-target** model described in Section 4 — **NOT** as org-wide write access.

---

## 2. Build philosophy — READ THIS FIRST (non-negotiable)

Same discipline that carried v1. It still applies.

- **Thin layers, one at a time.** Feature 1 first (it's tiny and de-risks the allow-list). Prove it. Then Feature 2. Never build Feature 2 while Feature 1 is unverified.
- **Every step has a yes/no success test** (Section 6). If you can't state one, the slice is too big.
- **Prefer boring and working over clever and broad.** No routing frameworks, no repo-registry abstractions, no "we'll need it later." Get one playground → one target working end to end before generalizing to N repos.
- **Explain trade-offs in plain language before any non-obvious choice.** The developer is building his first product and wants to understand, not just receive. Analogy first, then the technical term.
- **When a request is ambiguous, ask one sharp question — don't assume and build wide.**
- **Do not widen scope silently.** If a step seems to require broader GitHub permissions than Section 5 allows, STOP and flag it to the developer — do not just grant them.

"Autonomous, cross-repo agent" is the most scope-creep-prone phrase in this entire project. The client will keep pushing toward the grand version. This document's job is to let you say "yes — and here's the safe first slice of it."

---

## 3. Feature 1 — Multiple approved users (trivial)

The v1 allow-list already parses `ALLOWED_TELEGRAM_USER_IDS` as a **comma-separated set** of numeric IDs and checks every sender against it. So this feature is essentially already built — it just needs the second ID in the value.

- **Change:** add the developer's numeric Telegram ID to `ALLOWED_TELEGRAM_USER_IDS`, comma-separated (e.g. `11111111,22222222`). No code change expected — verify the parsing already handles multiple IDs (it does in v1; confirm it still does).
- **On the client's deployment:** this env var lives in the client's Vercel project, which the developer cannot see or edit. So the client must add the ID themselves and **redeploy** (Vercel env changes only take effect on redeploy). Provide the exact value to paste; never ask for their secret values back.
- **Note for the developer:** getting each person's numeric ID uses the same bootstrap trick from v1 — message the bot, read the "Ignored message from unauthorized user ID: …" line from the logs.

✅ **Success:** both the client's and the developer's Telegram accounts get replies; a third, non-listed account still gets silence.

> ⚠️ This feature also touches the exact variable most likely behind the client's "bot doesn't respond on my side" problem. If his ID was never saved correctly, the bot silently ignores him — indistinguishable from a broken webhook. Confirm his ID is actually in his deployment's env var, correctly, as part of this.

---

## 4. Feature 2 — Cross-repo, the safe way (the playground model)

### The one-paragraph reason this is careful
Today the agent holds a key to **one room** (single-repo PAT); the worst a misread instruction can do is open an unwanted PR in one repo, which a human still reviews. The client asked to give it a **master key to the whole organization**, including creating and writing repos. That removes the single most important safety boundary in the design. An LLM sometimes misreads intent; anyone added to the allow-list, or a cleverly-worded (prompt-injection) message, would then be able to act across **every** project the org owns. We are NOT doing that. We are giving cross-repo capability with the boundary kept.

### The model to build
```
Agent works freely in a PLAYGROUND repo  (mistakes here cost nothing)
        │
        │  when a change is good...
        ▼
Agent opens a PULL REQUEST into the TARGET repo
        │
        ▼
A HUMAN (client or developer) reviews and merges  ← the only door into anything real
        │
        ▼
Merge triggers the client's Vercel deploy (unchanged)
```

- **Playground repo:** a dedicated repo (e.g. `afanoxai/agent-playground`, private) the agent may write to freely. This is the agent's scratch space.
- **Target repo:** an existing real project the change is destined for. The agent's only way to affect it is an **opened PR**, exactly like v1 — never a direct write, never an auto-merge.
- **The bridge is a pull request, never a clone-and-push.** A clone/push into the target would silently restore direct write access — the exact thing we're avoiding. Human review stays mandatory.

### Scope boundaries for this build
- Support **one playground → one named target** end to end first. Do NOT build an N-repo router, a repo registry, or dynamic repo discovery yet. Generalizing to several named targets comes only after the single pair works and only if the client actually needs it.
- The set of repos the agent can touch is an **explicit, named allow-list of repositories** (playground + specific targets the client chooses) — mirroring the Telegram user allow-list philosophy. Never "all repos in the org."

### Creating new repos — treat separately and push back
The client also asked for the agent to **create new repos**. Flag this explicitly to the developer before building it:
- Repo-creation is a **broader, org-level permission** — a real step up from read/write on named repos, and much harder to contain.
- Ask what workflow actually requires it. Often the real need is "work across my existing projects," and creation was tacked on aspirationally.
- Default recommendation: **do not build repo-creation in this pass.** Ship named-repo cross-repo first (playground → target PR). Revisit creation as its own deliberate decision with its own risk discussion.

---

## 5. Security & safety — non-negotiable defaults (unchanged from v1, extended)

These are design defaults. Relaxing one must be an explicit, informed decision by the developer — never a silent convenience.

- **Named-repo scope only.** The fine-grained PAT covers the **specific** repos the agent needs (playground + chosen targets), limited to Contents + Pull requests + Issues. **Never org-wide. Never "all repositories." Never repo-creation rights unless separately, explicitly decided.**
- **PRs only, into any real repo.** The agent opens pull requests; humans merge. No direct writes to a default branch, no auto-merge, no clone-and-push bridge.
- **Sender allow-list.** Only approved Telegram IDs. (Feature 1 extends the list; it does not remove the gate.)
- **Untrusted LLM output stays validated.** Keep v1's `isSafeRepoPath` check (no leading `/`, no `..`) and the plan→fetch→draft grounding. If the agent now chooses among repos, the **target repo must also be validated against the named allow-list** — never act on a repo name the model emits that isn't on the list.
- **Secrets only in env vars.** Never in code or commits. The client injects real secrets in their own Vercel project; the developer never handles the client's secret values.
- **Short-expiry, rotatable PAT.** Widening the PAT's repo scope is the moment to also confirm its expiry is still short and note the rotation date.
- **Prove on throwaway infra first.** Build and verify the whole playground→target flow on the developer's own throwaway repos/account/bot before writing any client-facing steps or touching `afanoxai`. (This is exactly how v1 Layer 5 was de-risked.)

---

## 6. Build roadmap (v2 layers)

**Layer A — Add the second user.**
Add the developer's Telegram ID to the allow-list value; confirm v1's parser handles multiple IDs (no code change expected).
✅ *Success: two listed accounts get replies; an unlisted third gets silence.*

**Layer B — Two-repo plumbing (the real code change).**
v1 assumes one repo (`GITHUB_REPO`, single Octokit target). Introduce the distinction between **where the agent works** (playground) and **where it opens the PR** (target). Widen the PAT to cover both throwaway repos. Keep everything else (intent routing, grounding, path validation, PR-not-direct) intact.
✅ *Success: agent commits/experiments in the throwaway playground and opens a PR into the throwaway target; nothing lands on either default branch without a human merge; a repo name not on the allow-list is refused.*

**Layer C — Prove end to end on throwaway infra, then write client steps.**
Run the full flow on the developer's own account/bot/repos. Only once it's solid, write the client-facing setup steps (new PAT scope, playground repo creation, env values to add, redeploy) — derived from what actually worked, not written speculatively.
✅ *Success: full playground→target→human-merge loop works on throwaway infra; client instructions are the proven procedure.*

**(Deferred, not this pass)** — N named targets; repo-creation. Each is its own deliberate decision per Sections 4–5.

---

## 7. Environment & secrets (v2 additions)

v1 vars stay. Expected changes:

```
ALLOWED_TELEGRAM_USER_IDS=   # now contains 2+ comma-separated IDs (Feature 1)
GITHUB_PLAYGROUND_REPO=      # owner/repo the agent works in freely (Feature 2)
GITHUB_TARGET_REPO=          # owner/repo the agent opens PRs into (Feature 2)
# (GITHUB_REPO from v1 is superseded by the two above — migrate, don't keep a dangling single value)
```

The v2 PAT must be scoped to **exactly** the playground + target repos (named), Contents + PRs + Issues only. The client sets these in their own Vercel project and redeploys; the developer proves the shape on throwaway infra first.

---

## 8. Out of scope for v2 (do not build these)

- **Org-wide / "all repositories" GitHub access** — the whole point is to avoid this.
- **Repo-creation by the agent** — deferred to its own separate, explicit decision.
- **Clone-and-push or any auto-merge bridge into a real repo** — PR + human review is the only door.
- **N-repo routers, repo registries, dynamic repo discovery** — one playground → one target first.
- Databases / persistent memory, other messaging platforms, any refactor of working v1 systems not required by these two features.

---

## 9. Current status

v1 complete and deployed against throwaway infra (see `decisions.md`). v2 not started. **The client's own deployment reportedly still isn't responding on his side** (suspected env-var/allow-list or webhook registration on his Vercel — see the ⚠️ in Section 3). Building v2 features does not fix his deployment; the two are independent. Surface that to the developer: features can be built and tested on throwaway infra regardless, but the client won't see any of it until his deployment responds.

---

## 10. Open decisions to confirm with the developer

1. **Playground shape:** one shared `agent-playground` repo (recommended) vs. per-project playgrounds. Recommend the single shared repo for this pass.
2. **Repo-creation:** confirm it's deferred (recommended) — and if the client insists, get the specific workflow that needs it before building.
3. **`GITHUB_REPO` migration:** confirm replacing the single v1 var with playground+target rather than layering on top of it.

---

## 11. Working style with the developer

- Small, testable increments; show a working thing at each step.
- Analogy first, then the technical term. Explain the trade-off before non-obvious choices.
- Push back if asked to skip a layer, widen GitHub scope, or grant org-wide/creation access — hold the security line even under client pressure, and offer the safe slice instead of a flat no.
- Keep Section 5's defaults visible; they're easy to forget mid-build, and this is the pass where forgetting them is most costly.