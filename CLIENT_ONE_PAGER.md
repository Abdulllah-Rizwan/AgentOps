# Telegram Coding Agent — Where It Stands

A coding assistant you talk to from Telegram. You describe a change in plain language; it reads the
relevant repository, writes the change, and opens a **pull request** for you to review and merge.
Nothing reaches your real code without a human approving the PR.

---

## What it does today (working and reliable)

- **Talk to it on Telegram.** Send a normal message describing a change.
- **It reads your actual repo** — the real files and their contents, not a guess.
- **It opens a pull request** with the change, on its own branch. It never writes to your main
  branch directly.
- **You review and merge.** The merge is the only thing that touches real code, and it's always a
  human decision. Merging triggers your existing deployment as before.

This is a genuine "coding agent in Telegram" — modest in scope, but dependable.

## Your two requests — status

1. **Multiple approved users — done.** You and your developer can both drive the agent. Anyone not
   on the approved list is ignored. (Final two-account check is the last step before go-live.)
2. **Works across multiple repositories — done, safely.** The agent operates on an **explicit,
   named list of repositories you choose** — never your whole organization, and it can't create
   new repos. By default a message goes to your primary repo; you can direct it to another allowed
   repo by starting the message with `repo: <name>`. This "named list only" rule is the core safety
   guarantee: even a misread message can't reach a repository you didn't put on the list.

## What we're *not* claiming yet (and why)

You may have imagined the agent **autonomously building a whole feature by itself**, step by step,
start to finish. We built a working prototype of that — but it's genuinely a different, larger
machine. Doing it reliably needs the agent to *run and test its own code in a loop* on a dedicated
backend, not on the lightweight always-on service the current bot runs on (which is designed for
quick request-and-reply, and caps how long any single task can run).

So we're being deliberate: **ship the reliable single-change → PR assistant now**, and treat the
fully-autonomous builder as its own funded next phase. That's an engineering-time decision, not a
weekend tweak — and shipping the dependable version first is what lets you actually put it in front
of people today.

## To take it live on your repositories

Your developer has proven the whole flow on throwaway repos. Going live on your real projects needs,
from you, only:

1. A GitHub access token **scoped to exactly the repositories you choose** (read/write on their
   contents, pull requests, and issues — nothing wider).
2. That token, your approved Telegram IDs, and the chosen repository list added to your hosting
   environment, then a redeploy.

Your developer never handles your secret values — you set them yourself.

## The roadmap, honestly

- **Now:** dependable Telegram assistant that opens reviewed PRs across your chosen repos. ✅
- **Next (its own phase, more time):** the autonomous, multi-step feature builder — a real
  agent loop on a backend built to run and test code. This is where the bigger investment goes if
  and when you want to scale up.
