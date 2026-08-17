import { AssistantMessageEventStream } from "@earendil-works/pi-ai";

export const accountSource = "account";
export const personalSource = "personal";

export function normalizeModelSourceOrder(raw) {
  const result = [];
  for (const source of String(raw ?? "").split(",")) {
    const value = source.trim();
    if (
      (value === accountSource || value === personalSource)
      && !result.includes(value)
    ) result.push(value);
  }
  for (const source of [accountSource, personalSource]) {
    if (!result.includes(source)) result.push(source);
  }
  return result;
}

export function modelSourceFallbackReason(error) {
  const details = [
    error?.errorMessage,
    error?.message,
    error?.type,
    error?.code,
    error?.error?.message,
    error?.error?.type,
  ].filter(value => value !== undefined && value !== null);
  if (details.length === 0) details.push(error);
  const message = details
    .map(String)
    .join(" ")
    .toLowerCase();
  // Composite-key prefix failures mention "api key" but are model-id shape
  // mismatches, not missing credentials. Classify them before auth checks.
  if (
    /\bmodel_not_found\b/u.test(message)
    || /model[\s\S]{0,384}(not found|not supported|unsupported|unavailable)/u.test(message)
    || /not supported by any configured account/u.test(message)
    || /composite_key_model_prefix_required|composite api key model must use prefix\/model_id/u.test(message)
    || /模型.{0,64}(不存在|不支持|不可用)/u.test(message)
  ) {
    return "model";
  }
  if (/\b401\b|unauthori[sz]ed|authentication|api key|凭据|鉴权/u.test(message)) {
    return "authentication";
  }
  if (/\b402\b|balance|credit|quota|insufficient|余额|额度|限额/u.test(message)) {
    return "quota";
  }
  if (
    /\b403\b|forbidden|suspended|disabled|permission_error|restricted to|\/v1\/messages only|暂停|禁用/u
      .test(message)
  ) {
    return "access";
  }
  if (/\b408\b|\b429\b|rate.?limit|timeout|timed out|temporar|network|fetch failed|econn|etimedout|enotfound|\b5\d\d\b/u.test(message)) {
    return "unavailable";
  }
  return "";
}

export function createModelSourceStream({
  sources,
  autoFallback,
  openSource,
  onSource,
  onFallback,
}) {
  const outer = new AssistantMessageEventStream();
  void (async () => {
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const canFallback = autoFallback && index + 1 < sources.length;
      let committed = false;
      let fallback = false;
      const buffered = [];
      onSource?.(source.id);

      try {
        const inner = openSource(source);
        for await (const event of inner) {
          if (!committed) {
            if (event.type === "error") {
              const reason = modelSourceFallbackReason(event.error);
              if (canFallback && reason) {
                onFallback?.({
                  from: source.id,
                  to: sources[index + 1].id,
                  reason,
                });
                fallback = true;
                break;
              }
            }
            buffered.push(event);
            if (event.type !== "start") {
              committed = true;
              for (const pending of buffered) outer.push(pending);
              buffered.length = 0;
            }
            continue;
          }
          outer.push(event);
        }
      } catch (error) {
        const reason = modelSourceFallbackReason(error);
        if (!committed && canFallback && reason) {
          onFallback?.({
            from: source.id,
            to: sources[index + 1].id,
            reason,
          });
          fallback = true;
        } else {
          throw error;
        }
      }

      if (fallback) continue;
      for (const pending of buffered) outer.push(pending);
      outer.end();
      return;
    }
    outer.end();
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    const failed = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "milksu-route",
      model: "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    };
    outer.push({ type: "error", reason: "error", error: failed });
    outer.end();
  });
  return outer;
}

export function createModelSourceRouteProvider({
  source,
  model,
  sources,
  autoFallback,
  openSource,
  onSource,
  onFallback,
}) {
  const baseUrl = String(source?.baseUrl ?? "").trim();
  if (!baseUrl) throw new Error("模型来源缺少 baseUrl");
  return {
    name: "MilkSU 模型来源",
    baseUrl,
    apiKey: "milksu-model-source-route",
    api: source.api,
    streamSimple: (_routeModel, context, options) => {
      const sourceOptions = { ...(options ?? {}) };
      delete sourceOptions.apiKey;
      if (sourceOptions.headers && typeof sourceOptions.headers === "object") {
        const headers = Object.fromEntries(
          Object.entries(sourceOptions.headers)
            .filter(([name]) => name.toLowerCase() !== "authorization"),
        );
        if (Object.keys(headers).length > 0) sourceOptions.headers = headers;
        else delete sourceOptions.headers;
      }
      return createModelSourceStream({
        sources,
        autoFallback,
        openSource: selected => openSource(selected, context, sourceOptions),
        onSource,
        onFallback,
      });
    },
    models: [{
      id: model,
      name: source?.name ?? model,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: source?.contextWindow ?? 128000,
      maxTokens: source?.maxTokens ?? 16384,
    }],
  };
}
