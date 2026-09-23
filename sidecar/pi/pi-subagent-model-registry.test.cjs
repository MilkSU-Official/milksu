"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { currentProviderDefinition } = require("./current-provider-runtime.cjs");
const { guardSubagentSpawn } = require("./pi-subagents-spawn.cjs");
const {
  apiKeyEnvFor,
  applyChildModelEnvironment,
  childShellDeniedEnvNames,
  publicProvider,
  rememberSessionProviders,
  resetChildModelRegistry,
  subagentKeyEnv,
} = require("./pi-subagent-model-registry.cjs");

const repositoryRoot = resolve(__dirname, "..", "..");
const sentinel = "tokenflux-secret-must-not-be-written";
const turnSecret = "turn-relay-secret-must-not-be-written";

function tokenfluxDefinition() {
  return currentProviderDefinition("tokenflux", "deepseek/deepseek-flash", {
    TOKENFLUX_API_KEY: sentinel,
    TOKENFLUX_BASE_URL: "https://tokenflux.dev/v1",
  });
}

test("child registry resolves the parent TokenFlux id and keeps the key out of the file", async () => {
  resetChildModelRegistry();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const agentRoot = mkdtempSync(join(tmpdir(), "milksu-child-models-"));
  try {
    const definition = tokenfluxDefinition();
    assert.equal(definition.apiKey, sentinel);
    const published = publicProvider(
      "tokenflux",
      definition,
      apiKeyEnvFor("tokenflux"),
    );
    const account = publicProvider("milksu-account", {
      name: "MilkSU 账户分配模型",
      baseUrl: "https://tokenflux.dev/v1",
      api: "openai-completions",
      apiKey: sentinel,
      models: definition.models.filter(item => item.id === "deepseek/deepseek-flash"),
    }, "MILKSU_RELAY_KEY");
    const route = publicProvider("milksu-route", {
      name: "MilkSU 模型来源",
      baseUrl: "https://tokenflux.dev/v1",
      api: "openai-completions",
      apiKey: sentinel,
      models: definition.models.filter(item => item.id === "deepseek/deepseek-flash"),
    }, "TOKENFLUX_API_KEY");
    rememberSessionProviders("conversation", [published, account, route]);
    const childEnv = applyChildModelEnvironment({
      MILKSU_PI_AGENT_DIR: agentRoot,
      TOKENFLUX_API_KEY: sentinel,
    }, agentRoot);
    const registryPath = join(childEnv.PI_CODING_AGENT_DIR, "models.json");
    const body = readFileSync(registryPath, "utf8");
    const config = JSON.parse(body);
    assert.equal(body.includes(sentinel), false);
    assert.equal(config.providers.tokenflux.apiKey, "$TOKENFLUX_API_KEY");
    assert.equal(config.providers.tokenflux.baseUrl, "https://tokenflux.dev/v1");
    const model = config.providers.tokenflux.models.find(item => item.id === "deepseek/deepseek-flash");
    assert.ok(model);
    assert.equal(model.contextWindow, 1_000_000);
    assert.equal(model.maxTokens, 384_000);

    process.env.PI_CODING_AGENT_DIR = childEnv.PI_CODING_AGENT_DIR;
    process.env.PI_OFFLINE = "1";
    const runtimeModule = await import(pathToFileURL(join(
      repositoryRoot,
      "node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js",
    )).href);
    const resolverModule = await import(pathToFileURL(join(
      repositoryRoot,
      "node_modules/@earendil-works/pi-coding-agent/dist/core/model-resolver.js",
    )).href);
    const runtime = await runtimeModule.ModelRuntime.create({ refreshOnCreate: true });
    const resolved = resolverModule.resolveCliModel({
      cliModel: "tokenflux/deepseek/deepseek-flash",
      modelRuntime: runtime,
    });
    assert.equal(resolved.error, undefined, resolved.error);
    assert.equal(resolved.model.provider, "tokenflux");
    assert.equal(resolved.model.id, "deepseek/deepseek-flash");
    for (const provider of ["milksu-account", "milksu-route"]) {
      const inherited = resolverModule.resolveCliModel({
        cliModel: `${provider}/deepseek/deepseek-flash`,
        modelRuntime: runtime,
      });
      assert.equal(inherited.error, undefined, inherited.error);
      assert.equal(inherited.model.provider, provider);
      assert.equal(inherited.model.id, "deepseek/deepseek-flash");
    }
    const empty = await runtimeModule.ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: true,
    });
    const absent = resolverModule.resolveCliModel({
      cliModel: "tokenflux/deepseek/deepseek-flash",
      modelRuntime: empty,
    });
    assert.match(
      absent.error ?? "",
      /Model "tokenflux\/deepseek\/deepseek-flash" not found/,
    );

    const guarded = guardSubagentSpawn({
      command: process.execPath,
      args: ["runner.js"],
      env: {
        MILKSU_PI_AGENT_DIR: agentRoot,
        TOKENFLUX_API_KEY: sentinel,
        MILKSU_IMAGEGEN_API_KEY: "image-secret",
      },
      cwd: agentRoot,
      externalCli: false,
      platform: "linux",
    });
    assert.equal(guarded.env.PI_CODING_AGENT_DIR, childEnv.PI_CODING_AGENT_DIR);
    assert.equal(guarded.env.TOKENFLUX_API_KEY, sentinel);
    assert.equal(guarded.env.MILKSU_IMAGEGEN_API_KEY, undefined);

    resetChildModelRegistry();
    const turnRoot = mkdtempSync(join(tmpdir(), "milksu-child-turn-"));
    const provider = "custom-relay-team";
    const envName = subagentKeyEnv(provider);
    assert.equal(apiKeyEnvFor(provider, {}, { id: provider, key: turnSecret }), envName);
    const turnProvider = publicProvider(provider, {
      name: "Team",
      baseUrl: "https://relay.invalid/v1",
      api: "openai-completions",
      apiKey: turnSecret,
      models: [{
        id: "vendor/model",
        name: "vendor/model",
        contextWindow: 128000,
        maxTokens: 16384,
      }],
    }, envName);
    rememberSessionProviders("conversation", [turnProvider], { [envName]: turnSecret });
    const turnEnv = applyChildModelEnvironment({
      MILKSU_PI_AGENT_DIR: turnRoot,
      TOKENFLUX_API_KEY: sentinel,
    }, turnRoot);
    const turnBody = readFileSync(join(turnEnv.PI_CODING_AGENT_DIR, "models.json"), "utf8");
    assert.equal(turnBody.includes(turnSecret), false);
    assert.equal(turnBody.includes(sentinel), false);
    assert.equal(JSON.parse(turnBody).providers[provider].apiKey, `$${envName}`);
    assert.equal(turnEnv[envName], turnSecret);
    const external = guardSubagentSpawn({
      command: "cursor-agent",
      args: ["--print"],
      env: turnEnv,
      cwd: turnRoot,
      externalCli: true,
      platform: "linux",
    });
    assert.equal(external.env[envName], undefined);
    assert.equal(external.env.TOKENFLUX_API_KEY, undefined);
  } finally {
    resetChildModelRegistry();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  }
});

test("Pi shell deny list matches the child credential boundary", () => {
  const source = readFileSync(join(
    repositoryRoot,
    "node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js",
  ), "utf8");
  for (const name of childShellDeniedEnvNames) {
    assert.match(source, new RegExp(`"${name}"`));
  }
  assert.match(source, /MILKSU_SUBAGENT_KEY_/);
});
