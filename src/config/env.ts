// The ONE place environment variables are read and validated (CLAUDE_agent_v3.md
// Section 12: "Config/env loaded and validated once, not read via process.env
// scattered across files. Fail fast at startup with a clear message if something's
// missing.").
//
// Analogy: this is the building's front desk. Every other module asks the front
// desk for what it needs (`config.llm.model`) instead of each wandering off to
// rummage in `process.env`. When a key is wrong or missing, there's exactly one
// place it's caught, and the error names the fix.
//
// Nothing here talks to the network - it only reads and shapes configuration.

import "dotenv/config";
import type { RepoRef } from "../types/index.js";

// --- small parsing helpers (pure, so they're trivial to reason about) -----------

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in ` +
        `(or set it in your Vercel project's environment variables and redeploy).`
    );
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** LLM_MODEL is swappable by config alone (Layer A). Falls back to the model v1/v2 ran on. */
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";

/** Loop-breaker default if MAX_CONSECUTIVE_BOT_TURNS is unset (CLAUDE.md Section 3b: "start at 3"). */
const DEFAULT_MAX_BOT_TURNS = 3;

/** Default cap on the agent's own concurrently-open PRs per repo if MAX_OPEN_AGENT_PRS is unset. */
const DEFAULT_MAX_OPEN_AGENT_PRS = 3;

/** Parse a positive-integer env var, falling back to `fallback` when unset. Rejects junk loudly. */
function parsePositiveInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return n;
}

function parseRepoRef(full: string, sourceName: string): RepoRef {
  const [owner, repo] = full.split("/");
  if (!owner || !repo) {
    throw new Error(`${sourceName} entry "${full}" must be in "owner/repo" format.`);
  }
  return { owner: owner.trim(), repo: repo.trim() };
}

/** Comma-separated "owner/repo,owner/repo" -> RepoRef[]. Empty/unset -> []. */
function parseRepoList(name: string): RepoRef[] {
  const raw = optional(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((full) => parseRepoRef(full, name));
}

/** Parse comma-separated numeric Telegram IDs into a Set. Non-numeric entries are rejected loudly. */
function parseIdList(name: string, raw: string): Set<number> {
  const ids = new Set<number>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const n = Number(part);
    if (!Number.isInteger(n)) {
      throw new Error(`${name} contains a non-numeric Telegram ID: "${part}". Use comma-separated numbers.`);
    }
    ids.add(n);
  }
  return ids;
}

/** Comma-separated numeric Telegram IDs -> Set<number>. Non-numeric entries are rejected loudly. */
function parseUserIds(name: string): Set<number> {
  // Allowed to be empty at first-run (the bootstrap trick: message the bot, read the rejected ID
  // from the logs, then add it) - so we require the var to EXIST but tolerate an empty value.
  const raw = process.env[name];
  if (raw === undefined) {
    throw new Error(
      `Missing required environment variable ${name}. It may be empty at first - run the bot, message ` +
        `it, and your rejected user ID will be logged so you can add it.`
    );
  }
  return parseIdList(name, raw);
}

/**
 * Like parseUserIds but fully OPTIONAL: an unset var yields an empty set (the feature is simply
 * off). Used for the trusted-peer-agent allow-list, which most deployments won't set.
 */
function parseOptionalUserIds(name: string): Set<number> {
  const raw = process.env[name];
  return raw === undefined ? new Set<number>() : parseIdList(name, raw);
}

// --- the shape every other module consumes --------------------------------------

export interface AppConfig {
  telegram: {
    botToken: string;
    allowedUserIds: Set<number>;
    /** Only needed by the Vercel webhook entry; undefined for local polling. */
    webhookSecret: string | undefined;
    /**
     * The agent's own @handle, used by the addressing gate in group chats. Optional: if unset, it is
     * resolved once from Telegram's getMe at startup. Stored WITHOUT a leading '@' (normalized).
     */
    agentHandle: string | undefined;
    /** Loop-breaker cap: max consecutive non-human turns before the agent goes silent (Section 3b). */
    maxConsecutiveBotTurns: number;
    /**
     * Peer agents (e.g. Hermes) the client has EXPLICITLY authorized to command this agent in the
     * shared room (CLAUDE.md 3c), listed by their numeric Telegram sender ID. A message from one of
     * these that @mentions this agent is obeyed like a human's - but it is still a NON-HUMAN turn for
     * the loop-breaker (does not reset the counter; counts toward the cap), and every tool still
     * re-validates the repo against the allow-lists, so command authority never widens repo
     * authority. Empty/unset -> humans-only (the safe v1 default).
     */
    trustedAgentIds: Set<number>;
  };
  llm: {
    apiKey: string;
    /** Swappable via LLM_MODEL (Layer A). */
    model: string;
    baseUrl: string;
  };
  github: {
    pat: string;
    /** Free-write scratch space for the agent (CLAUDE_agent_v3.md Section 5). */
    playgroundRepo: RepoRef;
    /** Named allow-list of repos the agent may open PRs/issues into. Never org-wide. */
    targetRepos: RepoRef[];
    /**
     * SEPARATE, narrower allow-list for the one irreversible action: deleting a repo. Kept distinct
     * from `targetRepos` on purpose - being willing to receive a PR into a repo is not the same as
     * being willing to have it destroyed. Empty/unset -> every delete is refused (the safe default).
     */
    deletableRepos: RepoRef[];
    /**
     * Cap on how many of ITS OWN pull requests the agent keeps open in one repo at once ("its own" =
     * a PR whose head branch starts with `agent/`). At the cap, open_pull_request opens none and
     * instead returns the links to the existing open PRs. From MAX_OPEN_AGENT_PRS, default 3.
     */
    maxOpenAgentPrs: number;
  };
  memory: {
    // Standard Redis URL (Phase 4 migration). When set, a local/VPS Redis is used via ioredis.
    // Takes precedence over Upstash so the migration is a config change, not a code change.
    redisUrl: string | undefined;
    // Upstash Redis REST credentials (Layer D). Used when redisUrl is unset. Both absent AND no
    // redisUrl -> the in-memory fallback (fine for local dev, does NOT persist across restarts).
    upstashUrl: string | undefined;
    upstashToken: string | undefined;
  };
}

function buildConfig(): AppConfig {
  // Repo config migrates from the v2 var names toward the v3 ones without breaking an existing
  // deployment: prefer v3's names, fall back to v2's. (CLAUDE_agent_v3.md Section 7 supersedes
  // the single GITHUB_REPO with playground + an allow-list.)
  const playgroundRaw = required("GITHUB_PLAYGROUND_REPO");
  const v3Targets = parseRepoList("ALLOWED_TARGET_REPOS");
  const targetRepos = v3Targets.length > 0 ? v3Targets : parseRepoList("GITHUB_PR_REPOS");

  return {
    telegram: {
      botToken: required("TELEGRAM_BOT_TOKEN"),
      allowedUserIds: parseUserIds("ALLOWED_TELEGRAM_USER_IDS"),
      webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),
      agentHandle: optional("AGENT_TELEGRAM_HANDLE")?.replace(/^@/, "").toLowerCase(),
      maxConsecutiveBotTurns: parsePositiveInt("MAX_CONSECUTIVE_BOT_TURNS", DEFAULT_MAX_BOT_TURNS),
      trustedAgentIds: parseOptionalUserIds("TRUSTED_AGENT_TELEGRAM_IDS"),
    },
    llm: {
      apiKey: required("DEEPSEEK_API_KEY"),
      model: optional("LLM_MODEL") ?? DEFAULT_LLM_MODEL,
      baseUrl: optional("LLM_BASE_URL") ?? "https://api.deepseek.com",
    },
    github: {
      pat: required("GITHUB_PAT"),
      playgroundRepo: parseRepoRef(playgroundRaw, "GITHUB_PLAYGROUND_REPO"),
      targetRepos,
      deletableRepos: parseRepoList("GITHUB_DELETABLE_REPOS"),
      maxOpenAgentPrs: parsePositiveInt("MAX_OPEN_AGENT_PRS", DEFAULT_MAX_OPEN_AGENT_PRS),
    },
    memory: {
      redisUrl: optional("REDIS_URL"),
      upstashUrl: optional("UPSTASH_REDIS_REST_URL"),
      upstashToken: optional("UPSTASH_REDIS_REST_TOKEN"),
    },
  };
}

// Built once at module load and shared. Importing this module validates the environment - a
// missing/malformed core var throws here, at startup, with a message that names the fix, rather
// than surfacing as a confusing failure deep in a request later.
export const config: AppConfig = buildConfig();
