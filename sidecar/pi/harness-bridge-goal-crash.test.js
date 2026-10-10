// PR-2 批次 B2e 崩溃测试：goal 自主续跑的 durable 恢复（真 SIGKILL，C2
// harness-bridge-subagents-async-crash 的同款父子结构）。
//
// before 子进程：/goal 立目标 → 首轮文本 → run_end 观察门投递续跑#1
//（requestId=goal-continue:<goalId>:1 幂等）→ 续跑 run 的 generation 在飞行中被
//   父进程 SIGKILL（工厂已发 continuation-running 信号）。
// after 子进程：重开同一存储（锁偷取）→ createSession adoption 按 Conversation
//   Document 恢复 goal（同一 id、active）→ 打断的 run 续跑收尾 → run_end 观察门投递
//   续跑#2 → goal_complete → 停。断言见 scenario 的 result.json：goal id 跨崩溃稳定、
//   每代 continuation 恰一条 pi.user（requestId 幂等不重复）、终态 complete、
//   turn_settled 恰一次。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "harness-bridge-goal-crash-scenario.mjs",
);

async function tailSignal(statusPath, trigger, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      for (const line of (await readFile(statusPath, "utf8")).split("\n")) {
        if (!line) continue;
        try {
          if (JSON.parse(line).msg === trigger) return JSON.parse(line);
        } catch {
          // 半行写入：下一轮再读。
        }
      }
    } catch {
      // 文件尚未创建。
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for trigger "${trigger}" in ${statusPath}`);
}

function spawnScenario(args) {
  const child = spawn(process.execPath, [scenarioPath, ...args], {
    cwd: dirname(scenarioPath),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => {
    output += chunk;
  });
  child.stderr.on("data", chunk => {
    output += chunk;
  });
  const exited = new Promise(resolve => {
    child.on("exit", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, exited };
}

test("a goal continuation survives SIGKILL: the document restores the goal and resumes without duplicating", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2e-crash-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  try {
    const before = spawnScenario(["--phase", "before", "--run-dir", root]);
    const statusPath = join(root, "status.ndjson");

    // 续跑 run 已开跑（faux 工厂在 generation 里发信号）。
    const running = await tailSignal(statusPath, "continuation-running");
    assert.ok(running, "continuation run in flight before the kill");
    const activeGoal = (await readFile(statusPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .find(entry => entry.msg === "goal-state" && entry.data?.status === "active");
    assert.ok(activeGoal?.data?.id, "goal id recorded before the kill");

    // SIGKILL：generation 在飞行中被杀（continuation#1 的输入已落盘、答复未落）。
    before.child.kill("SIGKILL");
    const beforeExit = await before.exited;
    assert.equal(beforeExit.signal, "SIGKILL", "the before phase died by SIGKILL");
    assert.notEqual(beforeExit.code, 0, "the before phase did not exit cleanly");

    const after = spawnScenario(["--phase", "after", "--run-dir", root]);
    const afterExit = await after.exited;
    assert.equal(afterExit.code, 0, `after phase completed (output: ${afterExit.output.slice(-2000)})`);

    const result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
    assert.equal(result.failed, 0, `all after-phase checks passed: ${JSON.stringify(result.checks, null, 2)}`);
    const byName = new Map(result.checks.map(check => [check.name, check]));
    assert.equal(byName.get("the goal restores from the conversation document with the same id")?.detail?.before, activeGoal.data.id);
    assert.ok(
      byName.get("each continuation iteration appears exactly once (requestId idempotent)")?.ok,
      "requestId idempotency held across the crash",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
