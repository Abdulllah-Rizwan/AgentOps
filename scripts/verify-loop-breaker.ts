// Layer 3 verification: the loop-breaker caps consecutive non-human turns and resets on a human.
// Simulates the bot-to-bot tagging scenario against the REAL memory store (whatever is configured),
// using a throwaway chatId so it never touches real conversation data. Resets the counter at the end.
//
// Run: node ./node_modules/tsx/dist/cli.mjs scripts/verify-loop-breaker.ts

import { registerHumanTurn, registerNonHumanTurn } from "../src/agent/loop-breaker.js";
import { config } from "../src/config/env.js";

const CHAT = -999001; // throwaway chat id, far from any real one
const MAX = config.telegram.maxConsecutiveBotTurns;
let failures = 0;

function check(label: string, pass: boolean, detail: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  ${detail}`);
  if (!pass) failures++;
}

console.log(`Cap (MAX_CONSECUTIVE_BOT_TURNS) = ${MAX}\n`);

// Start clean (as if a human just spoke).
await registerHumanTurn(CHAT);

// Simulate bots tagging the agent repeatedly. The first MAX turns are allowed (not tripped); the
// one past the cap trips and should keep the chat silent.
for (let i = 1; i <= MAX; i++) {
  const r = await registerNonHumanTurn(CHAT);
  check(`non-human turn ${i} within cap`, r.count === i && r.tripped === false, `(count=${r.count}, tripped=${r.tripped})`);
}

const over = await registerNonHumanTurn(CHAT);
check(`turn ${MAX + 1} trips the cap`, over.count === MAX + 1 && over.tripped === true, `(count=${over.count}, tripped=${over.tripped})`);

// Even further non-human turns stay tripped (silent).
const stillOver = await registerNonHumanTurn(CHAT);
check("still tripped after the cap", stillOver.tripped === true, `(count=${stillOver.count}, tripped=${stillOver.tripped})`);

// A human speaks -> reset. The next non-human turn starts the streak over at 1, not tripped.
await registerHumanTurn(CHAT);
const afterReset = await registerNonHumanTurn(CHAT);
check("human message resets the streak", afterReset.count === 1 && afterReset.tripped === false, `(count=${afterReset.count}, tripped=${afterReset.tripped})`);

// Clean up the throwaway counter.
await registerHumanTurn(CHAT);

console.log(`\n${failures === 0 ? "ALL LOOP-BREAKER CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
