// pi-durable Harness 地基适配层（PR-2 批次 A：只打地基，不接 bridge 主流程）。
//
// 单点收口原则（PREP §5.1 缓解措施）：产品代码对 @earendil-works/pi-durable 的每个调用都
// 经过本模块。上游 API 标着 Experimental（README:3），变了只改这一层。
//
// 启用门（默认关闭）：bridge.js 的 createSession → SessionManager 路径一行未改，默认行为
// 零变化。后续批次翻开本开关后，语义是：值为 "1" 时 createSession 改走
// openMilkSUHarness 的 Harness/Conversation 路径（同工作区单 sidecar 进程持有单 Harness，
// 每条对话一条 Conversation，别名见下）；其余任何值（含未设置）维持现状。批次 B 翻门时
// 必须同步补 UI/Go 两侧的排队与审批回归（Q2/Q3 口径见 DECISIONS-pi-harness.md）。
//
// MilkSU conversationId ↔ durable ConversationId：pi-durable 的会话 id 由 storage mint（数字
// 序列，PREP §3.0/rehearsal s8），不能自选。这里用一份 session 级 Document 家族
// （milksu.conversation-index，key = 桌面 conversationId）做别名登记；createConversation 与
// 别名写入在同一个 commit 里原子完成，崩溃不会留下没有别名的会话。
//
// 防双开三件套（DECISIONS Q5）：pi-durable 自身无跨进程锁（README:527 纯约定）。
//   1. 生命周期硬保证（宿主侧，批次 B 接线）：旧 sidecar dispose → waitpid 确认退出后才起新
//      进程——这是主保证；
//   2. 宿主 advisory lock：本模块在存储目录维护 harness.lock（sidecar 拥有，不进 pi-durable），
//      持有期间心跳刷新 mtime，第二个进程 acquire 失败；
//   3. inspect() 自检降级定位：只管存储/格式损坏（打开时 throw、打开后 inspect 异常即拒绝启
//      动），对 SQLite 双开丢写无效（数据自洽不报错，REHEARSAL §6-C）——防双开靠 1+2，不靠自检。
//
// 心跳保活信号（DECISIONS Q3 硬要求 2）：Harness 打开期间适配层维持显式心跳（周期刷新锁文
// 件 mtime + 计数器）。宿主存活判定**不得依赖事件循环活跃度**：审批挂起期间 pi-durable 不持
// 有任何句柄、裸进程会以 code 13 退出（REHEARSAL §6-D），所以「安静」不等于「死了」。宿主应
// 以 ①进程句柄（waitpid）+ ②心跳新鲜度（锁文件 mtime 在 N 个周期内）判定存活，禁止用「是否
// 还在产出输出/事件」推断死亡——误判会触发审批循环重弹（R10）。心跳定时器默认持有事件循环
// 引用（ref），即审批挂起时由心跳保活进程；测试可用 unref 心跳。

import { mkdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Harness, configure as configureConversationAgent, defineDocFamily, watchEvents } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

// ---------- 启用门 ----------

export const HARNESS_ENABLE_ENV = "MILKSU_PI_HARNESS";

/** 批次 A 只暴露能力；除测试外没有调用方读取本开关（默认关闭，见文件头）。 */
export function isPiHarnessEnabled(environment = process.env) {
  return String(environment[HARNESS_ENABLE_ENV] ?? "") === "1";
}

// ---------- 路径 ----------

export const HARNESS_STORAGE_DIRECTORY = "harness";
export const HARNESS_STORAGE_FILE = "harness.sqlite";
export const HARNESS_LOCK_FILE = "harness.lock";

/** 与 bridge.js createSession 的 agentDir 推导保持同一份约定。 */
export function resolveHarnessAgentDir(environment = process.env, cwd = process.cwd()) {
  return String(environment.MILKSU_PI_AGENT_DIR ?? "").trim() || join(cwd, ".milksu", "pi");
}

export function harnessStoragePath(agentDir) {
  return join(agentDir, HARNESS_STORAGE_DIRECTORY, HARNESS_STORAGE_FILE);
}

export function harnessLockPath(agentDir) {
  return join(agentDir, HARNESS_STORAGE_DIRECTORY, HARNESS_LOCK_FILE);
}

// ---------- conversationId 别名登记（session 级 Document 家族） ----------

export const CONVERSATION_INDEX_DOC_KIND = "milksu.conversation-index";

const ConversationIndex = defineDocFamily({
  kind: CONVERSATION_INDEX_DOC_KIND,
  version: 1,
  scope: "session",
  family: true,
  // seed 参数按 pi-durable 家族文档约定保留；别名初值 0 表示「未登记」。
  initial: () => ({ conversationId: 0 }),
  checkpointWhen: () => true,
});

function normalizeConversationAlias(conversationId) {
  const alias = String(conversationId ?? "").trim();
  if (!alias) throw new Error("harness adapter requires a non-empty conversationId");
  return alias;
}

// ---------- 宿主 advisory lock（Q5-2） + 心跳（Q3-2） ----------

export const HARNESS_LOCK_HELD_CODE = "MILKSU_HARNESS_LOCK_HELD";
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_STALE_AFTER_HEARTBEATS = 10;
const DEFAULT_CREATE_SETTLE_MS = 50;

export class HarnessLockHeldError extends Error {
  constructor(detail) {
    const holder = detail?.holder;
    super(
      `MilkSU harness storage is held by another sidecar (lock ${detail?.path ?? ""},`
      + ` holder pid ${holder?.pid ?? "unknown"}, heartbeat age ${detail?.heartbeatAgeMs ?? "?"}ms).`
      + " 单进程约束由宿主保证：请确认旧 sidecar 已退出（waitpid）后再启动。",
    );
    this.name = "HarnessLockHeldError";
    this.code = HARNESS_LOCK_HELD_CODE;
    this.detail = detail;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程存在但属于别的用户——按「活着」保守处理；ESRCH 才是死了。
    return error?.code === "EPERM";
  }
}

async function readLockHolder(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return undefined;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startHeartbeat(lockPath, { intervalMs, unref = false }) {
  const startedAt = Date.now();
  let beats = 0;
  let lastBeatAt = 0;
  let lastError = undefined;
  let lost = false;
  let stopped = false;
  const touch = async () => {
    try {
      const now = new Date();
      await utimes(lockPath, now, now);
      lastBeatAt = Date.now();
      beats += 1;
      lost = false;
      lastError = undefined;
    } catch (error) {
      // 锁文件消失 = 持有权丢失（被宿主清理/被偷）。上报，不默默继续。
      lost = true;
      lastError = String(error?.message ?? error);
    }
  };
  const timer = setInterval(() => {
    void touch();
  }, intervalMs);
  if (unref) timer.unref();
  // 首拍在返回前完成：acquire 的调用方拿到锁时心跳已可用（beats >= 1）。
  const firstBeat = touch();
  return {
    intervalMs,
    firstBeat,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
    state() {
      return { startedAt, beats, lastBeatAt, intervalMs, lost, lastError };
    },
  };
}

/**
 * 获取 harness 存储目录的宿主 advisory lock（Q5-2）。
 *
 * 语义：O_EXCL 创建 harness.lock 写入持有者信息；已存在时，mtime 仍新鲜（心跳存活）或持有
 * pid 仍存活 → 抛 HarnessLockHeldError；mtime 过期或持有者已死 → 视为废弃锁，偷取后重试。
 * create 成功后做两次核验（立即 + settle 延迟后），把并发偷取的竞态窗口压到 settle 毫秒级。
 * 这是 advisory lock + 宿主生命周期硬保证之外的纵深防御，不是互斥的充分条件（见文件头）。
 */
export async function acquireHarnessLock(storageDirectory, options = {}) {
  const heartbeatMs = Math.max(50, Number(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS));
  const staleAfterHeartbeats = Math.max(
    1,
    Number(options.staleAfterHeartbeats ?? DEFAULT_STALE_AFTER_HEARTBEATS),
  );
  const settleMs = Math.max(0, Number(options.settleMs ?? DEFAULT_CREATE_SETTLE_MS));
  const staleMs = heartbeatMs * staleAfterHeartbeats;
  await mkdir(storageDirectory, { recursive: true });
  const lockPath = join(storageDirectory, HARNESS_LOCK_FILE);
  const holder = { pid: process.pid, acquiredAt: Date.now(), heartbeatMs, staleMs };

  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      await writeFile(lockPath, `${JSON.stringify(holder)}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => undefined);
      if (!info) continue; // 锁文件刚被清掉：重试创建。
      const existing = await readLockHolder(lockPath);
      const heartbeatAgeMs = Date.now() - info.mtimeMs;
      const holderAlive = processAlive(existing?.pid);
      // 偷取条件：心跳过期（持有者不再刷新 = 已死或已废），或持有 pid 确认不存在。
      // pid 复用只会让我们更保守（多等一个 stale 周期），不会误偷。
      if (heartbeatAgeMs < staleMs && holderAlive) {
        throw new HarnessLockHeldError({
          path: lockPath,
          holder: existing,
          mtimeMs: info.mtimeMs,
          heartbeatAgeMs,
          staleMs,
        });
      }
      await unlink(lockPath).catch(() => undefined);
      continue;
    }
    created = true;
  }
  if (!created) {
    throw new HarnessLockHeldError({ path: lockPath, reason: "contended" });
  }

  // 立即核验 + settle 后复核：若并发方偷走了我们刚创建的锁，宁可失败也不双持。
  const immediate = await readLockHolder(lockPath);
  if (immediate?.pid !== process.pid) {
    await unlink(lockPath).catch(() => undefined);
    throw new HarnessLockHeldError({ path: lockPath, holder: immediate, reason: "race" });
  }
  if (settleMs > 0) await sleep(settleMs);
  const settled = await readLockHolder(lockPath);
  if (settled?.pid !== process.pid) {
    await unlink(lockPath).catch(() => undefined);
    throw new HarnessLockHeldError({ path: lockPath, holder: settled, reason: "race" });
  }

  const heartbeat = startHeartbeat(lockPath, {
    intervalMs: heartbeatMs,
    unref: options.unrefHeartbeat === true,
  });
  await heartbeat.firstBeat;
  let released = false;
  return {
    path: lockPath,
    holder,
    heartbeat,
    heartbeatState: () => heartbeat.state(),
    async release() {
      if (released) return;
      released = true;
      heartbeat.stop();
      await unlink(lockPath).catch(() => undefined);
    },
  };
}

// ---------- Harness 打开 / 句柄 ----------

function createHandle({ harness, lock, agentDir, storagePath, context }) {
  let closed = false;

  async function ensureConversation(conversationId, createOptions = {}) {
    const alias = normalizeConversationAlias(conversationId);
    const fastPath = await harness.snapshot(ConversationIndex, alias, context);
    if (fastPath?.conversationId) {
      const existing = await harness.conversation(fastPath.conversationId, context);
      if (existing !== undefined) return { conversation: existing, created: false };
      // 别名指向不存在的会话（理论不可达）：走 commit 内重建修复。
    }
    const change = createOptions.agent;
    const outcome = await harness.commit(async (tx) => {
      const doc = await tx.doc(ConversationIndex, alias, 0);
      if (doc.conversationId) {
        const record = await tx.conversation(doc.conversationId);
        if (record !== undefined) return { id: doc.conversationId, created: false };
      }
      const record = await tx.createConversation({ ownership: { kind: "ownerless" } });
      if (change) await configureConversationAgent(tx, record.id, change);
      doc.conversationId = record.id;
      return { id: record.id, created: true };
    }, context);
    const conversation = await harness.conversation(outcome.id, context);
    if (conversation === undefined) {
      throw new Error(`harness adapter: conversation ${outcome.id} missing right after commit`);
    }
    return { conversation, created: outcome.created };
  }

  return {
    /** 只读原句柄（viewState/watch/watchEvents 等观察面）。 */
    harness,
    get agentDir() {
      return agentDir;
    },
    get storagePath() {
      return storagePath;
    },
    heartbeatState() {
      return lock.heartbeatState();
    },
    lockState() {
      return { path: lock.path, holder: lock.holder, heartbeat: lock.heartbeatState() };
    },

    /** 别名查找；未登记返回 undefined（不创建）。 */
    async conversation(conversationId) {
      const alias = normalizeConversationAlias(conversationId);
      const index = await harness.snapshot(ConversationIndex, alias, context);
      if (!index?.conversationId) return undefined;
      return harness.conversation(index.conversationId, context);
    },

    /** get-or-create：别名登记与建会话同一 commit（原子，并发安全）。 */
    ensureConversation,

    /**
     * submit 包装：requestId 原样直通（幂等键由桌面生成，重开进程后同 id 找回同一
     * submission，pi-durable submissions.js:117-126）。whenBusy 缺省沿用引擎默认
     * followUp（Q2：inbox 是唯一排队真相；steer 显式声明）。
     */
    async submitInput(conversationId, draft) {
      if (!draft || typeof draft !== "object") throw new TypeError("submitInput requires a draft");
      const { conversation } = await ensureConversation(conversationId);
      const submission = {
        type: "input",
        content: draft.content,
      };
      if (draft.requestId !== undefined) submission.requestId = String(draft.requestId);
      if (draft.whenBusy !== undefined) submission.whenBusy = draft.whenBusy;
      return conversation.submit(submission, context);
    },

    /**
     * 每会话 agent 配置（Q8 + B1）：pi-durable 的 AgentChange 子集。model/thinkingLevel 走
     * 命名引用；tools 传 ToolRegistration[]（或 {remove}）——pi-durable 的 configure 按对象
     * 的 .name 归档（agent.js applyChange），纯字符串会被误存成 undefined。
     */
    async configureConversation(conversationId, change = {}) {
      const { conversation } = await ensureConversation(conversationId);
      const next = {};
      if (change.provider && change.modelId) {
        next.model = { provider: String(change.provider), modelId: String(change.modelId) };
      } else if (change.clearModel) {
        next.model = null;
      }
      if (change.thinkingLevel !== undefined) next.thinkingLevel = change.thinkingLevel;
      if (change.tools !== undefined) next.tools = change.tools;
      if (change.cwd !== undefined) next.cwd = change.cwd;
      if (change.instructions !== undefined) next.instructions = change.instructions;
      if (Object.keys(next).length === 0) return;
      await conversation.configure(next, context);
    },

    /** 重开进程后按 id 重新拿回 submission（reacquire）。 */
    submission(id) {
      return harness.submission(id, context);
    },

    /** 等一个 submission 落定（done / unanswered(reason)）；接受 submitInput 的返回值或 id。 */
    async waitSubmission(submission) {
      const target = typeof submission === "object" && submission !== null && "wait" in submission
        ? submission
        : await harness.submission(submission, context);
      if (target === undefined) throw new Error("harness adapter: submission not found");
      return target.wait(context);
    },

    /** 撤回排队中的 input（placed/settled 语义见 pi-durable submissions.js:64-78）。 */
    abortSubmission(id) {
      return harness.abortSubmission(id, context);
    },

    /** 转录读取（新增/旧序由 cursor 控制；批次 D 的导出器同用这一面）。 */
    async conversationEntries(conversationId, { limit = 100, cursor } = {}) {
      const { conversation } = await ensureConversation(conversationId);
      return conversation.entries({}, limit, cursor, context);
    },

    /** 结构视图（pi.live/pi.inbox/pi.usage/pi.agent 的已提交快照；用后 dispose）。 */
    async conversationViewState(conversationId) {
      const { conversation } = await ensureConversation(conversationId);
      return conversation.viewState(context);
    },

    /** 解析后的 agent（模型/扩展/工具面），ready 事件与工具过滤用。 */
    async conversationAgent(conversationId) {
      const { conversation } = await ensureConversation(conversationId);
      return conversation.agent(context);
    },

    /** 撤回排队输入并中止该会话的普通任务（含非 background 的手动压缩）。 */
    async abortConversation(conversationId, options = {}) {
      const { conversation } = await ensureConversation(conversationId);
      await conversation.abort(context, options);
    },

    /** 手动压缩（spec §8.7）：入队压缩任务并返回其 id；结果经 waitTask 收条。 */
    async compactConversation(conversationId, instructions) {
      const { conversation } = await ensureConversation(conversationId);
      return conversation.compact(instructions, context);
    },

    /** 等一个任务终态（压缩收条等）。 */
    waitTask(taskId) {
      return harness.waitForTask(taskId, context);
    },

    /**
     * watchEvents 订阅（spec §9.4）：一批一提交的 AgentEvent 流。返回 {snapshot, stop,
     * closed}；listener 收到 readonly AgentEvent[]。溢出时上游以一份 snapshot 帧重放。
     */
    async watchConversationEvents(conversationId) {
      const { conversation } = await ensureConversation(conversationId);
      return watchEvents(harness, conversation.id, context);
    },

    /** docs["pi.inbox"] 的已提交快照（Q2：唯一排队真相；条目含文本）。 */
    async conversationInbox(conversationId) {
      const state = await this.conversationViewState(conversationId);
      try {
        const items = state?.value?.docs?.["pi.inbox"]?.items;
        return Array.isArray(items) ? items : [];
      } finally {
        state?.dispose?.();
      }
    },

    /** docs["pi.live"] 的已提交快照（run/generation/tools/compactions 展示面）。 */
    async conversationLive(conversationId) {
      const state = await this.conversationViewState(conversationId);
      try {
        return state?.value?.docs?.["pi.live"] ?? {};
      } finally {
        state?.dispose?.();
      }
    },

    resume() {
      harness.resume();
    },

    inspect() {
      return harness.inspect(context);
    },

    /**
     * dispose 语义（批次 B 的宿主接线点）：先停心跳（不再宣称存活）→ harness.close()（会话
     * 封存、存储落盘关闭，resolve 即存储已关）→ 释放锁。宿主侧应在 await 本方法后 waitpid
     * 确认进程退出，再起新 sidecar（Q5-1 生命周期硬保证）。幂等。
     */
    async close() {
      if (closed) return;
      closed = true;
      lock.heartbeat.stop();
      try {
        await harness.close(context);
      } finally {
        await lock.release();
      }
    },
  };
}

/**
 * 打开 MilkSU 的 durable Harness（Q4：SQLite WAL 是唯一产品后端；JSONL 仅测试用）。
 *
 * 打开顺序 = 防双开三件套：acquire lock（2）→ openNodeSqliteStorage + Harness.open（3 的
 * 「打开前」：存储格式损坏/迁移失败在此 throw）→ inspect 自检（3 的「打开后」：异常即拒绝
 * 启动，不静默继续）。任何一步失败：关闭已开句柄、释放锁、抛出。
 */
export async function openMilkSUHarness(options = {}) {
  if (!options || typeof options !== "object") throw new TypeError("openMilkSUHarness requires options");
  if (!options.models) throw new TypeError("openMilkSUHarness requires a pi-ai models collection");
  if (!options.registry) throw new TypeError("openMilkSUHarness requires a pi-durable registry");
  const agentDir = options.agentDir ?? resolveHarnessAgentDir();
  const context = options.context ?? BACKGROUND_CONTEXT;
  const storageDirectory = join(agentDir, HARNESS_STORAGE_DIRECTORY);
  const storagePath = harnessStoragePath(agentDir);

  const lock = await acquireHarnessLock(storageDirectory, {
    heartbeatMs: options.heartbeatMs,
    staleAfterHeartbeats: options.staleAfterHeartbeats,
    settleMs: options.settleMs,
    unrefHeartbeat: options.unrefHeartbeat,
  });

  let harness;
  try {
    // 打开前自检：损坏的库文件/迁移失败在 storage 打开或 Harness.open 处 throw。
    const storage = await openNodeSqliteStorage(storagePath, options.sqlite);
    const harnessOptions = {
      models: options.models,
      registry: options.registry,
    };
    if (options.settings !== undefined) harnessOptions.settings = options.settings;
    if (options.env !== undefined) harnessOptions.env = options.env;
    if (options.conversationCreated !== undefined) {
      harnessOptions.conversationCreated = options.conversationCreated;
    }
    if (options.onReport !== undefined) harnessOptions.onReport = options.onReport;
    harness = await Harness.open(storage, harnessOptions, context);
    // 打开后自检：inspect 只定位存储/格式损坏。注意它对 SQLite 双开丢写无效（数据自
    // 洽，REHEARSAL §6-C）——防双开靠锁与宿主生命周期，不靠这里。
    const inspection = await harness.inspect(context);
    if (!["paused", "running", "closing"].includes(inspection.scheduling)) {
      throw new Error(`harness adapter: unexpected scheduling state ${inspection.scheduling}`);
    }
  } catch (error) {
    if (harness !== undefined) await harness.close(context).catch(() => undefined);
    await lock.release();
    throw error;
  }
  return createHandle({ harness, lock, agentDir, storagePath, context });
}
