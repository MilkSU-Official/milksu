import assert from "node:assert/strict";
import { test } from "node:test";

import { contextUsageWindowPayload, resolveMaxOutput } from "./context-window-payload.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { knownMaxTokens } = require("./known-context-window.cjs");

test("reports the real input budget when both numbers are known", () => {
  assert.deepEqual(contextUsageWindowPayload(1_048_576, 384_000), {
    maxOutput: 384_000,
    usableWindow: 664_576,
  });
  assert.deepEqual(contextUsageWindowPayload(1_000_000, 384_000), {
    maxOutput: 384_000,
    usableWindow: 616_000,
  });
});

test("omits fields instead of guessing when a number is missing or absurd", () => {
  assert.deepEqual(contextUsageWindowPayload(1_048_576, undefined), {});
  assert.deepEqual(contextUsageWindowPayload(1_048_576, 0), {});
  assert.deepEqual(contextUsageWindowPayload(1_048_576, Number.NaN), {});
  assert.deepEqual(contextUsageWindowPayload(undefined, 384_000), {});
  assert.deepEqual(contextUsageWindowPayload(0, 384_000), {});
  // An output budget that eats the whole window leaves no input room to report.
  assert.deepEqual(contextUsageWindowPayload(384_000, 384_000), {});
  assert.deepEqual(contextUsageWindowPayload(200_000, 384_000), {});
});

test("keeps the reader's panel on its previous shape when nothing is known", () => {
  // The UI only switches denominators when usableWindow/maxOutput arrive, so an
  // empty payload is the documented "no regression" path.
  assert.deepEqual(Object.keys(contextUsageWindowPayload(undefined, undefined)), []);
});

