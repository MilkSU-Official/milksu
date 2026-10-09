// PR-2 批次 D1：旧 JSONL 归档（导出器 + manifest 查询面 + 按需导入器）测试。
//
// 照 REHEARSAL s7 的验证模板（导出往返 + 最小导入器 + 上下文逐条 diff）扩展到全类型
// 谱：旧侧真源 = pi-coding-agent 的 buildSessionContext + convertToLlm（根导出，非深
// 路径 import）；新侧 = pi-durable Conversation.context()。断言含：压缩区间两侧都不在
// 上下文但转录保全、恢复注入 custom_message 等价、§6-A 有效模型推导两分支（assistant
// 覆盖 model_change + 只有 model_change）、保底类型（usage/label/session_info/
// context_edit/branch_summary）处置、导出/重导幂等、源文件只读纪律。
//
// 红线：全部数据在 mkdtemp 临时目录（合成），不触碰 ~/Library/Application Support 下
// 的真实 runtime-data；模型层零网络（pi-ai faux provider 仅注册 provider 面，不请求）。

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "@earendil-works/pi-durable";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  buildSessionContext,
  convertToLlm,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { openMilkSUHarness } from "./harness-adapter.js";
import {
  LEGACY_CUSTOM_TYPES,
  MILKSU_ARCHIVE_MANIFEST_VERSION,
  archivedSessionSummary,
  deriveLegacyEffectiveSettings,
  deriveLegacySessionTree,
  exportLegacySessions,
  findArchivedSession,
  importLegacySessionIntoHarness,
  parseLegacySessionFile,
  readArchiveManifest,
  resolveHarnessArchiveDirectory,
  resolveHarnessArchiveManifestPath,
  resolveLegacySessionsDirectory,
} from "./harness-archive.js";
import { buildTestLayer } from "./harness-bridge-test-support.mjs";

// ---------- 合成旧 JSONL（全类型谱） ----------

function iso(seconds) {
  return new Date(Date.UTC(2026, 8, 1, 10, 0, seconds * 1000)).toISOString();
}

function messageEntry(id, parentId, seconds, message) {
  return { type: "message", id, parentId, timestamp: iso(seconds), message };
}

function userText(id, parentId, seconds, text) {
  return messageEntry(id, parentId, seconds, {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.parse(iso(seconds)),
  });
}

function assistantText(id, parentId, seconds, text, { provider = "faux", model = "claude-test-1", content } = {}) {
  return messageEntry(id, parentId, seconds, {
    role: "assistant",
    api: "openai",
    provider,
    model,
    content: content ?? [{ type: "text", text }],
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    stopReason: "stop",
    timestamp: Date.parse(iso(seconds)),
  });
}

/**
 * 会话 A：真实数据类型面全谱 + 压缩 + 废弃分支 + §6-A 分支 A（assistant 覆盖
 * model_change）。布局（路径 e1→e14，e11b 废弃）：
 *   e1 model_change claude-test-1 → e2 thinking high → e3 user → e4 assistant(toolCall)
 *   → e5 toolResult → e6 model_change claude-test-2（将被 e8/e14 的 assistant 元数据
 *   覆盖——§6-A 分支 A）→ e7 user(firstKept) → e8 assistant(claude-test-1) →
 *   e9 system（kept 区间内：旧侧不进上下文）→ e10 compaction(firstKept=e7) →
 *   e11b 废弃分支（fork=e10）→ e11 custom → e12 custom_message(recovery) →
 *   e13 user → e14 assistant。
 */
function buildSessionAlphaLines() {
  const lines = [];
  const push = entry => lines.push(JSON.stringify(entry));
  push({ type: "session", version: 3, id: "conv-alpha", timestamp: iso(0), cwd: "/tmp/ws" });
  push({ type: "model_change", id: "e1", parentId: null, timestamp: iso(1), provider: "faux", modelId: "claude-test-1" });
  push({ type: "thinking_level_change", id: "e2", parentId: "e1", timestamp: iso(2), thinkingLevel: "high" });
  push(userText("e3", "e2", 3, "first question"));
  push(messageEntry("e4", "e3", 4, {
    role: "assistant",
    api: "openai",
    provider: "faux",
    model: "claude-test-1",
    content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "npm test" } }],
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    stopReason: "toolUse",
    timestamp: Date.parse(iso(4)),
  }));
  push(messageEntry("e5", "e4", 5, {
    role: "toolResult",
    toolCallId: "tc-1",
    toolName: "bash",
    content: [{ type: "text", text: "42 passed" }],
    isError: false,
    timestamp: Date.parse(iso(5)),
  }));
  push({ type: "model_change", id: "e6", parentId: "e5", timestamp: iso(6), provider: "faux", modelId: "claude-test-2" });
  push(userText("e7", "e6", 7, "second question"));
  push(assistantText("e8", "e7", 8, "second answer"));
  push(messageEntry("e9", "e8", 9, {
    role: "system",
    content: "",
    sections: { tools: "bash, read" },
    timestamp: Date.parse(iso(9)),
  }));
  push({
    type: "compaction",
    id: "e10",
    parentId: "e9",
    timestamp: iso(10),
    summary: "Summarized the first exchange about tests.",
    firstKeptEntryId: "e7",
    tokensBefore: 1234,
  });
  // 废弃分支：e11b 从 e10 分叉，主路径走 e11。
  push(userText("e11b", "e10", 11, "abandoned question"));
  push({ type: "custom", id: "e11", parentId: "e10", timestamp: iso(12), customType: "milksu.widget-state", data: { open: true } });
  push({
    type: "custom_message",
    id: "e12",
    parentId: "e11",
    timestamp: iso(13),
    customType: "milksu-reasoning-only-recovery",
    content: "recovered context",
    display: false,
  });
  push(userText("e13", "e12", 14, "third question"));
  push(assistantText("e14", "e13", 15, "final answer"));
  return lines;
}

/**
 * 会话 B：§6-A 分支 B——最后一条 model_change 在最后一条 assistant 之后，生效模型
 * = model_change 的值（没有更晚的 assistant 元数据覆盖它）。
 */
function buildSessionBetaLines() {
  const lines = [];
  const push = entry => lines.push(JSON.stringify(entry));
  push({ type: "session", version: 3, id: "conv-beta", timestamp: iso(0), cwd: "/tmp/ws" });
  push(userText("b1", null, 1, "hello"));
  push(assistantText("b2", "b1", 2, "hi there", { model: "claude-test-1" }));
  push({ type: "model_change", id: "b3", parentId: "b2", timestamp: iso(3), provider: "faux", modelId: "claude-test-2" });
  push(userText("b4", "b3", 4, "again"));
  push(assistantText("b5", "b4", 5, "answer", { model: "claude-test-1" }));
  // 分支 B 的关键：model_change 在最后 assistant 之后。
  push({ type: "model_change", id: "b6", parentId: "b5", timestamp: iso(6), provider: "faux", modelId: "claude-test-9" });
  return lines;
}

/**
 * 会话 C：保底类型面（真实数据未出现）——usage/label/session_info/context_edit
 * (omit+replace+assistant 字符串替换)/branch_summary，外加一个无任何模型信息的
 * 极简会话骨架（有效模型 = null）。
 */
function buildSessionGammaLines() {
  const lines = [];
  const push = entry => lines.push(JSON.stringify(entry));
  push({ type: "session", version: 3, id: "conv-gamma", timestamp: iso(0), cwd: "/tmp/ws" });
  push(userText("g1", null, 1, "hello"));
  push(assistantText("g2", "g1", 2, "hi there"));
  push(userText("g3", "g2", 3, "to be omitted"));
  push(userText("g4", "g3", 4, "to be edited"));
  push({
    type: "usage",
    id: "g5",
    parentId: "g4",
    timestamp: iso(5),
    kind: "cache_warm",
    provider: "faux",
    model: "claude-test-1",
    usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 },
    note: "warm",
  });
  push({ type: "label", id: "g6", parentId: "g5", timestamp: iso(6), targetId: "g1", label: "重要" });
  push({ type: "session_info", id: "g7", parentId: "g6", timestamp: iso(7), name: "测试会话" });
  push({ type: "context_edit", id: "g8", parentId: "g7", timestamp: iso(8), targetId: "g3", replacement: null });
  push({
    type: "context_edit",
    id: "g9",
    parentId: "g8",
    timestamp: iso(9),
    targetId: "g4",
    replacement: { content: [{ type: "text", text: "edited question" }] },
  });
  push({
    type: "context_edit",
    id: "g10",
    parentId: "g9",
    timestamp: iso(10),
    targetId: "g2",
    replacement: { content: "assistant replaced text" },
  });
  push({
    type: "branch_summary",
    id: "g11",
    parentId: "g10",
    timestamp: iso(11),
    fromId: "g2",
    summary: "abandoned branch recap",
  });
  push(assistantText("g12", "g11", 12, "after branch summary"));
  return lines;
}

async function writeLegacySession(agentDir, fileName, lines) {
  await mkdir(resolveLegacySessionsDirectory(agentDir), { recursive: true });
  const path = join(resolveLegacySessionsDirectory(agentDir), fileName);
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

async function withArchiveFixture(build) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-archive-"));
  const agentDir = join(root, "agent");
  try {
    return await build({ root, agentDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(block => block?.text ?? "").join("");
  return "";
}

/** 逐条 diff：s7 的字段面（role/content/toolCallId/toolName/isError/provider/model/
 * stopReason/timestamp）+ 整条 JSON 相等。返回 mismatch 明细数组。 */
function diffContextMessages(oldMessages, newMessages) {
  const mismatches = [];
  const length = Math.max(oldMessages.length, newMessages.length);
  for (let index = 0; index < length; index += 1) {
    const old = oldMessages[index];
    const current = newMessages[index];
    if (old === undefined || current === undefined) {
      mismatches.push({ index, reason: "length", old: old === undefined ? null : "present", new: current === undefined ? null : "present" });
      continue;
    }
    for (const field of ["role", "toolCallId", "toolName", "isError", "provider", "model", "stopReason", "timestamp"]) {
      if (JSON.stringify(old[field]) !== JSON.stringify(current[field])) {
        mismatches.push({ index, field, old: old[field], new: current[field] });
      }
    }
    if (JSON.stringify(old.content) !== JSON.stringify(current.content)) {
      mismatches.push({ index, field: "content", old: old.content, new: current.content });
    }
    if (JSON.stringify(old) !== JSON.stringify(current)) {
      mismatches.push({ index, field: "<full-message-json>", old, new: current });
    }
  }
  return mismatches;
}

/** 旧侧真源：buildSessionContext + convertToLlm（leaf = 文件序最后一条，与
 * SessionManager._buildIndex 同语义）。 */
async function openHandle(agentDir, models) {
  return openMilkSUHarness({
    agentDir,
    models,
    registry: createRegistry(),
    heartbeatMs: 200,
    settleMs: 20,
    unrefHeartbeat: true,
  });
}

// ---------- 导出器 ----------

test("exporter archives every legacy session byte-identically with a complete manifest", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    const result = await exportLegacySessions({ agentDir });
    assert.deepEqual(result.copied, ["20260901_conv-alpha.jsonl"]);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.manifestWritten, true);

    const manifest = await readArchiveManifest(agentDir);
    assert.equal(manifest.version, MILKSU_ARCHIVE_MANIFEST_VERSION);
    assert.equal(manifest.sessions.length, 1);
    const row = manifest.sessions[0];
    const sourceBytes = await readFile(sourcePath);
    assert.equal(row.conversationId, "conv-alpha");
    assert.equal(row.file, "sessions/20260901_conv-alpha.jsonl");
    assert.equal(row.sha256, sha256(sourceBytes));
    assert.equal(row.byteSize, sourceBytes.byteLength);
    assert.deepEqual(row.header, {
      version: 3,
      id: "conv-alpha",
      timestamp: iso(0),
      cwd: "/tmp/ws",
    });
    assert.deepEqual(row.entryCounts, {
      model_change: 2,
      thinking_level_change: 1,
      message: 9,
      compaction: 1,
      custom: 1,
      custom_message: 1,
      session: 1,
    });
    assert.deepEqual(row.messageRoleCounts, { user: 4, assistant: 3, toolResult: 1, system: 1 });
    assert.equal(row.leafId, "e14");
    assert.deepEqual(row.leafPath, ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11", "e12", "e13", "e14"]);
    assert.deepEqual(row.abandonedBranches, [{ forkEntryId: "e10", branchEntryIds: ["e11b"] }]);

    // 归档副本逐字节一致（原格式保留，全量含废弃分支）。
    const archivedBytes = await readFile(join(agentDir, "archive", "sessions", "20260901_conv-alpha.jsonl"));
    assert.deepEqual(archivedBytes, sourceBytes);
  });
});

test("exporter is idempotent: repeated runs rewrite nothing (SHA-256 equality)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    const first = await exportLegacySessions({ agentDir });
    const archiveFile = join(agentDir, "archive", "sessions", "20260901_conv-alpha.jsonl");
    const manifestPath = resolveHarnessArchiveManifestPath(agentDir);
    const archiveStat = await stat(archiveFile);
    const manifestBytes = await readFile(manifestPath, "utf8");

    const second = await exportLegacySessions({ agentDir });
    assert.deepEqual(second.copied, [], "second run must not re-archive");
    assert.deepEqual(second.skipped, ["20260901_conv-alpha.jsonl"]);
    assert.equal(second.manifestWritten, false, "unchanged manifest must not be rewritten");
    assert.equal((await stat(archiveFile)).mtimeMs, archiveStat.mtimeMs, "archive copy untouched");
    assert.equal(await readFile(manifestPath, "utf8"), manifestBytes, "manifest untouched");

    // 第三跑同样零写入（连跑两次防抖动）。
    const third = await exportLegacySessions({ agentDir });
    assert.equal(third.manifestWritten, false);
    assert.deepEqual(third.copied, []);
  });
});

test("exporter versions a diverged source under a sha-named copy and marks the old row superseded", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    await exportLegacySessions({ agentDir });

    // 源变化（追加一行——仅测试摆盘；产品红线是旧源冻结，导出器只读源）。
    const changed = [...buildSessionAlphaLines(), JSON.stringify(userText("e15", "e14", 16, "after change"))];
    await writeFile(sourcePath, `${changed.join("\n")}\n`);
    const second = await exportLegacySessions({ agentDir });
    assert.deepEqual(second.versioned, [{
      from: "20260901_conv-alpha.jsonl",
      to: `20260901_conv-alpha.${sha256(await readFile(sourcePath)).slice(0, 8)}.jsonl`,
    }]);

    const manifest = await readArchiveManifest(agentDir);
    assert.equal(manifest.sessions.length, 2);
    const active = findArchivedSession(manifest, "conv-alpha");
    assert.ok(active, "an active row must remain");
    assert.equal(active.superseded, undefined);
    assert.notEqual(active.file, "sessions/20260901_conv-alpha.jsonl", "active row is the new version");
    const superseded = manifest.sessions.find(row => row !== active);
    assert.equal(superseded.superseded, true);
    // 两个版本的字节副本都在（归档永不丢数据）。
    await stat(join(agentDir, "archive", active.file));
    await stat(join(agentDir, "archive", superseded.file));

    // 同一变化再跑：版本化路径幂等（wx 撞同版本只核对不重写）。
    const third = await exportLegacySessions({ agentDir });
    assert.deepEqual(third.versioned, []);
    assert.deepEqual(third.copied, []);
  });
});

test("exporter tolerates a missing sessions directory and unparsable files (byte copy still made)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const empty = await exportLegacySessions({ agentDir });
    assert.deepEqual(empty.manifest.sessions, []);

    await mkdir(resolveLegacySessionsDirectory(agentDir), { recursive: true });
    await writeFile(join(agentDir, "sessions", "broken.jsonl"), "{not json at all\n\"also broken\":\n");
    const result = await exportLegacySessions({ agentDir });
    assert.deepEqual(result.copied, ["broken.jsonl"]);
    const row = result.manifest.sessions[0];
    assert.equal(row.conversationId, "");
    assert.ok(row.parseError, "parse failure is recorded");
    // 字节副本仍然归档（保底不丢数据）。
    const archived = await readFile(join(agentDir, "archive", "sessions", "broken.jsonl"), "utf8");
    assert.equal(archived, "{not json at all\n\"also broken\":\n");
    // 解析失败行不参与归档查询。
    assert.equal(findArchivedSession(result.manifest, "broken"), undefined);
  });
});

// ---------- 导入器：全类型谱等价 ----------

test("importer reproduces the old engine context entry by entry (full real-data type face)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);

    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    try {
      const entry = findArchivedSession(manifest, "conv-alpha");
      const result = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-alpha",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry,
      });
      assert.equal(result.created, true);
      assert.equal(result.appended, 14, "leaf path entries only (abandoned branch excluded)");

      const conversation = await handle.harness.conversation(result.conversationId, BACKGROUND_CONTEXT);
      const view = await conversation.context(BACKGROUND_CONTEXT);

      // 旧侧真源 = pi-coding-agent buildSessionContext + convertToLlm。
      const entries = parseSessionEntries(await readFile(sourcePath, "utf8"))
        .filter(item => item.type !== "session");
      const legacyContext = buildSessionContext(entries);
      const legacyLlm = convertToLlm(legacyContext.messages);

      // 逐条 diff：6/6（压缩摘要 1 + kept user/assistant 2 + 恢复注入 1 + 压缩后 2）。
      assert.equal(legacyLlm.length, 6, "old-side truth message count");
      const mismatches = diffContextMessages(legacyLlm, view.messages);
      assert.deepEqual(mismatches, [], "imported context must match the old engine entry by entry");
      assert.equal(view.messages.length, legacyLlm.length, "no extra or missing messages");

      // 压缩摘要包装逐字节一致（§6-B：pi-coding-agent 与 pi-durable 的包装相同）。
      const summary = view.messages.find(message => messageText(message).includes("was compacted into the following summary"));
      assert.ok(summary, "compaction summary present in context");
      assert.equal(
        messageText(summary),
        `The conversation history before this point was compacted into the following summary:\n\n<summary>\nSummarized the first exchange about tests.\n</summary>`,
      );

      // 压缩区间（e1..e6）两侧都不在上下文，但转录保全：42 passed 的 toolResult 在
      // 转录里（s7 同款断言）。
      const page = await handle.conversationEntries("conv-alpha", { limit: 100 });
      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message.role === "toolResult");
      assert.ok(toolResult, "summarized tool result survives in the transcript");
      assert.equal(messageText(toolResult), "42 passed");
      assert.ok(!view.messages.some(message => messageText(message).includes("42 passed")),
        "summarized region is out of context on the new side too");
      assert.ok(!legacyLlm.some(message => messageText(message).includes("42 passed")),
        "old side agrees: summarized region is out of context");

      // kept 区间内的 system 消息（e9）两侧都不进上下文；pi.system 条目仍在转录。
      const systemEntries = page.items.filter(item => item.kind === "pi.system");
      assert.equal(systemEntries.length, 1, "system message preserved in transcript");
      assert.ok(!view.messages.some(message => message.role === "system"),
        "kept-range system message omitted from new context (old-side buildContextEntries rule)");
      assert.ok(!legacyLlm.some(message => message.role === "system"), "old side omits it too");
      const compaction = page.items.find(item => item.kind === "pi.compaction");
      assert.equal(compaction.edits.length, 1, "kept-range system omission carried as a compaction edit");
      assert.equal(compaction.edits[0].action, "omit");
      assert.equal(compaction.edits[0].target, systemEntries[0].id);
      // head 映射到 firstKept（e7）的新 entry id（entries 是最新在前，按内容定位）。
      const firstKeptEntry = page.items.find(item => item.kind === "pi.user"
        && (item.model ?? []).some(message => messageText(message) === "second question"));
      assert.ok(firstKeptEntry, "firstKept entry (e7) present in transcript");
      assert.equal(compaction.head, firstKeptEntry.id, "compaction head is the mapped firstKept entry id");

      // 恢复注入 custom_message → pi.user 等价（s7 断言）。
      const recovered = page.items.find(item => item.kind === "pi.user"
        && (item.model ?? []).some(message => messageText(message) === "recovered context"));
      assert.ok(recovered, "custom_message(recovery) imported as a pi.user entry");
      assert.equal(recovered.data.customType, LEGACY_CUSTOM_TYPES.customMessage);
      assert.equal(recovered.data.legacyCustomType, "milksu-reasoning-only-recovery");
      assert.equal(recovered.data.display, false);

      // 废弃分支 e11b 不进转录（只导当前分支）。
      assert.ok(!page.items.some(item => (item.model ?? []).some(message => messageText(message) === "abandoned question")),
        "abandoned branch must not enter the imported transcript");

      // §6-A 分支 A：e8/e14 的 assistant 元数据（claude-test-1）按序覆盖 e6 的
      // model_change（claude-test-2）——有效模型 = claude-test-1，thinking = high。
      const agent = await conversation.agent(BACKGROUND_CONTEXT);
      assert.deepEqual(agent.model, { provider: "faux", modelId: "claude-test-1" });
      assert.equal(agent.thinkingLevel, "high");
      assert.deepEqual(legacyContext.model, { provider: "faux", modelId: "claude-test-1" },
        "old-side getSessionContextSettings agrees (§6-A branch A)");
      assert.equal(legacyContext.thinkingLevel, "high");

      // 记账条目：custom/model_change/thinking_level_change 全量保真、不进上下文。
      const customs = page.items.filter(item => item.kind === "milksu.custom");
      assert.deepEqual(
        customs.map(item => item.data.customType).sort(),
        ["milksu-legacy-model-change", "milksu-legacy-model-change", "milksu-legacy-thinking-level-change", "milksu.widget-state"].sort(),
      );
      const modelChanges = customs.filter(item => item.data.customType === LEGACY_CUSTOM_TYPES.modelChange);
      // entries() 最新在前：e6（claude-test-2）先于 e1（claude-test-1）。
      assert.deepEqual(modelChanges.map(item => item.data.modelId), ["claude-test-2", "claude-test-1"]);
      const stateEntry = customs.find(item => item.data.customType === "milksu.widget-state");
      assert.deepEqual(stateEntry.data.data, { open: true });

      // 源文件只读纪律：导出+导入之后字节与 mtime 不变。
      const sourceBytes = await readFile(sourcePath);
      assert.equal(sha256(sourceBytes), manifest.sessions[0].sha256, "source untouched");
    } finally {
      await handle.close();
    }
  });
});

test("importer derives the effective model from model_change when no later assistant overrides (§6-A branch B)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260902_conv-beta.jsonl", buildSessionBetaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);

    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    try {
      const result = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-beta",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry: findArchivedSession(manifest, "conv-beta"),
      });
      const conversation = await handle.harness.conversation(result.conversationId, BACKGROUND_CONTEXT);

      // 旧侧真源同判：最后的 model_change（claude-test-9）在最后 assistant 之后 → 生效。
      const entries = parseSessionEntries(await readFile(sourcePath, "utf8"))
        .filter(item => item.type !== "session");
      const legacyContext = buildSessionContext(entries);
      assert.deepEqual(legacyContext.model, { provider: "faux", modelId: "claude-test-9" });
      const agent = await conversation.agent(BACKGROUND_CONTEXT);
      assert.deepEqual(agent.model, { provider: "faux", modelId: "claude-test-9" },
        "§6-A branch B: last model_change after the last assistant wins");
      assert.equal(agent.thinkingLevel, "off", "no thinking_level_change → off (old default)");

      const view = await conversation.context(BACKGROUND_CONTEXT);
      const legacyLlm = convertToLlm(legacyContext.messages);
      assert.deepEqual(diffContextMessages(legacyLlm, view.messages), []);
    } finally {
      await handle.close();
    }
  });
});

test("importer maps fallback types losslessly and keeps context equivalent (usage/label/session_info/context_edit/branch_summary)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260903_conv-gamma.jsonl", buildSessionGammaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);

    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    try {
      const result = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-gamma",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry: findArchivedSession(manifest, "conv-gamma"),
      });
      const conversation = await handle.harness.conversation(result.conversationId, BACKGROUND_CONTEXT);
      const view = await conversation.context(BACKGROUND_CONTEXT);

      // 旧侧真源：context_edit 的 omit/replace（含 assistant 字符串替换的
      // [{type:"text"}] 规整）与 branch_summary 包装全部按旧引擎投影。
      const entries = parseSessionEntries(await readFile(sourcePath, "utf8"))
        .filter(item => item.type !== "session");
      const legacyContext = buildSessionContext(entries);
      const legacyLlm = convertToLlm(legacyContext.messages);
      assert.deepEqual(diffContextMessages(legacyLlm, view.messages), [],
        "fallback-type context equivalence must hold entry by entry");

      // 具体形状断言：omit 掉 g3、g4 被 replace、g2 的 assistant 正文被字符串替换。
      const texts = view.messages.map(message => messageText(message));
      assert.ok(!texts.includes("to be omitted"), "context_edit(null) omits the target");
      assert.ok(texts.includes("edited question"), "context_edit(replace) rewrites user content");
      assert.ok(texts.includes("assistant replaced text"), "assistant string replacement normalized to text block");
      assert.ok(texts.some(text => text.startsWith("The following is a summary of a branch that this conversation came back from:")),
        "branch_summary keeps its exact old-engine wrapper");

      // 保底类型全量进 milksu.custom（不丢数据）且不进上下文。
      const page = await handle.conversationEntries("conv-gamma", { limit: 100 });
      const customs = page.items.filter(item => item.kind === "milksu.custom");
      const byType = new Map(customs.map(item => [item.data.customType, item]));
      assert.deepEqual([...byType.keys()].sort(), [
        LEGACY_CUSTOM_TYPES.contextEdit,
        LEGACY_CUSTOM_TYPES.label,
        LEGACY_CUSTOM_TYPES.sessionInfo,
        LEGACY_CUSTOM_TYPES.usage,
      ].sort());
      assert.deepEqual(byType.get(LEGACY_CUSTOM_TYPES.usage).data.usage, { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 });
      assert.equal(byType.get(LEGACY_CUSTOM_TYPES.usage).data.note, "warm");
      assert.deepEqual(byType.get(LEGACY_CUSTOM_TYPES.label).data, { timestamp: iso(6), customType: LEGACY_CUSTOM_TYPES.label, targetId: "g1", label: "重要" });
      assert.equal(byType.get(LEGACY_CUSTOM_TYPES.sessionInfo).data.name, "测试会话");
      // 无 model_change 的会话：assistant 自带元数据仍然推导有效模型（§6-A 的
      // assistant 分支），与旧侧真源一致。
      const agent = await conversation.agent(BACKGROUND_CONTEXT);
      assert.deepEqual(agent.model, legacyContext.model);
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      await handle.close();
    }
  });
});

test("importer is idempotent across re-imports and process reopenings (alias hit returns the existing conversation)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);
    const entry = findArchivedSession(manifest, "conv-alpha");

    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    let first;
    try {
      first = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-alpha",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry,
      });
      const again = await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-alpha",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry,
      });
      assert.equal(again.conversationId, first.conversationId);
      assert.equal(again.created, false);
      assert.equal(again.appended, 0);
      const page = await handle.conversationEntries("conv-alpha", { limit: 100 });
      assert.equal(page.items.length, 14, "transcript not doubled");
    } finally {
      await handle.close();
    }

    // 进程重开（同存储）：重导仍幂等命中既有会话。
    const reopened = await openHandle(agentDir, makeModels().models);
    try {
      const afterReopen = await importLegacySessionIntoHarness({
        harness: reopened.harness,
        alias: "conv-alpha",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry,
      });
      assert.equal(afterReopen.conversationId, first.conversationId);
      assert.equal(afterReopen.created, false);
      const page = await reopened.conversationEntries("conv-alpha", { limit: 100 });
      assert.equal(page.items.length, 14, "transcript still exactly one copy after reopen");
    } finally {
      await reopened.close();
    }
  });
});

test("importer refuses a corrupted archive copy (SHA mismatch) and a header/conversationId mismatch", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    await writeLegacySession(agentDir, "20260902_conv-beta.jsonl", buildSessionBetaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);

    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    try {
      // 篡改归档副本（模拟损坏）：SHA 不符 → 拒绝导入。
      const archiveFile = join(agentDir, "archive", "sessions", "20260901_conv-alpha.jsonl");
      await writeFile(archiveFile, "tampered\n");
      await assert.rejects(
        () => importLegacySessionIntoHarness({
          harness: handle.harness,
          alias: "conv-alpha",
          archiveDir: resolveHarnessArchiveDirectory(agentDir),
          entry: findArchivedSession(manifest, "conv-alpha"),
        }),
        /does not match its manifest/,
      );

      // manifest 行的 conversationId 与副本 header 不一致 → 拒绝导入。
      const betaRow = findArchivedSession(manifest, "conv-beta");
      await assert.rejects(
        () => importLegacySessionIntoHarness({
          harness: handle.harness,
          alias: "conv-beta",
          archiveDir: resolveHarnessArchiveDirectory(agentDir),
          entry: { ...betaRow, conversationId: "conv-someone-else" },
        }),
        /holds session/,
      );
    } finally {
      await handle.close();
    }
  });
});

test("importer never writes the legacy source files (read-only discipline)", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    const before = await stat(sourcePath);
    const sourceBytes = await readFile(sourcePath);
    // 显式回拨 mtime，让「导出器碰没碰源」可断言（写句柄会推进 mtime）。
    await utimes(sourcePath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    const pinned = await stat(sourcePath);

    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);
    const { models } = makeModels();
    const handle = await openHandle(agentDir, models);
    try {
      await importLegacySessionIntoHarness({
        harness: handle.harness,
        alias: "conv-alpha",
        archiveDir: resolveHarnessArchiveDirectory(agentDir),
        entry: findArchivedSession(manifest, "conv-alpha"),
      });
    } finally {
      await handle.close();
    }

    const after = await stat(sourcePath);
    assert.equal(after.mtimeMs, pinned.mtimeMs, "source mtime must not move (no write handle)");
    assert.deepEqual(await readFile(sourcePath), sourceBytes, "source bytes untouched");
    assert.equal(before.size, after.size);
  });
});

// ---------- 纯函数面 ----------

test("deriveLegacyEffectiveSettings replicates getSessionContextSettings order semantics", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const sourcePath = await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    const tree = deriveLegacySessionTree(parseLegacySessionFile(await readFile(sourcePath, "utf8")));
    // 直接对照旧引擎：buildSessionProjection 的 settings 就是 getSessionContextSettings。
    const { buildSessionProjection } = await import("@earendil-works/pi-coding-agent");
    const projection = buildSessionProjection(tree.entries);
    assert.deepEqual(
      deriveLegacyEffectiveSettings(tree.path),
      { thinkingLevel: projection.thinkingLevel, model: projection.model },
    );

    // 乱序防御：model_change 在 assistant 之后 → model_change 生效。
    const flipped = deriveLegacyEffectiveSettings([
      { type: "message", message: { role: "assistant", provider: "faux", model: "m-early" } },
      { type: "model_change", provider: "faux", modelId: "m-late" },
    ]);
    assert.deepEqual(flipped.model, { provider: "faux", modelId: "m-late" });
    assert.equal(flipped.thinkingLevel, "off");
  });
});

test("archive query face: manifest read, conversation lookup, and wire summary", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    await exportLegacySessions({ agentDir });
    const manifest = await readArchiveManifest(agentDir);

    const hit = findArchivedSession(manifest, "conv-alpha");
    assert.ok(hit);
    assert.equal(findArchivedSession(manifest, "conv-missing"), undefined);
    assert.equal(findArchivedSession(undefined, "conv-alpha"), undefined);

    const summary = archivedSessionSummary(hit);
    assert.equal(summary.conversationId, "conv-alpha");
    assert.equal(summary.file, "sessions/20260901_conv-alpha.jsonl");
    assert.ok(!("leafPath" in summary), "wire summary omits bulky path detail");
    assert.deepEqual(summary.entryCounts, hit.entryCounts);
    assert.equal(archivedSessionSummary(undefined), null);
  });
});

// ---------- 层函数面（D2 的 UI 触发挂点） ----------

test("session layer exposes archivedConversationInfo / importArchivedConversation / exportLegacyArchive", async () => {
  await withArchiveFixture(async ({ agentDir }) => {
    const { faux, models } = makeModels();
    await writeLegacySession(agentDir, "20260901_conv-alpha.jsonl", buildSessionAlphaLines());
    const { layer } = buildTestLayer({
      agentDir,
      workspace: join(agentDir, "..", "workspace"),
      faux,
      models,
    });

    // 未归档：archived=false。
    const before = await layer.archivedConversationInfo("conv-alpha");
    assert.equal(before.archived, false);
    assert.equal(before.imported, false);

    // 层函数触发导出（bridge archive_export 命令的同一条路）。
    const exportResult = await layer.exportLegacyArchive();
    assert.deepEqual(exportResult.copied, ["20260901_conv-alpha.jsonl"]);

    // 已归档未导入：archived=true, imported=false。
    const archived = await layer.archivedConversationInfo("conv-alpha");
    assert.equal(archived.archived, true);
    assert.equal(archived.imported, false);
    assert.equal(archived.entry.conversationId, "conv-alpha");

    // 按需导入（D2 的 UI 触发面就是调它；导入后 createSession 照常补会话对象）。
    const imported = await layer.importArchivedConversation("conv-alpha");
    assert.equal(imported.created, true);
    assert.equal(imported.appended, 14);
    const afterImport = await layer.archivedConversationInfo("conv-alpha");
    assert.equal(afterImport.archived, true);
    assert.equal(afterImport.imported, true);

    // 重导幂等。
    const again = await layer.importArchivedConversation("conv-alpha");
    assert.equal(again.created, false);
    assert.equal(again.appended, 0);

    // 未归档 id：导入报错（如实，不静默建空会话）。
    await assert.rejects(
      () => layer.importArchivedConversation("conv-missing"),
      /is not in the MilkSU archive/,
    );

    // 导入后 createSession 照常拿到会话对象（D2 流程的下半段）。
    const session = await layer.createSession({ conversationId: "conv-alpha" });
    assert.equal(session.kind, "milksu-harness");
    const events = await layer.conversationEntries("conv-alpha", { limit: 100 });
    assert.equal(events.items.length, 14, "createSession must not duplicate the imported transcript");
    await layer.disposeAll();
  });
});

// ---------- bridge 命令面（源码契约，照 harness-bridge-gate.test.js 的做法） ----------

const bridgeSource = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "bridge.js"),
  "utf8",
);

test("bridge dispatches archive_query / archive_export and reports archive_status / archive_exported", () => {
  assert.ok(bridgeSource.includes('case "archive_query":'), "archive_query command must dispatch");
  assert.ok(bridgeSource.includes('case "archive_export":'), "archive_export command must dispatch");
  assert.ok(bridgeSource.includes("async function handleArchiveQuery(command) {"), "query handler present");
  assert.ok(bridgeSource.includes("async function handleArchiveExport(command) {"), "export handler present");
  assert.ok(bridgeSource.includes('"archive_status"'), "query answers on the archive_status event");
  assert.ok(bridgeSource.includes('"archive_exported"'), "export answers on the archive_exported event");
  // 门开分叉在层上；门关也能只读 manifest（导出/查询不依赖引擎）。
  assert.ok(bridgeSource.includes("harnessLayer().archivedConversationInfo(conversationId)"));
  assert.ok(bridgeSource.includes("exportLegacySessions({ agentDir: resolveHarnessAgentDir() })"));
  // fork/rewind 对 harness 会话保持显式不支持（B1 语义维持，D1 不动）。
  assert.ok(bridgeSource.includes('harnessUnsupportedResult(command, "session_forked")'));
  assert.ok(bridgeSource.includes('harnessUnsupportedResult(command, "session_rewound")'));
});

test("bridge query/export handlers never touch legacy session sources outside the exporter", () => {
  // bridge.js 里写 <agentDir>/sessions 的路径只允许出现在归档目录推导上（读），不允许
  // writeFile 到 sessions 目录（红线：绝不写旧 JSONL 源文件）。
  const sessionsWritePattern = /writeFile\([^)]*sessions/i;
  assert.doesNotMatch(bridgeSource, sessionsWritePattern);
});

test("compaction and branch summary wrappers stay byte-identical across both engines (§6-B lock)", async () => {
  // REHEARSAL §6-B 实证 pi-coding-agent 的 COMPACTION_SUMMARY_PREFIX/SUFFIX 与
  // pi-durable 的 SUMMARY_PREFIX/SUFFIX 逐字节相同。两处都是包内私有常量，本测试按
  // 绝对路径读 dist 源码把这条等式钉死：任何一侧升级后字节漂移，D1 的压缩摘要包装
  // 等价性就不再「由构造保证」，必须重新过目。
  const durableSource = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..",
      "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "compaction.js"),
    "utf8",
  );
  const oldEngine = await import(join(dirname(fileURLToPath(import.meta.url)), "..", "..",
    "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "messages.js"));
  const prefix = "The conversation history before this point was compacted into the following summary:\\n\\n<summary>\\n";
  const suffix = "\\n</summary>";
  assert.ok(durableSource.includes(`const SUMMARY_PREFIX = "${prefix}"`),
    "pi-durable compaction wrapper prefix must stay byte-identical");
  assert.ok(durableSource.includes(`const SUMMARY_SUFFIX = "${suffix}"`),
    "pi-durable compaction wrapper suffix must stay byte-identical");
  assert.equal(
    oldEngine.COMPACTION_SUMMARY_PREFIX,
    "The conversation history before this point was compacted into the following summary:\n\n<summary>\n",
  );
  assert.equal(oldEngine.COMPACTION_SUMMARY_SUFFIX, "\n</summary>");
  assert.equal(
    oldEngine.BRANCH_SUMMARY_PREFIX,
    "The following is a summary of a branch that this conversation came back from:\n\n<summary>\n",
  );
  assert.equal(oldEngine.BRANCH_SUMMARY_SUFFIX, "</summary>");
});
