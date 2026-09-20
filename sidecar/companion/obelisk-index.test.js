import test from "node:test";
import assert from "node:assert/strict";
import { queryCompanionMemory, scheduleCompanionIndexRefresh } from "./obelisk-index.js";

test("companion index refresh is scheduled asynchronously", async () => {
  let ran = false;
  scheduleCompanionIndexRefresh({
    path: "",
  });
  assert.equal(ran, false);
  await new Promise(resolve => setTimeout(resolve, 10));
  const result = await queryCompanionMemory(
    { action: "search", query: "auth" },
    { memorySearchEnabled: false },
  );
  assert.equal(result.written, false);
});
