import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  dshAcpHostPatchYaml,
  dshPIAIRoutes,
  resolveDshPackageDir,
  dshAcpModelOptionValue,
  dshAcpSupportsModel,
  dshDefaultAcpModel,
  dshModelDeclaresImageInput,
  dshModelLeaf,
  dshProviderRoute,
  dshReasoningOptionValue,
  dshRouteModel,
  dshTalksToTokenFlux,
  dshWireModel,
} from "./session-config.js";

const here = dirname(fileURLToPath(import.meta.url));
const computerUse = resolveDshPackageDir(here, "@deepseek-ai/dsh-computer-use");
const autoReview = resolveDshPackageDir(here, "@deepseek-ai/dsh-experimental-auto-review");

const officialEnv = { MILKSU_DSH_PI_AI_ROUTES: JSON.stringify({ deepseekOfficial: true }) };
const tokenfluxEnv = { MILKSU_DSH_PI_AI_ROUTES: JSON.stringify({
  deepseekOfficial: false,
  providers: {
    tokenflux: {
      api: "openai-completions",
      baseURL: "https://tokenflux.dev/v1",
      apiKeyEnv: "TOKENFLUX_API_KEY",
      displayName: "TokenFlux",
      models: [
        {
          id: "deepseek/deepseek-flash",
          name: "DeepSeek Flash",
          contextWindow: 1000000,
          maxTokens: 393216,
          image: true,
          reasoningEfforts: { low: "low", high: "high", max: "max" },
        },
        { id: "x-ai/grok-4.6", name: "Grok 4.6", contextWindow: 500000, maxTokens: 500000 },
      ],
    },
    anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", displayName: "Anthropic" },
  },
}) };

const v41 = JSON.stringify(["deepseek-official", "deepseek-flash"]);
const flash = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
const vision = JSON.stringify(["deepseek-official", "deepseek-v4-flash-vision-exp"]);
const tokenfluxFlash = JSON.stringify(["tokenflux", "deepseek/deepseek-flash"]);
const tokenfluxGrok = JSON.stringify(["tokenflux", "x-ai/grok-4.6"]);
const anthropicSonnet = JSON.stringify(["anthropic", "claude-sonnet-5"]);

const officialConfigOptions = [
  {
    id: "model",
    currentValue: flash,
    options: [{
      group: "deepseek-official",
      options: [
        { value: v41, name: "deepseek-flash" },
        { value: flash, name: "deepseek-v4-flash" },
        { value: vision, name: "deepseek-v4-flash-vision-exp" },
      ],
    }],
  },
  {
    id: "reasoning_effort",
    options: [
      { value: "", name: "Provider default" },
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
];

const multiProviderConfigOptions = [
  {
    id: "model",
    currentValue: tokenfluxFlash,
    options: [
      {
        group: "TokenFlux",
        options: [
          { value: tokenfluxFlash, name: "deepseek/deepseek-flash" },
          { value: tokenfluxGrok, name: "x-ai/grok-4.6" },
        ],
      },
      {
        group: "Anthropic",
        options: [{ value: anthropicSonnet, name: "claude-sonnet-5" }],
      },
    ],
  },
];

test("host patch keeps the official row with its advisory catalog", () => {
  const patch = dshAcpHostPatchYaml("/abs/host-plugin.mjs", { computerUse, autoReview }, officialEnv);
  assert.match(patch, /id: llm-deepseek/);
  assert.match(patch, /id: deepseek-flash/);
  assert.match(patch, /model: deepseek-flash/);
  assert.doesNotMatch(patch, /model: deepseek-v4-flash\n/);
  assert.doesNotMatch(patch, /protocol/);
  assert.doesNotMatch(patch, /id: llm-pi-ai/);
  assert.match(patch, /computer-use/);
  assert.match(patch, /auto-review/);
  assert.doesNotMatch(patch, /cua-driver-mcp/);
});

test("host patch disables llm-deepseek and mounts llm-pi-ai for TokenFlux", () => {
  const patch = dshAcpHostPatchYaml("/abs/host-plugin.mjs", { computerUse, autoReview }, tokenfluxEnv);
  assert.match(patch, /- id: llm-deepseek\n  disabled: true/);
  assert.match(patch, /id: llm-pi-ai/);
  assert.match(patch, /api: openai-completions/);
  assert.match(patch, /baseURL: https:\/\/tokenflux\.dev\/v1/);
  assert.match(patch, /apiKeyEnv: TOKENFLUX_API_KEY/);
  assert.match(patch, /id: "deepseek\/deepseek-flash"/);
  assert.match(patch, /inputModalities: \[text, image\]/);
  assert.match(patch, /reasoningEfforts:\n {14}low: low\n {14}high: high\n {14}max: max/);
  assert.match(patch, /provider: tokenflux/);
  assert.match(patch, /model: deepseek\/deepseek-flash/);
  assert.match(patch, /apiKeyEnv: ANTHROPIC_API_KEY/);
  assert.doesNotMatch(patch, /protocol/);
});

test("host patch without routes stays on the official default", () => {
  const patch = dshAcpHostPatchYaml("/abs/host-plugin.mjs", { computerUse, autoReview }, {});
  assert.match(patch, /provider: deepseek-official/);
  assert.match(patch, /model: deepseek-flash/);
  assert.doesNotMatch(patch, /id: llm-pi-ai/);
  assert.doesNotMatch(patch, /id: llm-deepseek/);
});

test("package dir resolution still finds computer-use and auto-review", () => {
  assert.ok(computerUse.endsWith("/lib/index.js"));
  assert.ok(autoReview.endsWith("/lib/index.js"));
});

test("official DeepSeek selections keep the ACP leaf", () => {
  assert.equal(dshDefaultAcpModel, "deepseek-flash");
  assert.equal(dshRouteModel("deepseek/deepseek-v4-flash"), "deepseek-flash");
  assert.equal(dshRouteModel("deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(dshWireModel("deepseek/deepseek-v4-flash", officialEnv, "custom-relay-deepseek"), "deepseek-flash");
  assert.equal(dshWireModel("deepseek-flash", officialEnv, "deepseek"), "deepseek-flash");
  assert.equal(dshAcpSupportsModel("deepseek-v4-flash", "custom-relay-deepseek", officialEnv), true);
  assert.equal(dshAcpSupportsModel("grok-4.5", "custom-relay-deepseek", officialEnv), false);
  assert.equal(dshAcpSupportsModel("deepseek-v4-flash"), true);
  assert.equal(
    dshAcpModelOptionValue(officialConfigOptions, "deepseek-v4-flash-vision-exp", officialEnv, "deepseek"),
    vision,
  );
  assert.equal(
    dshAcpModelOptionValue(officialConfigOptions, "deepseek/deepseek-v4-flash", officialEnv, "custom-relay-deepseek"),
    v41,
  );
  assert.equal(
    dshAcpModelOptionValue(officialConfigOptions, "x-ai/grok-4.6", officialEnv, "deepseek"),
    "",
  );
});

test("TokenFlux selections keep the composite key on the tokenflux route", () => {
  assert.equal(dshTalksToTokenFlux(tokenfluxEnv), true);
  assert.equal(dshTalksToTokenFlux(officialEnv), false);
  assert.equal(dshTalksToTokenFlux({}), false);
  assert.equal(dshWireModel("deepseek/deepseek-flash", tokenfluxEnv, "tokenflux"), "deepseek/deepseek-flash");
  assert.equal(dshWireModel("x-ai/grok-4.6", tokenfluxEnv, "tokenflux"), "x-ai/grok-4.6");
  // Without a routed provider the selection falls back to the official leaf.
  assert.equal(dshWireModel("deepseek/deepseek-flash", {}), "deepseek-flash");
  assert.equal(dshAcpSupportsModel("deepseek/deepseek-flash", "tokenflux", tokenfluxEnv), true);
  assert.equal(dshAcpSupportsModel("x-ai/grok-4.6", "tokenflux", tokenfluxEnv), true);
  assert.equal(dshAcpSupportsModel("openai/gpt-5.4", "tokenflux", tokenfluxEnv), false);
  assert.equal(
    dshAcpModelOptionValue(multiProviderConfigOptions, "deepseek/deepseek-flash", tokenfluxEnv, "tokenflux"),
    tokenfluxFlash,
  );
  assert.equal(
    dshAcpModelOptionValue(multiProviderConfigOptions, "x-ai/grok-4.6", tokenfluxEnv, "tokenflux"),
    tokenfluxGrok,
  );
});

test("mounted catalog providers route by provider id", () => {
  assert.equal(dshProviderRoute("anthropic", tokenfluxEnv), "anthropic");
  assert.equal(dshProviderRoute("openai", tokenfluxEnv), "deepseek-official");
  assert.equal(dshProviderRoute("custom-relay-deepseek", tokenfluxEnv), "deepseek-official");
  assert.equal(dshAcpSupportsModel("claude-sonnet-5", "anthropic", tokenfluxEnv), true);
  assert.equal(
    dshAcpModelOptionValue(multiProviderConfigOptions, "claude-sonnet-5", tokenfluxEnv, "anthropic"),
    anthropicSonnet,
  );
});

test("image capability follows the routed model table", () => {
  assert.equal(dshModelDeclaresImageInput("deepseek-v4-flash", "deepseek", officialEnv), false);
  assert.equal(dshModelDeclaresImageInput("deepseek-flash", "deepseek", officialEnv), true);
  assert.equal(dshModelDeclaresImageInput("deepseek/deepseek-flash", "tokenflux", tokenfluxEnv), true);
  assert.equal(dshModelDeclaresImageInput("x-ai/grok-4.6", "tokenflux", tokenfluxEnv), false);
  assert.equal(dshModelLeaf("deepseek/deepseek-v4-flash-vision-exp"), "deepseek-v4-flash-vision-exp");
});

test("maps thinking level onto advertised reasoning effort", () => {
  assert.equal(dshReasoningOptionValue(officialConfigOptions, { enabled: true, level: "high" }), "high");
  assert.equal(dshReasoningOptionValue(officialConfigOptions, { enabled: false, level: "high" }), "");
  assert.equal(dshReasoningOptionValue(officialConfigOptions, { enabled: true, level: "off" }), "");
  assert.equal(dshReasoningOptionValue(officialConfigOptions, { enabled: true, level: "xhigh" }), "");
});

test("routes environment only parses provider facts", () => {
  assert.equal(dshPIAIRoutes({}), null);
  assert.equal(dshPIAIRoutes({ MILKSU_DSH_PI_AI_ROUTES: "not json" }), null);
  const routes = dshPIAIRoutes(tokenfluxEnv);
  assert.equal(routes.deepseekOfficial, false);
  assert.equal(typeof routes.providers.tokenflux.models[0].id, "string");
});
