import { createHash } from "node:crypto";

function boundedInteger(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return 0;
  return Math.min(numeric, 1_000_000_000_000);
}

function boundedCost(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(numeric, 1_000_000);
}

function stableRecordId(parts) {
  const digest = createHash("sha256")
    .update(parts.map(value => String(value ?? "")).join("\x00"))
    .digest("hex");
  return `usage:${digest}`;
}

function normalizedSource(value) {
  return value === "account" || value === "personal" ? value : "";
}

function normalizedUsage(value) {
  if (!value || typeof value !== "object") return undefined;
  const inputTokens = boundedInteger(value.input);
  const outputTokens = boundedInteger(value.output);
  const cacheReadTokens = boundedInteger(value.cacheRead);
  const cacheWriteTokens = boundedInteger(value.cacheWrite);
  const reasoningTokens = boundedInteger(value.reasoning);
  const reportedTotal = boundedInteger(value.totalTokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: reportedTotal || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: boundedCost(value.cost?.total ?? value.cost),
  };
}

function occurredAt(value, fallback = Date.now()) {
  const numeric = Number(value);
  const candidate = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return new Date(fallback).toISOString();
  return date.toISOString();
}

export function projectAssistantUsage(message, options = {}) {
  if (!message || message.role !== "assistant") return undefined;
  const usage = normalizedUsage(message.usage);
  const model = String(message.model ?? "").trim();
  if (!usage || !model) return undefined;
  const conversationId = String(options.conversationId ?? "").trim();
  const timestamp = Number.isSafeInteger(Number(message.timestamp)) && Number(message.timestamp) > 0
    ? Number(message.timestamp)
    : Date.now();
  const provider = String(options.provider ?? message.provider ?? "").trim();
  const source = normalizedSource(options.source);
  return {
    recordId: stableRecordId([
      "assistant",
      conversationId,
      timestamp,
      message.responseId,
      provider,
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      message.stopReason,
    ]),
    module: options.module === "ctf" ? "ctf" : "coding",
    occurredAt: occurredAt(timestamp),
    provider,
    model,
    source,
    ...usage,
    success: message.stopReason !== "error" && message.stopReason !== "aborted",
  };
}

function subagentUsageRecords(result, options) {
  const details = result?.details;
  if (!details || !Array.isArray(details.results)) return [];
  return details.results.flatMap((entry, index) => {
    const usage = normalizedUsage(entry?.usage);
    const model = String(entry?.model ?? "").trim();
    if (!usage || !model) return [];
    const timestamp = Date.now();
    return [{
      recordId: stableRecordId([
        "subagent",
        options.conversationId,
        options.toolCallId,
        index,
        model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens,
        usage.cacheWriteTokens,
      ]),
      module: options.module === "ctf" ? "ctf" : "coding",
      occurredAt: occurredAt(timestamp),
      provider: String(options.provider ?? "").trim(),
      model,
      source: normalizedSource(options.source),
      ...usage,
      success: Number(entry?.exitCode) === 0,
    }];
  });
}

function imageGenUsageRecords(result, options) {
  const details = result?.details;
  if (details?.schema !== "milksu-imagegen-receipt/v1") return [];
  const inputTokens = boundedInteger(details.usage?.inputTokens);
  const outputTokens = boundedInteger(details.usage?.outputTokens);
  const totalTokens = boundedInteger(details.usage?.totalTokens) || inputTokens + outputTokens;
  const model = String(details.model ?? "").trim();
  if (!model || totalTokens === 0) return [];
  const timestamp = Date.now();
  return [{
    recordId: stableRecordId([
      "imagegen",
      options.conversationId,
      options.toolCallId,
      details.providerRequestId,
      model,
      inputTokens,
      outputTokens,
    ]),
    module: options.module === "ctf" ? "ctf" : "coding",
    occurredAt: occurredAt(timestamp),
    provider: String(details.provider ?? "openai").trim(),
    model,
    source: "personal",
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    costUsd: 0,
    success: details.status === "completed",
  }];
}

export function projectToolModelUsage(result, options = {}) {
  const toolName = String(options.toolName ?? "").trim();
  if (toolName === "subagent") return subagentUsageRecords(result, options);
  if (toolName === "imagegen") return imageGenUsageRecords(result, options);
  return [];
}
