// PR-2 批次 D1：按需导入器的崩溃注入硬核测试（真 SIGKILL）。
//
// 结构照 harness-crash.test.js（REHEARSAL runner.mjs 模式）：父进程 spawn 子进程
// （harness-archive-crash-scenario.mjs）跑 before 阶段（合成 20002 条大转录 → 归档 →
// 导入 commit 进行中），tail status.ndjson 到 "importing" 信号（第 256 条追加完成）后
// **立即**发 SIGKILL（真 kill -9；实测全量导入最快 ~100ms 完成，固定延迟会被跑完，
// 所以杀点取信号检测的最早时刻——10ms 轮询），再起 after 子进程重开同一存储断言：
// 原子性（要么全无要么全有，绝不残缺）→ 重导不重复不残缺 → 新旧上下文逐条 diff 等
// 价 → 再重导幂等 → 源文件只读。
//
// 红线：全部数据在 mkdtemp 临时目录（合成）；不触碰真实 runtime-data；零网络零密钥
//（pi-ai faux provider 仅注册 provider 面）。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scenarioPath = join(dirname(fileURLToPath(import.meta.url)), "harness-archive-crash-scenario.mjs");
const POLL_INTERVAL_MS = 10;

async function tailSignal(statusPath, trigger, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      for (const line of (await readFile(statusPath, "utf8")).split("\n")) {
        if (!line) continue;
        try {
          if (JSON.parse(line).msg === trigger) return;
        } catch {
          // 半行写入：下一轮再读。
        }
      }
    } catch {
      // 文件尚未创建。
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
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

test("SIGKILL mid-import: atomic rollback, re-import exact, context equivalent, idempotent", async t => {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-archive-crash-"));
  const statusPath = join(root, "status.ndjson");
  let evidence = "";
  try {
    const before = spawnScenario(["--phase", "before", "--run-dir", root]);
    await tailSignal(statusPath, "importing");
    before.child.kill("SIGKILL");
    const beforeExit = await before.exited;
    evidence = `status:\n${await readFile(statusPath, "utf8").catch(() => "<none>")}\nchild output:\n${beforeExit.output}`;
    assert.equal(beforeExit.signal, "SIGKILL",
      `before phase must die by SIGKILL mid-commit\n${evidence}`);

    const after = spawnScenario(["--phase", "after", "--run-dir", root]);
    const afterExit = await after.exited;
    assert.equal(afterExit.code, 0, `after phase failed:\n${afterExit.output}`);
    const result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
    const failures = result.checks.filter(check => !check.ok);
    assert.deepEqual(failures, [], JSON.stringify(result.checks, null, 2));
    // 主路径断言：杀点落在 commit 进行中（completedBeforeKill=false → 原子回滚路径）。
    // 若机器极端快导致 kill 前已完成提交，completedBeforeKill=true 的全量分支同样全绿
    //（断言集里已覆盖）；两种结局都不允许残缺态。
    assert.equal(typeof result.completedBeforeKill, "boolean");
  } catch (error) {
    // 诊断留现场：并行负载下的 before 早退/失败路径取证。
    evidence += `\nstatus-tail:\n${await readFile(statusPath, "utf8").catch(() => "<none>")}`;
    error.message = `${error.message}\n${evidence}`;
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
