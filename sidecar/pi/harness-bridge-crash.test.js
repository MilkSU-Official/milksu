// PR-2 批次 B1：审批挂起中 SIGKILL → 重开 → 审批重弹 + 心跳保活断言。
//
// 照 REHEARSAL s5 的形状（批次 A 的 harness-crash.test.js 同款父子结构）：
//   1. before 子进程：门开会话提交 → 工具调用触发 ask 审批 → 假桌面永不回包 →
//      beforeTool 挂起（意图未落盘，盘上无执行痕迹）。
//   2. 心跳保活（DECISIONS Q3 硬要求 2）：挂起期间进程不退出（ref 心跳是唯一事件
//      循环句柄），且 beats 计数递增。父进程看到两组递增 beats、确认进程仍活着
//      之后才发 SIGKILL。
//   3. after 子进程：重开同一存储（锁偷取）→ 同 requestId 重投 → 调度翻起 → call
//      阶段重来 → 审批重弹（自动批准）→ 执行恰好一次 → run 收尾（Q3 口径：崩溃后
//      重问、无副作用重复、无重复 tool-result）。
//
// 红线：数据全在 mkdtemp 临时目录；faux provider，零网络零真实密钥。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "harness-bridge-crash-scenario.mjs",
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

test("approval pending survives SIGKILL: reopen re-fires approval, heartbeat keeps the process alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-bridge-crash-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  try {
    const before = spawnScenario(["--phase", "before", "--run-dir", root]);
    const statusPath = join(root, "status.ndjson");

    // 审批已弹卡、无人回包（beforeTool 挂起）。
    const pending = await tailSignal(statusPath, "approval-pending");
    assert.ok(pending.data.beats >= 1, "heartbeat already beating while pending");

    // 心跳保活（Q3-2）：审批挂起期间进程必须活着且心跳继续跳。
    const pending2 = await tailSignal(statusPath, "approval-pending-2");
    assert.ok(
      pending2.data.beats > pending.data.beats,
      `heartbeat keeps counting during the pending approval: ${pending.data.beats} -> ${pending2.data.beats}`,
    );
    // 进程此刻必须仍在运行（未因事件循环清空而退出）。
    let exitedEarly = false;
    before.exited.then(() => {
      exitedEarly = true;
    });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(exitedEarly, false, "process stays alive while the approval is pending");
    process.kill(before.child.pid, 0);

    before.child.kill("SIGKILL");
    const beforeExit = await before.exited;
    assert.equal(beforeExit.signal, "SIGKILL", "before phase must die by SIGKILL");

    const after = spawnScenario(["--phase", "after", "--run-dir", root]);
    const afterExit = await after.exited;
    assert.equal(afterExit.code, 0, `after phase failed:\n${afterExit.output}`);
    const result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
    const failures = result.checks.filter(check => !check.ok);
    assert.deepEqual(failures, [], JSON.stringify(result.checks, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
