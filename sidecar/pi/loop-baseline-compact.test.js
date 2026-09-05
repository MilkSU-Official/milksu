import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTEXT_COMPACTION_RATIO,
  compactionInstructions,
  contextUsageSnapshot,
} from "./bridge-compaction.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("baseline: auto-compact is 85 percent and keeps failed-experiment details", () => {
  assert.equal(CONTEXT_COMPACTION_RATIO, 0.85);
  assert.equal(contextUsageSnapshot({ inputTokens: 85_000 }, 100_000).shouldCompact, true);
  assert.match(compactionInstructions, /不要丢弃任何会改变后续行为的细节/);
});

test("baseline: composer has /compact, /rewind and /handoff", async () => {
  const source = await readFile(
    join(root, "app/src/components-vue/ChatComposer.vue"),
    "utf8",
  );
  assert.match(source, /id: 'compact'/);
  assert.match(source, /id: 'rewind'/);
  assert.match(source, /id: 'handoff'/);
});
