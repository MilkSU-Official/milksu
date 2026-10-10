// PR-2 批次 D2：归档面的翻转增量测试（翻转首启一次性导出 + destroySession 的归档源
// 文件触点）。D1 的导出/导入等价性测试在 harness-archive.test.js（本票零改动）；这里
// 只测 D2 新面。数据全在 mkdtemp 临时目录（合成），模型层零网络（faux provider 注册面）。

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "@earendil-works/pi-durable";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { openMilkSUHarness } from "./harness-adapter.js";
import {
  HARNESS_ARCHIVE_FLIP_EXPORT_FILE,
  archivedLegacySourceCandidates,
  archivedLegacySourcePath,
  deleteArchivedLegacySources,
  exportLegacySessions,
  findArchivedSession,
  importLegacySessionIntoHarness,
  readArchiveManifest,
  resolveHarnessArchiveDirectory,
  resolveLegacySessionsDirectory,
  runFlipArchiveExport,
} from "./harness-archive.js";
import { buildTestLayer } from "./harness-bridge-test-support.mjs";

function iso(seconds) {
  return new Date(Date.UTC(2026, 8, 2, 9, 0, seconds * 1000)).toISOString();
}

function simpleLines(conversationId) {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: conversationId, timestamp: iso(0), cwd: "/tmp/ws" }),
    JSON.stringify({ type: "model_change", id: "m0", parentId: null, timestamp: iso(1), provider: "faux", modelId: "claude-test-1" }),
  ];
  let parent = "m0";
  for (let index = 0; index < 6; index += 1) {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    lines.push(JSON.stringify({
      type: "message", id: userId, parentId: parent, timestamp: iso(2 + index * 2),
      message: { role: "user", content: [{ type: "text", text: `question ${index}` }] },
    }));
    lines.push(JSON.stringify({
      type: "message", id: assistantId, parentId: userId, timestamp: iso(3 + index * 2),
      message: {
        role: "assistant",
        provider: "faux",
        model: "claude-test-1",
        stopReason: "stop",
        content: [{ type: "text", text: `answer ${index}` }],
      },
    }));
    parent = assistantId;
  }
  return lines;
}

async function writeLegacySession(agentDir, fileName, lines) {
  await mkdir(resolveLegacySessionsDirectory(agentDir), { recursive: true });
  const path = join(resolveLegacySessionsDirectory(agentDir), fileName);
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "milksu-flip-archive-"));
  const agentDir = join(root, "agent");
  try {
    return await run({ root, agentDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function exists(path) {
  return stat(path).then(() => true, () => false);
}

// ---------- runFlipArchiveExport（翻转首启一次性导出） ----------

test("flip export runs once, then the completed state makes every later run a no-op", async () => {
  await withFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260902_conv-flip.jsonl", simpleLines("conv-flip"));
    const first = await runFlipArchiveExport({ agentDir });
    assert.equal(first.ran, true);
    assert.equal(first.sessionCount, 1);
    assert.equal(first.copiedCount, 1);
    // 完成态落盘。
    const state = JSON.parse(await readFile(
      join(resolveHarnessArchiveDirectory(agentDir), HARNESS_ARCHIVE_FLIP_EXPORT_FILE),
      "utf8",
    ));
    assert.equal(state.completed, true);
    assert.equal(state.sessionCount, 1);
    // 第二次（同进程 / 下一启动周期）：completed → 不再跑。
    const second = await runFlipArchiveExport({ agentDir });
    assert.equal(second.ran, false);
    assert.equal(second.reason, "completed");
    // manifest 仍在（导出产物不受跳过影响）。
    const manifest = await readArchiveManifest(agentDir);
    assert.equal(findArchivedSession(manifest, "conv-flip")?.conversationId, "conv-flip");
  });
});

test("flip export claim: a live holder is skipped, a dead holder is stolen and re-run", async () => {
  await withFixture(async ({ agentDir }) => {
    const archiveDir = resolveHarnessArchiveDirectory(agentDir);
    await mkdir(archiveDir, { recursive: true });
    // 活 pid + 新鲜 claim：跳过（并发 sidecar 的 manifest 写竞态挡在外面）。
    await writeFile(join(archiveDir, HARNESS_ARCHIVE_FLIP_EXPORT_FILE), `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })}\n`);
    const skipped = await runFlipArchiveExport({ agentDir });
    assert.equal(skipped.ran, false);
    assert.equal(skipped.reason, "in-progress");
    assert.equal(skipped.holder, process.pid);
    // 死 pid（回收不可能命中的内核 pid 区）：偷取重跑。
    await writeFile(join(archiveDir, HARNESS_ARCHIVE_FLIP_EXPORT_FILE), `${JSON.stringify({
      pid: 2147483647,
      startedAt: new Date().toISOString(),
    })}\n`);
    await writeLegacySession(agentDir, "20260902_conv-dead.jsonl", simpleLines("conv-dead"));
    const stolen = await runFlipArchiveExport({ agentDir });
    assert.equal(stolen.ran, true);
    assert.equal(stolen.sessionCount, 1);
  });
});

test("flip export failure leaves the claim for the next startup to self-heal", async () => {
  await withFixture(async ({ agentDir }) => {
    let calls = 0;
    const first = await runFlipArchiveExport({
      agentDir,
      exportFn: async () => {
        calls += 1;
        throw new Error("synthetic export failure");
      },
    }).then(
      value => value,
      () => undefined,
    );
    assert.equal(first, undefined, "first attempt propagates the failure to the caller (layer logs and continues)");
    assert.equal(calls, 1);
    // 同进程内立即重试：claim 的持有 pid（本进程）存活且新鲜 → 跳过（in-progress），
    // 不会与失败路径并发写 manifest。
    const sameProcess = await runFlipArchiveExport({
      agentDir,
      exportFn: () => {
        calls += 1;
        return exportLegacySessions({ agentDir });
      },
    });
    assert.equal(sameProcess.ran, false);
    assert.equal(sameProcess.reason, "in-progress");
    assert.equal(calls, 1);
    // 下个启动周期（新进程语义：持有 pid 已死）→ 偷取重跑（导出器本身 SHA 幂等）。
    const claimPath = join(resolveHarnessArchiveDirectory(agentDir), HARNESS_ARCHIVE_FLIP_EXPORT_FILE);
    await writeFile(claimPath, `${JSON.stringify({
      pid: 2147483647,
      startedAt: new Date().toISOString(),
    })}\n`);
    const nextStart = await runFlipArchiveExport({
      agentDir,
      exportFn: () => exportLegacySessions({ agentDir }),
    });
    assert.equal(nextStart.ran, true);
  });
});

// ---------- archivedLegacySource*（destroySession 的 manifest 触点） ----------

test("archivedLegacySourcePath resolves the current source file from the manifest", async () => {
  await withFixture(async ({ agentDir }) => {
    const source = await writeLegacySession(agentDir, "20260902_conv-src.jsonl", simpleLines("conv-src"));
    await exportLegacySessions({ agentDir });
    assert.equal(await archivedLegacySourcePath(agentDir, "conv-src"), source);
    // 未归档（不在 manifest）→ undefined（调用方保留 SessionManager.list 兜底）。
    assert.equal(await archivedLegacySourcePath(agentDir, "conv-never-exported"), undefined);
    // 归档行存在但源文件已删 → undefined（候选都不存在）。
    await rm(source, { force: true });
    assert.equal(await archivedLegacySourcePath(agentDir, "conv-src"), undefined);
  });
});

test("versioned manifest rows fall back to the un-suffixed source name", async () => {
  await withFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260902_conv-ver.jsonl", simpleLines("conv-ver"));
    await exportLegacySessions({ agentDir });
    // 源变化后重导：版本化归档行成为现役，但现行源文件仍是原始名。（隔 2ms 防两次
    // 导出的 archivedAt 同毫秒平局——D1 现役判定按 archivedAt 新者胜，同毫秒平局
    // 属生产不可达的边角，不在本票修。）
    await new Promise(resolve => setTimeout(resolve, 2));
    const sourcePath = join(resolveLegacySessionsDirectory(agentDir), "20260902_conv-ver.jsonl");
    await writeFile(sourcePath, `${simpleLines("conv-ver").slice(0, 4).join("\n")}\n`);
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);
    const entry = findArchivedSession(manifest, "conv-ver");
    assert.match(entry.file, /\.[0-9a-f]{8}\.jsonl$/u, "active row is the versioned copy");
    const candidates = archivedLegacySourceCandidates(agentDir, entry);
    assert.equal(candidates.length, 2, "versioned + plain names are both candidates");
    assert.equal(await archivedLegacySourcePath(agentDir, "conv-ver"), sourcePath,
      "the plain source file is found via the fallback candidate");
  });
});

test("deleteArchivedLegacySources removes sources, never the archive copies or manifest", async () => {
  await withFixture(async ({ agentDir }) => {
    const source = await writeLegacySession(agentDir, "20260902_conv-del.jsonl", simpleLines("conv-del"));
    await exportLegacySessions({ agentDir });
    const removed = await deleteArchivedLegacySources(agentDir, "conv-del");
    assert.equal(removed.length, 1);
    assert.equal(removed[0], source);
    assert.equal(await exists(source), false, "legacy source file is deleted");
    const archiveDir = resolveHarnessArchiveDirectory(agentDir);
    assert.equal(await exists(join(archiveDir, "sessions", "20260902_conv-del.jsonl")), true,
      "the archive copy is the 保底 and is never deleted");
    const manifest = await readArchiveManifest(agentDir);
    assert.equal(findArchivedSession(manifest, "conv-del")?.conversationId, "conv-del",
      "manifest rows are append-only history and stay");
    // 未归档 id：no-op。
    assert.deepEqual(await deleteArchivedLegacySources(agentDir, "conv-not-archived"), []);
  });
});

// ---------- 层接线（flipArchiveExport 真路径 + createSession 自动导入 + destroy） ----------

test("layer construction kicks the flip export and createSession auto-imports archived sessions", async () => {
  await withFixture(async ({ agentDir, root }) => {
    const { faux, models } = makeFauxModels();
    await writeLegacySession(agentDir, "20260902_conv-open.jsonl", simpleLines("conv-open"));
    const { layer } = buildTestLayer({
      agentDir,
      workspace: join(root, "workspace"),
      faux,
      models,
      // null → 产品默认 runFlipArchiveExport 的真路径（层构造即导出）。
      flipArchiveExport: null,
    });
    try {
      // 层构造触发的翻转首启导出已完成（claim → completed）。
      const flip = await layer.archiveReady();
      assert.equal(flip.ran, true);
      assert.equal(flip.sessionCount, 1);
      const state = JSON.parse(await readFile(
        join(resolveHarnessArchiveDirectory(agentDir), HARNESS_ARCHIVE_FLIP_EXPORT_FILE),
        "utf8",
      ));
      assert.equal(state.completed, true);
      // 归档查询面看到已归档未导入。
      const info = await layer.archivedConversationInfo("conv-open");
      assert.equal(info.archived, true);
      assert.equal(info.imported, false);

      // 「继续聊」的桥侧等价面：直接 createSession（桌面发 send_message 的同一条路）
      // → 自动导入 → 会话对象 + 完整转录 + resumed=true，不翻倍。
      const session = await layer.createSession({ conversationId: "conv-open" });
      assert.equal(session.kind, "milksu-harness");
      const events = await layer.conversationEntries("conv-open", { limit: 100 });
      assert.equal(events.items.length, 13, "imported transcript is intact (header + m0 + 6 pairs)");
      const ready = await layer.createSession({ conversationId: "conv-open" });
      assert.equal(ready.kind, "milksu-harness");
      const again = await layer.conversationEntries("conv-open", { limit: 100 });
      assert.equal(again.items.length, 13, "re-createSession does not duplicate the transcript");

      // 已导入判定翻转。
      const afterImport = await layer.archivedConversationInfo("conv-open");
      assert.equal(afterImport.imported, true);

      // destroy + deletePersisted：旧引擎源 JSONL 删除，归档副本与 durable 转录保留。
      await layer.destroySession({ conversationId: "conv-open", deletePersisted: true });
      assert.equal(await exists(join(resolveLegacySessionsDirectory(agentDir), "20260902_conv-open.jsonl")), false);
      assert.equal(
        await exists(join(resolveHarnessArchiveDirectory(agentDir), "sessions", "20260902_conv-open.jsonl")),
        true,
      );
    } finally {
      await layer.disposeAll();
    }
  });
});

function makeFauxModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

test("importer hardens usage-less assistant messages with a zero usage (pi-durable estimateContext)", async () => {
  // 真实旧数据里 stopReason=error/aborted 的 assistant 可能不带 usage；pi-durable 的
  // estimateContext 直接读 message.usage（原生引擎的 assistant 恒带）。缺 usage 不补零
  // 会让续聊的 generation 任务在发请求前就炸（D2 真桥 E2E 实证后加固）。有 usage 的
  // 消息原样保留（D1 等价面不受影响）。
  await withFixture(async ({ agentDir }) => {
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "conv-no-usage", timestamp: iso(0), cwd: "/tmp/ws" }),
      JSON.stringify({ type: "message", id: "u0", parentId: null, timestamp: iso(1), message: { role: "user", content: [{ type: "text", text: "q" }] } }),
      JSON.stringify({
        type: "message", id: "a0", parentId: "u0", timestamp: iso(2),
        message: {
          role: "assistant", provider: "faux", model: "claude-test-1", stopReason: "error",
          content: [{ type: "text", text: "partial answer" }],
        },
      }),
      JSON.stringify({
        type: "message", id: "a1", parentId: "a0", timestamp: iso(3),
        message: {
          role: "assistant", provider: "faux", model: "claude-test-1", stopReason: "stop",
          usage: { input: 9, output: 3, cacheRead: 0, cacheWrite: 0 },
          content: [{ type: "text", text: "with usage" }],
        },
      }),
    ];
    await writeLegacySession(agentDir, "20260904_conv-no-usage.jsonl", lines);
    await exportLegacySessions({ agentDir });
    const { faux, models } = makeFauxModels();
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry: createRegistry(),
      heartbeatMs: 200,
      settleMs: 20,
      unrefHeartbeat: true,
    });
    try {
      const manifest = await readArchiveManifest(agentDir);
      const outcome = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-no-usage",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry: findArchivedSession(manifest, "conv-no-usage"),
      });
      assert.equal(outcome.created, true);
      const page = await handle.conversationEntries("conv-no-usage", { limit: 10 });
      const assistantPayloads = page.items
        .filter(item => item.kind === "pi.assistant")
        .map(item => item.model[0]);
      assert.equal(assistantPayloads.length, 2);
      const byText = Object.fromEntries(assistantPayloads.map(message => [
        message.content?.[0]?.text ?? "",
        message,
      ]));
      assert.deepEqual(
        byText["partial answer"].usage,
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        "usage-less assistant gets a zero usage attached",
      );
      assert.deepEqual(
        byText["with usage"].usage,
        { input: 9, output: 3, cacheRead: 0, cacheWrite: 0 },
        "existing usage is preserved untouched",
      );
    } finally {
      await handle.close();
    }
  });
});
