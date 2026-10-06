// pi-durable Harness 的模型接线工厂（PR-2 批次 A，DECISIONS Q8）。
//
// 现状 bridge 的三路路由（bridge.js configureRuntimeModel）跑在 pi-coding-agent 的
// ModelRuntime.registerProvider 上；Harness 用的是 pi-ai 的 Models/setProvider。本模块按
// 同一套三路语义构造**命名 provider 实例**，命名与传输约定对齐 pi-subagent-model-registry.cjs
// / current-provider-runtime.cjs / custom-relay-transport.cjs：
//
//   milksu-account —— 账号分配模型：经 TokenFlux 中继（MILKSU_RELAY_KEY/MILKSU_RELAY_URL，
//     api openai-completions，模型 id 走 tokenfluxModelIDForProvider 的单/复合 key 规则）；
//   自定义（自有中转/custom provider）—— MILKSU_CUSTOM_PROVIDER_* 或回合自带 turnProvider，
//     api 由 customRelayApi 判定（openai-completions/anthropic-messages/google-generative-ai），
//     provider id 保留用户自己的名字（不叫 milksu-*）；
//   milksu-route —— 双来源路由：账号+自有按序 failover 的进程内 route provider（对齐
//     bridge 的 createModelSourceRouteProvider，流引擎直接复用 model-source-routing.js）。
//
// 运行时替换（Q8）：改 baseURL/密钥 = 构造新 provider 实例 + Models.setProvider(id)（pi-ai
// models.d.ts:196，setProvider 为 upsert/replace）。每会话选择不在这里做——用
// harness-adapter 的 configureConversation({provider, modelId, thinkingLevel})。
//
// 测试纪律：真实密钥不进测试；单测用 pi-ai faux provider（providers/faux）+ 无效 URL 构造
// 假 provider，不发起网络请求。

import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import * as anthropicMessagesApi from "@earendil-works/pi-ai/api/anthropic-messages";
import * as googleGenerativeAiApi from "@earendil-works/pi-ai/api/google-generative-ai";
import * as openaiCompletionsApi from "@earendil-works/pi-ai/api/openai-completions";
import currentProviderRuntime from "./current-provider-runtime.cjs";
import { customRelayApi, normalizeCustomRelayBaseUrl } from "./custom-relay-transport.cjs";
import {
  createModelSourceStream,
  normalizeModelSourceOrder,
  selectModelSources,
} from "./model-source-routing.js";
import {
  registeredContextWindow,
  registeredMaxTokens,
} from "./known-context-window.cjs";
import { normalizeThinkingProfile, withModelThinkingProfile } from "./bridge-thinking.js";
import { streamTokenFluxModelWithCompat } from "./tokenflux-model-compat.js";

const { currentProviderDefinition, tokenfluxAccountModelAvailability, tokenfluxModelIDForProvider } =
  currentProviderRuntime;

export const MILKSU_ACCOUNT_PROVIDER_ID = "milksu-account";
export const MILKSU_RELAY_PROVIDER_ID = "milksu-relay";
export const MILKSU_ROUTE_PROVIDER_ID = "milksu-route";
export const MILKSU_RELAY_DEFAULT_URL = "https://tokenflux.dev/v1";

const apiModules = {
  "openai-completions": openaiCompletionsApi,
  "anthropic-messages": anthropicMessagesApi,
  "google-generative-ai": googleGenerativeAiApi,
};

const providerApiIds = () => Object.keys(apiModules);

function providerApiImplementations(api) {
  const module = apiModules[String(api ?? "").trim()];
  if (!module) {
    throw new Error(
      `harness model provider: unsupported api "${api}" (supported: ${providerApiIds().join(", ")})`,
    );
  }
  return { stream: module.stream, streamSimple: module.streamSimple };
}

function normalizedRelayUrl(environment) {
  return String(environment.MILKSU_RELAY_URL ?? "").trim() || MILKSU_RELAY_DEFAULT_URL;
}

function relayEnabled(environment) {
  return String(environment.MILKSU_RELAY_ENABLED ?? "") === "1"
    && Boolean(String(environment.MILKSU_RELAY_KEY ?? "").trim());
}

/**
 * 描述符 → pi-ai Provider。描述符形状即 bridge 的 provider definition 约定
 * （{id, name, baseUrl, apiKey, api, models:[…]}），models 条目沿用 bridge 的目录字段。
 */
export function buildHarnessProvider(descriptor) {
  const id = String(descriptor?.id ?? "").trim();
  if (!id) throw new Error("harness model provider requires an id");
  const baseUrl = String(descriptor.baseUrl ?? "").trim();
  if (baseUrl && !/^https?:\/\/[^\s]+$/u.test(baseUrl)) {
    throw new Error(`harness model provider ${id}: invalid baseUrl ${baseUrl}`);
  }
  const api = String(descriptor.api ?? "openai-completions").trim();
  const entries = Array.isArray(descriptor.models) ? descriptor.models : [];
  if (entries.length === 0) throw new Error(`harness model provider ${id}: no models`);
  const apiKey = String(descriptor.apiKey ?? "").trim();
  return createProvider({
    id,
    name: String(descriptor.name ?? id).trim() || id,
    ...(baseUrl ? { baseUrl } : {}),
    auth: {
      apiKey: {
        name: `${String(descriptor.name ?? id).trim() || id} API key`,
        // 无密钥 = 未配置（resolve undefined）：请求会得到显式 auth 错误，而不是无凭据裸发。
        resolve: async () => (apiKey ? { auth: { apiKey } } : undefined),
      },
    },
    models: entries.map(entry => ({
      ...entry,
      id: String(entry.id ?? "").trim(),
      provider: id,
      baseUrl,
      api: String(entry.api ?? api).trim(),
    })),
    api: providerApiImplementations(api),
  });
}

// ---------- 账号分配路（milksu-account） ----------
/**
 * 对齐 bridge.js registerAccountModel：账号 key 走 TokenFlux 目录，模型 id 复合/单 key 兼容，
 * thinking 档位、上下文窗口按同一套注册表取值。availability.authoritative && !model 时返回
 * undefined（账号分配不覆盖该模型，不做静默替换）。
 */
export function milksuAccountProviderDescriptor({
  provider,
  model,
  thinking,
  environment = process.env,
}) {
  if (!relayEnabled(environment)) return undefined;
  const accountModelId = tokenfluxModelIDForProvider(provider, model);
  const availability = tokenfluxAccountModelAvailability(accountModelId, environment);
  if (availability.authoritative && !availability.model) return undefined;
  const definition = currentProviderDefinition("tokenflux", accountModelId, {
    TOKENFLUX_API_KEY: String(environment.MILKSU_RELAY_KEY ?? ""),
    TOKENFLUX_BASE_URL: normalizedRelayUrl(environment),
    MILKSU_MODEL_CATALOG_PATH: environment.MILKSU_MODEL_CATALOG_PATH,
  });
  const source = definition?.models?.find(item => item.id === accountModelId);
  const shaped = {
    id: MILKSU_ACCOUNT_PROVIDER_ID,
    name: "MilkSU 账户分配模型",
    baseUrl: normalizedRelayUrl(environment),
    apiKey: String(environment.MILKSU_RELAY_KEY ?? ""),
    api: "openai-completions",
    models: [withModelThinkingProfile({
      ...source,
      id: accountModelId,
      name: source?.name ?? accountModelId,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: registeredContextWindow(accountModelId, source?.contextWindow),
      maxTokens: registeredMaxTokens(accountModelId, source?.maxTokens),
    }, thinking)],
  };
  return shaped;
}

/**
 * 账号路 provider：catalog/请求 id 双形态兼容（复合 key 被拒后按 bare id 重试一次）在流层
 * 生效，对齐 bridge.js registerAccountModel 的 withTokenFluxModelCompat 语义——但落在 pi-ai
 * Provider 的 streamSimple/stream 上（bridge 是 ModelRuntime definition）。
 */
export function buildMilksuAccountProvider(descriptor) {
  const provider = buildHarnessProvider(descriptor);
  const wrapped = {
    ...provider,
    streamSimple: (model, context, options) => streamTokenFluxModelWithCompat({
      model,
      context,
      options,
      open: (candidate, candidateContext, candidateOptions) => (
        provider.streamSimple(candidate, candidateContext, candidateOptions)
      ),
    }),
  };
  wrapped.stream = wrapped.streamSimple;
  return wrapped;
}

/**
 * milksu-relay：把 MilkSU 中继本身作为命名 provider（对齐 pi-subagent-model-registry.cjs
 * 的约定：apiKey 引用 MILKSU_RELAY_KEY、baseUrl 用 MILKSU_RELAY_URL、目录走 TokenFlux）。
 * 供子代理/后台任务直接指名用中继时构造；账号路请用 milksu-account。
 */
export function milksuRelayProviderDescriptor({
  model,
  thinking,
  environment = process.env,
}) {
  const relayKey = String(environment.MILKSU_RELAY_KEY ?? "").trim();
  if (!relayKey) return undefined;
  const definition = currentProviderDefinition("tokenflux", model, {
    TOKENFLUX_API_KEY: relayKey,
    TOKENFLUX_BASE_URL: normalizedRelayUrl(environment),
    MILKSU_MODEL_CATALOG_PATH: environment.MILKSU_MODEL_CATALOG_PATH,
  });
  if (!definition?.baseUrl) return undefined;
  const entries = (definition.models ?? [])
    .filter(entry => entry && String(entry.id ?? "").trim())
    .map(entry => withModelThinkingProfile({
      ...entry,
      id: String(entry.id).trim(),
      contextWindow: registeredContextWindow(String(entry.id), entry.contextWindow),
      maxTokens: registeredMaxTokens(String(entry.id), entry.maxTokens),
    }, thinking));
  if (entries.length === 0) return undefined;
  return {
    id: MILKSU_RELAY_PROVIDER_ID,
    name: "MilkSU 中继",
    baseUrl: normalizedRelayUrl(environment),
    apiKey: relayKey,
    api: "openai-completions",
    models: entries,
  };
}

// ---------- 自有中转 / custom provider 路 ----------

/**
 * 对齐 currentProviderDefinition：回合自带 turnProvider 优先于进程环境；custom relay 的
 * api 与 baseUrl 归一化走 custom-relay-transport 的同一套规则。provider id 保留用户命名。
 */
export function customRelayProviderDescriptor({
  provider,
  model,
  thinking,
  environment = process.env,
  turnProvider,
}) {
  const definition = currentProviderDefinition(provider, model, environment, turnProvider);
  if (!definition?.baseUrl || !Array.isArray(definition.models)) return undefined;
  const api = customRelayApi(definition.baseUrl, definition.api);
  const baseUrl = normalizeCustomRelayBaseUrl(definition.baseUrl, api);
  const entries = definition.models
    .filter(entry => entry && String(entry.id ?? "").trim())
    .map(entry => {
      const id = String(entry.id).trim();
      return withModelThinkingProfile({
        ...entry,
        id,
        name: String(entry.name ?? id).trim() || id,
        reasoning: entry.reasoning ?? false,
        input: entry.input ?? ["text"],
        cost: entry.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: registeredContextWindow(id, entry.contextWindow),
        maxTokens: registeredMaxTokens(id, entry.maxTokens),
      }, thinking);
    });
  if (entries.length === 0) return undefined;
  return {
    id: String(provider).trim(),
    name: String(definition.name ?? provider).trim() || String(provider).trim(),
    baseUrl,
    apiKey: String(definition.apiKey ?? ""),
    api,
    models: entries,
  };
}

// ---------- 双来源路由（milksu-route） ----------

/**
 * 构造 milksu-route：按 sourceOrder 把账号/自有模型串成 failover 流（引擎复用
 * model-source-routing.js 的 createModelSourceStream）。openSource 用同一个 Models 集合
 * 的 streamSimple（route 模型的请求落到当轮选中的来源模型上，对齐 bridge 的
 * session.modelRuntime.streamSimple 行为）。
 */
export function buildRouteProvider({ sources, autoFallback = false, models, onSource, onFallback }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("milksu-route requires at least one model source");
  }
  if (!models) throw new TypeError("milksu-route requires the harness models collection");
  const routeModelIds = [...new Set(sources.map(source => String(source.model?.id ?? "").trim()))]
    .filter(Boolean);
  if (routeModelIds.length === 0) throw new Error("milksu-route requires source model ids");
  const first = sources[0];
  // route 模型的 api 字段是元数据（真实分发走下方覆写的 streamSimple）：来源 api 不在已知
  // 传输表内时（如测试的 faux 合成 api）退回 openai-completions。
  const sourceApi = String(first.model?.api ?? "").trim();
  const routeApi = Object.hasOwn(apiModules, sourceApi) ? sourceApi : "openai-completions";
  const descriptor = {
    id: MILKSU_ROUTE_PROVIDER_ID,
    name: "MilkSU 模型来源",
    baseUrl: String(first.model?.baseUrl ?? "").trim(),
    apiKey: "milksu-model-source-route",
    api: routeApi,
    models: routeModelIds.map(id => {
      const source = sources.find(candidate => String(candidate.model?.id ?? "") === id);
      return { ...source.model, id, api: routeApi };
    }),
  };
  const provider = buildHarnessProvider(descriptor);
  // route 的流实现替换为 failover 路由：请求发往当轮选中的来源模型。
  const routed = {
    ...provider,
    streamSimple: (routeModel, context, options) => {
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
        openSource: selected => models.streamSimple(selected.model, context, sourceOptions),
        onSource,
        onFallback,
      });
    },
  };
  routed.stream = routed.streamSimple;
  return routed;
}

// ---------- 组装：三路接线 + 运行时替换 ----------

/**
 * 按 bridge configureRuntimeModel 的三路语义接线一次模型选择。
 *
 * personal（自有来源）解析顺序，对齐 bridge：① options.personalModel——已注册进 Models 的
 * provider/model 引用（产品侧＝bridge 的 modelRuntime 已注册 definition + 已配 auth；测试＝
 * 预先 setProvider 的 faux）；② customRelayProviderDescriptor——自定义中转（环境或回合自带）。
 *
 * 返回 {selection}：selection.provider/modelId 是该会话应 configure 的命名引用；无可用来源
 * 是失败不是替换（对齐 bridge 的 incident 处理）。构造好的 provider 实例经 setProvider 注册/
 * 替换进 models（Q8 的运行时替换面）。
 */
export function wireHarnessModelSelection({
  models,
  provider,
  model,
  thinking,
  sourceOrder,
  personalModel: preRegisteredPersonal,
  environment = process.env,
  turnProvider,
  autoFallback = false,
  onSource,
  onFallback,
}) {
  if (!models) throw new TypeError("wireHarnessModelSelection requires a models collection");
  const requestedOrder = normalizeModelSourceOrder(sourceOrder ?? environment.MILKSU_MODEL_SOURCE_ORDER);

  const accountDescriptor = milksuAccountProviderDescriptor({ provider, model, thinking, environment });
  let accountModel = undefined;
  if (accountDescriptor) {
    models.setProvider(buildMilksuAccountProvider(accountDescriptor));
    accountModel = models.getModel(MILKSU_ACCOUNT_PROVIDER_ID, accountDescriptor.models[0].id);
  }

  let personalModel = undefined;
  let customRelay = false;
  if (preRegisteredPersonal?.provider && preRegisteredPersonal?.modelId) {
    personalModel = models.getModel(
      String(preRegisteredPersonal.provider),
      String(preRegisteredPersonal.modelId),
    );
  } else {
    const customDescriptor = customRelayProviderDescriptor({ provider, model, thinking, environment, turnProvider });
    if (customDescriptor) {
      customRelay = true;
      models.setProvider(buildHarnessProvider(customDescriptor));
      personalModel = models.getModel(customDescriptor.id, customDescriptor.models[0].id);
    }
  }

  const selection = selectModelSources({
    requestedOrder,
    accountModel,
    personalModel,
    customRelay,
  });
  if (selection.failure || selection.sources.length === 0) {
    return { failure: selection.failure ?? { reason: "no-source" } };
  }
  if (selection.sources.length === 1) {
    const chosen = selection.sources[0];
    return {
      selection: { provider: chosen.model.provider, modelId: chosen.model.id, source: chosen.id },
      sources: selection.sources,
    };
  }
  const route = buildRouteProvider({
    sources: selection.sources,
    autoFallback,
    models,
    onSource,
    onFallback,
  });
  models.setProvider(route);
  return {
    selection: { provider: MILKSU_ROUTE_PROVIDER_ID, modelId: String(model).trim(), source: "route" },
    sources: selection.sources,
  };
}

/**
 * Harness 的 pi-ai Models 集合。初始 providers 为空（产品侧按 wireHarnessModelSelection
 * 逐路注册）；测试传 faux provider。
 */
export function createHarnessModels(options = {}) {
  const models = options.models ?? createModels();
  return {
    models,
    /** 注册/替换（upsert by id）——Q8 的运行时替换面。 */
    register(descriptor) {
      const provider = buildHarnessProvider(descriptor);
      models.setProvider(provider);
      return provider;
    },
    unregister(id) {
      models.deleteProvider(String(id ?? "").trim());
    },
    get(providerId, modelId) {
      return models.getModel(String(providerId ?? "").trim(), String(modelId ?? "").trim());
    },
  };
}

export { normalizeThinkingProfile };
