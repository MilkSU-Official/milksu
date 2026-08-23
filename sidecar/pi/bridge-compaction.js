// Manual Pi context compaction for a Coding conversation.
//
// This module only orchestrates the pinned @earendil-works/pi-coding-agent
// AgentSession.compact API and its compaction_start/compaction_end events. It
// does not invent a summarizer: the summary is produced by Pi with the fixed
// structured instruction below, and persisted by AgentSession itself into the
// session file (so it survives a Sidecar restart).
//
// The control action is bounded to an existing Pi session. CTF and Coding share
// the same Pi compact path: a busy session is passed through so Pi can abort
// then compact, matching TUI /compact. The summarization call is cancelled
// when it exceeds the timeout. Failures are surfaced as explicit errors
// instead of being reported as success.

export const DEFAULT_COMPACTION_TIMEOUT_MS = 120_000;
export const CONTEXT_COMPACTION_RATIO = 0.85;

export function contextUsageSnapshot(usage, contextWindow) {
  const input = Math.max(0, Number(usage?.inputTokens ?? 0))
    + Math.max(0, Number(usage?.cacheReadTokens ?? 0));
  const window = Math.max(0, Number(contextWindow ?? 0));
  const ratio = window > 0 ? input / window : 0;
  return {
    inputTokens: input,
    contextWindow: window,
    percent: window > 0 ? Math.min(100, Math.round(ratio * 100)) : 0,
    shouldCompact: window > 0 && ratio >= CONTEXT_COMPACTION_RATIO,
  };
}

// Fixed structured instruction. Kept in Chinese because the product surface is
// Chinese; the summarizer must retain every fact that changes later behaviour,
// including the file tracking that Pi's compaction details already record.
export const compactionInstructions = [
  "将本次 Coding 会话的上下文压缩为结构化摘要，保留所有会影响后续行为的事实。",
  "摘要必须覆盖：",
  "1. Goal：当前目标文本、状态与剩余子目标（如存在）。",
  "2. 约束：执行模式、审批策略、工作区边界、禁止事项与安全/合规要求。",
  "3. 已完成：已经完成并验证的事项清单，附关键证据位置。",
  "4. 进行中：尚未完成的工作、当前断点与未解决的问题。",
  "5. 关键决定：已经作出的关键设计与实现决定及其原因。",
  "6. 下一步：紧接着应执行的最小、可验证的下一步。",
  "7. 关键上下文：重要文件、命令、错误与发现；列出读取过的文件（read files）和修改过的文件（modified files）。",
  "8. 若为 CTF：保留题面、授权范围、材料路径、已验证观察、失败实验、候选 Flag 与证据位置；不要把整页 HTML/JS 原文抄进摘要。",
  "9. 若为 CVE 或实验室：保留选定目标、report.md 中的过程与观察、related.md 中已记录的公开 CVE ID；不要把整页 HTML/JS 或完整抓包抄进摘要。",
  "不要丢弃任何会改变后续行为的细节；保持精炼但完整。",
].join("\n");

/**
 * Register an in-flight compaction for a conversation and remove it when it
 * settles. Returns the tracked promise so callers can await the same object.
 * @param {Map<string, Promise<unknown>>} runs
 * @param {string} conversationId
 * @param {Promise<unknown>} run
 */
export function trackCompaction(runs, conversationId, run) {
  const tracked = run.finally(() => {
    if (runs.get(conversationId) === tracked) {
      runs.delete(conversationId);
    }
  });
  runs.set(conversationId, tracked);
  return tracked;
}

/**
 * Resolve once any in-flight compaction for the conversation has settled.
 * Used by the send_message path so a prompt never races a bounded compaction.
 * @param {Map<string, Promise<unknown>> | undefined} runs
 * @param {string} conversationId
 */
export async function waitForCompaction(runs, conversationId) {
  const inFlight = runs?.get(conversationId);
  if (inFlight) await inFlight;
}

/**
 * Project Pi's native compaction lifecycle event onto MilkSU's bounded wire
 * schema. The summary body deliberately never crosses the bridge.
 * @param {object} event
 * @param {string | undefined} requestId
 * @returns {{ type: string, data: object } | null}
 */
export function projectCompactionEvent(event, requestId) {
  if (event?.type === "compaction_start") {
    return {
      type: "compaction_start",
      data: {
        requestId,
        reason: event.reason,
      },
    };
  }
  if (event?.type !== "compaction_end") return null;
  const error = event.errorMessage
    ?? (event.aborted
      ? "Context compaction cancelled"
      : (event.result ? undefined : "Context compaction ended without a result"));
  return {
    type: "compaction_end",
    data: {
      requestId,
      reason: event.reason,
      aborted: Boolean(event.aborted),
      error,
      compaction: event.result
        ? {
            tokensBefore: event.result.tokensBefore,
            estimatedTokensAfter: event.result.estimatedTokensAfter,
          }
        : undefined,
    },
  };
}

function sessionStateProblem(session) {
  if (!session) return "Coding session is required";
  if (session.isCompacting) {
    return "Coding session is already compacting";
  }
  return "";
}

/**
 * Run a bounded manual compaction on an existing, idle session.
 * @param {import("@earendil-works/pi-coding-agent").AgentSession} session
 * @param {{ timeoutMs?: number, instructions?: string }} [options]
 * @returns {Promise<{ tokensBefore: number, estimatedTokensAfter?: number }>}
 */
export async function compactSession(session, options = {}) {
  const problem = sessionStateProblem(session);
  if (problem) throw new Error(problem);
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPACTION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("compaction timeout must be positive");
  }
  const instructions = options.instructions ?? compactionInstructions;
  let timer;
  try {
    const result = await Promise.race([
      session.compact(instructions),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            session.abortCompaction?.();
          } catch {
            // The summarization may already have ended; cancellation is best effort.
          }
          reject(new Error(
            "Context compaction timed out and was cancelled",
          ));
        }, timeoutMs);
      }),
    ]);
    return {
      tokensBefore: result?.tokensBefore,
      estimatedTokensAfter: result?.estimatedTokensAfter,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
