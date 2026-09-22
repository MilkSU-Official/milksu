// Companion context assembly (issue #128 D2 / D4).
//
// Pi keeps this session's transcript and compacts it. The `context` hook only
// clones messages for the provider request (pi-coding-agent 0.84.1
// runner.emitContext + agent-loop transformContext); it does not write them
// back onto the session. Obelisk is long-term memory beside that transcript,
// not a second copy and not a dump of every note:
// - approved semantic memories
// - episodic hits already limited by the search API for this user message
// Board run-state stays on companion_board.
// Do not cut the transcript by turn count or time gap.
//
// session_before_compact { cancel: true } aborts both manual compact and
// _runAutoCompaction in agent-session.js. Nothing in that path still requires
// cancel, so this module does not cancel Pi compaction.
// Stable memory stays ahead of the transcript so a provider prompt cache can hit.

export const COMPANION_CUSTOM_TYPES = Object.freeze({
  semantic: "companion.semantic",
  board: "companion.board",
  episodic: "companion.episodic",
});

export const ASSEMBLY_SEGMENTS = Object.freeze([
  "system",
  "semantic",
  "recent",
  "board",
  "episodic",
  "user",
]);

// semantic / episodic bound Obelisk text already retrieved for this turn.
// recent and board are not a transcript window or a board preload: Pi compaction
// owns the session, and run-state stays on companion_board.
export const ASSEMBLY_BUDGETS = Object.freeze({
  system: 4_000,
  semantic: 8_000,
  recent: 100_000,
  board: 4_000,
  episodic: 16_000,
});

const COMPANION_CUSTOM_TYPE_SET = new Set(Object.values(COMPANION_CUSTOM_TYPES));

export function estimateTokens(value) {
  const text = typeof value === "string" ? value : stringifyContent(value);
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function stringifyContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (typeof block.text === "string") text += block.text;
    else if (typeof block.thinking === "string") text += block.thinking;
    else if (block.type === "toolCall") {
      text += String(block.name ?? "");
      try {
        text += JSON.stringify(block.arguments ?? {});
      } catch {
        // Bound the estimate if arguments are not serializable.
      }
    }
  }
  return text;
}

export function messageTokens(message) {
  if (!message || typeof message !== "object") return 0;
  switch (message.role) {
    case "user":
    case "custom":
    case "toolResult":
      return estimateTokens(message.content);
    case "assistant":
      return estimateTokens(message.content);
    case "compactionSummary":
    case "branchSummary":
      return estimateTokens(message.summary);
    default:
      return estimateTokens(stringifyContent(message.content ?? message.text ?? ""));
  }
}

export function isCompanionCustomMessage(message) {
  return message?.role === "custom"
    && COMPANION_CUSTOM_TYPE_SET.has(String(message.customType ?? ""));
}

function assistantHasModelWork(message) {
  if (message?.role !== "assistant") return false;
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some(block => {
    if (String(block?.text ?? "").trim()) return true;
    if (block?.type === "toolCall" && String(block?.id ?? block?.name ?? "").trim()) return true;
    if (block?.type === "thinking" && String(block?.thinking ?? "").trim()) return true;
    return false;
  });
}

function isEmptyAssistantMessage(message) {
  return message?.role === "assistant" && !assistantHasModelWork(message);
}

function toolCallIdsFromAssistant(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter(block => block?.type === "toolCall")
    .map(block => String(block.id ?? "").trim())
    .filter(Boolean);
}

export function stripCompanionCustomMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const kept = [];
  let pendingToolCallIds = new Set();
  let pendingToolMeta = new Map();
  for (const message of messages) {
    if (isCompanionCustomMessage(message)) continue;
    if (isEmptyAssistantMessage(message)) {
      dropImagesFromPreviousUser(kept);
      // Empty/aborted assistant after toolCalls would orphan those calls for the
      // provider — close them with synthetic error results instead of dropping.
      for (const [id, name] of pendingToolMeta) {
        kept.push({
          role: "toolResult",
          toolCallId: id,
          toolName: name,
          content: [{ type: "text", text: "companion tool interrupted" }],
          details: { repaired: true },
          isError: true,
          timestamp: Date.now(),
        });
      }
      pendingToolCallIds = new Set();
      pendingToolMeta = new Map();
      continue;
    }
    if (message?.role === "toolResult") {
      const id = String(message.toolCallId ?? "").trim();
      if (!id || !pendingToolCallIds.has(id)) continue;
      kept.push(message);
      pendingToolCallIds.delete(id);
      pendingToolMeta.delete(id);
      continue;
    }
    if (message?.role === "assistant") {
      const calls = toolCallIdsFromAssistant(message);
      pendingToolCallIds = new Set(calls);
      pendingToolMeta = new Map();
      for (const id of calls) {
        const block = Array.isArray(message.content)
          ? message.content.find(item => item?.type === "toolCall" && String(item.id ?? "").trim() === id)
          : null;
        pendingToolMeta.set(id, String(block?.name ?? "tool").trim() || "tool");
      }
    } else if (message?.role === "user" && pendingToolCallIds.size > 0) {
      for (const [id, name] of pendingToolMeta) {
        kept.push({
          role: "toolResult",
          toolCallId: id,
          toolName: name,
          content: [{ type: "text", text: "companion tool interrupted" }],
          details: { repaired: true },
          isError: true,
          timestamp: Date.now(),
        });
      }
      pendingToolCallIds = new Set();
      pendingToolMeta = new Map();
      kept.push(message);
      continue;
    } else {
      pendingToolCallIds = new Set();
      pendingToolMeta = new Map();
    }
    kept.push(message);
  }
  if (pendingToolCallIds.size > 0) {
    for (const [id, name] of pendingToolMeta) {
      kept.push({
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        content: [{ type: "text", text: "companion tool interrupted" }],
        details: { repaired: true },
        isError: true,
        timestamp: Date.now(),
      });
    }
  }
  return kept;
}

function dropImagesFromPreviousUser(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (!Array.isArray(message.content)) return;
    const content = message.content.filter(block => block?.type !== "image");
    if (content.length === message.content.length) return;
    messages[index] = { ...message, content };
    return;
  }
}

function createCustomMessage(customType, text, details) {
  return {
    role: "custom",
    customType,
    content: [{ type: "text", text }],
    display: false,
    details: details ?? {},
    timestamp: new Date().toISOString(),
  };
}

function trimListByTokens(items, limit, render) {
  const kept = [];
  let used = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const text = render(item);
    const tokens = estimateTokens(text);
    if (used + tokens > limit && kept.length > 0) break;
    if (used + tokens > limit && kept.length === 0) {
      kept.unshift({ item, text: truncateToTokens(text, limit) });
      used = limit;
      break;
    }
    kept.unshift({ item, text });
    used += tokens;
  }
  return { items: kept, tokens: used, truncated: kept.length < items.length };
}

function truncateToTokens(text, limit) {
  const maxChars = Math.max(0, limit * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…`;
}

function renderMemory(memory) {
  const title = String(memory?.title ?? "").trim();
  const body = String(memory?.markdown ?? memory?.text ?? "").trim();
  if (title && body) return `${title}\n${body}`;
  return title || body;
}

function renderEpisodic(item) {
  const title = String(item?.title ?? "").trim();
  const snippet = String(item?.snippet ?? item?.text ?? "").trim();
  const sessionId = String(item?.sessionId ?? "").trim();
  const lines = [];
  if (title) lines.push(title);
  if (snippet && snippet !== title) lines.push(snippet);
  if (!title && !snippet && sessionId) lines.push(sessionId);
  if (sessionId) lines.push(`conversationId: ${sessionId}`);
  return lines.join("\n");
}

export function formatBoardForModel(value) {
  const snapshot = value && typeof value === "object" && value.board && typeof value.board === "object"
    ? value.board
    : value;
  if (!snapshot || typeof snapshot !== "object") return "";
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : null;
  const todos = Array.isArray(snapshot.todos) ? snapshot.todos : null;
  if (!sessions && !todos) return "";
  const lines = [];
  for (const session of sessions ?? []) {
    const title = String(session?.title ?? "").trim();
    const id = String(session?.id ?? "").trim();
    const status = String(session?.status ?? session?.state ?? "").trim();
    const head = [title, status].filter(Boolean).join(" · ");
    if (head) lines.push(head);
    else if (id) lines.push(id);
    if (id) lines.push(`conversationId: ${id}`);
  }
  for (const todo of todos ?? []) {
    const title = String(todo?.title ?? "").trim();
    const id = String(todo?.id ?? "").trim();
    if (title) lines.push(title);
    if (id) lines.push(`id: ${id}`);
  }
  return lines.length ? lines.join("\n") : "empty";
}

export function composeSystemPrompt({ base = "", persona = "" } = {}) {
  const parts = [String(base ?? "").trim(), String(persona ?? "").trim()].filter(Boolean);
  const text = parts.join("\n\n");
  if (estimateTokens(text) <= ASSEMBLY_BUDGETS.system) {
    return { text, tokens: estimateTokens(text), truncated: false };
  }
  return {
    text: truncateToTokens(text, ASSEMBLY_BUDGETS.system),
    tokens: ASSEMBLY_BUDGETS.system,
    truncated: true,
  };
}

export function assembleCompanionMessages({
  semanticMemories = [],
  recentMessages = [],
  boardSnapshot = { sessions: [], todos: [] },
  episodicRecalls = [],
  currentUserMessage,
} = {}) {
  // Pi's own messages, including compaction summaries. No turn-count or time-gap cut.
  const transcript = stripCompanionCustomMessages(recentMessages);
  const episodic = trimListByTokens(
    Array.isArray(episodicRecalls) ? episodicRecalls : [],
    ASSEMBLY_BUDGETS.episodic,
    renderEpisodic,
  );
  const semantic = trimListByTokens(
    Array.isArray(semanticMemories) ? semanticMemories : [],
    ASSEMBLY_BUDGETS.semantic,
    renderMemory,
  );
  let recentTokens = 0;
  for (const message of transcript) {
    recentTokens += messageTokens(message);
  }

  const messages = [];
  const segments = [];

  if (semantic.items.length > 0) {
    const text = semantic.items.map(item => item.text).join("\n\n");
    messages.push(createCustomMessage(COMPANION_CUSTOM_TYPES.semantic, text, {
      count: semantic.items.length,
      truncated: semantic.truncated,
    }));
    segments.push({ id: "semantic", tokens: semantic.tokens, truncated: semantic.truncated });
  } else {
    segments.push({ id: "semantic", tokens: 0, truncated: false });
  }

  if (episodic.items.length > 0) {
    const text = episodic.items.map(item => item.text).join("\n\n");
    messages.push(createCustomMessage(COMPANION_CUSTOM_TYPES.episodic, text, {
      count: episodic.items.length,
      truncated: episodic.truncated,
    }));
  }

  messages.push(...transcript);
  segments.push({
    id: "recent",
    tokens: recentTokens,
    truncated: false,
  });

  // Board stays on companion_board. A greeting should not arrive with the task board already open.
  segments.push({
    id: "board",
    tokens: 0,
    truncated: false,
    injected: false,
    available: boardSnapshot != null,
  });
  segments.push({
    id: "episodic",
    tokens: episodic.tokens,
    truncated: episodic.truncated,
    injected: episodic.items.length > 0,
    available: episodic.items.length > 0,
  });

  let user = currentUserMessage;
  if (!user) {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index]?.role === "user") {
        user = transcript[index];
        break;
      }
    }
  }
  if (user && !transcript.includes(user) && !messages.includes(user)) {
    messages.push(user);
  }
  segments.push({
    id: "user",
    tokens: user ? messageTokens(user) : 0,
    truncated: false,
  });

  return {
    messages,
    segments,
    order: messages.map(message => (
      message.role === "custom" ? message.customType : message.role
    )),
  };
}
