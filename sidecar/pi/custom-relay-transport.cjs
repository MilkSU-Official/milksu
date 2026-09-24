"use strict";

// Custom relays are not one protocol. AxonHub / New API / One API expose
// Anthropic Messages on an /anthropic path and OpenAI chat completions elsewhere.
// Pi already speaks both, including upstream thinking. This only picks which
// one, and which thinking field that upstream actually returns.

function pathSegments(baseUrl) {
  const raw = String(baseUrl ?? "").trim();
  if (!raw) return [];
  try {
    return new URL(raw).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return raw.toLowerCase().split("/").filter(Boolean);
  }
}

function hostOf(baseUrl) {
  try {
    return new URL(String(baseUrl ?? "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const RELAY_APIS = new Set([
  "openai-completions",
  "anthropic-messages",
  "google-generative-ai",
]);

function customRelayApi(baseUrl, explicit) {
  const chosen = String(explicit ?? "").trim();
  if (RELAY_APIS.has(chosen)) return chosen;
  const host = hostOf(baseUrl);
  if (host === "api.anthropic.com" || host.endsWith(".anthropic.com")) return "anthropic-messages";
  if (host === "generativelanguage.googleapis.com") return "google-generative-ai";
  const segments = pathSegments(baseUrl);
  if (segments.includes("anthropic")) return "anthropic-messages";
  if (segments.includes("gemini") || segments.includes("google")) return "google-generative-ai";
  return "openai-completions";
}

function normalizeCustomRelayBaseUrl(baseUrl, api) {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/u, "");
  // Anthropic's client appends /v1/messages. A pasted .../anthropic/v1 would
  // become .../v1/v1/messages and the upstream answers "model not found".
  if (api === "anthropic-messages" && /\/v1$/iu.test(trimmed)) {
    return trimmed.replace(/\/v1$/iu, "");
  }
  return trimmed;
}

function canonicalModelId(model) {
  return String(model ?? "").trim().toLowerCase().replaceAll("_", "-").replaceAll(".", "-");
}

function customRelayModelShape(api, model, baseUrl) {
  const id = canonicalModelId(model);
  if (api === "anthropic-messages") {
    const adaptive = /claude-(?:sonnet-5|opus-5|opus-4-7|opus-4-8|fable-5)/u.test(id);
    return {
      reasoning: true,
      compat: {
        supportsEagerToolInputStreaming: false,
        ...(adaptive ? { forceAdaptiveThinking: true } : {}),
      },
    };
  }
  if (api === "google-generative-ai") {
    return {
      reasoning: id.includes("gemini"),
      compat: undefined,
    };
  }
  const deepseek = id.includes("deepseek");
  const qwen = id.includes("qwen");
  const zai = id.includes("glm") || id.includes("zhipu") || id.includes("chatglm");
  const claude = id.includes("claude");
  const kimi = id.includes("kimi") || id.includes("moonshot");
  const minimax = id.includes("minimax");
  const doubao = id.includes("doubao") || id.includes("seed-");
  const openaiReasoning = /(?:^|\/)(?:gpt-5|gpt-6|o[1-9])/u.test(id) || id.includes("grok-");
  const reasoning = deepseek || qwen || zai || claude || kimi || minimax || doubao || openaiReasoning;
  const host = hostOf(baseUrl);
  const officialOpenAI = host === "api.openai.com" || host.endsWith(".openai.azure.com");
  const openRouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  // OpenRouter has one reasoning field for every family. Everywhere else, the
  // model name picks the field that family actually returns.
  const contentReplay = deepseek || claude || kimi || minimax || doubao;
  let thinkingFormat = "openai";
  if (openRouter) thinkingFormat = "openrouter";
  else if (contentReplay) thinkingFormat = "deepseek";
  else if (qwen) thinkingFormat = "qwen";
  else if (zai) thinkingFormat = "zai";
  // Official Grok does not take reasoning_effort. Pi leaves that off.
  const effort = reasoning && thinkingFormat !== "zai" && host !== "api.x.ai";
  return {
    reasoning,
    compat: {
      supportsDeveloperRole: officialOpenAI,
      maxTokensField: officialOpenAI && openaiReasoning ? "max_completion_tokens" : "max_tokens",
      ...(reasoning
        ? {
          supportsReasoningEffort: effort,
          thinkingFormat,
          requiresReasoningContentOnAssistantMessages: thinkingFormat === "deepseek",
        }
        : {}),
    },
  };
}

module.exports = {
  customRelayApi,
  customRelayModelShape,
  normalizeCustomRelayBaseUrl,
};
