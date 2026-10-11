// Layer 2 verification: the addressing gate decides correctly for every case, as a pure function
// (no Telegram needed). The live "in a real group" check still needs a test group + VPN; this
// proves the logic the handler relies on. Run: node ./node_modules/tsx/dist/cli.mjs scripts/verify-gate.ts

import { isAddressedToAgent } from "../src/agent/gate.js";

const HANDLE = "our_agent_bot";
let failures = 0;

function check(label: string, got: boolean, want: boolean) {
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
  if (!pass) failures++;
}

// Private chat: always addressed, mention or not.
check("private chat, no mention", isAddressedToAgent({ chatType: "private", text: "hello", botHandle: HANDLE }), true);

// Group chat: addressed only with an explicit @handle mention.
check("group, tagged", isAddressedToAgent({ chatType: "group", text: "@our_agent_bot read the repo", botHandle: HANDLE }), true);
check("supergroup, tagged mid-sentence", isAddressedToAgent({ chatType: "supergroup", text: "hey @our_agent_bot can you help", botHandle: HANDLE }), true);
check("group, tagged with different case", isAddressedToAgent({ chatType: "group", text: "@OUR_AGENT_BOT hi", botHandle: HANDLE }), true);
check("group, handle given WITH leading @ in config", isAddressedToAgent({ chatType: "group", text: "@our_agent_bot hi", botHandle: "@our_agent_bot" }), true);

check("group, no mention at all", isAddressedToAgent({ chatType: "group", text: "just chatting", botHandle: HANDLE }), false);
check("group, someone else tagged", isAddressedToAgent({ chatType: "group", text: "@hermes_bot do this", botHandle: HANDLE }), false);
check("group, substring of a longer handle", isAddressedToAgent({ chatType: "group", text: "@our_agent_bot_2 hi", botHandle: HANDLE }), false);
check("group, handle without @ is not a mention", isAddressedToAgent({ chatType: "group", text: "our_agent_bot do it", botHandle: HANDLE }), false);
check("group, no handle known -> silent", isAddressedToAgent({ chatType: "group", text: "@our_agent_bot hi", botHandle: undefined }), false);
check("group, handle as email-ish prefix not matched", isAddressedToAgent({ chatType: "group", text: "mail x@our_agent_bot.com", botHandle: HANDLE }), false);

console.log(`\n${failures === 0 ? "ALL GATE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
