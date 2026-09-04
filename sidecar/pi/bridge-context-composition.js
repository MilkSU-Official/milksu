// Honest context-composition estimate for Composer Context Usage.
//
// Totals stay on Provider billed prompt (input + cacheRead) when present.
// Category sizes come from the parts Pi actually assembled this turn, using
// Pi's chars/4 heuristic. This module never emits prompt text, keys, paths,
// or tool arguments.

import {
  estimateTokens as estimatePiMessageTokens,
  formatSkillsForPrompt,
} from "@earendil-works/pi-coding-agent";

export const CONTEXT_USAGE_CATEGORY_IDS = Object.freeze([
  "system",
  "tools",
  "skills",
  "mcp",
  "subagent",
  "conversation",
]);

const BUILTIN_TOOL_NAMES = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

const ESTIMATED_IMAGE_CHARS = 4800;

export function estimateTextTokens(text) {
  const chars = String(text ?? "").length;
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export function classifyToolCategory(name) {
  const toolName = String(name ?? "").trim();
  if (toolName === "subagent") return "subagent";
  if (BUILTIN_TOOL_NAMES.has(toolName)) return "tools";
  return "mcp";
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.floor(numeric), 1_000_000_000_000);
}

function toolDefinitionText(tool) {
  if (!tool || typeof tool !== "object") return "";
  try {
    return JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      promptGuidelines: tool.promptGuidelines,
    });
  } catch {
    return "";
  }
}

function skillList(skills) {
  if (typeof skills === "string") return skills;
  if (!skills) return "";
  const list = Array.isArray(skills) ? skills : skills.skills;
  if (!Array.isArray(list) || list.length === 0) return "";
  try {
    return formatSkillsForPrompt(list);
  } catch {
    return list
      .map(skill => `${skill?.name ?? ""}\n${skill?.description ?? ""}`)
      .join("\n");
  }
}

function contentChars(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) {
      chars += String(block.text).length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

function estimateMessageTokensFallback(message) {
  if (!message || typeof message !== "object") return 0;
  let chars = 0;
  switch (message.role) {
    case "user":
    case "custom":
    case "toolResult":
      chars = contentChars(message.content);
      break;
    case "assistant": {
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text") {
          chars += String(block.text ?? "").length;
        } else if (block.type === "thinking") {
          chars += String(block.thinking ?? "").length;
        } else if (block.type === "toolCall") {
          chars += String(block.name ?? "").length;
          try {
            chars += JSON.stringify(block.arguments ?? {}).length;
          } catch {
            // Keep the estimate bounded even if arguments are not serializable.
          }
        }
      }
      break;
    }
    case "bashExecution":
      chars = String(message.command ?? "").length + String(message.output ?? "").length;
      break;
    case "branchSummary":
    case "compactionSummary":
      chars = String(message.summary ?? "").length;
      break;
    default:
      return 0;
  }
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

function estimateMessageTokens(message) {
  if (typeof estimatePiMessageTokens === "function") {
    try {
      const tokens = estimatePiMessageTokens(message);
      if (Number.isFinite(tokens)) return Math.max(0, Math.ceil(tokens));
    } catch {
      // Fall back to the same chars/4 walk Pi uses.
    }
  }
  return estimateMessageTokensFallback(message);
}

function conversationTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateMessageTokens(message);
  }
  return tokens;
}

function scaleCategoriesToBilled(rawCategories, billedPromptTokens) {
  const positive = rawCategories.filter(category => category.tokens > 0);
  const rawSum = positive.reduce((sum, category) => sum + category.tokens, 0);
  if (!(billedPromptTokens > 0)) {
    return {
      estimatedTokens: rawSum,
      categories: positive,
    };
  }
  if (rawSum <= 0) {
    return {
      estimatedTokens: billedPromptTokens,
      categories: [],
    };
  }
  const shares = positive.map(category => {
    const exact = (category.tokens / rawSum) * billedPromptTokens;
    const tokens = Math.floor(exact);
    return { id: category.id, tokens, remainder: exact - tokens };
  });
  let leftover = billedPromptTokens - shares.reduce((sum, share) => sum + share.tokens, 0);
  const order = new Map(CONTEXT_USAGE_CATEGORY_IDS.map((id, index) => [id, index]));
  shares.sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder;
    return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
  });
  for (let index = 0; leftover > 0 && index < shares.length; index += 1) {
    shares[index].tokens += 1;
    leftover -= 1;
  }
  const byId = new Map(shares.map(share => [share.id, share.tokens]));
  return {
    estimatedTokens: billedPromptTokens,
    categories: CONTEXT_USAGE_CATEGORY_IDS
      .filter(id => (byId.get(id) ?? 0) > 0)
      .map(id => ({ id, tokens: byId.get(id) })),
  };
}

export function composeContextUsage({
  systemPrompt,
  tools,
  activeToolNames,
  skills,
  messages,
  billedPromptTokens,
  contextWindow,
} = {}) {
  const active = new Set(
    (Array.isArray(activeToolNames) ? activeToolNames : [])
      .map(name => String(name ?? "").trim())
      .filter(Boolean),
  );
  const tokens = {
    system: 0,
    tools: 0,
    skills: 0,
    mcp: 0,
    subagent: 0,
    conversation: 0,
  };

  const skillsText = skillList(skills);
  tokens.skills = estimateTextTokens(skillsText);

  const systemText = String(systemPrompt ?? "");
  tokens.system = estimateTextTokens(systemText);
  if (skillsText && systemText.includes(skillsText)) {
    tokens.system = Math.max(0, tokens.system - tokens.skills);
  }

  if (Array.isArray(tools)) {
    for (const tool of tools) {
      const name = String(tool?.name ?? "").trim();
      if (!name || !active.has(name)) continue;
      const definitionTokens = estimateTextTokens(toolDefinitionText(tool));
      tokens[classifyToolCategory(name)] += definitionTokens;
    }
  }

  tokens.conversation = conversationTokens(messages);

  const rawCategories = CONTEXT_USAGE_CATEGORY_IDS.map(id => ({
    id,
    tokens: tokens[id],
  }));
  const billed = nonNegativeInteger(billedPromptTokens);
  const scaled = scaleCategoriesToBilled(rawCategories, billed);
  return {
    estimatedTokens: scaled.estimatedTokens,
    contextWindow: nonNegativeInteger(contextWindow),
    categories: scaled.categories,
  };
}

export function projectSessionContextComposition(session, options = {}) {
  if (!session) return undefined;
  try {
    const skills = session.resourceLoader?.getSkills?.()?.skills ?? [];
    return composeContextUsage({
      systemPrompt: session.systemPrompt ?? "",
      tools: typeof session.getAllTools === "function" ? session.getAllTools() : [],
      activeToolNames: typeof session.getActiveToolNames === "function"
        ? session.getActiveToolNames()
        : [],
      skills,
      messages: Array.isArray(session.messages) ? session.messages : [],
      billedPromptTokens: options.billedPromptTokens,
      contextWindow: options.contextWindow ?? session.model?.contextWindow,
    });
  } catch {
    return undefined;
  }
}
