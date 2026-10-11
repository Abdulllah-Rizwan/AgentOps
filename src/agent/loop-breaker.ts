// The loop-breaker (CLAUDE.md Phase 4, Section 3b): a per-chat hard cap on CONSECUTIVE non-human
// turns, so two agents can't tag each other forever and burn credits with no human involved. It is
// independent of the addressing gate on purpose - even if the gate had a bug and two bots tagged
// each other, this caps the spend. Deliberately tiny: a counter in the existing memory store.
//
// Semantics:
//   - An allow-listed human speaking RESETS the counter to zero (the room has a human again).
//   - A non-human turn the agent would act on INCREMENTS the counter.
//   - Once the counter exceeds MAX_CONSECUTIVE_BOT_TURNS, the chat is "tripped": the agent stays
//     silent there until a human message resets it.

import { config } from "../config/env.js";
import { memory } from "../memory/store.js";

const MAX = config.telegram.maxConsecutiveBotTurns;

/** An allow-listed human spoke: clear the non-human streak for this chat. */
export async function registerHumanTurn(chatId: number): Promise<void> {
  await memory.setBotTurns(chatId, 0);
}

/**
 * Count one non-human turn for this chat and report whether the cap is now exceeded. `tripped`
 * true means: do NOT act (stay silent) until a human resets the counter.
 */
export async function registerNonHumanTurn(
  chatId: number
): Promise<{ count: number; max: number; tripped: boolean }> {
  const count = (await memory.getBotTurns(chatId)) + 1;
  await memory.setBotTurns(chatId, count);
  return { count, max: MAX, tripped: count > MAX };
}
