import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const { tokenfluxBareModelID } = createRequire(import.meta.url)("../pi/tokenflux-model-id.cjs");

export const dshAcpProviderId = "deepseek-official";
export const tokenfluxChatCompletionsURL = "https://tokenflux.dev/v1";
export const dshOfficialVendorPrefix = "deepseek";

// Product default Flash is DeepSeek V4.1 (`deepseek-flash`), which declares
// image input. DSH ACP's shipped profile still pins `deepseek-v4-flash`, a
// different text-only V4 route.
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

export function dshModelLeaf(modelId) {
  const raw = String(modelId ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.split("/").pop() ?? raw;
}

export function dshRouteModel(modelId) {
  const raw = String(modelId ?? "").trim();
  if (/^deepseek\/deepseek-v4-flash$/i.test(raw)) {
    return dshDefaultAcpModel;
  }
  return dshModelLeaf(raw);
}

export function dshTalksToTokenFlux(env = process.env) {
  const base = String(env?.DEEPSEEK_BASE_URL ?? "").trim().replace(/\/+$/u, "").toLowerCase();
  return base === tokenfluxChatCompletionsURL;
}

// ACP catalog stays on the leaf (`deepseek-flash`). TokenFlux composite keys
// require the product prefix/model on the HTTP wire. Official DeepSeek keeps
// the leaf. Do not invent a prefix when the product selection is already bare.
export function dshWireModel(modelId, env = process.env) {
  const raw = String(modelId ?? "").trim();
  const leaf = dshRouteModel(raw);
  if (!leaf || !dshTalksToTokenFlux(env)) return leaf;
  const bare = tokenfluxBareModelID(raw);
  if (!bare || bare === raw) return leaf;
  const prefix = raw.slice(0, raw.length - bare.length - 1);
  return prefix ? `${prefix}/${leaf}` : leaf;
}

function dshAdvisoryCatalogModels(tokenflux) {
  const official = [
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
  if (!tokenflux) return official;
  return official.flatMap(model => ([
    { ...model, id: `${dshOfficialVendorPrefix}/${model.id}` },
    model,
  ]));
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

export function dshAcpSupportsModel(modelId) {
  const leaf = dshRouteModel(modelId);
  return Boolean(leaf) && dshAcpModelIds.includes(leaf);
}

export function dshModelDeclaresImageInput(modelId) {
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

export function dshAcpHostPatchYaml(pluginPath, packages = {}) {
  const plugin = String(pluginPath ?? "").trim();
  if (!plugin) return "";
  // Browser Use attach is process-wide and one CDP. MilkSU sessions each have
  // their own isolated browser, so Playwright is declared per session/new as
  // ACP stdio MCP named playwright-mcp. Official Cua Driver MCP talks to the
  // raw desktop; DSH sessions reuse the bounded computer-use-proxy instead.
  // Experimental packages must be absolute paths: ACP resolves inserts from
  // $DSH_HOME/profiles/acp, not the Sidecar node_modules.
  const protocol = String(packages.protocol ?? "").trim();
  const tokenflux = packages.tokenflux === true;
  const rows = [];
  if (protocol === "chat-completions") {
    rows.push(
      "- id: llm-deepseek",
      "  config:",
      "    protocol: chat-completions",
    );
    if (tokenflux) {
      rows.push("    models:");
      for (const model of dshAdvisoryCatalogModels(true)) {
        rows.push(...renderCatalogModelYaml(model, 6));
      }
    }
  }
  rows.push(
    "- id: acp",
    "  config:",
    `    provider: ${dshAcpProviderId}`,
    `    model: ${tokenflux ? `${dshOfficialVendorPrefix}/${dshDefaultAcpModel}` : dshDefaultAcpModel}`,
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

export function dshAcpModelOptionValue(configOptions, modelId, env = process.env) {
  const leaf = dshRouteModel(modelId);
  if (!leaf || !dshAcpSupportsModel(leaf)) return "";
  const wire = dshWireModel(modelId, env) || leaf;
  const modelOption = (Array.isArray(configOptions) ? configOptions : [])
    .find(option => option?.id === "model");
  let leafValue = "";
  let leafAlias = "";
  for (const group of modelOption?.options ?? []) {
    for (const entry of group?.options ?? []) {
      const value = String(entry?.value ?? "");
      if (!value) continue;
      const parsed = parseAcpModelOptionValue(value);
      const candidate = parsed ? String(parsed[1] ?? "") : "";
      const name = String(entry?.name ?? "");
      if (candidate === wire || name === wire) return value;
      if (candidate === leaf || name === leaf) {
        if (!leafValue) leafValue = value;
        continue;
      }
      if (!leafAlias && (
        (candidate && dshModelLeaf(candidate) === leaf)
        || dshModelLeaf(name) === leaf
      )) {
        leafAlias = value;
      }
    }
  }
  return leafValue || leafAlias;
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
