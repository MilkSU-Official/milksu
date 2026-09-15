import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const dshAcpProviderId = "deepseek-official";

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
  const rows = [];
  if (protocol === "chat-completions") {
    rows.push(
      "- id: llm-deepseek",
      "  config:",
      "    protocol: chat-completions",
    );
  }
  rows.push(
    "- id: acp",
    "  config:",
    `    provider: ${dshAcpProviderId}`,
    `    model: ${dshDefaultAcpModel}`,
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

export function dshAcpModelOptionValue(configOptions, modelId) {
  const leaf = dshRouteModel(modelId);
  if (!leaf || !dshAcpSupportsModel(leaf)) return "";
  const modelOption = (Array.isArray(configOptions) ? configOptions : [])
    .find(option => option?.id === "model");
  for (const group of modelOption?.options ?? []) {
    for (const entry of group?.options ?? []) {
      const value = String(entry?.value ?? "");
      if (!value) continue;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && dshModelLeaf(parsed[1]) === leaf) return value;
      } catch {
        // Opaque values that are not JSON arrays still match on the leaf name.
      }
      if (dshModelLeaf(entry?.name) === leaf) return value;
    }
  }
  return "";
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
