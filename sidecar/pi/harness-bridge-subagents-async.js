// PR-2 批次 C2：门开路径的子代理·异步路面（pi-subagents 包那条 async 派活路全量
// 迁 Harness，DECISIONS Q6：一步到位）。
//
// 语义事实源是门关路径的 pi-subagents 0.74.0（钉包源码，只读不加载）：
//   - async 单发（subagent 默认 async:true）：spawnRunner 起 detached runner 进程，
//     工具立即返回收据「Async: <agent> [<runId>]」（async-execution.js
//     executeAsyncSingle + formatAsyncStartedMessage），run 状态在
//     async-subagent-runs/<runId>/status.json（state: running→complete/failed），
//     完成经 result-watcher + notify.js 以 sendMessage({customType:"subagent-notify"},
//     {triggerTurn:true}) 原生唤醒父会话（"Background task completed: **agent**"）；
//   - foreground 单发（async:false）：父会话内联等待，答案经工具结果回传；
//   - 控制面：subagent({action:"status"|"steer"|"stop"|"children.list", id/runId})；
//   - agent 定义：frontmatter（name/model/thinking/tools/prompt/…），门关部署以
//     MILKSU_PI_SUBAGENT_BUNDLED_ONLY=1 只加载钉包 builtin 定义（agents/agents.js
//     buildAgentDiscoverySources），发现路径（用户 ~/.agents、项目 .pi/agents、npm
//     包）在 MilkSU 部署形态被关闭——门开路径照抄（readBundledAgentDefinitions，
//     C1 公共底座）。
//
// 门开实现（照 pi-durable README「Abort and Subagents」§397-443 的例 23 产品级
// 模式：background anchor task + follow-up 输入回投）：
//   - 子代理异步 run = 一个**会话拥有的 background 任务**（milksu-subagent-anchor，
//     {background:true} 边界：不阻塞父会话 idle、不随父会话 abort 级联）——它
//     get-or-create 一个**任务拥有的 child 会话**（所有权索引 scanConversations
//     ({ownerTaskId})，C1 公共底座同款），提交任务输入（requestId=
//     `subagent-async:<runId>` 幂等——崩溃重跑不重投），等 child idle（或超时
//     deadline），摘要答案 + 写过的文件，经 requestId=`subagent-async-notify:<runId>`
//     把完成通知作为 **follow-up 输入投回父会话**（pi-durable 原生唤醒；父会话
//     忙则进 pi.inbox，当前 run 结束后触发下一轮），最后提交终态。
//   - spawn 工具（subagent_async）：async 默认——memo 固定 runId + scanTasks 按
//     runId 找回既有 anchor（replay-safe：崩溃重跑不重复建 run），立即返回收据；
//     async:false——前台等待（api.waitForTask(anchor)，与 C1 builtin 路同款等待
//     语义：答案经工具结果回传，不做完成通知）。
//   - 控制工具：subagent_async_status（无 id=列表/有 id=单 run 状态+结果）、
//     subagent_async_steer（steer/follow_up 投递，回执不阻塞）、subagent_async_stop
//     （abortTask 级联：child 子树自底向上收场）。控制面读 durable 真相
//     （scanTasks/scanConversations），崩溃重开后自动可用；进程内 registry 只服务
//     roster 投影与 destroy halt，createSession 的 adoption 面负责重建。
//   - agent 定义解析：C1 readBundledAgentDefinitions（本票增量补 model 字段——
//     门关 frontmatter 已知字段，钉包 builtin 定义本身不带 model；maiRecord 形态
//     的自定义定义用它）+ 模型串解析走 C1 parseSubagentModelOverride
//     （"provider/id" 口径，**milksu-route/X 形态**在 route provider 已注册进
//     harness Models 时直接命中；解析不了按 C1 语义抛错如实报告，不静默降级）。
//     工具集 = 角色 frontmatter tools ∩ registry（resolveRoleToolObjects 同款）。
//   - 转录/产物：child 会话转录天然在 harness 存储；run 摘要/输出按门关
//     async-subagent-runs 的 UX 形状投影——subagent_tasks 行（runId/状态/摘要/
//     duration/exitCode）接 C1 已建的 emitSubagentTasks 管线，渲染器零改动。
//
// 与门关的已见变化点（交付报告总表有完整对照）：
//   1. child 从 detached runner 进程（OS 级隔离 + sandbox-exec 写界）变为 sidecar
//      进程内的 harness background 会话（与 C1 builtin child 同边界：挂移植工具、
//      无审批链——门关 runner 子会话同样无审批）。
//   2. run 状态不再落 async-subagent-runs/<id>/status.json（durable 真相=anchor
//      任务记录 + child 转录）；门关 status.json 的 state/summary/output-0.log 投影
//      由 anchor 终态 + roster 行承载。
//   3. 完成通知从 pi.sendMessage({customType:"subagent-notify", display}) 变为
//      父会话 follow-up 输入（pi-durable 语义）：模型上下文同形（同款文案头），但
//      无自定义渲染面（图标/预览卡），桌面按排队输入触发的普通回合呈现。
//   4. steer 不再有 queued/delivered/missed 的三态回执（pi-durable inbox 的
//      steer/followUp 二态）+ 终态 run 上的 steer 竞态窗口（monitor 已决终态后
//      提交的 steer 输入无人再报告——门关 receipt 同样"not compliance proof"，
//      如实披露）。
//   5. schedule.*/mission.*/watchdog.*/workflow 编排面不在本票范围（保持暂缓，
//      通告指向后续批次）；R8 的模型串守卫改写（route 未发布时回退实际 provider）
//      不平移——门开按 C1 语义解析失败即报错。
//
// replay 声明：四件工具全部 replay:"safe"——spawn 靠 memo runId + scanTasks 找回
// anchor + requestId 幂等；steer 的 requestId 以 api.callId 派生（同调用重跑同 id
// 不重投）；stop/status 纯操作/纯读。

import { randomUUID } from "node:crypto";
import { configure, defineExtension, defineTask, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { validateSubagentInput } from "./bridge-collaboration.js";
import { normalizeSubagentYield } from "./bridge-subagent-yield.js";
import {
  MILKSU_SUBAGENTS_EXTENSION,
  buildAdvertisedAgentCatalog,
  buildChildInstructions,
  createSubagentChildRegistry,
  parseSubagentModelOverride,
  readBundledAgentDefinitions,
  resolveRoleToolObjects,
} from "./harness-bridge-subagents.js";

export const MILKSU_SUBAGENTS_ASYNC_EXTENSION = "milksu-subagents-async";

/** C2 挂载的工具名（mountedHarnessToolNames 与对照断言共用）。 */
export const MILKSU_SUBAGENT_ASYNC_TOOL_NAMES = Object.freeze([
  "subagent_async",
  "subagent_async_status",
  "subagent_async_steer",
  "subagent_async_stop",
]);

/** anchor 任务的注册名（durable TaskRecord.kind；scanTasks 按 kind 过滤）。 */
export const MILKSU_SUBAGENT_ANCHOR_KIND = "milksu-subagent-anchor";

/**
 * 门开会话的工具面扩展：policy.activeTools 含 `subagent`（subagentAvailable 派生，
 * bridge-policy.js:1564-1566——go 档且非 read-only）时一并挂上异步路面四件。
 * 只在门开会话层生效（configureAgentTools 的入口处调用），bridge-policy 共享面
 * 不动。
 */
export function expandHarnessSubagentAsyncToolNames(names) {
  const list = [...new Set([...(Array.isArray(names) ? names : [])].map(name => String(name)))];
  if (!list.includes("subagent")) return list;
  return [...list, ...MILKSU_SUBAGENT_ASYNC_TOOL_NAMES.filter(name => !list.includes(name))];
}

// ---------- 常量（门关 async-execution.js / notify.js 的同源值） ----------

// 单发默认超时：pi-subagents DEFAULT_ASYNC_TIMEOUT_MS（executeAsyncSingle 的
// params.timeoutMs 缺省）与 C1 DEFAULT_SUBAGENT_TIMEOUT_MS 同值。
const DEFAULT_ASYNC_TIMEOUT_MS = 30 * 60 * 1000;

// 完成通知的预览上限（notify.js CHILD_OUTPUT_PREVIEW_MAX_BYTES 同量级）。
const MAX_NOTIFY_PREVIEW_CHARS = 4096;
// 状态面回显的答案上限。
const MAX_STATUS_ANSWER_CHARS = 8000;
const MAX_STATUS_PROMPT_CHARS = 480;
// roster 摘要上限（bridge-subagent-yield summaryLimit 同源）。
const MAX_ROSTER_SUMMARY_CHARS = 240;

const childThinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** 答案文本（assistant content 的 text 块拼接）。 */
function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block?.text ?? ""))
    .join("");
}

/**
 * child 转录摘要（C1 summarizeChildConversation 的 anchor 版，无 submission 句柄
 * ——按 newest-first 条目扫描）：最新一条有正文的 assistant 消息为终答；成功
 * write/edit 调用路径为产物清单（上限 32，C1 同款）。
 */
function summarizeChildFromEntries(items) {
  const ordered = [...(Array.isArray(items) ? items : [])];
  let answer = undefined;
  for (const entry of ordered) {
    for (let index = (entry?.model ?? []).length - 1; index >= 0; index -= 1) {
      const message = entry.model[index];
      if (message?.role !== "assistant") continue;
      const text = messageText(message).trim();
      if (text) {
        answer = text;
        break;
      }
    }
    if (answer !== undefined) break;
  }
  const successful = new Set();
  const writePaths = [];
  for (const entry of ordered) {
    for (const message of entry?.model ?? []) {
      if (message?.role === "toolResult" && message.isError === false && typeof message.toolCallId === "string") {
        successful.add(message.toolCallId);
      }
    }
  }
  for (const entry of ordered) {
    for (const message of entry?.model ?? []) {
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (
          block?.type === "toolCall"
          && (block.name === "write" || block.name === "edit")
          && successful.has(block.id)
          && block.arguments
          && typeof block.arguments.path === "string"
          && !writePaths.includes(block.arguments.path)
        ) {
          writePaths.push(block.arguments.path);
        }
      }
    }
  }
  return { answer, files: writePaths.slice(0, 32) };
}

function boundedText(value, limit) {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

/** roster 行的 yield 形状（C1 childYield 的同款字段）。 */
function asyncChildYield(status, request, files, exitCode) {
  return {
    status,
    ...(request.worktreeId ? { worktreeId: request.worktreeId } : { cwd: request.cwd }),
    files,
    findings: [],
    exitCode,
    agent: request.agent,
  };
}

// ---------- anchor 任务定义 ----------

/**
 * 异步子代理 run 的 durable 状态机（README 例 23 的 background anchor 模式）。
 * input（JSON，spawn 时定形）：
 *   runId         幂等键（memo 固定；requestId/通知投递/scanTasks 找回共用）
 *   toolCallId    roster 行 id（spawn 调用的 callId）
 *   agent/task    角色名与任务提示词
 *   cwd           child 会话目录；worktreeId 有值时 roster 行显示 worktree
 *   modelRef      {provider, modelId, thinkingLevel?}——parseSubagentModelOverride
 *                 的解析产物（milksu-route/X 命中形态）；缺省=继承父会话
 *   thinkingLevel 角色思考档（无 modelRef 时生效）
 *   defaultContext "fork" 时首建 fork 父转录（oracle 语义，C1 同款）
 *   notify        async:true——完成时投 follow-up 通知；前台等待路为 false
 *   timeoutMs     deadline（缺省 30m；0=不限）
 *   startedAt     起跑时刻（deadline 基准）
 * checkpoint：{phase:"run"}——单相位；崩溃重跑从 initial 相位重来，靠所有权索引
 * + requestId 幂等收敛到同一 child/同一输入（不重复建、不重复投）。
 * 终态 result：{answer, files, exitCode, conversationId}。
 */
function createSubagentAnchorTask(surfaces) {
  const {
    definitions,
    resolveConversation,
    getProjectInstructions,
    updateSubagentTasks,
    childRegistry,
    isSessionActive,
    getHarnessHandle,
  } = surfaces;

  function roleDefinition(agent) {
    const name = String(agent ?? "").trim();
    const direct = definitions.get(name);
    if (direct) return direct;
    for (const definition of definitions.values()) {
      if (definition.aliases.includes(name)) return definition;
    }
    throw new Error(`MilkSU rejected unsupported bundled subagent "${agent}"`);
  }

  function childChange(role, input, registrySnapshot) {
    const change = {
      tools: resolveRoleToolObjects(role, registrySnapshot),
      instructions: buildChildInstructions(role, getProjectInstructions()),
      cwd: input.cwd,
      extensions: {
        remove: [
          registrySnapshot.extension("milksu-prompt"),
          registrySnapshot.extension("milksu-skills"),
          registrySnapshot.extension(MILKSU_SUBAGENTS_EXTENSION),
          registrySnapshot.extension(MILKSU_SUBAGENTS_ASYNC_EXTENSION),
        ].filter(Boolean),
      },
    };
    if (input.modelRef) {
      change.model = { provider: input.modelRef.provider, modelId: input.modelRef.modelId };
      if (input.modelRef.thinkingLevel) change.thinkingLevel = input.modelRef.thinkingLevel;
    } else if (input.thinkingLevel && childThinkingLevels.has(input.thinkingLevel)) {
      change.thinkingLevel = input.thinkingLevel;
    }
    return change;
  }

  /**
   * roster 行 upsert（按 toolCallId；崩溃重跑/收养重建共用）。会话已销毁时跳过
   * ——durable 真相（anchor 终态/child 转录）仍在，但进程内 registry/桌面 roster
   * 不再接收已销毁会话的行（destroy halt 的 forget 不被迟到的 abort handler
   * 侧效翻新）。
   */
  function upsertRosterRow(alias, row) {
    if (!isSessionActive(alias)) return;
    updateSubagentTasks(alias, current => [
      ...(Array.isArray(current) ? current : []).filter(task => task.toolCallId !== row.toolCallId),
      row,
    ]);
  }

  function registryRemember(alias, record) {
    if (!isSessionActive(alias)) return;
    childRegistry.remember(alias, record);
  }

  return defineTask({
    name: MILKSU_SUBAGENT_ANCHOR_KIND,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, context) => {
        const input = task.input;
        const alias = resolveConversation(runtime.conversationId);
        const role = roleDefinition(input.agent);
        if (role.externalCli) {
          throw new Error(`MilkSU routes ${input.agent} through the external CLI runner`);
        }
        // 1. child get-or-create + 同 commit configure（所有权索引；崩溃重跑复用）。
        //    注意：TaskRuntime.commit 的返回值会被引擎当作任务的下一状态提交
        //    （「A returned state replaces the task's state」），非状态值必须经外层
        //    变量带出——这与 ToolExecutionApi.commit（返回值原样透出）不同。
        let childId;
        await runtime.commit(async (tx) => {
          const existing = (await tx.scanConversations({ ownerTaskId: task.id }, 1)).items[0];
          if (existing !== undefined) {
            childId = existing.id;
            return undefined;
          }
          let created;
          if (input.defaultContext === "fork") {
            const parentPage = await tx.scanEntries({ conversationId: runtime.conversationId }, 1);
            const forkAt = parentPage?.items?.[0]?.id;
            created = forkAt !== undefined
              ? await tx.forkConversation(
                runtime.conversationId,
                forkAt,
                { ownership: { kind: "task", taskId: task.id } },
              )
              : await tx.createConversation({ ownership: { kind: "task", taskId: task.id } });
          } else {
            created = await tx.createConversation({ ownership: { kind: "task", taskId: task.id } });
          }
          await configure(tx, created.id, childChange(role, input, runtime.registry));
          childId = created.id;
          return undefined;
        }, context);
        // 2. 进程内面：registry 登记 + roster 行（带 child 会话 id；幂等 set 语义）。
        registryRemember(alias, {
          id: input.runId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          anchorTaskId: task.id,
          conversationId: childId,
          role: input.agent,
          prompt: input.task,
          cwd: input.worktreeId ?? input.cwd,
          status: "running",
          kind: "harness-async",
        });
        upsertRosterRow(alias, {
          id: input.toolCallId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          role: input.agent,
          prompt: input.task,
          cwd: input.worktreeId ?? input.cwd,
          status: "running",
        });
        // 3. 投任务输入（requestId 幂等：崩溃重跑找回同一 submission 不重投）+
        //    4. 等 child idle（覆盖 steer/follow-up 的续跑）或 deadline。中止信号
        //    （abortTask 打上的 abort 标记→本 invocation 被 signal）落在 submit 的
        //    admission 窗口时，被信号的 submit 仍会持久 admit child 输入（「admitted
        //    work stays durable」），其 generation/工具任务在 abort 标记之后才创建
        //    ——不吃引擎级联，anchor 的 abort handler 又要等 owned work 自然收场。
        //    故信号路径（submit 或 wait 的拒绝）用扩展 context 的原始 harness 句柄
        //    （BACKGROUND_CONTEXT 不吃本 invocation 的信号）显式 abort child——标记
        //    落地后 child 的工具 execute 被 abortSignal 提前唤醒，stop/destroy 即时
        //    收场。
        const abortChildOnSignal = async () => {
          try {
            const rawHandle = await Promise.resolve(getHarnessHandle()).catch(() => undefined);
            const conversation = await rawHandle?.harness?.conversation(childId, BACKGROUND_CONTEXT);
            await conversation?.abort(BACKGROUND_CONTEXT, { background: true });
          } catch {
            // 兜底路径失手：外层 stopHarnessAsyncRun 的有界轮询接手。
          }
        };
        const child = await runtime.conversation(childId, context);
        if (!child) {
          throw new Error(`MilkSU async subagent child conversation ${childId} is unavailable`);
        }
        const deadlineAt = Number(input.timeoutMs) > 0
          ? Number(input.startedAt) + Number(input.timeoutMs)
          : undefined;
        let timedOut = false;
        try {
          await child.submit({
            type: "input",
            content: input.task,
            requestId: `subagent-async:${input.runId}`,
          }, context);
          if (deadlineAt !== undefined && runtime.now() >= deadlineAt) {
            timedOut = true;
          } else {
            const idle = child.waitForIdle(context);
            const outcome = deadlineAt === undefined
              ? await idle.then(() => "idle")
              : await Promise.race([
                idle.then(() => "idle"),
                runtime.sleep(deadlineAt, context).then(() => "deadline"),
              ]);
            timedOut = outcome === "deadline";
          }
        } catch (error) {
          await abortChildOnSignal();
          throw error;
        }
        if (timedOut) {
          await child.abort(context).catch(() => undefined);
          await child.waitForIdle(context).catch(() => undefined);
        }
        // 5. 摘要 child 转录（终答 + 写过的文件）。scanEntries 的返回同样经外层
        //    变量带出（TaskRuntime.commit 的状态语义，见上）。
        let childPage;
        await runtime.commit(async (tx) => {
          childPage = await tx.scanEntries({ conversationId: childId }, 80);
        }, context);
        const { answer, files } = summarizeChildFromEntries(childPage?.items ?? []);
        const succeeded = !timedOut && Boolean(answer);
        const summary = succeeded
          ? boundedText(answer, MAX_ROSTER_SUMMARY_CHARS)
          : timedOut
            ? "Subagent timed out."
            : `Subagent ${input.agent} ended without a final message.`;
        const exitCode = succeeded ? 0 : 1;
        const result = {
          answer: answer ?? "",
          files,
          exitCode,
          conversationId: childId,
          timedOut,
        };
        // 6. roster 终态行（yield 形状对齐 C1）。
        const yieldValue = (() => {
          try {
            return normalizeSubagentYield(
              asyncChildYield(succeeded ? "succeeded" : "failed", input, files, exitCode),
              { role: input.agent },
            );
          } catch {
            return {
              status: "failed",
              cwd: input.cwd,
              files: [],
              findings: [],
              exitCode: 1,
            };
          }
        })();
        registryRemember(alias, {
          id: input.runId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          anchorTaskId: task.id,
          conversationId: childId,
          role: input.agent,
          prompt: input.task,
          cwd: input.worktreeId ?? input.cwd,
          status: succeeded ? "succeeded" : "failed",
          summary,
          kind: "harness-async",
        });
        upsertRosterRow(alias, {
          id: input.toolCallId,
          toolCallId: input.toolCallId,
          runId: input.runId,
          role: input.agent,
          prompt: input.task,
          cwd: input.worktreeId ?? input.cwd,
          status: succeeded ? "succeeded" : "failed",
          durationMs: Math.max(0, runtime.now() - Number(input.startedAt)),
          exitCode,
          yield: yieldValue,
          summary,
        });
        // 7. 完成通知（async 模式）：follow-up 输入回投父会话（原生唤醒；父忙则
        //    入 inbox 排队）。requestId 幂等——崩溃重跑不重复投。
        if (input.notify) {
          const parent = await runtime.conversation(runtime.conversationId, context);
          if (!parent) {
            throw new Error(`MilkSU async subagent parent conversation ${runtime.conversationId} is unavailable`);
          }
          const statusWord = succeeded ? "completed" : timedOut ? "failed" : "failed";
          const preview = boundedText(succeeded ? answer : summary, MAX_NOTIFY_PREVIEW_CHARS) || "(no output)";
          const content = [
            `Background task ${statusWord}: **${input.agent}**`,
            "",
            preview,
            "",
            `Run: ${input.runId}`,
          ].join("\n");
          await parent.submit({
            type: "input",
            content,
            requestId: `subagent-async-notify:${input.runId}`,
          }, context);
        }
        // 8. 终态提交（唯一一次 durable 状态推进；此后任务不再跑代码）。
        await runtime.commit(() => (
          succeeded
            ? { status: "terminal", outcome: { status: "completed", result } }
            : {
              status: "terminal",
              outcome: {
                status: "failed",
                error: { message: timedOut ? "Subagent timed out." : summary },
                result,
              },
            }
        ), context);
      },
    },
    abort: async (task, runtime, context) => {
      // abortTask 级联：engine 先自底向上收场 anchor 拥有的 child 子树，再进本
      // handler。这里只补终态 + 进程内面（幂等 set）。
      const input = task.input;
      const alias = resolveConversation(runtime.conversationId);
      registryRemember(alias, {
        id: input.runId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        anchorTaskId: task.id,
        role: input.agent,
        prompt: input.task,
        cwd: input.worktreeId ?? input.cwd,
        status: "failed",
        summary: "Subagent stopped by user.",
        kind: "harness-async",
      });
      upsertRosterRow(alias, {
        id: input.toolCallId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        role: input.agent,
        prompt: input.task,
        cwd: input.worktreeId ?? input.cwd,
        status: "failed",
        durationMs: Math.max(0, runtime.now() - Number(input.startedAt)),
        exitCode: 1,
        summary: "Subagent stopped by user.",
      });
      await runtime.commit(() => ({
        status: "terminal",
        outcome: {
          status: "aborted",
          reason: "stopped",
          result: {
            answer: "",
            files: [],
            exitCode: 1,
            stopped: true,
          },
        },
      }), context);
    },
  });
}

// ---------- 控制面：durable 真相读取 ----------

/** 会话的全部 anchor 任务记录（scanTasks 按 kind；newest 在后——按 startedAt 排序）。 */
async function scanAnchorTasks(api, context) {
  const page = await api.commit(
    tx => tx.scanTasks({ conversationId: api.conversationId, kind: MILKSU_SUBAGENT_ANCHOR_KIND }, 64),
    context,
  );
  const records = [...(page?.items ?? [])];
  records.sort((left, right) => (
    Number(right.input?.startedAt ?? 0) - Number(left.input?.startedAt ?? 0)
  ));
  return records;
}

/** runId（或前缀）→ anchor 记录；找不到返回 undefined。 */
function matchAnchor(records, id) {
  const needle = String(id ?? "").trim();
  if (!needle) return undefined;
  const direct = records.find(record => String(record.input?.runId ?? "") === needle);
  if (direct) return direct;
  const byPrefix = records.filter(record => String(record.input?.runId ?? "").startsWith(needle));
  if (byPrefix.length === 1) return byPrefix[0];
  return undefined;
}

function anchorLive(record) {
  const status = record?.state?.status;
  return status === "pending" || status === "running" || status === "waiting" || status === "completing";
}

function anchorOutcomeSummary(record) {
  const outcome = record?.state?.outcome;
  if (!outcome) return undefined;
  if (outcome.status === "completed") {
    return { status: "succeeded", answer: outcome.result?.answer ?? "", files: outcome.result?.files ?? [] };
  }
  if (outcome.status === "aborted") {
    return { status: "failed", answer: "", files: [], error: "Subagent stopped by user." };
  }
  return {
    status: "failed",
    answer: outcome.result?.answer ?? "",
    files: outcome.result?.files ?? [],
    error: outcome.error?.message ?? "Subagent run failed.",
  };
}

// ---------- 工具参数与描述 ----------

const spawnParameters = Type.Object({
  agent: Type.String({ description: "Bundled subagent role to run (subagent_async_status-free roles list via the subagent tool's list action)." }),
  task: Type.String({ minLength: 1, description: "Self-contained task prompt for the child." }),
  async: Type.Optional(Type.Boolean({ description: "Background run; default true. false blocks this call until the answer returns." })),
  cwd: Type.Optional(Type.String({ description: "Execution directory (main workspace or a registered writer worktree)." })),
  model: Type.Optional(Type.String({ description: "Child model provider/id (e.g. milksu-route/<id>); bare id only if unique. Suffix :off/minimal/low/medium/high/xhigh/max overrides the thinking default." })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Run deadline in ms; default 30m. Alias maxRuntimeMs." })),
  maxRuntimeMs: Type.Optional(Type.Integer({ minimum: 1, description: "Alias timeoutMs (same defaults)." })),
});

const statusParameters = Type.Object({
  id: Type.Optional(Type.String({ description: "Run id or prefix; omit to list every async run of this conversation." })),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Bounded result preview lines; default 80." })),
});

const steerParameters = Type.Object({
  id: Type.String({ description: "Run id or prefix of a live async run." }),
  message: Type.String({ minLength: 1, description: "Steering guidance or follow-up instruction." }),
  mode: Type.Optional(Type.String({ enum: ["steer", "follow_up"], description: "steer (default) redirects the busy run; follow_up queues after current work." })),
});

const stopParameters = Type.Object({
  id: Type.String({ description: "Run id or prefix." }),
});

const SPAWN_TOOL_DESCRIPTION = [
  "Spawn a subagent run that works in its own background conversation.",
  "Default (async): returns a run handle immediately; the parent session is woken with a follow-up message when the run completes or fails, so return control instead of sleeping or polling. Fetch one-shot status or the finished result with subagent_async_status.",
  "async:false blocks this call until the child's answer returns as the tool result (no completion notification).",
  "SAFETY-CRITICAL: invoke subagents only when delegation is authorized by the operator's current request or applicable user/project instructions; task size, complexity or recipe fit do not independently authorize delegation. One writer per cwd/worktree; use read-only roles for independent review.",
  "Controls: subagent_async_status (list/one run), subagent_async_steer (steer or follow-up), subagent_async_stop (stop). External CLI agents run through the subagent tool instead.",
].join("\n");

const STATUS_TOOL_DESCRIPTION = [
  "List the async subagent runs of this conversation, or show one run's state and result.",
  "Without id: compact list of runs (run id, agent, state, elapsed). With id (run id or prefix): state, agent, cwd, duration, and for finished runs the bounded answer preview and written files.",
  "Use for one-shot checks; never as a wait loop—completion notifications arrive natively.",
].join("\n");

const STEER_TOOL_DESCRIPTION = [
  "Deliver a message to a live async subagent run.",
  "mode:\"steer\" (default) redirects the run's remaining work while it is busy; mode:\"follow_up\" queues the message to be answered after the current work.",
  "Returns a delivery receipt only; the answer arrives with the run's completion notification or via subagent_async_status. Steering a finished run is rejected—spawn a new run instead.",
].join("\n");

const STOP_TOOL_DESCRIPTION = [
  "Stop one async subagent run by id (run id or prefix).",
  "The run's child conversation and the work it owns are aborted bottom-up and the run settles as stopped; already finished runs are reported as complete.",
].join("\n");

const SPAWN_PROMPT_SNIPPET = "For operator-requested background delegation, spawn subagent runs with subagent_async; completion notifications arrive natively.";
const SPAWN_PROMPT_GUIDELINES = [
  "Do not spawn async subagents unless the operator requested delegation directly or through applicable instructions.",
  "Do not sleep or poll for async subagent completion; the session is woken natively when a run completes or fails.",
];

// ---------- 扩展构造 ----------

/**
 * 构造门开路径的异步子代理扩展。context（来自 harness-bridge-session 的会话层；
 * C1 同款约定）：
 *   resolveConversation   durable conversationId → MilkSU conversationId
 *   getPolicy             alias → 会话策略（workspace/codingCollaboration）
 *   getProjectInstructions () → 项目说明文本（child inheritProjectContext）
 *   modelsCollection      () → harness 级 Models 集合（model 覆写解析）
 *   getHarnessHandle      () → 适配层 handle（stop 的 abortTask 面）
 *   childRegistry         createSubagentChildRegistry() 的实例（异步路面专用）
 *   updateSubagentTasks   (alias, currentTasks => nextTasks)——roster 投影更新面
 *   environment           进程环境（钉包角色定义根解析）
 *   subagentTaskTimeoutMs () → 单发默认超时（测试可覆写；缺省 30m）
 */
export function createMilksuSubagentsAsyncExtension(context) {
  const required = [
    "resolveConversation",
    "getPolicy",
    "getProjectInstructions",
    "modelsCollection",
    "getHarnessHandle",
  ];
  for (const name of required) {
    if (!context || typeof context[name] !== "function") {
      throw new TypeError(`createMilksuSubagentsAsyncExtension requires ${name}`);
    }
  }
  if (!context?.childRegistry || typeof context.childRegistry.list !== "function") {
    throw new TypeError("createMilksuSubagentsAsyncExtension requires childRegistry");
  }
  const {
    resolveConversation,
    getPolicy,
    getProjectInstructions,
    modelsCollection,
    getHarnessHandle,
    childRegistry,
    updateSubagentTasks,
    environment = process.env,
    subagentTaskTimeoutMs = () => DEFAULT_ASYNC_TIMEOUT_MS,
    isSessionActive = () => true,
  } = context;
  if (typeof updateSubagentTasks !== "function") {
    throw new TypeError("createMilksuSubagentsAsyncExtension requires updateSubagentTasks");
  }
  const definitions = readBundledAgentDefinitions(environment);
  const anchorTask = createSubagentAnchorTask({
    definitions,
    resolveConversation,
    getProjectInstructions,
    updateSubagentTasks,
    childRegistry,
    isSessionActive,
    getHarnessHandle,
  });

  function roleDefinition(agent) {
    const name = String(agent ?? "").trim();
    const direct = definitions.get(name);
    if (direct) return direct;
    for (const definition of definitions.values()) {
      if (definition.aliases.includes(name)) return definition;
    }
    throw new Error(`MilkSU rejected unsupported bundled subagent "${agent}"`);
  }

  /**
   * spawn 公共段：校验（validateSubagentInput——MilkSU 共享契约）+ 角色解析 +
   * 模型串解析（milksu-route/X 实测形态；失败按 C1 语义抛错）+ runId 幂等 +
   * anchor get-or-create。返回 {input, anchorRecord, reused}。
   */
  async function prepareAnchorRun(args, api, context) {
    const alias = resolveConversation(api.conversationId);
    const policy = getPolicy(alias);
    const request = validateSubagentInput(args, policy?.codingCollaboration, policy?.workspace);
    if (request.mode !== "single") {
      throw new Error("MilkSU subagent_async spawns one child; management actions stay on the subagent tool");
    }
    const launch = request.tasks[0];
    const role = roleDefinition(launch.agent);
    if (role.externalCli) {
      throw new Error(
        `MilkSU runs external CLI agent ${launch.agent} through the subagent tool (foreground); subagent_async spawns harness child conversations only`,
      );
    }
    const modelOverride = parseSubagentModelOverride(
      String(args.model ?? "").trim() || role.model || undefined,
      modelsCollection(),
    );
    const worktree = policy?.codingCollaboration?.worktrees?.find(
      entry => entry.path === launch.cwd,
    );
    // runId 幂等：同一次工具调用（崩溃重跑）拿到同一 runId；anchor 按 runId 找回。
    const runId = await api.memo("subagent-async-run-id", randomUUID(), context);
    const existing = (await scanAnchorTasks(api, context))
      .find(record => String(record.input?.runId ?? "") === runId);
    const input = {
      runId,
      toolCallId: api.callId,
      agent: launch.agent,
      task: launch.task,
      cwd: launch.cwd,
      worktreeId: worktree?.id,
      ...(modelOverride ? {
        modelRef: {
          provider: modelOverride.provider,
          modelId: modelOverride.modelId,
          ...(modelOverride.thinkingLevel ? { thinkingLevel: modelOverride.thinkingLevel } : {}),
        },
      } : {}),
      ...(!modelOverride && role.thinking && childThinkingLevels.has(role.thinking)
        ? { thinkingLevel: role.thinking }
        : {}),
      ...(role.defaultContext === "fork" ? { defaultContext: "fork" } : {}),
      notify: args.async !== false,
      timeoutMs: Math.max(0, Number(args.timeoutMs ?? args.maxRuntimeMs ?? subagentTaskTimeoutMs())),
      startedAt: Date.now(),
    };
    if (existing) return { input: existing.input, anchorRecord: existing, reused: true, alias };
    const anchorId = await api.createTask(anchorTask, input, {
      ownership: { kind: "conversation" },
      background: true,
    }, context);
    const record = await api.getTask(anchorId, context);
    return { input, anchorRecord: record, reused: false, alias, anchorId };
  }

  const spawnTool = defineTool({
    name: "subagent_async",
    description: SPAWN_TOOL_DESCRIPTION,
    parameters: spawnParameters,
    replay: "safe",
    async execute(args, api, context) {
      const { input, anchorRecord, reused, alias, anchorId } = await prepareAnchorRun(args, api, context);
      const anchorTaskId = anchorRecord?.id ?? anchorId;
      childRegistry.remember(alias, {
        id: input.runId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        anchorTaskId,
        role: input.agent,
        prompt: input.task,
        cwd: input.worktreeId ?? input.cwd,
        status: "running",
        kind: "harness-async",
      });
      if (input.notify) {
        // async 收据（formatAsyncStartedMessage 的非交互变体，指引照门关语义改写
        // 为门开工具面）。
        const text = [
          `Async: ${input.agent} [${input.runId}]`,
          "",
          "The async run is detached and running in a background conversation.",
          "Completion or failure wakes this session natively with a follow-up message; do not run sleep timers or polling loops to wait for it.",
          `Use subagent_async_status with id "${input.runId}" for a one-shot status or result, subagent_async_steer to redirect it, or subagent_async_stop to stop it.`,
        ].join("\n");
        return {
          content: [{ type: "text", text: reused ? `${text}\n(replayed run handle)` : text }],
          details: {
            mode: "single",
            runId: input.runId,
            asyncId: input.runId,
            results: [],
          },
        };
      }
      // foreground：等待 anchor 终态（超时在 anchor 内裁决），答案经工具结果回传。
      let settled;
      try {
        settled = await api.waitForTask(anchorTaskId, context);
      } catch (error) {
        // 调用被中止（父会话 abort/超时面）：anchor 是 background 边界，需显式收场
        // child 子树 + anchor（abort 标记之后创建的 owned work 不吃引擎级联，见
        // stopHarnessAsyncRun 注记），再按中止收报。
        const handle = await Promise.resolve(getHarnessHandle()).catch(() => undefined);
        await stopHarnessAsyncRun(handle, anchorTaskId).catch(() => undefined);
        throw error;
      }
      const outcome = settled?.state?.outcome ?? {};
      const result = outcome.result ?? {};
      const succeeded = outcome.status === "completed";
      const answer = String(result.answer ?? "");
      const summary = succeeded
        ? (answer || "Subagent finished without a final message.")
        : result.timedOut
          ? "Subagent timed out."
          : (outcome.error?.message || `Subagent ${input.agent} ended without a final message.`);
      return {
        content: [{ type: "text", text: succeeded ? (answer || summary) : summary }],
        details: {
          mode: "single",
          runId: input.runId,
          asyncId: input.runId,
          results: [asyncChildYield(
            succeeded ? "succeeded" : "failed",
            input,
            result.files ?? [],
            succeeded ? 0 : 1,
          )],
        },
        ...(succeeded ? {} : { isError: true }),
      };
    },
  });

  const statusTool = defineTool({
    name: "subagent_async_status",
    description: STATUS_TOOL_DESCRIPTION,
    parameters: statusParameters,
    replay: "safe",
    async execute(args, api, context) {
      const records = await scanAnchorTasks(api, context);
      const lines = Math.max(1, Math.min(500, Number(args.lines ?? 80)));
      const renderRun = record => {
        const input = record.input ?? {};
        const outcome = anchorOutcomeSummary(record);
        const state = outcome ? outcome.status : "running";
        const elapsed = Math.max(0, Date.now() - Number(input.startedAt ?? Date.now()));
        return `- ${input.runId} · ${input.agent} · ${state} · ${Math.round(elapsed / 1000)}s`;
      };
      if (!String(args.id ?? "").trim()) {
        if (!records.length) {
          return { content: [{ type: "text", text: "No async subagent runs in this conversation." }], details: { mode: "management" } };
        }
        return {
          content: [{ type: "text", text: ["Async subagent runs:", ...records.map(renderRun)].join("\n") }],
          details: { mode: "management" },
        };
      }
      const record = matchAnchor(records, args.id);
      if (!record) {
        return {
          content: [{ type: "text", text: `MilkSU found no async subagent run for id "${args.id}" in this conversation.` }],
          details: { mode: "management" },
        };
      }
      const input = record.input ?? {};
      const outcome = anchorOutcomeSummary(record);
      const handle = await Promise.resolve(getHarnessHandle()).catch(() => undefined);
      let busy = false;
      if (!outcome && handle && typeof input.runId === "string") {
        try {
          const page = await handle.harness.commit(
            tx => tx.scanConversations({ ownerTaskId: record.id }, 1),
            BACKGROUND_CONTEXT,
          );
          const childId = page?.items?.[0]?.id;
          if (childId !== undefined) {
            const conversation = await handle.harness.conversation(childId, BACKGROUND_CONTEXT);
            const state = conversation ? await conversation.viewState(BACKGROUND_CONTEXT) : undefined;
            busy = Boolean(state?.value?.docs?.["pi.live"]?.run);
            state?.dispose?.();
          }
        } catch {
          // 观察面尽力而为。
        }
      }
      const rows = [
        `run: ${input.runId}`,
        `agent: ${input.agent}`,
        `status: ${outcome ? outcome.status : "running"}`,
        `cwd: ${input.worktreeId ?? input.cwd}`,
        `startedAt: ${new Date(Number(input.startedAt ?? Date.now())).toISOString()}`,
      ];
      if (input.task) rows.push(`task: ${boundedText(input.task, MAX_STATUS_PROMPT_CHARS)}`);
      if (outcome) {
        rows.push(`exitCode: ${outcome.status === "succeeded" ? 0 : 1}`);
        if (outcome.error) rows.push(`error: ${boundedText(outcome.error, MAX_STATUS_PROMPT_CHARS)}`);
        const answer = outcome.answer || outcome.error || "(no output)";
        rows.push("", "result:", boundedText(answer, MAX_STATUS_ANSWER_CHARS).split("\n").slice(0, lines).join("\n"));
        if ((outcome.files ?? []).length) {
          rows.push("", "files:", ...outcome.files.map(path => `- ${path}`));
        }
      } else {
        rows.push(`activity: ${busy ? "working" : "settling"}`);
        rows.push("", "The run is still working; the completion notification will wake this session.");
      }
      return {
        content: [{ type: "text", text: rows.join("\n") }],
        details: { mode: "management", runId: input.runId },
      };
    },
  });

  const steerTool = defineTool({
    name: "subagent_async_steer",
    description: STEER_TOOL_DESCRIPTION,
    parameters: steerParameters,
    replay: "safe",
    async execute(args, api, context) {
      const records = await scanAnchorTasks(api, context);
      const record = matchAnchor(records, args.id);
      if (!record) {
        return {
          content: [{ type: "text", text: `MilkSU found no async subagent run for id "${args.id}" in this conversation.` }],
          details: { mode: "management" },
        };
      }
      const input = record.input ?? {};
      if (!anchorLive(record)) {
        return {
          content: [{ type: "text", text: `Async subagent run ${input.runId} already finished; spawn a new subagent_async run instead.` }],
          details: { mode: "management" },
        };
      }
      const page = await api.commit(
        tx => tx.scanConversations({ ownerTaskId: record.id }, 1),
        context,
      );
      const childId = page?.items?.[0]?.id;
      const child = childId !== undefined ? await api.conversation(childId, context) : undefined;
      if (!child) {
        return {
          content: [{ type: "text", text: `Async subagent run ${input.runId} has no child conversation to steer.` }],
          details: { mode: "management" },
        };
      }
      const mode = args.mode === "follow_up" ? "followUp" : "steer";
      await child.submit({
        type: "input",
        content: String(args.message),
        whenBusy: mode,
        // callId 派生：同一次工具调用崩溃重跑不重投同一 steer。
        requestId: `subagent-async-steer:${input.runId}:${api.callId}`,
      }, context);
      return {
        content: [{
          type: "text",
          text: `Steered async subagent ${input.agent} [${input.runId}]: message delivered (${mode === "steer" ? "steering" : "follow-up queued"}). The answer arrives with the run's completion notification.`,
        }],
        details: { mode: "management", runId: input.runId },
      };
    },
  });

  const stopTool = defineTool({
    name: "subagent_async_stop",
    description: STOP_TOOL_DESCRIPTION,
    parameters: stopParameters,
    replay: "safe",
    async execute(args, api, context) {
      const records = await scanAnchorTasks(api, context);
      const record = matchAnchor(records, args.id);
      if (!record) {
        return {
          content: [{ type: "text", text: `MilkSU found no async subagent run for id "${args.id}" in this conversation.` }],
          details: { mode: "management" },
        };
      }
      const input = record.input ?? {};
      if (!anchorLive(record)) {
        return {
          content: [{ type: "text", text: `Async subagent run ${input.runId} already finished (${anchorOutcomeSummary(record)?.status ?? "terminal"}); nothing to stop.` }],
          details: { mode: "management" },
        };
      }
      const handle = await Promise.resolve(getHarnessHandle());
      // 显式收场（child abort + anchor abortTask）：见 stopHarnessAsyncRun 的级联
      // 注记——abort 标记之后创建的 owned work 不吃引擎级联，需显式 abort child。
      const outcome = await stopHarnessAsyncRun(handle, record.id);
      return {
        content: [{
          type: "text",
          text: `Stopped async subagent ${input.agent} [${input.runId}] (${outcome}).`,
        }],
        details: { mode: "management", runId: input.runId },
      };
    },
  });

  const catalog = buildAdvertisedAgentCatalog(definitions);
  const extension = defineExtension({
    name: MILKSU_SUBAGENTS_ASYNC_EXTENSION,
    tools: [spawnTool, statusTool, steerTool, stopTool],
    tasks: [anchorTask],
    sections: catalog ? [section("advertised_subagents_async", () => catalog)] : [],
  });
  extension.promptContributions = {
    snippets: new Map([["subagent_async", SPAWN_PROMPT_SNIPPET]]),
    guidelines: new Map([["subagent_async", SPAWN_PROMPT_GUIDELINES]]),
  };
  return extension;
}

// ---------- adoption：崩溃重开后的面重建 ----------

/**
 * createSession 收尾调用：按 durable 真相（scanTasks kind=milksu-subagent-anchor）
 * 重建进程内 registry 与 roster 行——飞行中的 run 恢复 running 行，已终态的 run
 * 恢复终态行（摘要从 outcome 取）。幂等：行按 toolCallId upsert。
 *
 * 找到 anchor 时显式 harness.resume()（C2 对 B1「createSession 不主动 resume」调度
 * 纪律的定点例外，如实注记）：background anchor 的恢复不依赖任何后续进度类调用
 * ——父会话重开后可能长时间无输入，而异步 run 必须自行续跑（崩溃重开→anchor 续
 * 跑→child 收尾→完成通知原生唤醒父会话，正是 async 语义）。B1 的审批重弹口径不
 * 变：无 anchor 的会话仍由下一条 submitInput/waitSubmission 翻起调度。
 */
export async function adoptSessionAsyncSubagents({
  handle,
  durableConversationId,
  alias,
  childRegistry,
  updateSubagentTasks,
}) {
  if (!handle?.harness || !Number.isInteger(durableConversationId)) return 0;
  const page = await handle.harness.commit(
    tx => tx.scanTasks(
      { conversationId: durableConversationId, kind: MILKSU_SUBAGENT_ANCHOR_KIND },
      64,
    ),
    BACKGROUND_CONTEXT,
  );
  const records = [...(page?.items ?? [])];
  if (records.length > 0) {
    handle.harness.resume();
  }
  for (const record of records) {
    const input = record.input ?? {};
    if (!input?.runId) continue;
    const outcome = anchorOutcomeSummary(record);
    const row = {
      id: input.toolCallId,
      toolCallId: input.toolCallId,
      runId: input.runId,
      role: input.agent,
      prompt: input.task,
      cwd: input.worktreeId ?? input.cwd,
      status: outcome ? outcome.status : "running",
      ...(outcome?.answer || outcome?.error ? { summary: boundedText(outcome.answer || outcome.error, MAX_ROSTER_SUMMARY_CHARS) } : {}),
      kind: "harness-async",
    };
    updateSubagentTasks(alias, current => [
      ...(Array.isArray(current) ? current : []).filter(task => task.toolCallId !== row.toolCallId),
      row,
    ]);
    childRegistry.remember(alias, {
      id: input.runId,
      toolCallId: input.toolCallId,
      runId: input.runId,
      anchorTaskId: record.id,
      role: input.agent,
      prompt: input.task,
      cwd: input.worktreeId ?? input.cwd,
      status: outcome ? outcome.status : "running",
      kind: "harness-async",
    });
  }
  return records.length;
}

// ---------- halt：会话销毁时收场异步 run（background 边界需显式 abortTask） ----------

/**
 * 收场一个异步 run：child 会话显式 abort（跨 background 边界）+ anchor abortTask。
 *
 * 为什么要显式 abort child：abortTask(anchor) 的引擎级联对**已在飞**的 owned work
 * 生效（标记→信号→工具 execute 的 abortSignal 提前唤醒），但对 abort 标记**之后**
 * 才创建的 owned work（实测：destroy 落在 anchor 提交 child 输入的飞行中——输入
 * 已持久 admit、child 的 generation/bash 任务随后才创建）不会及时标记，anchor 的
 * abort handler 又要等 owned work 自然收场——child 会睡满整个工具超时。显式
 * conversation.abort(child, {background:true}) 把 child 的普通作用域任务立即标记
 * 收掉（排队输入同时撤回），确定性收场（stop/destroy/前台中止三路共用）。
 */
export async function stopHarnessAsyncRun(handle, anchorTaskId) {
  if (!handle?.harness || !Number.isInteger(anchorTaskId)) return "not-found";
  const childConversationId = async () => {
    try {
      const page = await handle.harness.commit(
        tx => tx.scanConversations({ ownerTaskId: anchorTaskId }, 1),
        BACKGROUND_CONTEXT,
      );
      return page?.items?.[0]?.id;
    } catch {
      return undefined;
    }
  };
  // child 的标记性 abort：abort 的撤回+标记在首个 commit 落地（快），但其
  // 「resolve once the scope is idle」会等到 child 收场——迟到的 owned work 在
  // 自然超时前不收场时不应阻塞本函数，故对 idle 等待设短上限，余下等待由引擎
  // 后台完成（abort promise 不取消，标记已持久生效）。
  const abortChildMarked = async () => {
    const childId = await childConversationId();
    if (childId === undefined) return;
    try {
      const conversation = await handle.harness.conversation(childId, BACKGROUND_CONTEXT);
      await Promise.race([
        conversation?.abort(BACKGROUND_CONTEXT, { background: true }).catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, 250)),
      ]);
    } catch {
      // child 已收场/不可达：后续轮次或 abortTask 兜底。
    }
  };
  // 直标记 child 会话的在飞任务（taskGraph → abortTask 逐个）：绕开作用域遍历，
  // admission 竞态窗口里「abort 标记之后才创建」的 generation/工具任务也能被逐个
  // 打上标记并信号（实测 conversation.abort 的作用域级联在该窗口不触达）。
  const abortChildTasksDirectly = async () => {
    const childId = await childConversationId();
    if (childId === undefined) return;
    try {
      const graph = await handle.harness.taskGraph(BACKGROUND_CONTEXT);
      const nodes = Object.values(graph?.value?.tasks ?? {});
      graph?.dispose?.();
      for (const node of nodes) {
        if (node.conversationId !== childId || node.abortRequested) continue;
        await handle.harness.abortTask(node.id, BACKGROUND_CONTEXT).catch(() => undefined);
      }
    } catch {
      // taskGraph 读取失败：退回 conversation.abort 路径。
    }
  };
  await abortChildMarked();
  let outcome = "marked";
  try {
    outcome = await handle.harness.abortTask(anchorTaskId, BACKGROUND_CONTEXT);
  } catch {
    outcome = "terminal";
  }
  // admission 竞态收口：被信号的 submit 仍可能持久 admit child 输入（「admitted
  // work stays durable」），其 generation/工具任务在 abort 标记之后才创建——不吃
  // 引擎级联，anchor 的 abort handler 又只等 owned work 自然收场。有界轮询：直标
  // child 任务（taskGraph → abortTask）+ 标记性 conversation.abort，直到 anchor
  // 终态或轮询上限。
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const record = await handle.harness.getTask(anchorTaskId, BACKGROUND_CONTEXT);
      if (record?.state?.status === "terminal") break;
    } catch {
      break;
    }
    if (Date.now() > deadline) break;
    await abortChildTasksDirectly();
    await abortChildMarked();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return outcome;
}

/**
 * 门开异步路面的停止面（destroySession 接线；与注入的 haltConversationSubagents
 * ——门关 async run 目录 pid 面——互补：harness 任务行无 asyncDir，注入面天然
 * no-op）。background anchor 不随父会话 abort 级联，这里按 registry 里的在飞
 * anchor 显式收场（见 stopHarnessAsyncRun 的级联注记）。
 */
export function createHarnessSubagentAsyncHalt(childRegistry, getHarnessHandle) {
  return async function haltHarnessAsyncSubagents(alias) {
    const children = childRegistry.list(alias).filter(child => child.kind === "harness-async");
    if (!children.length) return;
    const handle = await Promise.resolve(getHarnessHandle?.()).catch(() => undefined);
    if (!handle?.harness) return;
    for (const child of children) {
      if (!child.anchorTaskId) continue;
      await stopHarnessAsyncRun(handle, child.anchorTaskId).catch(() => undefined);
    }
    childRegistry.forget(alias);
  };
}
