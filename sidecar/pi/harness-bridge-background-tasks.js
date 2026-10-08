// PR-2 批次 B2d：门开路径的后台任务面（bg_task/bg_status，pi-better-background-tasks
// 的门关工具面按 C2 background anchor 模式重建）。
//
// 语义事实源是门关路径（reviewed-ts/extensions.js 内联的 pi-better-background-tasks
// 0.1.10 + MilkSU 受审 spawn 面 bridge-background-process.js）：
//   - bg_task：七动作包装（spawn/watch/list/status/log/stop/clear）；spawn 起 detached
//     进程立即返回收据；watch 按 interval 轮询命令直到 success_when/failure_when/超时；
//     终态经 pi.sendUserMessage({deliverAs:"followUp"}) 回投通知。
//   - bg_status：只读+控制包装（list/status/log/stop/clear）。
//   - 审批面：spawn/watch/stop/clear 为效果动作（bridge.js:721-730），B1 审判链
//     （harness-bridge-approval.js:73）已有同款判定，挂载即生效。
//   - 磁盘面：meta.json + output.log 落 MILKSU_BACKGROUND_TASKS_DIR ||
//     tmpdir()/pi-better-background-tasks/tasks/<id>/（registry.ts 同约定）——桌面
//     background_tasks 面板的投影（bridge-background-view 的 session 过滤 + log tail）
//     读的正是这个目录，渲染器零改动。
//
// 门开实现（C2 anchor 模式，README 例 23）：
//   - 每个 bg 任务 = 一个**会话拥有的 background anchor 任务**（milksu-background-task，
//     {background:true}：不阻塞父会话、不随父 abort 级联）。anchor 首跑写 meta（含
//     callbackOrigin.sessionId=桌面会话 id——桌面面板过滤键）+ 经受审 spawnCommand/
//     runCommandOnce（bridge-background-process.js，与门关同一构造器：buildCodingBackground
//     Launch + 破坏性删除守卫 + 0600 日志纪律）执行；轮询等待（runtime.sleep，1s 节拍）；
//     终态：更新 meta → follow-up 输入回投父会话（requestId=`bg-task-notify:<bgId>` 幂等，
//     文案与门关 notifyTerminal 同源）→ 提交终态。
//   - 崩溃重跑：anchor 重跑读 meta——已终态 → 只补通知（requestId 幂等）；running 且
//     pid 已死 → failed「exit result was not captured」（门关 resumeRunningTask 同语义）；
//     pid 活着 → 继续轮询（exit 行从日志尾部解析，spawnCommand 的 close 钩子写的）。
//   - bg_status/list/status 读 durable 真相（scanTasks kind=milksu-background-task）；
//     log 读磁盘 meta 的 logPath（readPiBackgroundTaskLog，门关同一读面）。
//   - stop：stopHarnessBackgroundTask（handle.harness.abortTask + 有界轮询，C2
//     stopHarnessAsyncRun 的简化版——无 child 会话，abort handler 负责 kill 进程组 +
//     meta cancelled + 终态提交）。
//
// 与门关的已见变化点（对照总表）：
//   1. 生命周期真相从「进程内定时器 + 磁盘 meta」变为 anchor 任务记录（durable，
//      崩溃重开自动续跑）+ 磁盘 meta（桌面面板/日志双留）。
//   2. 完成通知从 pi.sendUserMessage 变为父会话 follow-up 输入（pi-durable 语义，
//      模型上下文同文案；无自定义渲染面）。
//   3. watch 的轮询从进程内 setTimeout 定时器变为 anchor 轮询循环（调度器持有，
//      崩溃后续跑）；条件求值（exit_code/stdout_contains/stderr_contains/json_path_*）
//      从 conditions.ts 逐字移植（纯函数）。
//   4. 桌面 spawn 控制（controlBackgroundTask 的 spawn 分支）门开改走本扩展的 anchor
//     （durable + bg_status 可见），门关保持原样。
//
// replay 声明：两件工具 replay:"safe"——spawn 靠 memo bgId + scanTasks 找回 anchor
// （requestId 幂等不重复投）；其余动作纯读/纯操作。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defineExtension, defineTask, defineTool } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "typebox";
import {
  processExists,
  runCommandOnce,
  spawnCommand,
  stopProcessGroup,
  validateCommandSpec,
} from "./bridge-background-process.js";
import {
  listPiBackgroundTaskMetas,
  readPiBackgroundTaskLog,
} from "./reviewed-ts/extensions.js";

export const MILKSU_BACKGROUND_TASKS_EXTENSION = "milksu-background-tasks";
export const MILKSU_BG_TOOL_NAMES = Object.freeze(["bg_task", "bg_status"]);
/** anchor 任务的注册名（durable TaskRecord.kind；scanTasks 按 kind 过滤）。 */
export const MILKSU_BACKGROUND_ANCHOR_KIND = "milksu-background-task";

// ---------- 磁盘面（registry.ts 同约定：目录/文件名/meta 形状） ----------

function bgBaseDir(environment = process.env) {
  const configured = environment.MILKSU_BACKGROUND_TASKS_DIR?.trim();
  if (configured) return resolve(configured);
  return join(tmpdir(), "pi-better-background-tasks");
}

function bgTasksDir(environment = process.env) {
  return join(bgBaseDir(environment), "tasks");
}

function bgMetaPath(id, environment = process.env) {
  return join(bgTasksDir(environment), id, "meta.json");
}

function bgLogPath(id, environment = process.env) {
  return join(bgTasksDir(environment), id, "output.log");
}

let bgIdSequence = 0;

/** 与门关 nextTaskId 同形（bg_<pid36>_<时间36>_<序号>；进程内序号自增）。 */
function nextBgId() {
  bgIdSequence += 1;
  return `bg_${process.pid.toString(36)}_${Date.now().toString(36)}_${bgIdSequence}`;
}

function writeBgMeta(meta, environment = process.env) {
  mkdirSync(join(bgTasksDir(environment), meta.id), { recursive: true, mode: 0o700 });
  writeFileSync(bgMetaPath(meta.id, environment), JSON.stringify(meta, null, 2), { mode: 0o600 });
}

function readBgMeta(id, environment = process.env) {
  try {
    return JSON.parse(readFileSync(bgMetaPath(id, environment), "utf8"));
  } catch {
    return undefined;
  }
}

// ---------- 条件求值（conditions.ts 逐字移植：纯函数） ----------

export function evaluateBackgroundCondition(condition, result) {
  const type = String(condition?.type ?? "");
  if (type === "exit_code") {
    return { matched: result.exitCode === condition.equals, value: result.exitCode };
  }
  if (type === "stdout_contains") {
    return { matched: String(result.stdout ?? "").includes(String(condition.value ?? "")) };
  }
  if (type === "stderr_contains") {
    return { matched: String(result.stderr ?? "").includes(String(condition.value ?? "")) };
  }
  if (type === "json_path_equals" || type === "json_path_exists") {
    const resolved = resolveBackgroundJsonPath(String(result.stdout ?? ""), String(condition.path ?? ""));
    if (!resolved.ok) return { matched: false, error: resolved.error };
    return type === "json_path_equals"
      ? { matched: JSON.stringify(resolved.value) === JSON.stringify(condition.value), value: resolved.value }
      : { matched: true, value: resolved.value };
  }
  return { matched: false, error: `unsupported condition type: ${type}` };
}

function resolveBackgroundJsonPath(jsonText, path) {
  let current;
  try {
    current = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, error: `stdout is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const tokens = parseBackgroundJsonPath(path);
  if (!tokens) return { ok: false, error: `unsupported JSON path: ${path}` };
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return { ok: false, error: `JSON path not found: ${path}` };
      }
      current = current[token];
      continue;
    }
    if (current === null || typeof current !== "object" || !(token in current)) {
      return { ok: false, error: `JSON path not found: ${path}` };
    }
    current = current[token];
  }
  return { ok: true, value: current };
}

function parseBackgroundJsonPath(path) {
  if (!path.startsWith("$")) return undefined;
  const tokens = [];
  let i = 1;
  while (i < path.length) {
    if (path[i] === ".") {
      i += 1;
      const start = i;
      while (i < path.length && /[A-Za-z0-9_$-]/.test(path[i])) i += 1;
      if (i === start) return undefined;
      tokens.push(path.slice(start, i));
      continue;
    }
    if (path[i] === "[") {
      const end = path.indexOf("]", i);
      if (end === -1) return undefined;
      const raw = path.slice(i + 1, end).trim();
      const quoted = raw.match(/^['"](.+)['"]$/);
      if (quoted) tokens.push(quoted[1]);
      else if (/^\d+$/.test(raw)) tokens.push(Number(raw));
      else return undefined;
      i = end + 1;
      continue;
    }
    return undefined;
  }
  return tokens;
}

// ---------- 输出格式化（tools.ts format* 的 record/meta 双源版） ----------

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m${rest.toString().padStart(2, "0")}s`;
}

function oneLine(value, maxLength) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const single = String(raw ?? "").replace(/\s+/g, " ").trim();
  return single.length <= maxLength ? single : `${single.slice(0, Math.max(0, maxLength - 1))}…`;
}

const TERMINAL_BG_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function isTerminalBgStatus(status) {
  return TERMINAL_BG_STATUSES.has(String(status));
}

/** anchor 记录 → 展示状态（pending/running/waiting/completing 都算 running）。 */
function anchorBgStatus(record) {
  const outcome = record?.state?.outcome;
  if (outcome?.status === "completed") return String(outcome.result?.status ?? "succeeded");
  if (outcome?.status === "aborted") return "cancelled";
  if (outcome?.status === "failed") return String(outcome.result?.status ?? "failed");
  return "running";
}

function anchorBgLive(record) {
  return !record?.state?.outcome;
}

function bgLabel(meta, input) {
  const id = String(input?.bgId ?? meta?.id ?? "");
  const name = String(meta?.name ?? input?.name ?? "").trim();
  return name ? `${name} (${id})` : id;
}

function formatBgLaunch(input, environment) {
  return `Started background ${input.kind === "watch" ? "command_watch" : "process"} ${bgLabel(undefined, input)}. `
    + `Status: running. Log: ${bgLogPath(input.bgId, environment)}`;
}

function formatBgList(records, limit) {
  const visible = records.slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)));
  if (!visible.length) return "No background tasks found.";
  const now = Date.now();
  return visible.map((record) => {
    const input = record.input ?? {};
    const meta = readBgMeta(input.bgId);
    const status = isTerminalBgStatus(meta?.status) ? meta.status : anchorBgStatus(record);
    const age = formatDuration((meta?.endedAt ?? now) - Number(input.startedAt ?? now));
    const name = String(meta?.name ?? input.name ?? "").trim();
    return `${input.bgId} ${name ? `${name} ` : ""}${input.kind === "watch" ? "command_watch" : "process"} ${status} ${age}`;
  }).join("\n");
}

function formatBgStatus(record) {
  const input = record.input ?? {};
  const meta = readBgMeta(input.bgId);
  const status = isTerminalBgStatus(meta?.status) ? meta.status : anchorBgStatus(record);
  const lines = [
    `Background task ${bgLabel(meta, input)} is ${status}.`,
    `kind: ${input.kind === "watch" ? "command_watch" : "process"}`,
    `elapsed: ${formatDuration((meta?.endedAt ?? Date.now()) - Number(input.startedAt ?? Date.now()))}`,
  ];
  if (meta?.deadlineAt && status === "running") {
    lines.push(`deadline: ${formatDuration(meta.deadlineAt - Date.now())} left`);
  }
  if (meta?.lastExitCode !== undefined || meta?.lastSignal !== undefined) {
    lines.push(`last exit: ${meta.lastExitCode ?? "null"}${meta.lastSignal ? ` signal=${meta.lastSignal}` : ""}`);
  }
  if (meta?.result) lines.push(`result: ${oneLine(meta.result, 500)}`);
  if (meta?.error) lines.push(`error: ${oneLine(meta.error, 500)}`);
  if (meta?.lastState !== undefined) lines.push(`last state: ${oneLine(meta.lastState, 800)}`);
  lines.push(`log: ${meta?.logPath ?? bgLogPath(input.bgId)}`);
  lines.push(`For full metadata use bg_task_status id=${input.bgId} verbose=true. For logs use bg_task_log id=${input.bgId} tail_lines=20, or tail_lines=0 for the retained raw log.`);
  return lines.join("\n");
}

function formatBgLog(id, tailLines, environment) {
  const meta = readBgMeta(id, environment);
  const logPath = meta?.logPath ?? bgLogPath(id, environment);
  const log = readPiBackgroundTaskLog(logPath, tailLines ?? 20);
  const prefix = log.truncated ? `[showing tail of ${logPath}]\n` : `[${logPath}]\n`;
  return prefix + (log.text || "(log is empty)");
}

// ---------- anchor 任务定义 ----------

const BG_EXIT_LINE = /^--- exit .* code=(\d+|null) signal=(\S+|null) ---$/m;

function parseExitLine(logText) {
  const match = String(logText ?? "").match(BG_EXIT_LINE);
  if (!match) return undefined;
  return {
    exitCode: match[1] === "null" ? null : Number(match[1]),
    signal: match[2] === "null" ? null : match[2],
  };
}

function appendWatchHeader(logPath, intervalMs) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `--- watch ${new Date().toISOString()} interval_ms=${intervalMs} ---\n`);
}

function appendWatchResult(logPath, result) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `\n--- check ${new Date(result.startedAt).toISOString()} exit=${result.exitCode ?? "null"} signal=${result.signal ?? "null"} duration_ms=${result.endedAt - result.startedAt} ---\n`);
  if (result.stdout) appendFileSync(logPath, result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) appendFileSync(logPath, `[stderr]\n${result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`}`);
}

function extractLastState(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return result.stdout.slice(0, 4000);
  }
}

/**
 * bg 任务的 durable 状态机（C2 anchor 模式）。input（JSON，spawn 时定形）：
 *   bgId/toolCallId/kind("process"|"watch")/command/argv/shell/cwd/env/name
 *   callback（完成时回投通知；桌面 spawn 控制为 false）
 *   timeoutSeconds（0=不限；watch 缺省 900）
 *   intervalSeconds/successWhen/failureWhen（watch）
 *   startedAt
 * checkpoint：{phase:"run"}——单相位；崩溃重跑从 meta（磁盘）+ 日志 exit 行收敛，
 * requestId 幂等保证通知不重复投。终态 result：{status, exitCode, signal}。
 */
function createBackgroundAnchorTask(surfaces) {
  const { resolveConversation, emitTasksChanged, environment = process.env } = surfaces;

  async function notifyTerminal(runtime, context, meta, input) {
    if (meta.callback === false || meta.callbackSentAt) return;
    const parent = await runtime.conversation(runtime.conversationId, context);
    if (!parent) {
      throw new Error(`MilkSU background task parent conversation ${runtime.conversationId} is unavailable`);
    }
    await parent.submit({
      type: "input",
      content: `Background task ${bgLabel(meta, input)} reached terminal status ${meta.status}. `
        + `Inspect the compact result with bg_task_status id=${input.bgId}; call bg_task_log only if the status summary is insufficient.`,
      requestId: `bg-task-notify:${input.bgId}`,
    }, context);
    meta.callbackSentAt = Date.now();
    writeBgMeta(meta, environment);
  }

  function commitTerminal(runtime, context, status, exitCode, signal) {
    return runtime.commit(() => ({
      status: "terminal",
      outcome: {
        status: ["succeeded", "timed_out", "cancelled"].includes(status) ? "completed" : "failed",
        ...(status === "failed" ? { error: { message: `Background task ${status}.` } } : {}),
        result: { status, exitCode, signal },
      },
    }), context);
  }

  async function settleMeta(runtime, context, meta, input, patch) {
    // 终态落 meta（一次）：已终态（如桌面 stop 先写 cancelled）不翻新。
    const latest = readBgMeta(input.bgId, environment) ?? meta;
    if (isTerminalBgStatus(latest.status)) return latest;
    const next = {
      ...latest,
      ...patch,
      endedAt: Date.now(),
    };
    writeBgMeta(next, environment);
    emitTasksChanged(resolveConversation(runtime.conversationId));
    return next;
  }

  return defineTask({
    name: MILKSU_BACKGROUND_ANCHOR_KIND,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, context) => {
        const input = task.input;
        const meta0 = readBgMeta(input.bgId, environment);

        // 崩溃重跑收敛：已终态 → 补通知后直接提交。
        if (meta0 && isTerminalBgStatus(meta0.status)) {
          await notifyTerminal(runtime, context, meta0, input);
          const outcome = meta0.status === "cancelled" ? "aborted" : meta0.status === "failed" ? "failed" : "completed";
          await runtime.commit(() => ({
            status: "terminal",
            outcome: {
              status: outcome,
              ...(outcome === "failed" ? { error: { message: `Background task ${meta0.status}.` } } : {}),
              result: { status: meta0.status, exitCode: meta0.lastExitCode ?? null, signal: meta0.lastSignal ?? null },
            },
          }), context);
          return;
        }

        // 首跑：写 meta（桌面面板过滤键 = callbackOrigin.sessionId）+ 起执行面。
        // 已有 running meta 但无 pid（桌面控制面同步预写）→ 补执行面（spawn + pid）。
        let meta = meta0;
        if (!meta || (input.kind === "process" && !meta.pid)) {
          meta = {
            ...(meta ?? {}),
            id: input.bgId,
            name: input.name,
            kind: input.kind === "watch" ? "command_watch" : "process",
            status: "running",
            startedAt: Number(input.startedAt ?? Date.now()),
            deadlineAt: Number(input.timeoutSeconds) > 0
              ? Number(input.startedAt ?? Date.now()) + Number(input.timeoutSeconds) * 1000
              : undefined,
            intervalMs: input.kind === "watch" ? Math.max(1, Number(input.intervalSeconds ?? 30)) * 1000 : undefined,
            logPath: bgLogPath(input.bgId, environment),
            callback: input.callback !== false,
            callbackOrigin: { cwd: input.cwd, sessionId: resolveConversation(runtime.conversationId) },
            command: input.command,
            argv: input.argv,
            shell: input.shell ?? true,
            cwd: input.cwd,
            env: input.env,
            spawnPid: process.pid,
            ...(input.kind === "watch" ? { successWhen: input.successWhen, failureWhen: input.failureWhen, notifyOn: "terminal" } : {}),
          };
          writeBgMeta(meta, environment);
          if (input.kind === "watch") {
            appendWatchHeader(meta.logPath, meta.intervalMs ?? 30000);
          } else {
            try {
              const spawned = spawnCommand(
                { command: input.command, argv: input.argv, shell: input.shell ?? true, cwd: input.cwd, env: input.env },
                meta.logPath,
                true,
              );
              spawned.child.unref();
              meta.pid = spawned.child.pid ?? undefined;
              meta.pgid = spawned.pgid ?? spawned.child.pid ?? undefined;
              writeBgMeta(meta, environment);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const settled = await settleMeta(runtime, context, meta, input, {
                status: "failed",
                error: message,
                result: { reason: message },
              });
              await notifyTerminal(runtime, context, settled, input);
              await commitTerminal(runtime, context, "failed", null, null);
              return;
            }
          }
          emitTasksChanged(resolveConversation(runtime.conversationId));
        }

        // 等待终态：1s 节拍轮询（runtime.sleep 拒绝即中止信号 → abort handler 接手）。
        // 进程面真相 = meta.pid 活性 + 日志 exit 行（spawnCommand 的 close 钩子写）；
        // watch 面 = intervalMs 节拍的 runCommandOnce + 条件求值。
        let uncapturedRetries = 0;
        for (;;) {
          try {
            const latest = readBgMeta(input.bgId, environment) ?? meta;
          if (isTerminalBgStatus(latest.status)) {
            // 外部控制（桌面 stop/门关 stopTask 同款）已先落终态。
            await notifyTerminal(runtime, context, latest, input);
            await commitTerminal(runtime, context, latest.status, latest.lastExitCode ?? null, latest.lastSignal ?? null);
            return;
          }
          if (input.kind === "watch") {
            if (latest.deadlineAt && runtime.now() >= latest.deadlineAt) {
              const settled = await settleMeta(runtime, context, latest, input, {
                status: "timed_out",
                result: { reason: "timeout" },
              });
              await notifyTerminal(runtime, context, settled, input);
              await commitTerminal(runtime, context, "timed_out", undefined, undefined);
              return;
            }
            const result = await runCommandOnce({
              command: latest.command,
              argv: latest.argv,
              shell: latest.shell,
              cwd: latest.cwd,
              env: latest.env,
            });
            appendWatchResult(latest.logPath, result);
            const withCheck = {
              ...latest,
              lastCheckedAt: Date.now(),
              lastExitCode: result.exitCode,
              lastSignal: result.signal,
              lastState: extractLastState(result),
            };
            writeBgMeta(withCheck, environment);
            if (latest.failureWhen && evaluateBackgroundCondition(latest.failureWhen, result).matched) {
              const settled = await settleMeta(runtime, context, withCheck, input, {
                status: "failed",
                result: { reason: "failure condition matched", matchedCondition: latest.failureWhen, exitCode: result.exitCode, signal: result.signal },
              });
              await notifyTerminal(runtime, context, settled, input);
              await commitTerminal(runtime, context, "failed", result.exitCode, result.signal);
              return;
            }
            if (latest.successWhen && evaluateBackgroundCondition(latest.successWhen, result).matched) {
              const settled = await settleMeta(runtime, context, withCheck, input, {
                status: "succeeded",
                result: { reason: "success condition matched", matchedCondition: latest.successWhen, exitCode: result.exitCode, signal: result.signal },
              });
              await notifyTerminal(runtime, context, settled, input);
              await commitTerminal(runtime, context, "succeeded", result.exitCode, result.signal);
              return;
            }
            await runtime.sleep(runtime.now() + (latest.intervalMs ?? 30000), context);
            continue;
          }
          // process：超时 → 杀进程组 + timed_out。
          if (latest.deadlineAt && runtime.now() >= latest.deadlineAt) {
            if (latest.pid) {
              try {
                stopProcessGroup(latest.pid, latest.pgid);
              } catch {
                // 兜底：进程可能已退出。
              }
            }
            const settled = await settleMeta(runtime, context, latest, input, {
              status: "timed_out",
              result: { reason: "timeout" },
            });
            await notifyTerminal(runtime, context, settled, input);
            await commitTerminal(runtime, context, "timed_out", undefined, undefined);
            return;
          }
          const exit = parseExitLine(readPiBackgroundTaskLog(latest.logPath, 0).text || "");
          if (exit) {
            const status = exit.exitCode === 0 ? "succeeded" : "failed";
            const settled = await settleMeta(runtime, context, latest, input, {
              status,
              lastExitCode: exit.exitCode,
              lastSignal: exit.signal,
              result: { exitCode: exit.exitCode, signal: exit.signal },
            });
            await notifyTerminal(runtime, context, settled, input);
            await commitTerminal(runtime, context, status, exit.exitCode, exit.signal);
            return;
          }
          if (latest.pid && !processExists(latest.pid)) {
            uncapturedRetries += 1;
            if (uncapturedRetries >= 3) {
              const settled = await settleMeta(runtime, context, latest, input, {
                status: "failed",
                error: "process is no longer alive; exit result was not captured by this pi session",
                result: { reason: "process is no longer alive; exit result was not captured by this pi session" },
              });
              await notifyTerminal(runtime, context, settled, input);
              await commitTerminal(runtime, context, "failed", null, null);
              return;
            }
          } else {
            uncapturedRetries = 0;
          }
          await runtime.sleep(runtime.now() + 1000, context);
          } catch (error) {
            // 中止信号（abortTask/引擎关闭）原样上抛——abort handler 接手终态；
            // 其余错误（执行面失败）按门关 pollWatch 语义落 failed 终态。
            if (context.abortSignal?.aborted || runtime.signal.aborted) throw error;
            const message = error instanceof Error ? error.message : String(error);
            const latest = readBgMeta(input.bgId, environment) ?? meta;
            const settled = await settleMeta(runtime, context, latest, input, {
              status: "failed",
              error: message,
              result: { reason: message },
            });
            await notifyTerminal(runtime, context, settled, input);
            await commitTerminal(runtime, context, "failed", null, null);
          }
        }
      },
    },
    abort: async (task, runtime, context) => {
      const input = task.input;
      const latest = readBgMeta(input.bgId, environment);
      if (latest && !isTerminalBgStatus(latest.status) && latest.pid) {
        try {
          stopProcessGroup(latest.pid, latest.pgid);
        } catch {
          // 进程可能已退出。
        }
      }
      if (latest && !isTerminalBgStatus(latest.status)) {
        latest.status = "cancelled";
        latest.endedAt = Date.now();
        latest.stopRequestedAt = latest.endedAt;
        latest.result = { reason: "cancelled" };
        writeBgMeta(latest, environment);
        emitTasksChanged(resolveConversation(runtime.conversationId));
      }
      await runtime.commit(() => ({
        status: "terminal",
        outcome: {
          status: "aborted",
          reason: "stopped",
          result: { status: "cancelled", exitCode: null, signal: null, stopped: true },
        },
      }), context);
    },
  });
}

// ---------- 控制面：durable 真相读取 + 停止 ----------

/** 会话的全部 bg anchor 记录（scanTasks 按 kind；newest 在后——按 startedAt 排序）。 */
async function scanBgAnchorTasks(api, context) {
  const page = await api.commit(
    tx => tx.scanTasks({ conversationId: api.conversationId, kind: MILKSU_BACKGROUND_ANCHOR_KIND }, 64),
    context,
  );
  const records = [...(page?.items ?? [])];
  records.sort((left, right) => (
    Number(right.input?.startedAt ?? 0) - Number(left.input?.startedAt ?? 0)
  ));
  return records;
}

function matchBgAnchor(records, id) {
  const needle = String(id ?? "").trim();
  if (!needle) return undefined;
  const direct = records.find(record => String(record.input?.bgId ?? "") === needle);
  if (direct) return direct;
  const byPrefix = records.filter(record => String(record.input?.bgId ?? "").startsWith(needle));
  if (byPrefix.length === 1) return byPrefix[0];
  return undefined;
}

/**
 * 收场一个 bg anchor：abortTask（abort handler 杀进程组 + meta cancelled）后有界
 * 轮询到终态（C2 stopHarnessAsyncRun 的简化版：无 child 会话子树）。
 */
export async function stopHarnessBackgroundTask(handle, anchorTaskId) {
  if (!handle?.harness || !Number.isInteger(anchorTaskId)) return "not-found";
  let outcome = "marked";
  try {
    outcome = await handle.harness.abortTask(anchorTaskId, BACKGROUND_CONTEXT);
  } catch {
    outcome = "terminal";
  }
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const record = await handle.harness.getTask(anchorTaskId, BACKGROUND_CONTEXT);
      if (record?.state?.status === "terminal") break;
    } catch {
      break;
    }
    if (Date.now() > deadline) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return outcome;
}

// ---------- 工具参数与描述（tools.ts 同源） ----------

const ConditionSchema = Type.Union([
  Type.Object({ type: Type.Literal("exit_code"), equals: Type.Number() }),
  Type.Object({ type: Type.Literal("stdout_contains"), value: Type.String() }),
  Type.Object({ type: Type.Literal("stderr_contains"), value: Type.String() }),
  Type.Object({ type: Type.Literal("json_path_equals"), path: Type.String(), value: Type.Any() }),
  Type.Object({ type: Type.Literal("json_path_exists"), path: Type.String() }),
]);

const CommandFields = {
  name: Type.Optional(Type.String({ description: "Human-readable task label." })),
  command: Type.Optional(Type.String({ description: "Shell command to run. Required unless shell:false with argv is used." })),
  argv: Type.Optional(Type.Array(Type.String(), { description: "Argument vector. Use with shell:false to avoid shell parsing." })),
  shell: Type.Optional(Type.Boolean({ description: "Run command through the package's bash-compatible shell. Default true." })),
  cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the session workspace." })),
  env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Extra environment variables." })),
  max_log_bytes: Type.Optional(Type.Number({ description: "Maximum retained raw-log bytes. Default 4 MiB." })),
  callback: Type.Optional(Type.Boolean({ description: "Queue a follow-up when the task reaches a terminal state. Default true." })),
  timeout_seconds: Type.Optional(Type.Number({ description: "Optional timeout in seconds. Command watchers default to 900 seconds when omitted; pass 0 to disable. Spawned processes have no default timeout." })),
};

const bgTaskParameters = Type.Object({
  action: Type.Union([
    Type.Literal("spawn"),
    Type.Literal("watch"),
    Type.Literal("list"),
    Type.Literal("status"),
    Type.Literal("log"),
    Type.Literal("stop"),
    Type.Literal("clear"),
  ]),
  id: Type.Optional(Type.String()),
  status: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
  tail_lines: Type.Optional(Type.Number()),
  verbose: Type.Optional(Type.Boolean()),
  ...CommandFields,
  interval_seconds: Type.Optional(Type.Number()),
  success_when: Type.Optional(ConditionSchema),
  failure_when: Type.Optional(ConditionSchema),
});

const bgStatusParameters = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("status"),
    Type.Literal("log"),
    Type.Literal("stop"),
    Type.Literal("clear"),
  ]),
  id: Type.Optional(Type.String()),
  status: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
  tail_lines: Type.Optional(Type.Number()),
  verbose: Type.Optional(Type.Boolean()),
});

const BG_TASK_DESCRIPTION = [
  "Action wrapper for background tasks: spawn, watch, list, status, log, stop, or clear. Spawn/watch return immediately; do not poll in foreground.",
  "For action:status, default compact output and use verbose:true only for full metadata. For action:log, default compact tail and use tail_lines:0 only for explicit full logs.",
  "A follow-up message wakes this session when a spawned task reaches a terminal state, so never sleep or poll waiting for one.",
].join(" ");

const BG_STATUS_DESCRIPTION = [
  "Action wrapper for inspecting background tasks: list, status, log, stop, or clear. Nonblocking. Status is compact by default; log returns a compact tail by default. Use verbose:true or tail_lines:0 only for explicit full-data recovery.",
].join(" ");

// ---------- 扩展构造 ----------

/**
 * 构造门开路径的后台任务扩展。context（来自 harness-bridge-session 的会话层）：
 *   resolveConversation  durable conversationId → MilkSU conversationId（别名）
 *   getPolicy            alias → 会话策略（缺省 cwd = policy.workspace）
 *   getHarnessHandle     () → 适配层 handle（stop 的 abortTask 面）
 *   emitTasksChanged     alias → 桌面 background_tasks 投影重发（工具执行后调用）
 *   environment          进程环境（MILKSU_BACKGROUND_TASKS_DIR 解析）
 */
export function createMilksuBackgroundTasksExtension(context) {
  const required = ["resolveConversation", "getPolicy", "getHarnessHandle", "emitTasksChanged"];
  for (const name of required) {
    if (!context || typeof context[name] !== "function") {
      throw new TypeError(`createMilksuBackgroundTasksExtension requires ${name}`);
    }
  }
  const {
    resolveConversation,
    getPolicy,
    getHarnessHandle,
    emitTasksChanged,
    environment = process.env,
  } = context;
  const anchorTask = createBackgroundAnchorTask({
    resolveConversation,
    emitTasksChanged,
    environment,
  });

  async function prepareAnchor(args, api, context, kind) {
    const alias = resolveConversation(api.conversationId);
    const policy = getPolicy(alias);
    const spec = {
      command: typeof args.command === "string" ? args.command : undefined,
      argv: Array.isArray(args.argv) ? args.argv : undefined,
      shell: args.shell !== false,
    };
    validateCommandSpec(spec);
    if (typeof spec.command === "string" && spec.command.includes("\u0000")) {
      throw new Error("background task command contains an invalid null byte");
    }
    if (typeof spec.command === "string" && spec.command.length > 16_000) {
      throw new Error("background task command must be at most 16000 characters");
    }
    // runId 幂等：同一次工具调用（崩溃重跑）拿到同一 bgId；anchor 按 bgId 找回。
    const bgId = await api.memo("milksu-bg-task-id", nextBgId(), context);
    const existing = (await scanBgAnchorTasks(api, context))
      .find(record => String(record.input?.bgId ?? "") === bgId);
    const input = {
      bgId,
      toolCallId: api.callId,
      kind,
      command: spec.command,
      argv: spec.argv,
      shell: spec.shell,
      cwd: String(args.cwd ?? policy?.workspace ?? process.cwd()),
      env: args.env && typeof args.env === "object" ? args.env : undefined,
      name: typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 200) : undefined,
      callback: args.callback !== false,
      timeoutSeconds: Number(args.timeout_seconds ?? (kind === "watch" ? 900 : 0)) || 0,
      startedAt: Date.now(),
      ...(kind === "watch" ? {
        intervalSeconds: Number(args.interval_seconds ?? 30) || 30,
        successWhen: args.success_when,
        failureWhen: args.failure_when,
      } : {}),
    };
    if (existing) return { input: existing.input, anchorRecord: existing, reused: true, alias };
    const anchorId = await api.createTask(anchorTask, input, {
      ownership: { kind: "conversation" },
      background: true,
    }, context);
    const record = await api.getTask(anchorId, context);
    return { input, anchorRecord: record, reused: false, alias, anchorId };
  }

  async function runBackgroundAction(args, api, context, capabilities) {
    const action = String(args.action ?? "").trim();
    const alias = resolveConversation(api.conversationId);
    if (action === "spawn" || action === "watch") {
      if (!capabilities.spawn) return `Unknown action: ${action}`;
      if (action === "watch" && !args.success_when) {
        return "Invalid parameters: watch requires success_when.";
      }
      const { input, reused, alias: owner } = await prepareAnchor(args, api, context, action === "watch" ? "watch" : "process");
      emitTasksChanged(owner);
      const receipt = formatBgLaunch(input, environment);
      return reused ? `${receipt}\n(replayed task handle)` : receipt;
    }
    if (action === "list") {
      const records = await scanBgAnchorTasks(api, context);
      return formatBgList(records, args.limit);
    }
    if (action === "status") {
      if (!args.id) return "Invalid parameters: status requires id.";
      const records = await scanBgAnchorTasks(api, context);
      const record = matchBgAnchor(records, args.id);
      if (!record) return `No background task found for id ${args.id}.`;
      return formatBgStatus(record);
    }
    if (action === "log") {
      if (!args.id) return "Invalid parameters: log requires id.";
      const records = await scanBgAnchorTasks(api, context);
      const record = matchBgAnchor(records, args.id);
      if (!record) return `No background task found for id ${args.id}.`;
      return formatBgLog(String(record.input?.bgId ?? args.id), args.tail_lines, environment);
    }
    if (action === "stop") {
      if (!args.id) return "Invalid parameters: stop requires id.";
      const records = await scanBgAnchorTasks(api, context);
      const record = matchBgAnchor(records, args.id);
      if (!record) return `No background task found for id ${args.id}.`;
      if (!anchorBgLive(record)) {
        return `Background task ${record.input?.bgId} already finished (${anchorBgStatus(record)}); nothing to stop.`;
      }
      const handle = await Promise.resolve(getHarnessHandle()).catch(() => undefined);
      await stopHarnessBackgroundTask(handle, record.id);
      emitTasksChanged(alias);
      return `Background task ${record.input?.bgId} is cancelled.`;
    }
    if (action === "clear") {
      const records = await scanBgAnchorTasks(api, context);
      const wanted = Array.isArray(args.status) && args.status.length > 0
        ? new Set(args.status.map(value => String(value)))
        : undefined;
      let cleared = 0;
      for (const record of records) {
        const meta = readBgMeta(String(record.input?.bgId ?? ""), environment);
        if (!meta || meta.dismissedAt !== undefined) continue;
        const status = isTerminalBgStatus(meta.status) ? meta.status : anchorBgStatus(record);
        if (!isTerminalBgStatus(status)) continue;
        if (wanted && !wanted.has(status)) continue;
        meta.dismissedAt = Date.now();
        writeBgMeta(meta, environment);
        cleared += 1;
      }
      emitTasksChanged(alias);
      const statusLabel = wanted ? ` matching ${[...wanted].join(",")}` : "";
      return `Dismissed ${cleared} terminal background task${cleared === 1 ? "" : "s"}${statusLabel}.`;
    }
    return `Unknown action: ${action}`;
  }

  const bgTaskTool = defineTool({
    name: "bg_task",
    description: BG_TASK_DESCRIPTION,
    parameters: bgTaskParameters,
    replay: "safe",
    async execute(args, api, context) {
      const text = await runBackgroundAction(args, api, context, { spawn: true });
      return { content: [{ type: "text", text }] };
    },
  });

  const bgStatusTool = defineTool({
    name: "bg_status",
    description: BG_STATUS_DESCRIPTION,
    parameters: bgStatusParameters,
    replay: "safe",
    async execute(args, api, context) {
      const text = await runBackgroundAction(args, api, context, { spawn: false });
      return { content: [{ type: "text", text }] };
    },
  });

  return defineExtension({
    name: MILKSU_BACKGROUND_TASKS_EXTENSION,
    tools: [bgTaskTool, bgStatusTool],
    tasks: [anchorTask],
  });
}

// ---------- adoption：崩溃重开后的面重建 + 桌面 spawn 控制的 anchor 面 ----------

/**
 * createSession 收尾调用：按 durable 真相（scanTasks kind=milksu-background-task）
 * 恢复桌面 background_tasks 投影；有 anchor 时显式 harness.resume()（C2 同款定点
 * 例外：background anchor 的恢复不依赖任何后续进度类调用）。
 */
export async function adoptSessionBackgroundTasks({
  handle,
  durableConversationId,
  emitTasksChanged,
}) {
  if (!handle?.harness || !Number.isInteger(durableConversationId)) return 0;
  const page = await handle.harness.commit(
    tx => tx.scanTasks(
      { conversationId: durableConversationId, kind: MILKSU_BACKGROUND_ANCHOR_KIND },
      64,
    ),
    BACKGROUND_CONTEXT,
  );
  const records = [...(page?.items ?? [])];
  if (records.length > 0) handle.harness.resume();
  emitTasksChanged?.();
  return records.length;
}

/**
 * 桌面 spawn 控制（controlBackgroundTask 的 spawn 分支）的门开实现：直接建 anchor
 * （durable + bg_status 可见 + 桌面面板投影），callback:false（门关桌面 spawn 同款：
 * 用户在面板看输出，不打扰模型回合）。
 */
export async function spawnHarnessBackgroundTask({
  handle,
  durableConversationId,
  alias,
  commandText,
  name,
  cwd,
  environment = process.env,
}) {
  if (!handle?.harness || !Number.isInteger(durableConversationId)) {
    throw new Error("MilkSU harness runtime is unavailable");
  }
  const command = String(commandText ?? "").trim();
  if (!command) throw new Error("terminal command is required");
  if (command.includes("\u0000")) throw new Error("terminal command contains an invalid null byte");
  if (command.length > 16_000) throw new Error("terminal command must be at most 16000 characters");
  const anchorTask = createBackgroundAnchorTask({
    // 桌面 spawn 的 anchor 固定归属本会话别名（meta 的桌面面板过滤键）。
    resolveConversation: () => String(alias ?? ""),
    emitTasksChanged: () => undefined,
    environment,
  });
  const input = {
    bgId: nextBgId(),
    toolCallId: `desktop-${randomUUID()}`,
    kind: "process",
    command,
    shell: true,
    cwd: String(cwd || process.cwd()),
    name: name ? String(name).slice(0, 200) : undefined,
    callback: false,
    timeoutSeconds: 0,
    startedAt: Date.now(),
  };
  // 同步预写 running meta（门关桌面 spawn 的即时可见语义）：桌面面板投影立刻有行；
  // anchor 首跑见到无 pid 的 running meta 即接管执行面（见 anchor 的首跑分支）。
  writeBgMeta({
    id: input.bgId,
    name: input.name,
    kind: "process",
    status: "running",
    startedAt: input.startedAt,
    logPath: bgLogPath(input.bgId, environment),
    callback: false,
    callbackOrigin: { cwd: input.cwd, sessionId: String(alias ?? "") },
    command: input.command,
    shell: true,
    cwd: input.cwd,
    spawnPid: process.pid,
  }, environment);
  const anchorId = await handle.harness.commit(
    tx => tx.createTask(anchorTask, input, {
      // 原始 Harness 句柄的 Tx 无「当前会话」默认：显式指定 durable 会话。
      conversationId: durableConversationId,
      ownership: { kind: "conversation" },
      background: true,
    }),
    BACKGROUND_CONTEXT,
  );
  return { anchorId, bgId: input.bgId, logPath: bgLogPath(input.bgId, environment) };
}

/** 桌面 stop 控制的门开实现：按 bg id 找 anchor 并收场。 */
export async function stopHarnessBackgroundTaskById({
  handle,
  durableConversationId,
  taskId,
  environment = process.env,
}) {
  if (!handle?.harness || !Number.isInteger(durableConversationId)) {
    throw new Error("background task not found");
  }
  const page = await handle.harness.commit(
    tx => tx.scanTasks(
      { conversationId: durableConversationId, kind: MILKSU_BACKGROUND_ANCHOR_KIND },
      64,
    ),
    BACKGROUND_CONTEXT,
  );
  const needle = String(taskId ?? "").trim();
  const records = [...(page?.items ?? [])];
  const direct = records.find(candidate => String(candidate.input?.bgId ?? "") === needle);
  const byPrefix = direct
    ? []
    : records.filter(candidate => String(candidate.input?.bgId ?? "").startsWith(needle));
  const record = direct ?? (byPrefix.length === 1 ? byPrefix[0] : undefined);
  if (!record) throw new Error(`background task not found: ${needle}`);
  // 先落 meta cancelled（外部控制的终态先落盘，anchor 轮询见到即收敛），再收场 anchor。
  const meta = readBgMeta(needle, environment);
  if (meta && !isTerminalBgStatus(meta.status)) {
    if (meta.pid) {
      try {
        stopProcessGroup(meta.pid, meta.pgid);
      } catch {
        // 进程可能已退出。
      }
    }
    meta.status = "cancelled";
    meta.endedAt = Date.now();
    meta.stopRequestedAt = meta.endedAt;
    meta.result = { reason: "cancelled" };
    writeBgMeta(meta, environment);
  }
  await stopHarnessBackgroundTask(handle, record.id);
  const settled = await handle.harness.getTask(record.id, BACKGROUND_CONTEXT);
  return anchorBgStatus(settled);
}
