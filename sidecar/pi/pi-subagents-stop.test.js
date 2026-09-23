import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isOwnedSubagentCommand,
  ownedSubagentPids,
  terminateConversationSubagents,
} from "./pi-subagents-stop.js";

test("owned commands are the runner and the external CLIs", () => {
  assert.equal(isOwnedSubagentCommand("node /opt/pi-subagents/src/runs/background/subagent-runner.js", "runner"), true);
  assert.equal(isOwnedSubagentCommand("/usr/bin/cursor-agent --print", "external"), true);
  assert.equal(isOwnedSubagentCommand("/Applications/Claude.app/claude", "external"), true);
  assert.equal(isOwnedSubagentCommand("codex exec", "external"), true);
  assert.equal(isOwnedSubagentCommand("/usr/sbin/launchd", "runner"), false);
  assert.equal(isOwnedSubagentCommand("/usr/bin/python3", "external"), false);
  assert.equal(isOwnedSubagentCommand("", "runner"), false);
});

async function liveRun(status) {
  const root = await mkdtemp(join(tmpdir(), "milksu-stop-"));
  const run = join(root, "run-1");
  await mkdir(run);
  await writeFile(join(run, "status.json"), JSON.stringify(status));
  return { root, run };
}

test("a live runner is signaled and an unrelated pid is not", async () => {
  const { root, run } = await liveRun({
    state: "running",
    pid: 4242,
    steps: [{ externalProcess: { pid: 5252 } }, { externalProcess: { pid: 6262 } }],
  });
  const signals = [];
  const outcomes = await terminateConversationSubagents(
    [{ id: "run-1", status: "running", asyncDir: run }],
    root,
    {
      graceMs: 0,
      platform: "linux",
      commandForPid(pid) {
        if (pid === 4242) return "node /pkg/pi-subagents/src/runs/background/subagent-runner.js";
        if (pid === 5252) return "/usr/local/bin/cursor-agent --print";
        if (pid === 6262) return "/usr/bin/python3";
        return "";
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 0) {
          const error = new Error("dead");
          error.code = "ESRCH";
          throw error;
        }
      },
    },
  );
  assert.deepEqual(outcomes, [{
    id: "run-1",
    action: "signaled",
    pids: [4242, 5252],
  }]);
  assert.deepEqual(
    signals.filter(([, signal]) => signal !== 0),
    [[-4242, "SIGTERM"], [-5252, "SIGTERM"]],
  );
});

test("a runner that is still alive after SIGTERM receives SIGKILL", async () => {
  const { root, run } = await liveRun({ state: "running", pid: 4343 });
  const signals = [];
  await terminateConversationSubagents(
    [{ id: "run-1", status: "running", asyncDir: run }],
    root,
    {
      graceMs: 0,
      platform: "linux",
      commandForPid: () => "node subagent-runner.js",
      kill(pid, signal) {
        signals.push([pid, signal]);
      },
    },
  );
  assert.deepEqual(
    signals.filter(([, signal]) => signal !== 0),
    [[-4343, "SIGTERM"], [-4343, "SIGKILL"]],
  );
});

test("ownedSubagentPids refuses a runner whose command line is not the package", async () => {
  const { root, run } = await liveRun({ state: "running", pid: 7 });
  const owned = ownedSubagentPids(run, root, {
    commandForPid: () => "/usr/sbin/launchd",
  });
  assert.deepEqual(owned, { action: "skipped", pids: [] });
});
