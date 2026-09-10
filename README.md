# AgentOps

A Telegram bot that interprets developer instructions with DeepSeek and acts on GitHub — creating issues, opening pull requests, or just chatting. Built incrementally; see `CLAUDE.md` for the build philosophy/roadmap and `decisions.md` for what's actually been done.

## How it works

```
Telegram message → bot (allow-listed senders only) → DeepSeek classifies intent (chat / issue / pr) → GitHub API action, if applicable → reply back in Telegram
```

- **chat** — a normal conversational reply, no GitHub call.
- **issue** — DeepSeek turns the message into a title/body and files a GitHub issue.
- **pr** — DeepSeek reads the repo's real file list (and a target file's current content, if it exists), drafts a change, and opens a pull request on a new branch. The agent never commits directly to the default branch.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm run dev` — runs the bot locally via long-polling.

## Environment variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [BotFather](https://t.me/BotFather) |
| `ALLOWED_TELEGRAM_USER_IDS` | Comma-separated numeric Telegram user IDs allowed to use the bot |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `GITHUB_PAT` | Fine-grained GitHub PAT, scoped to a single repo (Issues, Contents, Pull requests: Read & write) |
| `GITHUB_REPO` | Target repo as `owner/repo` |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret used to verify webhook requests in production. Not needed for local polling. |

## Project structure

- `src/bot.ts` — all bot logic: env validation, DeepSeek/GitHub clients, intent classification, and the chat/issue/PR handlers.
- `src/index.ts` — local dev entrypoint; runs the bot via long-polling.
- `api/telegram.ts` — Vercel serverless entrypoint; runs the bot via webhook in production.

## Deployment

Production runs on Vercel via `api/telegram.ts` instead of local long-polling — a single Telegram bot token can only be in one mode (polling or webhook) at a time. See `DEPLOYMENT.md` for the full deployment guide.
