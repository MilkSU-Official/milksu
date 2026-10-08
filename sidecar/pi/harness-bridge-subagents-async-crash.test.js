// PR-2 批次 C2 崩溃测试：异步路面的 background anchor run（真 SIGKILL，C1
// harness-bridge-subagents-crash 的同款父子结构）。
//
// before 子进程：subagent_async 默认 async spawn → 收据立即返回 → background
//   anchor 任务的 run 相位建 child 会话并提交（requestId=subagent-async:<runId>）
//   → child 的 bash sleep 在飞行中被父进程 SIGKILL（intent 已落盘、结果未落，
//   anchor 停在 monitor 等待中）。
// after 子进程：重开同一存储 → anchor 任务由调度器续跑（run 相位重来：所有权索引
//   找回同一 child、requestId 幂等不重投）→ child 的 interrupted bash 收错误结果后
//   续答 → anchor 摘要 + 完成通知作为 follow-up 输入投回父会话（原生唤醒）→
//   父会话续答。断言见 scenario 的 result.json。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "harness-bridge-subagents-async-crash-scenario.mjs",
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

test("async subagent run survives SIGKILL: the anchor rerun finds the same child, submits once, notifies, and closes", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-c2-crash-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  try {
    const before = spawnScenario(["--phase", "before", "--run-dir", root]);
    const statusPath = join(root, "status.ndjson");

    // async child 已登记（background 会话）、child 的 bash 已开跑（exec-log 落行）。
    const running = await tailSignal(statusPath, "child-running");
    assert.ok(Number.isInteger(running.data.childConversationId), "child conversation id recorded");
    assert.ok(running.data.runId, "async run id recorded");
    assert.ok(running.data.beats >= 1, "heartbeat beating while the anchor runs");

    // SIGKILL：child 的 bash execute 在飞行中被杀（intent 落盘、结果未落），
    // anchor 的 monitor 等待被打断。
    before.child.kill("SIGKILL");
    const beforeExit = await before.exited;
    assert.equal(beforeExit.signal, "SIGKILL");

    const after = spawnScenario(["--phase", "after", "--run-dir", root]);
    const afterExit = await after.exited;
    assert.equal(afterExit.code, 0, `scenario output: ${afterExit.output}`);

    const result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
    const failed = result.checks.filter(check => !check.ok);
    assert.deepEqual(
      failed.map(check => check.name),
      [],
      `failed checks: ${JSON.stringify(failed, null, 2)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
