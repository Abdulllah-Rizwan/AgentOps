import { bot } from "../src/bot.js";

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET is not set. Add it to your Vercel project's environment variables.");
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = await request.json();
    await bot.handleUpdate(update);

    return new Response("OK", { status: 200 });
  },
};
