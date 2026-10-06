import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
  MILKSU_ACCOUNT_PROVIDER_ID,
  MILKSU_RELAY_PROVIDER_ID,
  MILKSU_ROUTE_PROVIDER_ID,
  buildHarnessProvider,
  buildMilksuAccountProvider,
  buildRouteProvider,
  createHarnessModels,
  customRelayProviderDescriptor,
  milksuAccountProviderDescriptor,
  milksuRelayProviderDescriptor,
  wireHarnessModelSelection,
} from "./harness-model-providers.js";

// 纪律：全部用无效域名/假密钥/faux provider，不发任何网络请求。

function chatModel(id, extra = {}) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
    ...extra,
  };
}

async function writeCatalog(root, snapshot) {
  const path = join(root, "tokenflux-catalog.json");
  await writeFile(path, JSON.stringify(snapshot));
  return path;
}

async function withTempDir(run) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-providers-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("buildHarnessProvider stamps provider identity and resolves auth", async () => {
  const models = createModels();
  const provider = buildHarnessProvider({
    id: "custom-relay-test",
    name: "自定义中转",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "key-1",
    api: "openai-completions",
    models: [chatModel("demo-model")],
  });
  models.setProvider(provider);
  const model = models.getModel("custom-relay-test", "demo-model");
  assert.equal(model.provider, "custom-relay-test");
  assert.equal(model.baseUrl, "https://relay.invalid/v1");
  assert.equal(model.api, "openai-completions");
  const auth = await models.getAuth("custom-relay-test");
  assert.equal(auth.auth.apiKey, "key-1");
});

test("buildHarnessProvider rejects invalid descriptors and unknown apis", () => {
  assert.throws(() => buildHarnessProvider({ id: "" }), /requires an id/);
  assert.throws(
    () => buildHarnessProvider({ id: "x", baseUrl: "ftp://bad", models: [chatModel("m")] }),
    /invalid baseUrl/,
  );
  assert.throws(() => buildHarnessProvider({ id: "x", models: [] }), /no models/);
  assert.throws(
    () => buildHarnessProvider({ id: "x", api: "made-up-api", models: [chatModel("m")] }),
    /unsupported api "made-up-api"/,
  );
});

test("provider without a key reports unconfigured instead of sending keyless requests", async () => {
  const models = createModels();
  models.setProvider(buildHarnessProvider({
    id: "keyless-relay",
    baseUrl: "https://relay.invalid/v1",
    api: "openai-completions",
    models: [chatModel("m")],
  }));
  assert.equal(await models.getAuth("keyless-relay"), undefined);
});

test("milksu-account descriptor follows the TokenFlux catalog conventions", async () => {
  await withTempDir(async root => {
    const catalogPath = await writeCatalog(root, {
      provider: "tokenflux",
      source: "remote",
      credential_source: "account",
      account_model_ids: ["deepseek/deepseek-v4-flash"],
      models: [{
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        context_window: 128000,
        max_tokens: 8192,
        input: ["text"],
      }],
    });
    const environment = {
      MILKSU_RELAY_ENABLED: "1",
      MILKSU_RELAY_KEY: "account-key",
      MILKSU_RELAY_URL: "https://tokenflux.invalid/v1",
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    };
    const descriptor = milksuAccountProviderDescriptor({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: { enabled: false },
      environment,
    });
    assert.ok(descriptor);
    assert.equal(descriptor.id, MILKSU_ACCOUNT_PROVIDER_ID);
    assert.equal(descriptor.api, "openai-completions");
    assert.equal(descriptor.baseUrl, "https://tokenflux.invalid/v1");
    assert.equal(descriptor.models[0].id, "deepseek/deepseek-v4-flash");

    // 账号分配不覆盖的模型：descriptor 为 undefined（不做静默替换）。
    const uncovered = milksuAccountProviderDescriptor({
      provider: "deepseek",
      model: "deepseek-v4-other",
      thinking: { enabled: false },
      environment,
    });
    assert.equal(uncovered, undefined);

    // relay 未启用：整条账号路不存在。
    const disabled = milksuAccountProviderDescriptor({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: { enabled: false },
      environment: { ...environment, MILKSU_RELAY_ENABLED: "0" },
    });
    assert.equal(disabled, undefined);

    // 包装后的 provider 能注册进 Models 并解析出账号密钥。
    const models = createModels();
    models.setProvider(buildMilksuAccountProvider(descriptor));
    const model = models.getModel(MILKSU_ACCOUNT_PROVIDER_ID, "deepseek/deepseek-v4-flash");
    assert.ok(model);
    const auth = await models.getAuth(MILKSU_ACCOUNT_PROVIDER_ID);
    assert.equal(auth.auth.apiKey, "account-key");
    assert.equal(typeof models.streamSimple, "function");
  });
});

test("custom relay descriptor keeps the user's provider id and transport rules", async () => {
  const openaiEnvironment = {
    MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-deepseek",
    MILKSU_CUSTOM_PROVIDER_NAME: "DeepSeek 自有中转",
    MILKSU_CUSTOM_PROVIDER_URL: "https://own-relay.invalid/v1",
    MILKSU_CUSTOM_PROVIDER_KEY: "own-key",
  };
  const openai = customRelayProviderDescriptor({
    provider: "custom-relay-deepseek",
    model: "deepseek-chat",
    thinking: { enabled: true, level: "high" },
    environment: openaiEnvironment,
  });
  assert.ok(openai);
  assert.equal(openai.id, "custom-relay-deepseek");
  assert.equal(openai.api, "openai-completions");
  assert.equal(openai.models[0].id, "deepseek-chat");

  // /anthropic 路径自动判成 anthropic-messages，且 /v1 尾巴被归一化。
  const anthropicEnvironment = {
    ...openaiEnvironment,
    MILKSU_CUSTOM_PROVIDER_URL: "https://own-relay.invalid/anthropic/v1",
  };
  const anthropic = customRelayProviderDescriptor({
    provider: "custom-relay-deepseek",
    model: "claude-sonnet-5",
    thinking: { enabled: false },
    environment: anthropicEnvironment,
  });
  assert.equal(anthropic.api, "anthropic-messages");
  assert.equal(anthropic.baseUrl, "https://own-relay.invalid/anthropic");

  // 回合自带的 turnProvider 优先于进程环境（对话自己的中转）。
  const turn = customRelayProviderDescriptor({
    provider: "conv-relay",
    model: "some-model",
    thinking: { enabled: false },
    environment: openaiEnvironment,
    turnProvider: {
      id: "conv-relay",
      name: "Conv Relay",
      baseUrl: "https://conv-relay.invalid/v1",
      key: "conv-key",
    },
  });
  assert.ok(turn);
  assert.equal(turn.id, "conv-relay");
  assert.equal(turn.baseUrl, "https://conv-relay.invalid/v1");
});

function messageText(event) {
  const blocks = event?.message?.content ?? event?.error?.content ?? [];
  return blocks
    .filter(block => block?.type === "text")
    .map(block => block.text)
    .join("");
}

test("buildRouteProvider streams through the selected source and fails over", async () => {
  const models = createModels();
  const primary = fauxProvider({ provider: "faux-a", models: [{ id: "model-a" }] });
  const secondary = fauxProvider({ provider: "faux-b", models: [{ id: "model-b" }] });
  models.setProvider(primary.provider);
  models.setProvider(secondary.provider);

  // 主来源请求前就 429（未提交任何内容 → 可回退），备用来源正常回答。
  primary.setResponses([() => {
    throw new Error("HTTP 429 rate limit exceeded");
  }]);
  secondary.setResponses([fauxAssistantMessage("secondary answered")]);

  const fallbacks = [];
  const route = buildRouteProvider({
    sources: [
      { id: "account", model: models.getModel("faux-a", "model-a") },
      { id: "personal", model: models.getModel("faux-b", "model-b") },
    ],
    autoFallback: true,
    models,
    onFallback: fallback => fallbacks.push(fallback),
  });
  models.setProvider(route);
  const routeModel = models.getModel(MILKSU_ROUTE_PROVIDER_ID, "model-a");
  assert.ok(routeModel, "route model registered under milksu-route");

  const events = [];
  for await (const event of models.streamSimple(routeModel, { messages: [] })) {
    events.push(event);
  }
  assert.equal(messageText(events.find(event => event.type === "done")), "secondary answered");
  assert.deepEqual(fallbacks, [{ from: "account", to: "personal", reason: "unavailable" }]);

  // 不开 autoFallback：主来源的错误就是这一轮的错误，不偷换来源。
  const strict = buildRouteProvider({
    sources: [
      { id: "account", model: models.getModel("faux-a", "model-a") },
      { id: "personal", model: models.getModel("faux-b", "model-b") },
    ],
    autoFallback: false,
    models,
  });
  primary.setResponses([() => {
    throw new Error("HTTP 429 rate limit exceeded");
  }]);
  const strictEvents = [];
  for await (const event of strict.streamSimple(models.getModel("faux-a", "model-a"), { messages: [] })) {
    strictEvents.push(event);
  }
  const strictError = strictEvents.find(event => event.type === "error")?.error;
  assert.match(String(strictError?.errorMessage ?? strictError), /429/);
});

test("wireHarnessModelSelection picks single source and builds a route for dual sources", async () => {
  await withTempDir(async root => {
    const catalogPath = await writeCatalog(root, {
      provider: "tokenflux",
      source: "remote",
      credential_source: "account",
      account_model_ids: ["deepseek/deepseek-v4-flash"],
      models: [{ id: "deepseek/deepseek-v4-flash", context_window: 128000, max_tokens: 8192 }],
    });
    const relayEnvironment = {
      MILKSU_RELAY_ENABLED: "1",
      MILKSU_RELAY_KEY: "account-key",
      MILKSU_RELAY_URL: "https://tokenflux.invalid/v1",
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    };

    // 单来源：账号路可用、无自有来源 → 直接选 milksu-account。
    const accountOnly = wireHarnessModelSelection({
      models: createModels(),
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: { enabled: false },
      environment: relayEnvironment,
    });
    assert.equal(accountOnly.selection.provider, MILKSU_ACCOUNT_PROVIDER_ID);
    assert.equal(accountOnly.selection.modelId, "deepseek/deepseek-v4-flash");
    assert.equal(accountOnly.selection.source, "account");

    // 双来源：账号 + 已注册的自有 provider（bridge 语义：personal 来自已注册 definition）→ milksu-route。
    const dualModels = createModels();
    const personal = fauxProvider({ provider: "faux-personal", models: [{ id: "deepseek-v4-flash" }] });
    dualModels.setProvider(personal.provider);
    const dual = wireHarnessModelSelection({
      models: dualModels,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: { enabled: false },
      environment: relayEnvironment,
      personalModel: { provider: "faux-personal", modelId: "deepseek-v4-flash" },
    });
    assert.equal(dual.selection.provider, MILKSU_ROUTE_PROVIDER_ID);
    assert.equal(dual.selection.modelId, "deepseek-v4-flash");
    assert.equal(dual.sources.length, 2);
    assert.deepEqual(dual.sources.map(source => source.id), ["account", "personal"]);

    // 自定义中转永远不经账号路（selectModelSources 的 customRelay 规则）：只剩 personal。
    const relayOnly = wireHarnessModelSelection({
      models: createModels(),
      provider: "custom-relay-deepseek",
      model: "deepseek-chat",
      thinking: { enabled: false },
      environment: {
        ...relayEnvironment,
        MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-deepseek",
        MILKSU_CUSTOM_PROVIDER_URL: "https://own-relay.invalid/v1",
        MILKSU_CUSTOM_PROVIDER_KEY: "own-key",
      },
    });
    assert.equal(relayOnly.selection.provider, "custom-relay-deepseek");
    assert.equal(relayOnly.selection.source, "personal");
    assert.equal(relayOnly.selection.modelId, "deepseek-chat");
  });
});

test("milksu-relay descriptor follows the registry conventions", async () => {
  await withTempDir(async root => {
    const catalogPath = await writeCatalog(root, {
      provider: "tokenflux",
      source: "remote",
      credential_source: "personal",
      models: [{ id: "claude/claude-opus-4-6", context_window: 200000, max_tokens: 32768 }],
    });
    const environment = {
      MILKSU_RELAY_KEY: "relay-key",
      MILKSU_RELAY_URL: "https://relay.invalid/v1",
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    };
    const descriptor = milksuRelayProviderDescriptor({
      model: "claude/claude-opus-4-6",
      thinking: { enabled: true, level: "high" },
      environment,
    });
    assert.ok(descriptor);
    assert.equal(descriptor.id, MILKSU_RELAY_PROVIDER_ID);
    assert.equal(descriptor.baseUrl, "https://relay.invalid/v1");
    assert.equal(descriptor.apiKey, "relay-key");
    assert.equal(descriptor.api, "openai-completions");
    assert.ok(descriptor.models.some(entry => entry.id === "claude/claude-opus-4-6"));

    const models = createModels();
    const access = createHarnessModels({ models });
    access.register(descriptor);
    assert.ok(access.get(MILKSU_RELAY_PROVIDER_ID, "claude/claude-opus-4-6"));

    // 无中继密钥：不注册。
    assert.equal(
      milksuRelayProviderDescriptor({
        model: "claude/claude-opus-4-6",
        thinking: { enabled: false },
        environment: { ...environment, MILKSU_RELAY_KEY: "" },
      }),
      undefined,
    );
  });
});

test("wireHarnessModelSelection fails when the chosen source is unavailable", async () => {
  await withTempDir(async root => {
    const catalogPath = await writeCatalog(root, {
      provider: "tokenflux",
      source: "remote",
      credential_source: "account",
      account_model_ids: ["deepseek/deepseek-v4-flash"],
      models: [{ id: "deepseek/deepseek-v4-flash", context_window: 128000, max_tokens: 8192 }],
    });
    const result = wireHarnessModelSelection({
      models: createModels(),
      provider: "deepseek",
      model: "deepseek-v4-uncovered",
      thinking: { enabled: false },
      sourceOrder: "account",
      environment: {
        MILKSU_RELAY_ENABLED: "1",
        MILKSU_RELAY_KEY: "account-key",
        MILKSU_RELAY_URL: "https://tokenflux.invalid/v1",
        MILKSU_MODEL_CATALOG_PATH: catalogPath,
      },
    });
    assert.ok(result.failure, "unreachable chosen source is a failure, not a substitution");
    assert.equal(result.failure.reason, "selected-source-unavailable");
  });
});

test("createHarnessModels supports runtime replacement via setProvider", async () => {
  const access = createHarnessModels();
  const first = access.register({
    id: "custom-relay-test",
    name: "第一版",
    baseUrl: "https://one.invalid/v1",
    apiKey: "key-1",
    api: "openai-completions",
    models: [chatModel("demo-model")],
  });
  assert.equal(first.id, "custom-relay-test");
  assert.equal(access.get("custom-relay-test", "demo-model")?.baseUrl, "https://one.invalid/v1");

  // 运行时改 baseURL/密钥（Q8）：新实例 + 同名 setProvider 替换。
  access.register({
    id: "custom-relay-test",
    name: "第二版",
    baseUrl: "https://two.invalid/v1",
    apiKey: "key-2",
    api: "openai-completions",
    models: [chatModel("demo-model")],
  });
  assert.equal(access.get("custom-relay-test", "demo-model")?.baseUrl, "https://two.invalid/v1");
  const models = access.models;
  const auth = await models.getAuth("custom-relay-test");
  assert.equal(auth.auth.apiKey, "key-2");

  access.unregister("custom-relay-test");
  assert.equal(access.get("custom-relay-test", "demo-model"), undefined);
});

test("faux provider registration keeps the whole factory test network-free", async () => {
  const models = createModels();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("offline")]);
  const events = [];
  for await (const event of models.streamSimple(models.getModel("faux", "faux-1"), { messages: [] })) {
    events.push(event);
  }
  const done = events.find(event => event.type === "done");
  assert.equal(
    (done?.message?.content ?? []).filter(block => block?.type === "text").map(b => b.text).join(""),
    "offline",
  );
});
