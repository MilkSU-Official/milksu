import assert from "node:assert/strict";
import test from "node:test";
import { createCTFTruncationContinuationExtension } from "./bridge-ctf-continuation.js";

function harness(sessionRole) {
  const listeners = new Map();
  const sent = [];
  createCTFTruncationContinuationExtension(sessionRole)({
    on: (name, listener) => listeners.set(name, listener),
    sendMessage: (message, options) => sent.push({ message, options }),
  });
  return { listeners, sent };
}

test("CTF uses Pi follow-up to continue a length-truncated response", async () => {
  const { listeners, sent } = harness("solver");
  await listeners.get("agent_end")({
    messages: [{ role: "assistant", stopReason: "length", content: [{ type: "text", text: "主" }] }],
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.display, false);
  assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("CTF does not continue completed responses and Coding does not install the hook", async () => {
  const ctf = harness("solver");
  await ctf.listeners.get("agent_end")({
    messages: [{ role: "assistant", stopReason: "stop", content: [] }],
  });
  assert.equal(ctf.sent.length, 0);

  const coding = harness("");
  assert.equal(coding.listeners.has("agent_end"), false);
});
