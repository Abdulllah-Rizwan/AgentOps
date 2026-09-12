import { bot } from "./bot.js";

bot.launch();
console.log("Bot is running (long-polling). Press Ctrl+C to stop.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
