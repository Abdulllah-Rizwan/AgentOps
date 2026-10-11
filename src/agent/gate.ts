// The addressing gate (CLAUDE.md Phase 4, Section 3a): the in-code rule that decides whether a
// received message is even meant for this agent. It is deliberately TINY - a tag check, nothing
// more - and pure (no Telegram, no network), so it is trivial to test and there is exactly one
// place to open when "it replied/ignored when it shouldn't have" shows up.
//
// Rule:
//   - Private (1:1) chat  -> always addressed. You don't @mention a bot you're DMing.
//   - Any group/supergroup -> addressed ONLY if the text contains an explicit @handle mention of
//     this agent. No fuzzy "probably meant for me" inference (CLAUDE.md: keep v1 strict).
//
// This is enforced in CODE, not left to Telegram's privacy-mode setting, which is a defense-in-
// depth layer at best (CLAUDE.md 3a).

/** A Telegram chat type. Narrowed to what the gate cares about; anything non-private is a group. */
export type ChatType = "private" | "group" | "supergroup" | "channel" | (string & {});

/** Lowercase, strip a single leading '@'. Telegram usernames are case-insensitive, [A-Za-z0-9_]. */
function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

/** Escape a handle for safe inclusion in a RegExp (usernames can't contain regex metachars, but
 *  this keeps the function honest if the config is ever something unexpected). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this message address the agent? Returns true only when the agent should proceed to reason
 * and (maybe) reply. A false means: ignore silently - no LLM call, no reply, no tool use.
 */
export function isAddressedToAgent(params: {
  chatType: ChatType;
  text: string;
  botHandle: string | undefined;
}): boolean {
  const { chatType, text } = params;

  // Private chat: the message is inherently for the bot.
  if (chatType === "private") return true;

  // Group chat: require an explicit @handle mention. Without a known handle we cannot match one,
  // so we stay silent rather than guess (the safe default for the gate).
  const handle = params.botHandle ? normalizeHandle(params.botHandle) : "";
  if (!handle) return false;

  // Match "@handle" as a whole token: a preceding boundary (start or a non-username char) and no
  // trailing username character, so "@handle" matches but "@handlebar" does not. Case-insensitive.
  const mention = new RegExp(`(^|[^A-Za-z0-9_@])@${escapeRegExp(handle)}(?![A-Za-z0-9_])`, "i");
  return mention.test(text);
}
