import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { streamSimple as defaultStreamSimple } from "@earendil-works/pi-ai/compat";
import fs from "node:fs";
import {
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
} from "./tokenflux-model-id.cjs";

export {
  tokenfluxBareModelID,
  tokenfluxCompositePrefixRequired,
  tokenfluxModelNotFound,
  tokenfluxRequestModelIDs,
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
} from "./tokenflux-model-id.cjs";

function errorPayload(event, fallback) {
  return event?.error ?? event?.message ?? fallback;
}

function catalogModelIDsFromEnvironment(environment = process.env) {
  const catalogPath = String(environment.MILKSU_MODEL_CATALOG_PATH ?? "").trim();
  if (!catalogPath) return [];
  try {
    const snapshot = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (snapshot?.provider !== "tokenflux" || !Array.isArray(snapshot.models)) return [];
    return snapshot.models.map(item => String(item?.id ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Stream with the catalog/request model id first. Only retry with a catalog-
 * known alternate bare/prefixed form before any content is committed.
 */
export function streamTokenFluxModelWithCompat({
  model,
  context,
  options,
  open = defaultStreamSimple,
  catalogModelIDs = catalogModelIDsFromEnvironment(),
}) {
  const candidates = tokenfluxRequestModels(model, catalogModelIDs);
  if (candidates.length === 0) {
    return open(model, context, options);
  }
  if (candidates.length === 1) {
    return open(candidates[0], context, options);
  }

  const outer = new AssistantMessageEventStream();
  void (async () => {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const canRetry = index + 1 < candidates.length;
      let committed = false;
      let retry = false;
      const buffered = [];

      try {
        const inner = open(candidate, context, options);
        for await (const event of inner) {
          if (!committed) {
            if (
              event.type === "error"
              && canRetry
              && tokenfluxRequestRetryable(errorPayload(event, candidate))
            ) {
              retry = true;
              break;
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
        if (!committed && canRetry && tokenfluxRequestRetryable(error)) {
          retry = true;
        } else {
          throw error;
        }
      }

      if (retry) continue;
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
      provider: model?.provider ?? "tokenflux",
      model: model?.id ?? "unknown",
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

/** Attach a TokenFlux dual-format streamSimple to a provider definition. */
export function withTokenFluxModelCompat(definition) {
  if (!definition || typeof definition !== "object") return definition;
  const baseStream = typeof definition.streamSimple === "function"
    ? definition.streamSimple.bind(definition)
    : defaultStreamSimple;
  return {
    ...definition,
    streamSimple: (model, context, options) => streamTokenFluxModelWithCompat({
      model,
      context,
      options,
      open: baseStream,
    }),
  };
}
