import "dotenv/config";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}

const bot = new Telegraf(token);

bot.on("text", async (ctx) => {
  await ctx.reply(`I received: ${ctx.message.text}`);
});

bot.launch();
console.log("Bot is running (long-polling). Press Ctrl+C to stop.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
