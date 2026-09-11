import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("host plugin loads as an ES module from a .mjs path", async () => {
  const loaded = await import(pathToFileURL(join(here, "host-plugin.mjs")).href);
  assert.equal(loaded.name, "milksu-dsh-host");
  assert.deepEqual(loaded.inject, ["compaction", "agents"]);
  assert.equal(typeof loaded.apply, "function");
});
