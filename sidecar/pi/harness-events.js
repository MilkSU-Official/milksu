// pi-durable watchEvents → bridge 事件形状的纯函数投影器（PR-2 批次 A，最小版）。
//
// 输入：pi-durable 的 AgentEvent（harness/events.d.ts，coding-agent 风格事件流
// message_start/message_update/message_end/tool_execution_start/…，一批一提交）。
// 输出：bridge emit 的桌面事件形状（bridge.js session.subscribe 分支的同一族：
// text_delta/thinking_*/message_*/tool_call_*/usage_recorded/turn_*/error）。
//
// 纯函数：无 I/O、无进程全局；跨批状态（文本/思考累计、工具开始时间）只在本投影器实例内。
// 批次 A 不接入 bridge 会话主流程——批次 B 把 watchEvents(harness, id) 的批次喂给本投影器，
// 再经 bridge 的 emit 通道输出。届时 text_delta 的 ~60ms 合并（bridge queueTextDelta）与
// redact/formatToolInput/secrets 也在那一层接上。
//
// 映射表（pi-durable → bridge）：
//   run_start → turn_started（语义差：run = 一次提交批的整轮；bridge 的 turn 对应 Pi 的
//     agent_start/settled，桌面只看开始/收尾，投影为最接近的一对）
//   run_end → turn_settled
//   message_start → 无输出（重置本条消息的累计状态）
//   message_update.changes → thinking_start/thinking_delta/text_delta（pi-durable 无
//     thinking_end：thinking_done 在 message_end 由累计内容合成，见下）
//   message_end → thinking_done（若已流式）+ projectAssistantMessageEnd 的
//     message_segment_done/message_done/error + usage_recorded（复用 bridge-message-view /
//     bridge-usage-view，保证与现有桌面投影逐字段同形）
//   tool_execution_start → tool_call_start {toolCallId, toolName, content, module}
//   tool_execution_update → tool_call_progress（进度心跳；工具输出仍按现状只在结束时给）
//   tool_execution_end → tool_call_end {toolCallId, toolName, content, durationMs, isError, module}
//   task_failed → error（唯一失败可见面；auto_retry 的重试期间也可能触发，见 docs）
//   snapshot/inbox_update/submission/entry_appended/agent_changed/usage_changed/
//     compaction_*/auto_retry_*/deferred_poll/turn_* → 本版不投影（见模块尾部 NOTES）
//
// 已知取舍（批次 B/D 补齐）：
//   - inbox_update 不映射：pi-durable 的 QueuedItem 只有 {id, mode}，bridge queue_update 需要
//     消息文本；Q2 已定 pi.inbox Document 是唯一排队真相，UI 排队态应从 viewState 的
//     docs["pi.inbox"] 投影，而不是从事件猜。
//   - tool_call_start 的 content 用 JSON.stringify(args)：bridge 现状是 formatToolInput +
//     redactResearchText（bridge.js:1288/1837）。批次 B 接线时换用同一套格式化与脱敏。
//   - durationMs 优先用 pi.tool-result 消息里内核记录的单调时钟耗时（pi-durable 1.1.0 起，
//     interrupted/aborted 的调用没有该字段；旧版本写入的 entry 也没有），缺省时回退本投影器
//     记录的 start 时刻 wall-clock 差值；usage 的 provider/source 上下文由接线层
//     补（options.provider/options.source 透传给 projectAssistantUsage）。

import { projectAssistantMessageEnd } from "./bridge-message-view.js";
import { projectAssistantUsage } from "./bridge-usage-view.js";

/**
 * 工具耗时融合（pi-durable/pi-coding-agent 1.1.0）：内核在执行现场用单调时钟记录
 * execute() 的真实耗时，且随 entry 持久化（崩溃恢复/重载后仍在）；投影器的 wall-clock
 * 差值含事件传播延迟且只活在内存里。内核值可用时优先，缺省（工具未跑、中断、旧记录）
 * 回退 wall-clock 差值，两者都无则 undefined。
 */
export function toolExecutionDurationMs(recordedMs, startedAt) {
  const recorded = Number(recordedMs);
  if (Number.isFinite(recorded) && recorded >= 0) return recorded;
  return startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
}

function toolResultContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item?.type === "text")
    .map(item => item.text)
    .join("\n");
}

/**
 * 创建投影器实例。options：
 *   module: "coding" | "ctf"（usage/tool 事件的 module 字段，对齐 bridge usageModule）
 *   conversationId: usage_recorded 里 projectAssistantUsage 需要的会话 id
 *   provider / source: usage 归因（对齐 bridge sessionConfiguredProviders/sessionModelSources）
 */
export function createHarnessEventProjector(options = {}) {
  const module = options.module === "ctf" ? "ctf" : "coding";
  const conversationId = String(options.conversationId ?? "").trim();
  const provider = String(options.provider ?? "").trim() || undefined;
  const source = options.source === "account" || options.source === "personal"
    ? options.source
    : "";
  let textStreamed = false;
  let thinkingStreamed = false;
  let thinkingText = "";
  const toolStartedAt = new Map();

  function projectMessageEnd(event) {
    const message = event?.entry?.model?.[0];
    if (!message || message.role !== "assistant") return [];
    const events = [];
    // pi-durable 没有 thinking_end：已流式的思考在消息收尾时由累计内容合成 thinking_done，
    // 并把 thinkingStreamed 传给 projectAssistantMessageEnd 抑制它的第二份（对齐 bridge 在
    // thinking_end + message_end 两处的去重）；未流式的 thinking 由后者按消息内容补发。
    if (thinkingStreamed && thinkingText.trim()) {
      events.push({
        type: "thinking_done",
        data: { content: thinkingText },
      });
    }
    for (const projected of projectAssistantMessageEnd(message, {
      textStreamed: false,
      thinkingStreamed,
    })) {
      events.push(projected);
    }
    const usage = projectAssistantUsage(message, {
      conversationId,
      module,
      ...(provider ? { provider } : {}),
      ...(source ? { source } : {}),
    });
    if (usage) {
      events.push({ type: "usage_recorded", data: { usage, module } });
    }
    textStreamed = false;
    thinkingStreamed = false;
    thinkingText = "";
    return events;
  }

  function projectMessageUpdate(event) {
    const events = [];
    for (const change of Array.isArray(event?.changes) ? event.changes : []) {
      if (change?.type === "thinking_start") {
        thinkingStreamed = true;
        thinkingText = "";
        events.push({ type: "thinking_start", data: {} });
      } else if (change?.type === "thinking_delta") {
        thinkingStreamed = true;
        thinkingText += String(change.delta ?? "");
        events.push({ type: "thinking_delta", data: { delta: String(change.delta ?? "") } });
      } else if (change?.type === "text_delta") {
        textStreamed = true;
        events.push({ type: "text_delta", data: { delta: String(change.delta ?? "") } });
      }
      // text_start/toolcall_start/toolcall_delta/block/message：bridge 现状不流式这些面。
    }
    return events;
  }

  function projectToolStart(event) {
    toolStartedAt.set(event.toolCallId, Date.now());
    return [{
      type: "tool_call_start",
      data: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: JSON.stringify(event.args ?? {}),
        module,
      },
    }];
  }

  function projectToolEnd(event) {
    const startedAt = toolStartedAt.get(event.toolCallId);
    toolStartedAt.delete(event.toolCallId);
    const message = event?.entry?.model?.find(candidate => candidate?.role === "toolResult");
    return [{
      type: "tool_call_end",
      data: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: toolResultContent(message),
        durationMs: toolExecutionDurationMs(message?.durationMs, startedAt),
        isError: Boolean(message?.isError),
        module,
      },
    }];
  }

  function project(event) {
    if (!event || typeof event !== "object") return [];
    switch (event.type) {
      case "run_start":
        return [{ type: "turn_started", data: {} }];
      case "run_end":
        return [{ type: "turn_settled", data: {} }];
      case "message_start":
        textStreamed = false;
        thinkingStreamed = false;
        thinkingText = "";
        return [];
      case "message_update":
        return projectMessageUpdate(event);
      case "message_end":
        return projectMessageEnd(event);
      case "tool_execution_start":
        return projectToolStart(event);
      case "tool_execution_update":
        return [{
          type: "tool_call_progress",
          data: { toolCallId: event.toolCallId, toolName: event.toolName, module },
        }];
      case "tool_execution_end":
        return projectToolEnd(event);
      case "task_failed":
        return [{
          type: "error",
          data: { error: `Task ${event.kind} ${event.taskId} failed: ${event.message}` },
        }];
      default:
        return [];
    }
  }

  return {
    module,
    /** 单个 AgentEvent → bridge 事件数组（保持事件内次序）。 */
    project,
    /** 一个提交批（readonly AgentEvent[]）→ bridge 事件数组。 */
    projectBatch(batch) {
      const events = [];
      for (const event of Array.isArray(batch) ? batch : []) {
        events.push(...project(event));
      }
      return events;
    },
    /** 诊断：正在挂起的工具（批次 B 的悬挂检测可用）。 */
    pendingTools() {
      return [...toolStartedAt.keys()];
    },
  };
}
