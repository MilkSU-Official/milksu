// PR-2 批次 C1 崩溃测试：replay-safe 子代理（真 SIGKILL，B1 harness-bridge-crash
// 的同款父子结构）。
//
// before 子进程：派活 worker → child 会话建立并提交 → child 的 bash sleep 在飞行中
//   被父进程 SIGKILL（intent 已落盘、结果未落）。
// after 子进程：重开同一存储 → 同 requestId 重投 → subagent 工具 replay-safe 重跑
//   → 所有权索引找回同一 child（不重复建）→ requestId 幂等（不重投）→ child 的
//   interrupted bash 收错误结果后续答 → 工具结果回传 child 终答 → parent 续答。
// 断言见 scenario 的 result.json（同 child id、child 单条 pi.user、exec-log 单行、
// 工具结果非错含 child 终答、parent 终答、roster succeeded）。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "harness-bridge-subagents-crash-scenario.mjs",
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

test("subagent run survives SIGKILL: reopen finds the same child, submits once, and finishes", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-c1-crash-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  try {
    const before = spawnScenario(["--phase", "before", "--run-dir", root]);
    const statusPath = join(root, "status.ndjson");

    // child 会话已登记、child 的 bash 已开跑（exec-log 落行）。
    const running = await tailSignal(statusPath, "child-running");
    assert.ok(Number.isInteger(running.data.childConversationId), "child conversation id recorded");
    assert.ok(running.data.beats >= 1, "heartbeat beating while the child runs");

    // SIGKILL：child 的 bash execute 在飞行中被杀（intent 落盘、结果未落）。
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
