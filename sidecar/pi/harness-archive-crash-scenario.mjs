// 崩溃注入子进程驱动（PR-2 批次 D1 测试专用，非产品代码）。
//
// 用法：node harness-archive-crash-scenario.mjs --phase before|after --run-dir <dir>
//
// before：在 --run-dir/agent/sessions 合成一份大转录旧 JSONL（8000 条，全类型谱骨架）
//         → 导出器归档 → 打开 Harness → 调 importLegacySessionIntoHarness（onProgress
//         每 256 条写 status.ndjson 信号）→ 导入 commit 进行中被父进程 SIGKILL。
// after：重开同一存储（锁偷取：持有者 pid 已死）→ 断言原子性（要么全无要么全有，绝不
//         残缺）→ 重导 → 转录不重复不残缺 + 新旧上下文逐条 diff 等价 → 再重导幂等 →
//         写 result.json。
//
// 红线：数据全在 --run-dir 下的临时目录（合成数据）；模型层是 pi-ai faux provider
// 的 provider 注册面（导入/断言零网络零密钥）。

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRegistry } from "@earendil-works/pi-durable";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { buildSessionContext, convertToLlm, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { openMilkSUHarness } from "./harness-adapter.js";
import {
  exportLegacySessions,
  findArchivedSession,
  importLegacySessionIntoHarness,
  readArchiveManifest,
  resolveHarnessArchiveDirectory,
  resolveLegacySessionsDirectory,
} from "./harness-archive.js";

function argument(name, fallback = undefined) {
  const prefix = `--${name}`;
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const phase = argument("phase");
const runDir = argument("run-dir");
if (!phase || !runDir) {
  console.error("usage: harness-archive-crash-scenario.mjs --phase before|after --run-dir <dir>");
  process.exit(2);
}

const agentDir = join(runDir, "agent");
mkdirSync(resolveLegacySessionsDirectory(agentDir), { recursive: true });
const alias = "conv-crash-large";
const sessionFile = "20260904_conv-crash-large.jsonl";

const statusPath = join(runDir, "status.ndjson");
const t0 = Date.now();
async function signal(message, data) {
  await appendFile(statusPath, `${JSON.stringify({ t: Date.now() - t0, msg: message, ...(data ? { data } : {}) })}\n`);
}

// 大转录：20002 条 user/assistant 交替（每条都带 provider/model 元数据，§6-A 的
// assistant 覆盖面照常参与推导），外加头尾各一组状态条目。体量按「导入 commit 至少
// 数百毫秒」选定——父进程在 onProgress 首个信号（第 256 条）后立即 SIGKILL，杀点稳
// 定落在 commit 进行中（实测全量 8002 条最快 ~100ms 完成，太小会被 kill 前跑完）。
const TOTAL_PAIRS = 10000;
const CRASH_ALIAS = alias;

function buildLargeLines() {
  const lines = [];
  const push = entry => lines.push(JSON.stringify(entry));
  const iso = (n) => new Date(Date.UTC(2026, 8, 4, 0, 0, 0) + n * 1000).toISOString();
  push({ type: "session", version: 3, id: CRASH_ALIAS, timestamp: iso(0), cwd: "/tmp/ws" });
  push({ type: "model_change", id: "m0", parentId: null, timestamp: iso(1), provider: "faux", modelId: "claude-test-1" });
  let parent = "m0";
  let n = 2;
  for (let pair = 0; pair < TOTAL_PAIRS; pair += 1) {
    const userId = `u${pair}`;
    const assistantId = `a${pair}`;
    push({
      type: "message",
      id: userId,
      parentId: parent,
      timestamp: iso(n++),
      message: {
        role: "user",
        content: [{ type: "text", text: `question ${pair}` }],
        timestamp: Date.parse(iso(n)),
      },
    });
    push({
      type: "message",
      id: assistantId,
      parentId: userId,
      timestamp: iso(n++),
      message: {
        role: "assistant",
        api: "openai",
        provider: "faux",
        model: "claude-test-1",
        content: [{ type: "text", text: `answer ${pair}` }],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop",
        timestamp: Date.parse(iso(n)),
      },
    });
    parent = assistantId;
  }
  push({ type: "custom", id: "c0", parentId: parent, timestamp: iso(n++), customType: "milksu.widget-state", data: { done: true } });
  return lines;
}

function makeModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function openHarness(models) {
  return openMilkSUHarness({
    agentDir,
    models,
    registry: createRegistry(),
    heartbeatMs: 200,
    settleMs: 20,
    unrefHeartbeat: true,
  });
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(block => block?.text ?? "").join("");
  return "";
}

function diffContextMessages(oldMessages, newMessages) {
  const mismatches = [];
  for (let index = 0; index < Math.max(oldMessages.length, newMessages.length); index += 1) {
    if (JSON.stringify(oldMessages[index]) !== JSON.stringify(newMessages[index])) {
      mismatches.push(index);
    }
  }
  return mismatches;
}

const checks = [];
function check(name, ok, detail = undefined) {
  checks.push({ name, ok: Boolean(ok), detail });
  return ok;
}

async function runBefore() {
  const lines = buildLargeLines();
  await writeFile(join(agentDir, "sessions", sessionFile), `${lines.join("\n")}\n`);
  await signal("source-written", { entries: lines.length });
  await exportLegacySessions({ agentDir });
  await signal("exported");
  const manifest = await readArchiveManifest(agentDir);
  const entry = findArchivedSession(manifest, CRASH_ALIAS);
  const { models } = makeModels();
  const handle = await openHarness(models);
  await signal("harness-open");
  try {
    await importLegacySessionIntoHarness({
      harness: handle.harness,
      alias: CRASH_ALIAS,
      archiveDir: resolveHarnessArchiveDirectory(agentDir),
      entry,
      onProgress: async progress => {
        if (progress.appended === 256) {
          await signal("importing", { appended: progress.appended, total: progress.total });
        }
      },
    });
    // 正常路径不该走到这里（父进程会在信号后杀掉本进程）；防御性收尾。
    await signal("import-completed-unexpectedly");
    await handle.close();
  } catch (error) {
    await signal("import-failed", { error: String(error?.message ?? error) });
    await handle.close();
  }
}

async function readAllEntries(handle, alias, limit = 4096) {
  const items = [];
  let cursor = undefined;
  do {
    const page = await handle.conversationEntries(alias, { limit, cursor });
    items.push(...(page?.items ?? []));
    cursor = page?.next;
  } while (cursor !== undefined);
  return items;
}

async function runAfter() {
  const { models } = makeModels();
  const handle = await openHarness(models);
  try {
    // ① 原子性：重开后、重导前——要么全无（commit 回滚），要么全有（kill 前恰好提交
    //    完），绝不残缺（有会话没条目 / 条目数在 1..N-1 之间）。
    let preImportEntries = 0;
    let preImportConversation = undefined;
    preImportConversation = await handle.conversation(CRASH_ALIAS);
    const completedBeforeKill = preImportConversation !== undefined;
    if (completedBeforeKill) {
      const page = { items: await readAllEntries(handle, CRASH_ALIAS) };
      preImportEntries = page.items.length;
      check("completed-before-kill: transcript is complete (race tolerated, documented)",
        preImportEntries === 2 * TOTAL_PAIRS + 2, preImportEntries);
    } else {
      check("killed mid-commit: nothing is visible (atomic rollback)", true);
    }
    check("no partial state (0 or full, never in between)",
      !completedBeforeKill || preImportEntries === 2 * TOTAL_PAIRS + 2,
      { completedBeforeKill, preImportEntries });

    // ② 重导：别名命中既有（completedBeforeKill）或全新创建（回滚后）。
    const manifest = await readArchiveManifest(agentDir);
    const entry = findArchivedSession(manifest, CRASH_ALIAS);
    const result = await importLegacySessionIntoHarness({
      harness: handle.harness,
      alias: CRASH_ALIAS,
      archiveDir: resolveHarnessArchiveDirectory(agentDir),
      entry,
    });
    check("re-import settles (created or idempotent hit)",
      result.created === true || result.created === false, result);
    check("re-import appends at most once",
      result.appended === 0 || result.appended === 2 * TOTAL_PAIRS + 2, result.appended);

    // ③ 不重复不残缺：转录恰一份全量。
    const page = { items: await readAllEntries(handle, CRASH_ALIAS) };
    const expected = 2 * TOTAL_PAIRS + 2;
    check(`transcript exactly ${expected} entries (not doubled, not truncated)`,
      page.items.length === expected, page.items.length);
    const kindCounts = {};
    for (const item of page.items) kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
    check(`kind counts: ${TOTAL_PAIRS} pi.user + ${TOTAL_PAIRS} pi.assistant + 2 milksu.custom`,
      kindCounts["pi.user"] === TOTAL_PAIRS
        && kindCounts["pi.assistant"] === TOTAL_PAIRS
        && kindCounts["milksu.custom"] === 2,
      kindCounts);

    // ④ 等价性：新旧上下文逐条 diff（旧侧真源 = buildSessionContext + convertToLlm）。
    const conversation = await handle.harness.conversation(result.conversationId, BACKGROUND_CONTEXT);
    const view = await conversation.context(BACKGROUND_CONTEXT);
    const legacyEntries = parseSessionEntries(
      await readFile(join(agentDir, "sessions", sessionFile), "utf8"),
    ).filter(item => item.type !== "session");
    const legacyContext = buildSessionContext(legacyEntries);
    const legacyLlm = convertToLlm(legacyContext.messages);
    const mismatches = diffContextMessages(legacyLlm, view.messages);
    check(`context equivalent entry by entry (${legacyLlm.length}/${legacyLlm.length}, mismatch=0)`,
      mismatches.length === 0 && view.messages.length === legacyLlm.length,
      { mismatches: mismatches.slice(0, 5), old: legacyLlm.length, new: view.messages.length });
    check("last message preserved", messageText(view.messages.at(-1)) === `answer ${TOTAL_PAIRS - 1}`);
    // §6-A：8000 条 assistant 全带 claude-test-1 元数据 → 有效模型与旧侧一致。
    const agent = await conversation.agent(BACKGROUND_CONTEXT);
    check("effective model matches the old engine derivation",
      JSON.stringify(agent.model) === JSON.stringify(legacyContext.model), { agent: agent.model, old: legacyContext.model });

    // ⑤ 再重导幂等（别名命中，转录不翻倍）。
    const again = await importLegacySessionIntoHarness({
      harness: handle.harness,
      alias: CRASH_ALIAS,
      archiveDir: resolveHarnessArchiveDirectory(agentDir),
      entry,
    });
    check("second re-import hits the alias (created=false, appended=0)",
      again.created === false && again.appended === 0, again);
    const finalPage = { items: await readAllEntries(handle, CRASH_ALIAS) };
    check("transcript still exactly one copy", finalPage.items.length === expected, finalPage.items.length);

    // ⑥ 源文件只读纪律：全程之后字节不变。
    const sourceBytes = await readFile(join(agentDir, "sessions", sessionFile));
    check("source file untouched (sha matches manifest)",
      entry.sha256.length === 64 && (await import("node:crypto"))
        .createHash("sha256").update(sourceBytes).digest("hex") === entry.sha256);

    await writeFile(join(runDir, "result.json"), JSON.stringify({
      phase: "after",
      completedBeforeKill,
      checks,
      failed: checks.filter(item => !item.ok).length,
    }, null, 2));
  } finally {
    await handle.close();
  }
}

if (phase === "before") {
  await runBefore();
} else if (phase === "after") {
  await runAfter();
} else {
  console.error(`unknown phase ${phase}`);
  process.exit(2);
}
process.exit(0);
