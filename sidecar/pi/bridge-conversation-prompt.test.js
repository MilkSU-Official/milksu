import assert from "node:assert/strict";
import test from "node:test";
import { enqueueConversationPrompt } from "./bridge-conversation-prompt.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("two conversations start their prompts without waiting on each other", async () => {
  const queues = new Map();
  const started = [];
  const first = deferred();
  const second = deferred();

  const firstDone = enqueueConversationPrompt(queues, "a", async () => {
    started.push("a");
    await first.promise;
  });
  const secondDone = enqueueConversationPrompt(queues, "b", async () => {
    started.push("b");
    await second.promise;
  });

  await Promise.resolve();
  assert.deepEqual(started, ["a", "b"]);

  first.resolve();
  second.resolve();
  await Promise.all([firstDone, secondDone]);
});

test("the same conversation stays serialized", async () => {
  const queues = new Map();
  const order = [];
  const hold = deferred();

  const firstDone = enqueueConversationPrompt(queues, "a", async () => {
    order.push("first-start");
    await hold.promise;
    order.push("first-end");
  });
  const secondDone = enqueueConversationPrompt(queues, "a", async () => {
    order.push("second");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);

  hold.resolve();
  await Promise.all([firstDone, secondDone]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("a failed prompt reports once and does not block the next turn", async () => {
  const queues = new Map();
  const seen = [];
  const firstDone = enqueueConversationPrompt(
    queues,
    "a",
    async () => {
      throw new Error("turn failed");
    },
    (error) => {
      seen.push(error instanceof Error ? error.message : String(error));
    },
  );
  await firstDone;
  assert.deepEqual(seen, ["turn failed"]);

  let ran = false;
  await enqueueConversationPrompt(queues, "a", async () => {
    ran = true;
  });
  assert.equal(ran, true);
});
