import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  dshAcpHostPatchYaml,
  resolveDshPackageDir,
  dshAcpModelOptionValue,
  dshAcpSupportsModel,
  dshDefaultAcpModel,
  dshModelDeclaresImageInput,
  dshModelLeaf,
  dshReasoningOptionValue,
  dshRouteModel,
} from "./session-config.js";

const v41 = JSON.stringify(["deepseek-official", "deepseek-flash"]);
const flash = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
const vision = JSON.stringify(["deepseek-official", "deepseek-v4-flash-vision-exp"]);

const configOptions = [
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

test("maps MilkSU model ids onto ACP catalog option values", () => {
  assert.equal(dshModelLeaf("deepseek/deepseek-v4-flash-vision-exp"), "deepseek-v4-flash-vision-exp");
  assert.equal(dshAcpSupportsModel("deepseek-v4-flash"), true);
  assert.equal(dshAcpSupportsModel("grok-4.5"), false);
  assert.equal(dshAcpModelOptionValue(configOptions, "deepseek-v4-flash-vision-exp"), vision);
  assert.equal(dshAcpModelOptionValue(configOptions, "x-ai/grok-4.6"), "");
});

test("TokenFlux default Flash is DSH deepseek-flash (V4.1), not text-only v4-flash", () => {
  assert.equal(dshDefaultAcpModel, "deepseek-flash");
  assert.equal(dshRouteModel("deepseek/deepseek-v4-flash"), "deepseek-flash");
  assert.equal(dshRouteModel("deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(dshRouteModel("deepseek-flash"), "deepseek-flash");
  assert.equal(dshAcpModelOptionValue(configOptions, "deepseek/deepseek-v4-flash"), v41);
  assert.equal(dshModelDeclaresImageInput("deepseek/deepseek-v4-flash"), true);
  const here = dirname(fileURLToPath(import.meta.url));
  const computerUse = resolveDshPackageDir(here, "@deepseek-ai/dsh-computer-use");
  const autoReview = resolveDshPackageDir(here, "@deepseek-ai/dsh-experimental-auto-review");
  const patch = dshAcpHostPatchYaml("/abs/host-plugin.mjs", { computerUse, autoReview });
  assert.match(patch, /id: acp/);
  assert.match(patch, /model: deepseek-flash/);
  assert.doesNotMatch(patch, /model: deepseek-v4-flash/);
  assert.match(patch, /computer-use/);
  assert.match(patch, /auto-review/);
  assert.ok(computerUse.endsWith("/lib/index.js"));
  assert.ok(autoReview.endsWith("/lib/index.js"));
  assert.match(patch, new RegExp(computerUse.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(patch, /browser-use-playwright-mcp/);
  assert.doesNotMatch(patch, /cua-driver-mcp/);
  assert.doesNotMatch(patch, /protocol: chat-completions/);
  const tokenfluxPatch = dshAcpHostPatchYaml("/abs/host-plugin.mjs", {
    computerUse,
    autoReview,
    protocol: "chat-completions",
  });
  assert.match(tokenfluxPatch, /id: llm-deepseek/);
  assert.match(tokenfluxPatch, /protocol: chat-completions/);
});

test("only DeepSeek catalog vision routes declare image input", () => {
  assert.equal(dshModelDeclaresImageInput("deepseek-v4-flash"), false);
  assert.equal(dshModelDeclaresImageInput("deepseek-v4-pro"), false);
  assert.equal(dshModelDeclaresImageInput("deepseek-flash"), true);
  assert.equal(dshModelDeclaresImageInput("deepseek/deepseek-v4-flash-vision-exp"), true);
});

test("maps thinking level onto advertised reasoning effort", () => {
  assert.equal(dshReasoningOptionValue(configOptions, { enabled: true, level: "high" }), "high");
  assert.equal(dshReasoningOptionValue(configOptions, { enabled: false, level: "high" }), "");
  assert.equal(dshReasoningOptionValue(configOptions, { enabled: true, level: "off" }), "");
  assert.equal(dshReasoningOptionValue(configOptions, { enabled: true, level: "xhigh" }), "");
});
