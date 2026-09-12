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

export function dshAcpHostPatchYaml(pluginPath) {
  const plugin = String(pluginPath ?? "").trim();
  if (!plugin) return "";
  return [
    "- id: acp",
    "  config:",
    `    provider: ${dshAcpProviderId}`,
    `    model: ${dshDefaultAcpModel}`,
    "- insert:",
    "  - id: milksu-dsh-host",
    `    name: ${JSON.stringify(plugin)}`,
    "",
  ].join("\n");
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
