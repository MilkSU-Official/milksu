import { assistantVisibleText } from "./reply-review.js";

export const MEMORY_EXTRACT_MODES = Object.freeze(["off", "turn", "idle"]);
export const MEMORY_EXTRACT_IDLE_MINUTES = Object.freeze([5, 10, 15, 30, 60]);
export const MEMORY_EXTRACT_TURN_LIMIT = 1;
export const MEMORY_EXTRACT_IDLE_LIMIT = 3;

export function normalizeMemoryExtract(value) {
  const mode = String(value ?? "").trim();
  return MEMORY_EXTRACT_MODES.includes(mode) ? mode : "turn";
}

export function normalizeMemoryExtractIdleMinutes(value) {
  const minutes = Number(value);
  return MEMORY_EXTRACT_IDLE_MINUTES.includes(minutes) ? minutes : 10;
}

export function memoryExtractInstructions(locale, maxItems) {
  const limit = clampExtractLimit(maxItems);
  if (locale === "en") {
    return [
      "Extract durable user memory from this stretch.",
      "Keep only a stable preference, a form of address, or a standing constraint.",
      "Write each conclusion as an affirmative sentence.",
      "evidence must be a contiguous quote copied from the user text.",
      "If the stretch is a greeting, small talk, or task coordination, return no items.",
      "If an existing memory already says it, use skip.",
      "If the user changed an existing memory, update that id.",
      `Return at most ${limit} items.`,
      'Return JSON only: {"items":[{"action":"create|update|skip","existingId":"","title":"","markdown":"","evidence":""}]}',
    ].join(" ");
  }
  return [
    "从这一段对话里提取可以长期记住的用户事实。",
    "只保留稳定偏好、称呼或长期约束。",
    "结论写成肯定句。",
    "evidence 必须是用户原话里连续抄下来的一段。",
    "打招呼、闲聊或纯编排就返回空列表。",
    "已有记忆已经表达同一事实就用 skip。",
    "用户改口了就更新那一条的 id。",
    `最多 ${limit} 条。`,
    '只返回 JSON：{"items":[{"action":"create|update|skip","existingId":"","title":"","markdown":"","evidence":""}]}',
  ].join(" ");
}

function clampExtractLimit(maxItems) {
  const limit = Number(maxItems);
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(MEMORY_EXTRACT_IDLE_LIMIT, Math.floor(limit));
}

function parseJSONObject(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseMemoryExtractResult(text, { userText = "", memories = [], maxItems = 1 } = {}) {
  const parsed = parseJSONObject(text);
  const rows = Array.isArray(parsed?.items) ? parsed.items : [];
  const known = new Set(
    (Array.isArray(memories) ? memories : [])
      .map(item => String(item?.id ?? "").trim())
      .filter(Boolean),
  );
  const source = String(userText ?? "");
  const limit = clampExtractLimit(maxItems);
  const items = [];
  for (const row of rows) {
    if (items.length >= limit) break;
    if (!row || typeof row !== "object") continue;
    const action = String(row.action ?? "").trim();
    const title = String(row.title ?? "").trim();
    const markdown = String(row.markdown ?? "").trim();
    const evidence = String(row.evidence ?? "").trim();
    const existingId = String(row.existingId ?? row.existing_id ?? "").trim();
    if (!title || !markdown || !evidence || !source.includes(evidence)) continue;
    if (action === "update") {
      if (!known.has(existingId)) continue;
      items.push({ action, existingId, title, markdown, evidence });
      continue;
    }
    if (action === "create") {
      items.push({ action: "create", existingId: "", title, markdown, evidence });
    }
  }
  return items;
}

export async function extractCompanionMemories({
  userText,
  assistantText = "",
  memories = [],
  locale,
  maxItems = 1,
  complete,
} = {}) {
  const source = String(userText ?? "").trim();
  if (!source || typeof complete !== "function") return [];
  const language = locale === "en" ? "en" : "zh";
  const limit = clampExtractLimit(maxItems);
  const known = (Array.isArray(memories) ? memories : []).map(item => {
    const id = String(item?.id ?? "").trim();
    const title = String(item?.title ?? "").trim();
    const markdown = String(item?.markdown ?? "").trim();
    if (!id || (!title && !markdown)) return "";
    return `id: ${id}\n${title}\n${markdown}`;
  }).filter(Boolean);
  const body = language === "en"
    ? `User text:\n${source}\n\nAssistant reply:\n${assistantText}\n\nExisting memories:\n${known.join("\n\n") || "(none)"}`
    : `用户原话：\n${source}\n\n助手回复：\n${assistantText}\n\n已有记忆：\n${known.join("\n\n") || "（无）"}`;
  const message = await complete({
    systemPrompt: memoryExtractInstructions(language, limit),
    messages: [{
      role: "user",
      content: [{ type: "text", text: body }],
      timestamp: Date.now(),
    }],
  });
  if (message?.stopReason === "error" || message?.stopReason === "aborted") {
    throw new Error("companion memory extract failed");
  }
  return parseMemoryExtractResult(assistantVisibleText(message), {
    userText: source,
    memories,
    maxItems: limit,
  });
}

export function createMemoryExtractController({ extract, setTimer, clearTimer } = {}) {
  let mode = "turn";
  let idleMs = 10 * 60 * 1000;
  let stretch = [];
  let retry = null;
  let timer = null;
  let generation = 0;

  function cancelTimer() {
    generation += 1;
    if (timer != null && typeof clearTimer === "function") clearTimer(timer);
    timer = null;
  }

  function armIdle() {
    cancelTimer();
    if (mode !== "idle" || stretch.length === 0 || typeof setTimer !== "function") return;
    const ticket = generation;
    timer = setTimer(async () => {
      if (ticket !== generation) return;
      timer = null;
      const batch = stretch;
      stretch = [];
      const failed = retry;
      retry = null;
      if (failed) await run(failed, true);
      await run({ stretch: batch, maxItems: MEMORY_EXTRACT_IDLE_LIMIT }, false);
    }, idleMs);
  }

  async function run(job, isRetry) {
    if (!job?.stretch?.length || typeof extract !== "function") return;
    try {
      await extract(job);
    } catch {
      if (!isRetry) retry = job;
    }
  }

  return {
    configure(next = {}) {
      const nextMode = next.mode == null ? mode : normalizeMemoryExtract(next.mode);
      const nextMinutes = next.idleMinutes == null
        ? idleMs / 60000
        : normalizeMemoryExtractIdleMinutes(next.idleMinutes);
      const nextIdleMs = nextMinutes * 60 * 1000;
      const modeChanged = nextMode !== mode;
      const idleChanged = nextIdleMs !== idleMs;
      mode = nextMode;
      idleMs = nextIdleMs;
      if (mode !== "idle") {
        cancelTimer();
        if (modeChanged) stretch = [];
      } else if (idleChanged && stretch.length) {
        armIdle();
      }
      if (mode === "off") {
        stretch = [];
        retry = null;
      }
    },

    beginTurn() {
      cancelTimer();
    },

    async finishTurn({ userText = "", assistantText = "", aborted = false } = {}) {
      if (mode === "off") return;
      if (aborted) {
        if (mode === "idle" && stretch.length) armIdle();
        return;
      }
      const user = String(userText ?? "").trim();
      if (!user) {
        if (mode === "idle" && stretch.length) armIdle();
        return;
      }
      const turn = { user, assistant: String(assistantText ?? "").trim() };
      if (mode === "turn") {
        const failed = retry;
        retry = null;
        if (failed) await run(failed, true);
        await run({ stretch: [turn], maxItems: MEMORY_EXTRACT_TURN_LIMIT }, false);
        return;
      }
      stretch.push(turn);
      armIdle();
    },
  };
}
