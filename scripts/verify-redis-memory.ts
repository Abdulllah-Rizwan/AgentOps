// Layer 4 verification: the ioredis-backed memory persists across a process RESTART. Run in two
// separate processes (the restart simulation), both with REDIS_URL pointed at a local Redis:
//
//   REDIS_URL=redis://localhost:6379 node ./node_modules/tsx/dist/cli.mjs scripts/verify-redis-memory.ts write
//   REDIS_URL=redis://localhost:6379 node ./node_modules/tsx/dist/cli.mjs scripts/verify-redis-memory.ts read
//
// The "write" process exits fully; "read" is a cold process that must still see the data -> proof
// it lives in Redis, not in process memory. Exits non-zero if the backend isn't Redis or data is lost.

import { memory } from "../src/memory/store.js";
import { config } from "../src/config/env.js";

const CHAT = -424242;
const MARKER = "MARKER_PERSIST_TEST";
const phase = process.argv[2];

if (!config.memory.redisUrl) {
  console.error("FAIL: REDIS_URL is not set, so this is not exercising the Redis backend. Aborting.");
  process.exit(1);
}

if (phase === "write") {
  await memory.setBotTurns(CHAT, 0); // start clean
  await memory.append(CHAT, [
    { role: "user", content: MARKER },
    { role: "assistant", content: "stored before restart" },
  ]);
  await memory.setBotTurns(CHAT, 2);
  console.log("WROTE marker + bot_turns=2 to Redis, then exiting (simulated shutdown).");
  process.exit(0);
} else if (phase === "read") {
  const turns = await memory.load(CHAT);
  const botTurns = await memory.getBotTurns(CHAT);
  const hasMarker = turns.some((t) => t.content === MARKER);
  const turnsOk = botTurns === 2;
  console.log(`READ ${turns.length} turn(s); marker present=${hasMarker}; bot_turns=${botTurns}`);
  const pass = hasMarker && turnsOk;
  console.log(pass ? "PASS: data survived the restart (persisted in Redis)." : "FAIL: data did not survive.");
  process.exit(pass ? 0 : 1);
} else {
  console.error('Usage: ... verify-redis-memory.ts <write|read>');
  process.exit(2);
}
