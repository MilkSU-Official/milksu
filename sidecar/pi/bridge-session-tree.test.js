import test from "node:test";
import assert from "node:assert/strict";
import {
  findBranchMessage,
  messagesOnActiveBranch,
  navigateFromUserMessage,
} from "./bridge-session-tree.js";

function sessionWithBranch(entries) {
  return {
    sessionManager: {
      getBranch() {
        return entries;
      },
    },
  };
}

test("walks the active branch in chronological order", () => {
  const session = sessionWithBranch([
    { type: "message", id: "u1", message: { role: "user", content: "one" } },
    { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    { type: "message", id: "u2", message: { role: "user", content: "two" } },
  ]);
  assert.deepEqual(
    messagesOnActiveBranch(session, "user").map(entry => entry.id),
    ["u1", "u2"],
  );
  assert.equal(findBranchMessage(session, "user", 1).id, "u2");
  assert.equal(findBranchMessage(session, "assistant", 0).id, "a1");
});

test("navigateFromUserMessage moves the leaf to that user entry", async () => {
  const seen = [];
  const session = {
    ...sessionWithBranch([
      { type: "message", id: "u1", message: { role: "user", content: "one" } },
      { type: "message", id: "u2", message: { role: "user", content: "two" } },
    ]),
    async navigateTree(id) {
      seen.push(id);
    },
  };
  await navigateFromUserMessage(session, 0);
  assert.deepEqual(seen, ["u1"]);
});
