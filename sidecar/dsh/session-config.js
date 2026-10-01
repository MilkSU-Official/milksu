import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// Static import so esbuild inlines this module into the packaged dsh-bridge.cjs.
// A createRequire(import.meta.url) reference survives bundling and expects a
// ../pi sibling file that the Sidecar package layout does not ship.
import tokenfluxModelID from "../pi/tokenflux-model-id.cjs";

const { tokenfluxBareModelID } = tokenfluxModelID;

export const dshAcpProviderId = "deepseek-official";
export const tokenfluxChatCompletionsURL = "https://tokenflux.dev/v1";
export const dshTokenFluxProviderId = "tokenflux";
export const dshDeepSeekProviderIds = ["deepseek", "custom-relay-deepseek"];
export const dshPIAIRoutesEnvironment = "MILKSU_DSH_PI_AI_ROUTES";

// Product default Flash is DeepSeek V4.1 (`deepseek-flash`), which declares
// image input. DSH ACP's shipped profile still pins `deepseek-v4-flash`, a
// different text-only V4 route. This catalog only backs the official
// deepseek-official route; the TokenFlux route carries its own model table.
export const dshDefaultAcpModel = "deepseek-flash";

export const dshAcpModelIds = Object.freeze([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash-vision-exp",
]);

export const dshImageCapableModelIds = Object.freeze([
  "deepseek-flash",
  "deepseek-v4-flash-vision-exp",
]);

/**
 * The Go runtime composes MILKSU_DSH_PI_AI_ROUTES with the non-credential
 * provider facts for this spawn: which providers the dsh-llm-pi-ai adapter
 * may route to, their endpoints, model tables, and thinking levels.
 */
export function dshPIAIRoutes(env = process.env) {
  const raw = String(env?.[dshPIAIRoutesEnvironment] ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const providers = parsed.providers && typeof parsed.providers === "object"
      && !Array.isArray(parsed.providers)
      ? parsed.providers
      : {};
    return {
      deepseekOfficial: parsed.deepseekOfficial === true,
      providers,
    };
  } catch {
    return null;
  }
}

function dshTokenFluxRoute(env = process.env) {
  return dshPIAIRoutes(env)?.providers?.[dshTokenFluxProviderId] ?? null;
}

function dshTokenFluxModelIds(env = process.env) {
  const route = dshTokenFluxRoute(env);
  return Array.isArray(route?.models) ? route.models : [];
}

function dshTokenFluxModelEntry(modelId, env = process.env) {
  const raw = String(modelId ?? "").trim();
  if (!raw) return null;
  const bare = tokenfluxBareModelID(raw) || raw;
  for (const model of dshTokenFluxModelIds(env)) {
    const id = String(model?.id ?? "").trim();
    if (id === raw || id === bare) return model;
  }
  return null;
}

export function dshModelLeaf(modelId) {
  const raw = String(modelId ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.split("/").pop() ?? raw;
}

// The official deepseek-official route names its models by leaf; the catalog
// maps the V4.1 Flash product id onto that route's `deepseek-flash` entry.
export function dshRouteModel(modelId) {
  const raw = String(modelId ?? "").trim();
  if (/^deepseek\/deepseek-v4-flash$/i.test(raw)) {
    return dshDefaultAcpModel;
  }
  return dshModelLeaf(raw);
}

/**
 * Which provider group a MilkSU model selection routes to on DSH: the
 * official DeepSeek presets go to the deepseek-official row; TokenFlux and
 * the mounted official providers go to their dsh-llm-pi-ai route.
 */
export function dshProviderRoute(providerId, env = process.env) {
  const provider = String(providerId ?? "").trim().toLowerCase();
  if (dshDeepSeekProviderIds.includes(provider)) return dshAcpProviderId;
  const routes = dshPIAIRoutes(env);
  if (routes && provider && routes.providers[provider]) return provider;
  // A selection without a routed provider still resolves by model name so
  // legacy sessions (and the account source) keep their DeepSeek models.
  return dshAcpProviderId;
}

export function dshTalksToTokenFlux(env = process.env) {
  return Boolean(dshTokenFluxRoute(env));
}

// The official route speaks leaf model ids; TokenFlux keeps the catalog's
// composite keys on the wire. Other routed providers pass the selected id
// through unchanged so their pi-ai catalog entry matches.
export function dshWireModel(modelId, env = process.env, providerId = "") {
  const raw = String(modelId ?? "").trim();
  const route = dshProviderRoute(providerId, env);
  if (route === dshTokenFluxProviderId) return raw;
  if (route === dshAcpProviderId) return dshRouteModel(raw);
  return raw;
}

// The advisory catalog for the official deepseek-official route, named by
// leaf ids. The TokenFlux route carries its own snapshot-derived table.
function dshAdvisoryCatalogModels() {
  return [
    {
      id: "deepseek-flash",
      name: "DeepSeek-V41-Flash",
      image: true,
      inHistory: true,
    },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    {
      id: "deepseek-v4-flash-vision-exp",
      name: "DeepSeek-V4-Flash-Vision-Exp",
      image: true,
    },
  ];
}

function renderCatalogModelYaml(model, indent) {
  const pad = " ".repeat(indent);
  const rows = [
    `${pad}- id: ${model.id}`,
    `${pad}  name: ${model.name}`,
  ];
  if (model.image) {
    rows.push(`${pad}  inputModalities: [text, image]`);
  }
  if (model.inHistory) {
    rows.push(`${pad}  systemPromptUpdate: in-history`);
  }
  return rows;
}

export function dshAcpSupportsModel(modelId, providerId = "", env = process.env) {
  const route = dshProviderRoute(providerId, env);
  if (route === dshTokenFluxProviderId) {
    return Boolean(dshTokenFluxModelEntry(modelId, env));
  }
  if (route === dshAcpProviderId) {
    const leaf = dshRouteModel(modelId);
    return Boolean(leaf) && dshAcpModelIds.includes(leaf);
  }
  // Other mounted providers carry their model table in the pi-ai catalog;
  // availability is the route existing, matching the mounted route set.
  return true;
}

export function dshModelDeclaresImageInput(modelId, providerId = "", env = process.env) {
  const route = dshProviderRoute(providerId, env);
  if (route === dshTokenFluxProviderId) {
    return dshTokenFluxModelEntry(modelId, env)?.image === true;
  }
  return dshImageCapableModelIds.includes(dshRouteModel(modelId));
}

export function resolveDshPackageDir(here, packageName) {
  const name = String(packageName ?? "").trim();
  const root = String(here ?? "").trim();
  if (!name || !root) return "";
  // ACP --patch insert `name` is imported as an ES module from
  // $DSH_HOME/profiles/acp. Directory paths throw ERR_UNSUPPORTED_DIR_IMPORT;
  // resolve to the package entry file.
  const fromFiles = [
    join(root, "session-config.js"),
    join(root, "package.json"),
    join(root, "..", "..", "package.json"),
  ];
  for (const from of fromFiles) {
    try {
      const resolved = createRequire(from).resolve(name);
      if (resolved && existsSync(resolved)) return resolved;
    } catch {
      // Try the next resolution root.
    }
  }
  const parts = name.split("/").filter(Boolean);
  const fallbacks = [
    join(root, "node_modules", ...parts, "lib", "index.js"),
    join(root, "..", "..", "node_modules", ...parts, "lib", "index.js"),
  ];
  return fallbacks.find(candidate => existsSync(candidate)) || "";
}

function renderReasoningEffortsYaml(efforts, indent) {
  const levels = Object.keys(efforts);
  if (levels.length === 0) return [];
  const pad = " ".repeat(indent);
  const rows = [`${pad}reasoningEfforts:`];
  for (const level of levels) {
    const wire = efforts[level];
    // "off" without a wire value means dispatch sends no reasoning parameter.
    rows.push(wire === "" || wire == null ? `${pad}  ${level}:` : `${pad}  ${level}: ${wire}`);
  }
  return rows;
}

function renderRoutedModelYaml(model, indent) {
  const pad = " ".repeat(indent);
  const rows = [
    `${pad}- id: ${JSON.stringify(String(model.id))}`,
  ];
  if (model.name) rows.push(`${pad}  name: ${JSON.stringify(String(model.name))}`);
  if (model.contextWindow) rows.push(`${pad}  contextWindow: ${Number(model.contextWindow)}`);
  if (model.maxTokens) rows.push(`${pad}  maxTokens: ${Number(model.maxTokens)}`);
  if (model.image) rows.push(`${pad}  inputModalities: [text, image]`);
  rows.push(...renderReasoningEffortsYaml(model.reasoningEfforts ?? {}, indent + 2));
  return rows;
}

function renderPIAIProviderYaml(name, route, indent) {
  const pad = " ".repeat(indent);
  const rows = [`${pad}${name}:`];
  if (route.displayName) rows.push(`${pad}  displayName: ${JSON.stringify(String(route.displayName))}`);
  if (route.api) rows.push(`${pad}  api: ${route.api}`);
  if (route.baseURL) rows.push(`${pad}  baseURL: ${route.baseURL}`);
  rows.push(`${pad}  apiKeyEnv: ${route.apiKeyEnv}`);
  if (Array.isArray(route.models) && route.models.length > 0) {
    rows.push(`${pad}  models:`);
    for (const model of route.models) {
      rows.push(...renderRoutedModelYaml(model, indent + 4));
    }
  }
  return rows;
}

// The session default keeps the official row when its key is active and
// otherwise follows the TokenFlux route's first DeepSeek entry.
function dshDefaultSessionRoute(routes) {
  if (routes?.deepseekOfficial) {
    return { provider: dshAcpProviderId, model: dshDefaultAcpModel };
  }
  const models = routes?.providers?.[dshTokenFluxProviderId]?.models;
  if (Array.isArray(models) && models.length > 0) {
    const deepseek = models.find(model => String(model?.id ?? "").startsWith("deepseek/"));
    const chosen = deepseek ?? models[0];
    return { provider: dshTokenFluxProviderId, model: String(chosen?.id ?? "") };
  }
  return { provider: dshAcpProviderId, model: dshDefaultAcpModel };
}

export function dshAcpHostPatchYaml(pluginPath, packages = {}, env = process.env) {
  const plugin = String(pluginPath ?? "").trim();
  if (!plugin) return "";
  // Browser Use attach is process-wide and one CDP. MilkSU sessions each have
  // their own isolated browser, so Playwright is declared per session/new as
  // ACP stdio MCP named playwright-mcp. Official Cua Driver MCP talks to the
  // raw desktop; DSH sessions reuse the bounded computer-use-proxy instead.
  // Experimental packages must be absolute paths: ACP resolves inserts from
  // $DSH_HOME/profiles/acp, not the Sidecar node_modules.
  //
  // DSH 0.2 llm-deepseek speaks Anthropic Messages only, so this patch never
  // selects a protocol: the official row stays on the official endpoint, and
  // the TokenFlux path disables it in favor of the dsh-llm-pi-ai tokenflux
  // route (chat-completions at the /v1 OpenAI-compatible entry).
  const routes = dshPIAIRoutes(env);
  const rows = [];
  if (routes?.deepseekOfficial) {
    rows.push(
      "- id: llm-deepseek",
      "  config:",
      "    models:",
    );
    for (const model of dshAdvisoryCatalogModels()) {
      rows.push(...renderCatalogModelYaml(model, 6));
    }
  } else if (routes?.providers?.[dshTokenFluxProviderId]) {
    rows.push(
      "- id: llm-deepseek",
      "  disabled: true",
    );
  }
  const providerNames = Object.keys(routes?.providers ?? {});
  if (providerNames.length > 0) {
    rows.push(
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
    );
    for (const name of providerNames) {
      rows.push(...renderPIAIProviderYaml(name, routes.providers[name], 6));
    }
  }
  const session = dshDefaultSessionRoute(routes);
  rows.push(
    "- id: acp",
    "  config:",
    `    provider: ${session.provider}`,
    `    model: ${session.model}`,
    "- insert:",
    "  - id: milksu-dsh-host",
    `    name: ${JSON.stringify(plugin)}`,
  );
  const computerUse = String(packages.computerUse ?? "").trim();
  if (computerUse) {
    rows.push(
      "  - id: computer-use",
      `    name: ${JSON.stringify(computerUse)}`,
    );
  }
  const autoReview = String(packages.autoReview ?? "").trim();
  if (autoReview) {
    rows.push(
      "  - id: auto-review",
      `    name: ${JSON.stringify(autoReview)}`,
    );
  }
  rows.push("");
  return rows.join("\n");
}

function parseAcpModelOptionValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
  } catch {
    // Opaque values that are not JSON arrays still match on the leaf name.
  }
  return null;
}

export function dshAcpModelOptionValue(configOptions, modelId, env = process.env, providerId = "") {
  const wire = dshWireModel(modelId, env, providerId);
  if (!wire || !dshAcpSupportsModel(modelId, providerId, env)) return "";
  const targetGroup = dshProviderRoute(providerId, env);
  const modelOption = (Array.isArray(configOptions) ? configOptions : [])
    .find(option => option?.id === "model");
  let routedValue = "";
  let routedAlias = "";
  let leafValue = "";
  const leaf = dshModelLeaf(wire);
  for (const group of modelOption?.options ?? []) {
    for (const entry of group?.options ?? []) {
      const value = String(entry?.value ?? "");
      if (!value) continue;
      const parsed = parseAcpModelOptionValue(value);
      const groupProvider = parsed ? String(parsed[0] ?? "") : "";
      const candidate = parsed ? String(parsed[1] ?? "") : "";
      const name = String(entry?.name ?? "");
      const exact = candidate === wire || name === wire;
      if (groupProvider === targetGroup) {
        if (exact) return value;
        if (!routedAlias && leaf && (
          (candidate && dshModelLeaf(candidate) === leaf)
          || dshModelLeaf(name) === leaf
        )) {
          routedAlias = value;
        }
        continue;
      }
      // A selection without its routed group in the option list (catalog
      // providers resolve after registration) falls back to a leaf match.
      if (exact && targetGroup !== dshAcpProviderId) {
        if (!routedValue) routedValue = value;
        continue;
      }
      if (!leafValue && leaf && targetGroup === dshAcpProviderId && (
        candidate === leaf || name === leaf
      )) {
        leafValue = value;
      }
    }
  }
  return routedAlias || routedValue || leafValue;
}

export function dshReasoningOptionValue(configOptions, thinking) {
  const enabled = thinking && typeof thinking === "object"
    ? thinking.enabled !== false
    : true;
  const level = String(
    thinking && typeof thinking === "object" ? thinking.level : thinking ?? "",
  ).trim().toLowerCase();
  if (!enabled || !level || level === "off") return "";
  const option = (Array.isArray(configOptions) ? configOptions : [])
    .find(item => item?.id === "reasoning_effort");
  const match = (option?.options ?? []).find(entry => (
    String(entry?.value ?? "").toLowerCase() === level
  ));
  return match ? String(match.value) : "";
}
