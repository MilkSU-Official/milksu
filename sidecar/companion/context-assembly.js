// Companion context assembly (issue #128 D2 / D4).
//
// The `context` extension replaces the entire message array each turn.
// Stable segments stay first so provider prompt cache can still hit.

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

export function stripCompanionCustomMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(message => !isCompanionCustomMessage(message));
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
  const sessionId = String(item?.sessionId ?? "").trim();
  const snippet = String(item?.snippet ?? item?.text ?? "").trim();
  if (sessionId && snippet) return `[${sessionId}] ${snippet}`;
  return snippet || sessionId;
}

function renderBoard(snapshot) {
  if (typeof snapshot === "string") return snapshot;
  try {
    return JSON.stringify(snapshot ?? { sessions: [], todos: [] });
  } catch {
    return "{\"sessions\":[],\"todos\":[]}";
  }
}

function truncateBoardSnapshot(snapshot, limit) {
  if (typeof snapshot === "string") {
    return { text: truncateToTokens(snapshot, limit), truncated: estimateTokens(snapshot) > limit };
  }
  const sessions = Array.isArray(snapshot?.sessions) ? [...snapshot.sessions] : [];
  const todos = Array.isArray(snapshot?.todos) ? [...snapshot.todos] : [];
  const next = { ...(snapshot && typeof snapshot === "object" ? snapshot : {}), sessions, todos };
  let text = renderBoard(next);
  if (estimateTokens(text) <= limit) {
    return { text, truncated: false, snapshot: next };
  }
  while ((sessions.length > 0 || todos.length > 0) && estimateTokens(text) > limit) {
    if (sessions.length >= todos.length && sessions.length > 0) sessions.shift();
    else if (todos.length > 0) todos.shift();
    else break;
    next.sessions = sessions;
    next.todos = todos;
    next.truncated = true;
    text = renderBoard(next);
  }
  if (estimateTokens(text) > limit) {
    text = truncateToTokens(text, limit);
  }
  return { text, truncated: true, snapshot: next };
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
  const recent = stripCompanionCustomMessages(recentMessages);
  const semantic = trimListByTokens(
    Array.isArray(semanticMemories) ? semanticMemories : [],
    ASSEMBLY_BUDGETS.semantic,
    renderMemory,
  );
  const recentBudgeted = [];
  let recentTokens = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const tokens = messageTokens(message);
    if (recentTokens + tokens > ASSEMBLY_BUDGETS.recent && recentBudgeted.length > 0) {
      break;
    }
    recentBudgeted.unshift(message);
    recentTokens += tokens;
  }

  const board = truncateBoardSnapshot(boardSnapshot, ASSEMBLY_BUDGETS.board);
  const episodic = trimListByTokens(
    Array.isArray(episodicRecalls) ? episodicRecalls : [],
    ASSEMBLY_BUDGETS.episodic,
    renderEpisodic,
  );

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

  messages.push(...recentBudgeted);
  segments.push({
    id: "recent",
    tokens: recentTokens,
    truncated: recentBudgeted.length < recent.length,
  });

  messages.push(createCustomMessage(COMPANION_CUSTOM_TYPES.board, board.text, {
    truncated: board.truncated,
  }));
  segments.push({
    id: "board",
    tokens: estimateTokens(board.text),
    truncated: board.truncated,
  });

  if (episodic.items.length > 0) {
    const text = episodic.items.map(item => item.text).join("\n\n");
    messages.push(createCustomMessage(COMPANION_CUSTOM_TYPES.episodic, text, {
      count: episodic.items.length,
      truncated: episodic.truncated,
    }));
    segments.push({ id: "episodic", tokens: episodic.tokens, truncated: episodic.truncated });
  } else {
    segments.push({ id: "episodic", tokens: 0, truncated: false });
  }

  let user = currentUserMessage;
  if (!user) {
    for (let index = recentBudgeted.length - 1; index >= 0; index -= 1) {
      if (recentBudgeted[index]?.role === "user") {
        user = recentBudgeted[index];
        break;
      }
    }
  }
  if (user && !recentBudgeted.includes(user) && !messages.includes(user)) {
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

export function handleSessionBeforeCompact() {
  return { cancel: true };
}
