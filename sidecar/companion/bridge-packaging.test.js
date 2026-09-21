import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { companionCommandRunsImmediately } from "./bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "bridge.js"), "utf8");

test("companion bridge imports provider runtime as ESM so packaging can bundle it", () => {
  assert.match(
    source,
    /import\s+currentProviderRuntime\s+from\s+"\.\.\/pi\/current-provider-runtime\.cjs"/,
  );
  assert.doesNotMatch(source, /createRequire/);
  assert.doesNotMatch(source, /require\(["']\.\.\/pi\/current-provider-runtime\.cjs["']\)/);
});

test("companion session keeps the full Pi tool loop instead of noTools all", () => {
  assert.match(source, /companionSessionToolNames\(\)/);
  assert.doesNotMatch(source, /noTools:\s*"all"/);
});

test("development run-bridge marks itself as the companion main entry", async () => {
  const entry = readFileSync(join(here, "run-bridge.mjs"), "utf8");
  assert.match(entry, /MILKSU_COMPANION_BRIDGE_MAIN/);
  assert.match(source, /MILKSU_COMPANION_BRIDGE_MAIN/);
});

test("host replies and abort run immediately like main Pi workspace_action / abort_session", () => {
  assert.equal(companionCommandRunsImmediately("companion_host_response"), true);
  assert.equal(companionCommandRunsImmediately("abort"), true);
  assert.equal(companionCommandRunsImmediately("send_message"), false);
  assert.equal(companionCommandRunsImmediately("create_session"), false);
  assert.match(source, /dispatchCompanionLine/);
  assert.match(source, /Do not await session\.prompt on the stdin command queue/);
});
