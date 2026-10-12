// The mutable repo allow-lists (target repos for read/write, and deletable repos), persisted as a
// small JSON file SEPARATE from .env. This is what lets the agent prune a repo it just deleted
// without a restart, and keeps that rewrite far away from the secrets in .env.
//
// Why a separate file and not .env:
//   - .env holds secrets; a programmatic rewrite risks corrupting a credential line. This file holds
//     ONLY repo names, so a bad write can at worst drop a repo name (recoverable), never a secret.
//   - These lists change at runtime (on delete). .env is read once at boot and frozen.
//
// Source of truth: the JSON file. On first run it is SEEDED from the .env-derived values
// (config.github.*), so an existing deployment migrates automatically with no manual step. After
// that, the file wins.
//
// Safety: the ONLY mutation exposed is removeRepoEverywhere(), called when a repo is deleted. It can
// only ever SHRINK the lists - there is no path for the agent to ADD a repo it chose. Growing the
// lists stays a human action (edit the file, restart).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./env.js";
import { repoKey, type RepoRef } from "../types/index.js";

// Resolved against the working directory (like .env), NOT the module path - it must live beside the
// project, not inside dist/, so a rebuild never wipes it. Overridable for tests/proof scripts.
const STORE_PATH = resolve(process.cwd(), process.env.REPOS_FILE?.trim() || "data/repos.json");

interface RepoStoreShape {
  targets: string[];
  deletable: string[];
}

function parseRepoRef(full: string): RepoRef | null {
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return { owner: owner.trim(), repo: repo.trim() };
}

function toRefs(list: string[]): RepoRef[] {
  const refs: RepoRef[] = [];
  for (const entry of list) {
    const ref = parseRepoRef(entry.trim());
    if (ref) refs.push(ref);
  }
  return refs;
}

// In-memory authoritative copy: loaded once at startup, read from directly, and persisted on every
// mutation. Reads come from memory so a prune is reflected immediately (no restart); the file is
// just the durable backing store that survives one.
let targets: RepoRef[] = [];
let deletable: RepoRef[] = [];

function writeStore(): void {
  const data: RepoStoreShape = {
    targets: targets.map(repoKey),
    deletable: deletable.map(repoKey),
  };
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  // Atomic write: write a temp file then rename over the real one, so a crash mid-write can never
  // leave a half-written (corrupt) file where the allow-list should be.
  const tmp = `${STORE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, STORE_PATH);
}

function load(): void {
  if (existsSync(STORE_PATH)) {
    // Strip a leading BOM before parsing: a hand-edit on Windows can prepend one, and JSON.parse
    // rejects it. (This project has a long history of BOM/CRLF corruption - see decisions.md.)
    const text = readFileSync(STORE_PATH, "utf8").replace(/^﻿/, "");
    let raw: Partial<RepoStoreShape>;
    try {
      raw = JSON.parse(text) as Partial<RepoStoreShape>;
    } catch (err) {
      throw new Error(
        `Repo store ${STORE_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
          `Fix or delete the file - deleting it re-seeds the lists from .env on next start.`
      );
    }
    targets = toRefs(Array.isArray(raw.targets) ? raw.targets : []);
    deletable = toRefs(Array.isArray(raw.deletable) ? raw.deletable : []);
    return;
  }
  // First run: seed from the .env-derived values and persist. From here on the file is the source of
  // truth, so an existing deployment migrates with no manual step.
  targets = [...config.github.targetRepos];
  deletable = [...config.github.deletableRepos];
  writeStore();
}

load();

/** The target (read/write) allow-list, live from the in-memory store. */
export function getTargetRepos(): RepoRef[] {
  return targets;
}

/** The deletable allow-list, live from the in-memory store. */
export function getDeletableRepos(): RepoRef[] {
  return deletable;
}

/** Absolute path the lists are persisted to (for logs and proof scripts). */
export function repoStorePath(): string {
  return STORE_PATH;
}

/**
 * Remove a repo from BOTH lists (called when that repo is deleted). Returns true if anything was
 * removed. This is the only mutation the store exposes, and it can only SHRINK the lists - it never
 * adds a repo. Persists atomically so the change survives a restart.
 */
export function removeRepoEverywhere(repo: RepoRef): boolean {
  const key = repoKey(repo).toLowerCase();
  const before = targets.length + deletable.length;
  targets = targets.filter((r) => repoKey(r).toLowerCase() !== key);
  deletable = deletable.filter((r) => repoKey(r).toLowerCase() !== key);
  const changed = targets.length + deletable.length !== before;
  if (changed) writeStore();
  return changed;
}
