"use strict";

// TokenFlux accepts two key shapes on the same OpenAI-compatible endpoint:
// 1. single-model keys: bare model ids (for example grok-4.5)
// 2. composite keys: vendor prefix + model id (for example x-ai/grok-4.5)
// MilkSU keeps the catalog id as the product selection and only rewrites the
// request model id when a live response proves the other shape is required.

const knownVendorPrefixes = Object.freeze([
  "x-ai",
  "openai",
  "anthropic",
  "google",
  "qwen",
  "deepseek",
  "bailian",
  "dashscope",
  "alibaba",
]);

function normalizeModelID(value) {
  return String(value ?? "").trim();
}

function tokenfluxCompositePrefixRequired(error) {
  const details = [
    error?.errorMessage,
    error?.message,
    error?.code,
    error?.type,
    error?.error?.message,
    error?.error?.code,
    error?.error?.type,
  ].filter(value => value !== undefined && value !== null);
  if (details.length === 0 && error !== undefined && error !== null) {
    details.push(error);
  }
  const message = details.map(String).join(" ");
  return /COMPOSITE_KEY_MODEL_PREFIX_REQUIRED|composite api key model must use prefix\/model_id/iu
    .test(message);
}

function tokenfluxModelNotFound(error) {
  const details = [
    error?.errorMessage,
    error?.message,
    error?.type,
    error?.code,
    error?.error?.message,
    error?.error?.type,
  ].filter(value => value !== undefined && value !== null);
  if (details.length === 0 && error !== undefined && error !== null) {
    details.push(error);
  }
  const message = details.map(String).join(" ").toLowerCase();
  return (
    /\bmodel_not_found\b/u.test(message)
    || /model[\s\S]{0,384}(not found|not supported|unsupported|unavailable)/u.test(message)
    || /not supported by any configured account/u.test(message)
  );
}

function tokenfluxBareModelID(modelID) {
  const id = normalizeModelID(modelID);
  if (!id.includes("/")) return id;
  const prefix = id.slice(0, id.indexOf("/"));
  if (!knownVendorPrefixes.includes(prefix)) return id;
  return id.slice(id.indexOf("/") + 1);
}

function inferCompositePrefixedIDs(bareModelID) {
  const id = normalizeModelID(bareModelID);
  if (!id || id.includes("/")) return [];
  const result = [];
  const add = prefix => {
    const value = `${prefix}/${id}`;
    if (!result.includes(value)) result.push(value);
  };

  // Grok / xAI
  if (/^grok/iu.test(id)) add("x-ai");
  // OpenAI GPT family and Codex-style ids
  if (/^(?:gpt|o[1-9]|chatgpt|codex)/iu.test(id)) add("openai");
  // Anthropic Claude
  if (/^claude/iu.test(id)) add("anthropic");
  // Google Gemini / Gemma
  if (/^(?:gemini|gemma)/iu.test(id)) add("google");
  // Alibaba Bailian / DashScope / Qwen family
  if (/^(?:qwen|qwq|qvq|wanx|tongyi)/iu.test(id)) {
    add("qwen");
    add("bailian");
    add("dashscope");
  }
  // DeepSeek
  if (/^deepseek/iu.test(id)) add("deepseek");

  return result;
}

function tokenfluxRequestModelIDs(modelID) {
  const id = normalizeModelID(modelID);
  if (!id) return [];
  const result = [id];
  const push = value => {
    const next = normalizeModelID(value);
    if (next && !result.includes(next)) result.push(next);
  };

  if (id.includes("/")) {
    push(tokenfluxBareModelID(id));
  } else {
    for (const prefixed of inferCompositePrefixedIDs(id)) push(prefixed);
  }
  return result;
}

function tokenfluxRequestModels(model) {
  const ids = tokenfluxRequestModelIDs(model?.id);
  if (ids.length === 0) return model ? [model] : [];
  return ids.map(id => (
    id === model.id
      ? model
      : { ...model, id, name: model?.name && model.id === id ? model.name : id }
  ));
}

function tokenfluxRequestRetryable(error) {
  return tokenfluxCompositePrefixRequired(error) || tokenfluxModelNotFound(error);
}

module.exports = {
  inferCompositePrefixedIDs,
  knownVendorPrefixes,
  tokenfluxBareModelID,
  tokenfluxCompositePrefixRequired,
  tokenfluxModelNotFound,
  tokenfluxRequestModelIDs,
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
};
