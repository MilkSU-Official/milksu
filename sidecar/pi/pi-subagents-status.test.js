import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acceptedAsyncDir,
  mapAsyncSubagentStatus,
  readAsyncSubagentSnapshot,
} from "./pi-subagents-status.js";

test("async status maps live states to running and stop-like states to failed", () => {
  assert.equal(mapAsyncSubagentStatus("running"), "running");
  assert.equal(mapAsyncSubagentStatus("paused"), "running");
  assert.equal(mapAsyncSubagentStatus("queued"), "running");
  assert.equal(mapAsyncSubagentStatus("starting"), "running");
  assert.equal(mapAsyncSubagentStatus("failed"), "failed");
  assert.equal(mapAsyncSubagentStatus("stopped"), "failed");
  assert.equal(mapAsyncSubagentStatus("timeout"), "failed");
  assert.equal(mapAsyncSubagentStatus("complete"), "succeeded");
  assert.equal(mapAsyncSubagentStatus("partial"), "succeeded");
});

test("async dir reads stay inside temp or the workspace and hide absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-async-"));
  const workspace = await realpath(root);
  const outside = await mkdtemp(join(tmpdir(), "milksu-async-out-"));
  const run = join(workspace, "run");
  await mkdir(run);
  await writeFile(join(run, "status.json"), JSON.stringify({
    state: "running",
    error: `see ${join(outside, "secret")}`,
  }));
  await writeFile(join(run, "output-0.log"), `hello ${join(run, "notes.txt")}\n`);
  const snapshot = readAsyncSubagentSnapshot(run, workspace);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.summary.includes(outside), false);
  assert.equal(snapshot.transcript.includes(run), false);
  assert.match(snapshot.transcript, /hello/);

  const link = join(workspace, "escape");
  await symlink("/usr", link);
  assert.equal(acceptedAsyncDir(link, workspace), "");
  assert.equal(acceptedAsyncDir(join(run, "..", "..", "etc"), workspace), "");
});
