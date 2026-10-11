// The Telegram boundary: receive a message, gate it on the sender allow-list, hand it to the agent
// (via the memory-backed conversation seam), and send the reply back. It contains no agent/GitHub
// logic itself - just Telegram wiring. The Telegraf timeout/error-handling and the send-with-
// Markdown-fallback flow are preserved from v1/v2, which earned them against real failures.

import { Telegraf } from "telegraf";
import { config } from "../config/env.js";
import { handleMessage } from "../agent/conversation.js";
import { isAddressedToAgent } from "../agent/gate.js";
import { registerHumanTurn, registerNonHumanTurn } from "../agent/loop-breaker.js";
import { splitForTelegram, shouldUseMarkdown, toTelegramMarkdown } from "./format.js";

// Telegraf wraps each update in its own timeout and, on firing, its default handler re-throws and
// crashes the process. Raise the ceiling to just under Vercel's 300s function limit and register a
// real handler, so a slow/failed update reports a friendly message and the process survives.
export const bot = new Telegraf(config.telegram.botToken, { handlerTimeout: 280_000 });

bot.catch((err, ctx) => {
  console.error("Unhandled error while processing update:", err);
  ctx
    .reply("Sorry, something went wrong (or took too long) handling that. Try again, or with a smaller request.")
    .catch((replyErr) => console.error("Couldn't even send the error reply:", replyErr));
});

// NOTE: sender allow-list enforcement used to live in a `bot.use` middleware that dropped every
// non-allow-listed sender before the handler. It now lives INSIDE the handler (below), so the
// loop-breaker has a real chokepoint to see and count non-human turns - a blanket drop here would
// hide them. The security posture is unchanged: unauthorized senders and bots still get silence.

bot.on("text", async (ctx) => {
  const message = ctx.message.text;
  const chatId = ctx.chat.id;
  const from = ctx.from;

  // Sender classification (CLAUDE.md 3b): a human is an allow-listed, non-bot sender. Anything else
  // - a bot (is_bot), or any id not on the human allow-list - is treated as non-human.
  const isAllowedHuman =
    from !== undefined && from.is_bot !== true && config.telegram.allowedUserIds.has(from.id);

  if (isAllowedHuman) {
    // A human speaking resets the loop-breaker (addressed or not) - the room has a human again.
    await registerHumanTurn(chatId);
  } else {
    // Kept exact: the bootstrap trick for finding a new user's numeric ID (message the bot, read it here).
    console.log(`Ignored message from unauthorized/non-human sender ID: ${from?.id} (is_bot=${from?.is_bot === true})`);
  }

  // Addressing gate (CLAUDE.md 3a): in a group, act only when explicitly @mentioned. The handle is
  // the configured one, or the bot's own username (Telegraf resolves it via getMe at launch into
  // ctx.me). Not addressed -> ignore SILENTLY: no placeholder, no LLM call, no reply.
  const botHandle = config.telegram.agentHandle ?? ctx.me;
  if (!isAddressedToAgent({ chatType: ctx.chat.type, text: message, botHandle })) {
    console.log(`[gate] ignoring message in ${ctx.chat.type} chat ${chatId} (not addressed to @${botHandle ?? "?"})`);
    return;
  }

  // Command authority is humans-only in v1 (CLAUDE.md 3c): a non-human that addresses the agent is
  // not obeyed. The loop-breaker counts the turn and, once past the cap, keeps the chat silent until
  // a human speaks - the backstop against two agents looping even if the gate above ever misfires.
  if (!isAllowedHuman) {
    const { count, max, tripped } = await registerNonHumanTurn(chatId);
    console.log(
      tripped
        ? `[loop-breaker] cap ${max} exceeded in chat ${chatId} (turn ${count}); silent until a human speaks.`
        : `[loop-breaker] non-human turn ${count}/${max} in chat ${chatId}; not acting (humans-only).`
    );
    return;
  }

  const placeholder = await ctx.reply("Thinking...");

  let resultText: string;
  try {
    resultText = await handleMessage(chatId, message);
  } catch (err) {
    console.error("Failed to handle message:", err);
    resultText = "Sorry, something went wrong handling that message.";
  }

  const chunks = splitForTelegram(toTelegramMarkdown(resultText));

  // Replace the "Thinking..." placeholder with the first chunk; fall back to plain text if Markdown
  // parsing is rejected (an unbalanced * or _ in a conversational reply shouldn't drop the message).
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      placeholder.message_id,
      undefined,
      chunks[0],
      shouldUseMarkdown(chunks[0]) ? { parse_mode: "Markdown" } : {}
    );
  } catch (err) {
    console.error("Formatted reply failed, falling back to plain text:", err);
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, placeholder.message_id, undefined, chunks[0]);
    } catch (fallbackErr) {
      console.error("Plain-text fallback also failed:", fallbackErr);
    }
  }

  for (const chunk of chunks.slice(1)) {
    try {
      await ctx.reply(chunk, shouldUseMarkdown(chunk) ? { parse_mode: "Markdown" } : {});
    } catch (err) {
      console.error("Formatted follow-up failed, falling back to plain text:", err);
      try {
        await ctx.reply(chunk);
      } catch (fallbackErr) {
        console.error("Plain-text follow-up also failed:", fallbackErr);
      }
    }
  }
});
