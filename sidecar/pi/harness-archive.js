// PR-2 批次 D1：旧 JSONL 会话归档（一次性导出器 + manifest 查询面 + 按需导入器）。
//
// 口径（DECISIONS-pi-harness.md Q1：归档保底 + 按需续命，用户确认要能续聊）：
//   导出  —— 扫 <agentDir>/sessions/*.jsonl，每文件**全量字节级**归档到
//            <agentDir>/archive/sessions/（原格式保留，含废弃分支），manifest.json 记录
//            conversationId↔文件↔SHA-256↔分型条目数↔leaf 路径↔废弃分支清单（PREP §3.6）。
//            幂等：重复跑按 SHA-256 判等跳过；源 SHA 变化时按 <stem>.<sha8>.jsonl 版本化
//            追加归档，旧行标 superseded（归档永不丢数据）。
//   导入  —— 用户打开归档中的旧会话续聊时（D2 接 UI 触发；本票是可调用的层函数），
//            按当前 leaf 路径转成 Harness Conversation **副本**：会话创建、别名登记
//            （milksu.conversation-index）与全部条目写入在**同一个 commit** 里原子完成
//            （批次 A 定下的原子纪律），崩溃要么全无要么全有。重导幂等：别名命中即返回
//            既有会话，转录不翻倍。归档原件与旧 JSONL 源文件永不改动。
//
// 转换映射（照 REHEARSAL s7 已验证的形状扩展到全类型谱）：
//   message(user/assistant/toolResult/system) → pi.user / pi.assistant / pi.tool-result /
//     pi.system，model 载荷 = 旧引擎 sessionEntryToContextMessages 的投影（含 null content
//     规整）——**逐字节沿用旧引擎自己的投影函数**，等价性由构造保证；
//   message(bashExecution/custom 等投影成 user 的角色) → pi.user（同上，投影函数兜底）；
//   custom_message → pi.user（customType/display/details 进 entry.data 保真，不丢数据）；
//   compaction → pi.compaction：摘要包装 = 旧引擎 convertToLlm 的
//     COMPACTION_SUMMARY_PREFIX/SUFFIX（与 pi-durable 逐字节相同，REHEARSAL §6-B 实证），
//     head 映射到 firstKept 的新 entry id（firstKept 不在路径上时 head="self"，对齐旧侧
//     foundFirstKept=false 的空保留区间语义）；kept 区间内的 system 消息旧侧不进上下文
//     （buildContextEntries 显式排除），这里以 compaction 条目的 edits:omit 复刻；
//     tokensBefore/details/usage/fromHook 进 data.legacy 保真；
//   branch_summary → pi.user（BRANCH_SUMMARY 包装，旧引擎投影函数逐字节）；
//   model_change / thinking_level_change → pi.agent（**有效模型推导复刻 §6-A**：沿 leaf
//     路径 assistant 消息自带的 provider/model 按序覆盖 model_change，见
//     deriveLegacyEffectiveSettings）+ milksu.custom 记账条目（转录保真，不进上下文——
//     与旧侧一致）；
//   custom / usage / label / session_info / context_edit（真实数据未出现或纯状态）→
//     milksu.custom 记账条目（不进上下文，与旧侧一致；原始数据全量进 data，不丢数据）。
//     其中 context_edit 额外映射到 pi-durable 原生 edits（omit/replace），上下文语义对齐
//     旧侧 projectContextEntry。
//   废弃分支不进转录（s7 实证）；fork/rewind 对导入会话不支持（B1 显式报不支持，维持）。
//
// 已知语义差异（如实记录，见交付报告）：旧引擎把 stopReason=error/aborted/deferred 的
// assistant 消息留在模型上下文里；pi-durable 的 deriveContext 显式排除它们（更健康的行
// 为）。导入转录照旧保全这类消息，上下文侧接受新引擎语义。
//
// 红线：绝不写 <agentDir>/sessions 下的旧 JSONL 源文件（导出只读源）；真实 runtime-data
// 不碰（测试全用合成数据）。

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AssistantEntry,
  CompactionEntry,
  SystemEntry,
  ToolResultEntry,
  UserEntry,
  configure,
  defineEntry,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
// 旧侧真源函数（pi-coding-agent 根导出）：解析/迁移 + 上下文投影。转换逐字节沿用旧引擎
// 自己的投影（sessionEntryToContextMessages + convertToLlm），等价性由构造保证。
import {
  convertToLlm,
  migrateSessionEntries,
  parseSessionEntries,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { ConversationIndex } from "./harness-adapter.js";

// ---------- 路径约定（与 resolveHarnessAgentDir 的 agentDir 推导对齐） ----------

export const HARNESS_ARCHIVE_DIRECTORY = "archive";
export const HARNESS_ARCHIVE_MANIFEST_FILE = "manifest.json";
export const HARNESS_ARCHIVE_SESSIONS_DIRECTORY = "sessions";
export const MILKSU_ARCHIVE_MANIFEST_VERSION = 1;

export function resolveLegacySessionsDirectory(agentDir) {
  return join(agentDir, "sessions");
}

export function resolveHarnessArchiveDirectory(agentDir) {
  return join(agentDir, HARNESS_ARCHIVE_DIRECTORY);
}

export function resolveHarnessArchiveManifestPath(agentDir) {
  return join(agentDir, HARNESS_ARCHIVE_DIRECTORY, HARNESS_ARCHIVE_MANIFEST_FILE);
}

// ---------- 记账条目 kind（s7 验证的 milksu.custom 家族） ----------

/** 旧会话里不进模型上下文的状态/记账条目统一落这个 kind（customType 区分）。 */
export const MILKSU_CUSTOM_ENTRY = defineEntry("milksu.custom");

export const LEGACY_CUSTOM_TYPES = {
  custom: "milksu.custom",
  modelChange: "milksu-legacy-model-change",
  thinkingLevelChange: "milksu-legacy-thinking-level-change",
  usage: "milksu-legacy-usage",
  label: "milksu-legacy-label",
  sessionInfo: "milksu-legacy-session-info",
  contextEdit: "milksu-legacy-context-edit",
  branchSummary: "milksu-legacy-branch-summary",
  customMessage: "milksu-legacy-custom-message",
};

// ---------- 解析与树推导（复刻 SessionManager 的 leaf 语义） ----------

/**
 * 解析一份旧 JSONL 全量内容（header + 全部条目，含废弃分支），并走旧引擎的
 * migrateSessionEntries 迁移阶梯（v1/v2 → v3）。parseSessionEntries 跳过坏行，与
 * SessionManager 读文件同一行为。
 */
export function parseLegacySessionFile(content) {
  const fileEntries = parseSessionEntries(String(content ?? ""));
  migrateSessionEntries(fileEntries);
  return fileEntries;
}

/**
 * 推导 leaf 路径与废弃分支。leaf = 文件序最后一条非 header 条目（SessionManager
 * _buildIndex 的赋值序）；路径沿 parentId 回走到根（buildSessionPath 同款）。
 */
export function deriveLegacySessionTree(fileEntries) {
  const header = fileEntries.find(entry => entry?.type === "session") ?? null;
  const entries = fileEntries.filter(entry => entry && entry.type !== "session");
  const byId = new Map();
  for (const entry of entries) {
    if (typeof entry.id === "string" && entry.id) byId.set(entry.id, entry);
  }
  const leafId = entries.length > 0
    ? String(entries[entries.length - 1].id ?? "")
    : "";
  const path = [];
  let current = leafId ? byId.get(leafId) : undefined;
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  const onPath = new Set(path.map(entry => entry.id));
  // 废弃分支清单：不在 leaf 路径上的条目，按其「路径上最近的祖先」（分叉点）分组。
  const groups = new Map();
  for (const entry of entries) {
    if (onPath.has(entry.id)) continue;
    let forkEntryId = null;
    let ancestor = entry.parentId ? byId.get(entry.parentId) : undefined;
    while (ancestor) {
      if (onPath.has(ancestor.id)) {
        forkEntryId = ancestor.id;
        break;
      }
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    const list = groups.get(forkEntryId) ?? [];
    list.push(entry.id);
    groups.set(forkEntryId, list);
  }
  const abandonedBranches = [...groups.entries()].map(([forkEntryId, branchEntryIds]) => ({
    forkEntryId,
    branchEntryIds,
  }));
  return { header, entries, byId, leafId, path, onPath, abandonedBranches };
}

/** 全量分型条目数（含 header 记作 "session"）与 message 角色分布。 */
export function legacyEntryCounts({ header, entries }) {
  const entryCounts = {};
  for (const entry of entries) {
    const type = String(entry?.type ?? "unknown");
    entryCounts[type] = (entryCounts[type] ?? 0) + 1;
  }
  if (header) entryCounts.session = (entryCounts.session ?? 0) + 1;
  const messageRoleCounts = {};
  for (const entry of entries) {
    if (entry?.type === "message" && entry.message?.role) {
      const role = String(entry.message.role);
      messageRoleCounts[role] = (messageRoleCounts[role] ?? 0) + 1;
    }
  }
  return { entryCounts, messageRoleCounts };
}

/**
 * §6-A 有效模型/思考档推导——逐分支复刻旧引擎 getSessionContextSettings
 * （pi-coding-agent session-manager.js:146-160）：沿 leaf 路径按序覆盖，
 * thinking_level_change 与 model_change 各自记账，**assistant 消息自带的
 * provider/model 会覆盖更早的 model_change**（s7 §6-A 实证：只搬 model_change 会得
 * 错模型）。防御性偏差（如实记录）：旧侧对 assistant 元数据无守卫（缺字段也会写成
 * undefined ref）；这里只接受两侧字段都非空的 assistant 覆盖，坏数据不产生坏 ref。
 */
export function deriveLegacyEffectiveSettings(path) {
  let thinkingLevel = "off";
  let model = null;
  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = String(entry.thinkingLevel ?? "off");
    } else if (entry.type === "model_change") {
      const provider = String(entry.provider ?? "").trim();
      const modelId = String(entry.modelId ?? "").trim();
      if (provider && modelId) model = { provider, modelId };
    } else if (entry.type === "message" && entry.message?.role === "assistant") {
      const provider = entry.message.provider;
      const modelId = entry.message.model;
      if (typeof provider === "string" && provider && typeof modelId === "string" && modelId) {
        model = { provider, modelId };
      }
    }
  }
  return { thinkingLevel, model };
}

// ---------- 导出器 ----------

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestRowComparable(row) {
  const { archivedAt, ...rest } = row;
  return rest;
}

async function readExistingManifest(archiveDir) {
  try {
    const raw = await readFile(join(archiveDir, HARNESS_ARCHIVE_MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.sessions) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 一次性全量归档：<agentDir>/sessions/*.jsonl → <agentDir>/archive/。
 *
 * - 每文件字节级复制（原格式保留，全量含废弃分支），SHA-256 判等幂等：已归档且
 *   未变化 → 跳过不重写；源变化 → <stem>.<sha8>.jsonl 版本化追加，旧行标 superseded。
 * - manifest.json 只在语义内容变化时重写（重复跑零写入）。
 * - 解析失败的文件照样字节归档（保底不丢数据），行内记 parseError。
 * - 只读源目录；一切写入都在 archive 目录下。
 *
 * 返回 { archiveDir, manifest, copied, skipped, versioned, manifestWritten }。
 */
export async function exportLegacySessions({ agentDir, now = () => new Date().toISOString() }) {
  if (!agentDir || typeof agentDir !== "string") throw new TypeError("exportLegacySessions requires agentDir");
  const sessionsDir = resolveLegacySessionsDirectory(agentDir);
  const archiveDir = resolveHarnessArchiveDirectory(agentDir);
  const archiveSessionsDir = join(archiveDir, HARNESS_ARCHIVE_SESSIONS_DIRECTORY);
  await mkdir(archiveSessionsDir, { recursive: true });

  const names = (await readdir(sessionsDir).catch(() => [])).sort();
  const existing = await readExistingManifest(archiveDir);
  const existingByFile = new Map((existing?.sessions ?? []).map(row => [row.file, row]));
  const rows = [];
  const scannedFiles = new Set();
  const copied = [];
  const skipped = [];
  const versioned = [];

  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const sourcePath = join(sessionsDir, name);
    const sourceInfo = await stat(sourcePath).catch(() => undefined);
    if (!sourceInfo?.isFile()) continue;
    const bytes = await readFile(sourcePath);
    const sha256 = sha256Hex(bytes);
    const byteSize = bytes.byteLength;

    // 归档目标名：同名已存在且 SHA 相同 → 幂等跳过；SHA 变化 → 版本化追加。
    let archiveName = name;
    const currentPath = join(archiveSessionsDir, name);
    const currentInfo = await stat(currentPath).catch(() => undefined);
    if (currentInfo?.isFile()) {
      const currentSha = sha256Hex(await readFile(currentPath));
      if (currentSha === sha256) {
        archiveName = name;
        skipped.push(name);
      } else {
        // 源在归档后变化：新内容按 SHA 版本化追加（同 SHA 重跑天然幂等，wx 撞上
        // 已存在的同版本只核对不重写）。
        archiveName = `${name.slice(0, -".jsonl".length)}.${sha256.slice(0, 8)}.jsonl`;
        const versionedPath = join(archiveSessionsDir, archiveName);
        try {
          await writeFile(versionedPath, bytes, { flag: "wx" });
          versioned.push({ from: name, to: archiveName });
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          if (sha256Hex(await readFile(versionedPath)) !== sha256) throw error;
        }
      }
    } else {
      await writeFile(currentPath, bytes, { flag: "wx" });
      copied.push(name);
    }

    // 元数据尽力而为：解析失败也保留字节副本（行内记 parseError）。
    let header = null;
    let leafId = "";
    let leafPath = [];
    let abandonedBranches = [];
    let entryCounts = {};
    let messageRoleCounts = {};
    let conversationId = "";
    let parseError;
    try {
      const fileEntries = parseLegacySessionFile(bytes.toString("utf8"));
      const tree = deriveLegacySessionTree(fileEntries);
      header = tree.header
        ? {
          version: tree.header.version,
          id: tree.header.id,
          timestamp: tree.header.timestamp,
          cwd: tree.header.cwd,
          ...(tree.header.parentSession ? { parentSession: tree.header.parentSession } : {}),
        }
        : null;
      conversationId = String(tree.header?.id ?? "");
      if (!tree.header) parseError = "session header missing";
      leafId = tree.leafId;
      leafPath = tree.path.map(entry => entry.id);
      abandonedBranches = tree.abandonedBranches;
      const counts = legacyEntryCounts(tree);
      entryCounts = counts.entryCounts;
      messageRoleCounts = counts.messageRoleCounts;
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const file = `${HARNESS_ARCHIVE_SESSIONS_DIRECTORY}/${archiveName}`;
    const previous = existingByFile.get(file);
    rows.push({
      conversationId,
      file,
      sha256,
      byteSize,
      header,
      entryCounts,
      messageRoleCounts,
      leafId,
      leafPath,
      abandonedBranches,
      archivedAt: previous?.archivedAt ?? now(),
      ...(parseError ? { parseError } : {}),
    });
    scannedFiles.add(file);
  }

  // 归档是 append-only 的账本：源文件后来被删/改名，既有归档行照留（archive 副本
  // 就是真相，manifest 不因源目录变化丢历史）。
  for (const row of existing?.sessions ?? []) {
    if (!scannedFiles.has(row.file)) rows.push(row);
  }

  // 同 conversationId 只留一行现役（superseded 标记旧行，全部保留在 manifest 里）。
  const activeByConversation = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.conversationId) continue;
    const active = activeByConversation.get(row.conversationId);
    if (active === undefined) {
      activeByConversation.set(row.conversationId, index);
    } else {
      // 保留 archivedAt 更新的一行作为现役（版本化追加在后）。
      const keepIndex = Date.parse(rows[active].archivedAt) > Date.parse(row.archivedAt)
        ? active
        : index;
      const dropIndex = keepIndex === active ? index : active;
      rows[dropIndex] = { ...rows[dropIndex], superseded: true };
      activeByConversation.set(row.conversationId, keepIndex);
    }
  }

  const previousRows = existing?.sessions ?? [];
  const changed = previousRows.length !== rows.length
    || previousRows.some((row, index) => (
      JSON.stringify(manifestRowComparable(row)) !== JSON.stringify(manifestRowComparable(rows[index]))
    ));
  const manifest = {
    version: MILKSU_ARCHIVE_MANIFEST_VERSION,
    exportedAt: changed ? now() : (existing?.exportedAt ?? now()),
    sessions: rows,
  };
  if (changed) {
    await writeFile(
      join(archiveDir, HARNESS_ARCHIVE_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  return {
    archiveDir,
    manifest,
    copied,
    skipped,
    versioned,
    manifestWritten: changed,
  };
}

// ---------- 查询面（bridge 侧判断 conversationId 是否归档会话） ----------

export async function readArchiveManifest(agentDir) {
  return readExistingManifest(resolveHarnessArchiveDirectory(agentDir));
}

/** 在 manifest 里找 conversationId 的现役归档行；未归档返回 undefined。 */
export function findArchivedSession(manifest, conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id || !manifest || !Array.isArray(manifest.sessions)) return undefined;
  return manifest.sessions.find(row => (
    row.conversationId === id && row.superseded !== true
  ));
}

/** 桌面事件用的归档行摘要（不带 leafPath/废弃分支明细）。 */
export function archivedSessionSummary(row) {
  if (!row) return null;
  return {
    conversationId: row.conversationId,
    file: row.file,
    sha256: row.sha256,
    byteSize: row.byteSize,
    header: row.header ?? null,
    entryCounts: row.entryCounts ?? {},
    messageRoleCounts: row.messageRoleCounts ?? {},
    archivedAt: row.archivedAt,
    ...(row.parseError ? { parseError: row.parseError } : {}),
  };
}

// ---------- 导入器 ----------

/** message 系条目的 pi entry kind：按旧引擎投影后的首条消息角色分派。 */
function entryKindForProjectedMessages(projected) {
  const first = projected[0];
  switch (first?.role) {
    case "assistant":
      return AssistantEntry.kind;
    case "toolResult":
      return ToolResultEntry.kind;
    case "system":
      return SystemEntry.kind;
    default:
      // user / custom / bashExecution / compactionSummary / branchSummary 全部投影成 user。
      return UserEntry.kind;
  }
}

/**
 * 按当前 leaf 路径把旧条目逐条映射进 Harness（在单个 commit 内顺序执行）。
 * 追加顺序 = 路径顺序（append-only 树的父先子后），旧 id → 新 id 映射边追加边记。
 */
async function appendLegacyPath(tx, conversationId, tree, onProgress) {
  const { path } = tree;
  // 最新 compaction（buildContextEntries 同款：路径上最后一条 compaction 才算数）。
  let latestCompaction = null;
  let latestCompactionIndex = -1;
  for (let index = 0; index < path.length; index += 1) {
    if (path[index].type === "compaction") {
      latestCompaction = path[index];
      latestCompactionIndex = index;
    }
  }
  // kept 区间 = [firstKept, 最新 compaction)：旧侧把其中的 system 消息排除出上下文，
  // 这里收集其旧 id，随 compaction 条目以 edits:omit 复刻。
  const keptSystemIds = [];
  if (latestCompaction) {
    const firstKeptId = String(latestCompaction.firstKeptEntryId ?? "");
    const firstKeptIndex = firstKeptId
      ? path.findIndex(entry => entry.id === firstKeptId)
      : -1;
    if (firstKeptIndex >= 0) {
      for (let index = firstKeptIndex; index < latestCompactionIndex; index += 1) {
        const entry = path[index];
        if (entry.type === "message" && entry.message?.role === "system") {
          keptSystemIds.push(entry.id);
        }
      }
    }
  }

  const newByOld = new Map();
  let appended = 0;
  for (const entry of path) {
    const draft = legacyEntryDraft(entry, {
      newByOld,
      byId: tree.byId,
      latestCompaction,
      keptSystemIds,
    });
    const record = await tx.appendEntry(conversationId, draft);
    newByOld.set(String(entry.id), record.id);
    appended += 1;
    if (onProgress && appended % 256 === 0) {
      await onProgress({ appended, total: path.length });
    }
  }
  return { appended, newByOld };
}

/** 单条旧条目 → EntryDraft（model 载荷逐字节沿用旧引擎投影函数）。 */
function legacyEntryDraft(entry, { newByOld, byId, latestCompaction, keptSystemIds }) {
  // ---- 进上下文的类型：投影消息 = 旧引擎 sessionEntryToContextMessages + convertToLlm。
  if (
    entry.type === "message"
    || entry.type === "custom_message"
    || entry.type === "branch_summary"
    || entry.type === "compaction"
  ) {
    const projected = sessionEntryToContextMessages(entry);
    const messages = convertToLlm(projected);
    if (entry.type === "compaction") {
      // head 映射到 firstKept 的新 id；firstKept 不在路径上（或为 null）→ "self"，
      // 对齐旧侧 foundFirstKept=false 的空保留区间（上下文 = 摘要 + 压缩后条目）。
      const firstKeptId = String(entry.firstKeptEntryId ?? "");
      const mappedHead = firstKeptId ? newByOld.get(firstKeptId) : undefined;
      const edits = [];
      // kept 区间内 system 消息旧侧不进上下文（buildContextEntries 显式排除）。
      // 只有最新 compaction 的 kept 区间在活跃上下文里（更早的已被摘要掉，两
      // 侧都不在），所以只需给最新这条挂 omit。
      if (entry === latestCompaction) {
        for (const systemId of keptSystemIds) {
          const target = newByOld.get(systemId);
          if (target !== undefined) edits.push({ target, action: "omit" });
        }
      }
      return {
        kind: CompactionEntry.kind,
        ...(mappedHead !== undefined ? { head: mappedHead } : { head: "self" }),
        model: messages,
        data: {
          // 旧条目无 manual/auto 语义可考：自动压缩是真实数据的绝对主体，记 "auto"。
          reason: "auto",
          legacy: {
            tokensBefore: entry.tokensBefore,
            ...(entry.details !== undefined ? { details: entry.details } : {}),
            ...(entry.usage !== undefined ? { usage: entry.usage } : {}),
            ...(entry.fromHook !== undefined ? { fromHook: entry.fromHook } : {}),
          },
        },
        ...(edits.length > 0 ? { edits } : {}),
      };
    }
    const draft = {
      kind: entryKindForProjectedMessages(messages),
      model: messages,
    };
    if (entry.type === "custom_message") {
      // customType/display/details 不进上下文（convertToLlm 丢掉），入 data 保真。
      draft.data = {
        customType: LEGACY_CUSTOM_TYPES.customMessage,
        legacyCustomType: entry.customType,
        display: entry.display === true,
        ...(entry.details !== undefined ? { details: entry.details } : {}),
      };
    } else if (entry.type === "branch_summary") {
      draft.data = {
        customType: LEGACY_CUSTOM_TYPES.branchSummary,
        fromId: entry.fromId,
        ...(entry.details !== undefined ? { details: entry.details } : {}),
        ...(entry.usage !== undefined ? { usage: entry.usage } : {}),
        ...(entry.fromHook !== undefined ? { fromHook: entry.fromHook } : {}),
      };
    }
    return draft;
  }

  // ---- context_edit：记账条目（不进上下文）+ pi-durable 原生 edits 复刻旧侧语义。
  if (entry.type === "context_edit") {
    const edits = [];
    // 目标必须在当前 leaf 路径上（旧侧 contextEntries 只含路径条目，编辑目标不在
    // 路径上时本就无效果——只保数据不挂 edits）。
    const target = newByOld.get(String(entry.targetId ?? ""));
    const targetEntry = byId.get(String(entry.targetId ?? ""));
    if (target !== undefined && targetEntry !== undefined) {
      if (entry.replacement === null || entry.replacement === undefined) {
        edits.push({ target, action: "omit" });
      } else {
        const replacementMessages = legacyReplacementMessages(targetEntry, entry.replacement);
        if (replacementMessages !== null) {
          edits.push({ target, action: "replace", messages: replacementMessages });
        }
      }
    }
    return {
      kind: MILKSU_CUSTOM_ENTRY.kind,
      data: {
        customType: LEGACY_CUSTOM_TYPES.contextEdit,
        timestamp: entry.timestamp,
        targetId: entry.targetId,
        replacement: entry.replacement ?? null,
      },
      ...(edits.length > 0 ? { edits } : {}),
    };
  }

  // ---- 不进上下文的记账类型：milksu.custom 全量保真（原始数据进 data，不丢数据）。
  const data = { timestamp: entry.timestamp };
  switch (entry.type) {
    case "custom":
      data.customType = String(entry.customType ?? LEGACY_CUSTOM_TYPES.custom);
      data.data = entry.data ?? null;
      break;
    case "model_change":
      data.customType = LEGACY_CUSTOM_TYPES.modelChange;
      data.provider = entry.provider;
      data.modelId = entry.modelId;
      break;
    case "thinking_level_change":
      data.customType = LEGACY_CUSTOM_TYPES.thinkingLevelChange;
      data.thinkingLevel = entry.thinkingLevel;
      break;
    case "usage":
      data.customType = LEGACY_CUSTOM_TYPES.usage;
      data.kind = entry.kind;
      data.provider = entry.provider;
      data.model = entry.model;
      data.usage = entry.usage ?? null;
      if (entry.note !== undefined) data.note = entry.note;
      break;
    case "label":
      data.customType = LEGACY_CUSTOM_TYPES.label;
      data.targetId = entry.targetId;
      data.label = entry.label ?? null;
      break;
    case "session_info":
      data.customType = LEGACY_CUSTOM_TYPES.sessionInfo;
      data.name = entry.name ?? null;
      break;
    default:
      // 格式外类型（未来版本）：全量原文进 data，不丢数据，customType 标记来源类型。
      data.customType = `milksu-legacy-${String(entry.type ?? "unknown")}`;
      data.entry = { ...entry };
      break;
  }
  return { kind: MILKSU_CUSTOM_ENTRY.kind, data };
}

/**
 * 旧侧 projectContextEntry 的 replacement 映射：目标条目的整份贡献按旧规则换 content。
 * assistant/toolResult 的字符串 replacement → [{type:"text"}]；user/custom 直通（custom
 * 投影后已是 user，字符串 content 再走一次 custom 的规整）。
 */
function legacyReplacementMessages(targetEntry, replacement) {
  const projected = sessionEntryToContextMessages(targetEntry);
  return convertToLlm(projected.map(message => {
    if (!["user", "assistant", "toolResult", "custom"].includes(message.role)) return message;
    const content = (message.role === "assistant" || message.role === "toolResult")
      && typeof replacement.content === "string"
      ? [{ type: "text", text: replacement.content }]
      : replacement.content;
    return { ...message, content };
  }));
}

/**
 * 把一份归档旧会话按需导入 Harness（Q1 按需续命；D2 接 UI 触发，本票为可调用层函数）。
 *
 * 原子纪律：别名登记、会话创建、pi.agent 配置（§6-A 有效模型推导）与全部条目写入在同
 * 一个 commit 里——崩溃要么全无要么全有。重导幂等：别名命中即返回既有（created:false），
 * 转录不翻倍。只读归档副本（源文件与归档原件都不写）；归档行 SHA-256 不符即拒绝导入。
 *
 * @param options.harness 适配层 handle 的 .harness 原句柄（harness-adapter 单点收口原则：
 *                        pi-durable 调用集中在本模块与适配层）。
 * @param options.entry   manifest 归档行（findArchivedSession 的产物）。
 */
export async function importLegacySessionIntoHarness({
  harness,
  alias,
  archiveDir,
  entry,
  context = BACKGROUND_CONTEXT,
  onProgress,
}) {
  const conversationId = String(alias ?? "").trim();
  if (!conversationId) throw new Error("importLegacySessionIntoHarness requires an alias");
  if (!harness) throw new TypeError("importLegacySessionIntoHarness requires a harness handle");
  if (!entry?.file) throw new TypeError("importLegacySessionIntoHarness requires a manifest entry");

  // 快路径：别名已登记 → 幂等返回既有（重导不翻倍）。
  const registered = await harness.snapshot(ConversationIndex, conversationId, context);
  if (registered?.conversationId) {
    const existing = await harness.conversation(registered.conversationId, context);
    if (existing !== undefined) {
      return { conversationId: registered.conversationId, created: false, appended: 0 };
    }
  }

  // 只读归档副本；SHA-256 不符（归档被改动/损坏）即拒绝。
  const bytes = await readFile(join(archiveDir, entry.file));
  const sha256 = sha256Hex(bytes);
  if (entry.sha256 && sha256 !== entry.sha256) {
    throw new Error(
      `MilkSU archive copy of ${entry.conversationId || entry.file} does not match its manifest`
      + ` SHA-256 (${sha256} != ${entry.sha256}); refusing to import`,
    );
  }
  const fileEntries = parseLegacySessionFile(bytes.toString("utf8"));
  const tree = deriveLegacySessionTree(fileEntries);
  const headerId = String(tree.header?.id ?? "");
  if (entry.conversationId && headerId && headerId !== entry.conversationId) {
    throw new Error(
      `MilkSU archive copy of ${entry.file} holds session ${headerId},`
      + ` expected ${entry.conversationId}; refusing to import`,
    );
  }
  const settings = deriveLegacyEffectiveSettings(tree.path);

  const outcome = await harness.commit(async tx => {
    const doc = await tx.doc(ConversationIndex, conversationId, 0);
    if (doc.conversationId) {
      const record = await tx.conversation(doc.conversationId);
      if (record !== undefined) {
        return { conversationId: doc.conversationId, created: false, appended: 0 };
      }
    }
    const record = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const change = {};
    if (settings.model) change.model = { ...settings.model };
    if (settings.thinkingLevel) change.thinkingLevel = settings.thinkingLevel;
    if (Object.keys(change).length > 0) await configure(tx, record.id, change);
    const { appended } = await appendLegacyPath(tx, record.id, tree, onProgress);
    doc.conversationId = record.id;
    return { conversationId: record.id, created: true, appended };
  }, context);
  return outcome;
}
