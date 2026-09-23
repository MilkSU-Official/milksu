import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const codingImageGenToolName = "milksu_imagegen";
/** Unset-env fallback for tests. Product calls use MILKSU_IMAGEGEN_MODEL from the live catalog. */
export const codingImageGenModel = "openai-image/gpt-image-2";

const defaultBaseURL = "https://tokenflux.dev/v1";
const maxReferenceBytes = 8 * 1024 * 1024;
const maxOutputBytes = 8 * 1024 * 1024;
const maxResponseBytes = 12 * 1024 * 1024;
const requestTimeoutMilliseconds = 180_000;

/** Canonical GPT-Image / Grok Imagine sizes used by MilkSU tooling. */
const canonicalSizes = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const canonicalQualities = new Set(["low", "medium", "high"]);

const outputCostUSD = {
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
  "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
};

/**
 * Request-shape profiles for OpenAI-compatible Images relays.
 * Domestic / Imagen / FLUX relays often reject GPT-Image-only fields
 * (quality low|medium|high, background, moderation, output_format).
 */
const sizeAliasToCanonical = new Map([
  ["1024x1024", "1024x1024"],
  ["1536x1024", "1536x1024"],
  ["1024x1536", "1024x1536"],
  ["1792x1024", "1536x1024"],
  ["1024x1792", "1024x1536"],
  ["2048x2048", "1024x1024"],
  ["256x256", "1024x1024"],
  ["512x512", "1024x1024"],
  ["auto", "1024x1024"],
]);

const qualityAliasToCanonical = new Map([
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["auto", "medium"],
  ["standard", "medium"],
  ["hd", "high"],
]);

/**
 * @typedef {"gpt-image" | "images-minimal" | "gemini"} ImageGenRequestProfile
 */

/**
 * Request shape for a model whose prefix ends in -image.
 * google-image uses Gemini generateContent. gpt-image uses the GPT Image
 * body. x-ai-image / grok-imagine and other -image routes use the small
 * Images API body.
 * @param {string} model
 * @returns {ImageGenRequestProfile}
 */
export function imageGenRequestProfile(model = resolveImageGenModel()) {
  const id = String(model ?? "").trim().toLowerCase();
  const vendor = id.split("/")[0] || "";
  if (vendor === "google-image") return "gemini";
  if (id.includes("gpt-image")) return "gpt-image";
  return "images-minimal";
}

export function resolveImageGenModel(env = process.env) {
  return String(env.MILKSU_IMAGEGEN_MODEL ?? "").trim()
    || String(env.OPENAI_IMAGE_MODEL ?? "").trim()
    || codingImageGenModel;
}

export function resolveImageGenAPIKey(env = process.env) {
  return String(env.MILKSU_IMAGEGEN_API_KEY ?? "").trim()
    || String(env.OPENAI_API_KEY ?? "").trim();
}

export function resolveImageGenBaseURLValue(env = process.env) {
  return String(env.MILKSU_IMAGEGEN_BASE_URL ?? "").trim()
    || String(env.OPENAI_BASE_URL ?? "").trim()
    || defaultBaseURL;
}

export function resolveImageGenProvider(env = process.env) {
  return String(env.MILKSU_IMAGEGEN_PROVIDER ?? "").trim() || "tokenflux";
}

export function imageGenIsConfigured(env = process.env) {
  return Boolean(
    String(env.MILKSU_IMAGEGEN_CONFIGURED ?? "").trim() === "1"
    || resolveImageGenAPIKey(env),
  ) && Boolean(resolveImageGenModel(env));
}

export function imageGenSupportsEdit(model = resolveImageGenModel()) {
  const id = String(model ?? "").trim().toLowerCase();
  return id.includes("gpt-image") || id.includes("grok-imagine");
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || normalized.startsWith("127.");
}

export function normalizeImageGenBaseURL(value = resolveImageGenBaseURLValue()) {
  let url;
  try {
    url = new URL(String(value || defaultBaseURL));
  } catch {
    throw new Error("MilkSU ImageGen rejected an invalid ImageGen Base URL");
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error("MilkSU ImageGen rejected a credentialed or ambiguous ImageGen Base URL");
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("MilkSU ImageGen requires HTTPS except for a loopback test endpoint");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url;
}

function endpointFor(mode, baseURL, profile, model) {
  if (profile === "gemini") {
    const base = new URL(baseURL);
    const encoded = String(model ?? "").split("/").map(encodeURIComponent).join("/");
    return new URL(`${base.protocol}//${base.host}/v1beta/models/${encoded}:generateContent`);
  }
  const endpoint = new URL(baseURL);
  endpoint.pathname = `${endpoint.pathname}/images/${
    mode === "edit" ? "edits" : "generations"
  }`.replace(/\/{2,}/g, "/");
  return endpoint;
}

export function imageGenOutputEstimate(size, quality) {
  return outputCostUSD[size]?.[quality];
}

/**
 * Map provider / DALL·E / domestic size and quality aliases onto MilkSU canonical values.
 * @returns {{ size: string, quality: string, sizeMappedFrom?: string, qualityMappedFrom?: string }}
 */
export function normalizeImageGenSizeQuality(rawSize, rawQuality) {
  const sizeRaw = String(rawSize ?? "").trim().toLowerCase() || "1024x1024";
  const qualityRaw = String(rawQuality ?? "").trim().toLowerCase() || "low";
  const size = sizeAliasToCanonical.get(sizeRaw)
    || (canonicalSizes.has(sizeRaw) ? sizeRaw : "");
  const quality = qualityAliasToCanonical.get(qualityRaw)
    || (canonicalQualities.has(qualityRaw) ? qualityRaw : "");
  if (!size) {
    throw imageGenFailureError(
      "unsupported_size",
      `MilkSU ImageGen rejected unsupported size ${rawSize}. `
        + "Use 1024x1024, 1536x1024, or 1024x1536 (DALL·E 1792x1024 maps to 1536x1024).",
      { size: String(rawSize ?? ""), retryable: true },
    );
  }
  if (!quality) {
    throw imageGenFailureError(
      "unsupported_quality",
      `MilkSU ImageGen rejected unsupported quality ${rawQuality}. `
        + "Use low, medium, or high (hd maps to high, standard maps to medium).",
      { quality: String(rawQuality ?? ""), retryable: true },
    );
  }
  return {
    size,
    quality,
    ...(sizeRaw !== size ? { sizeMappedFrom: String(rawSize ?? "") } : {}),
    ...(qualityRaw !== quality ? { qualityMappedFrom: String(rawQuality ?? "") } : {}),
  };
}

export function formatImageGenApprovalInput(
  params,
  baseURL = resolveImageGenBaseURLValue(),
  model = resolveImageGenModel(),
  provider = resolveImageGenProvider(),
) {
  const mode = params?.mode === "edit" ? "参考图编辑" : "文本生成";
  let size = "1024x1024";
  let quality = "low";
  try {
    const normalized = normalizeImageGenSizeQuality(params?.size, params?.quality);
    size = normalized.size;
    quality = normalized.quality;
  } catch {
    // Keep defaults for the approval card when the model passed a bad size.
  }
  const endpoint = endpointFor(
    params?.mode,
    normalizeImageGenBaseURL(baseURL),
    imageGenRequestProfile(model),
    model,
  );
  const estimate = imageGenOutputEstimate(size, quality);
  return [
    `ImageGen ${mode}`,
    `Provider ${provider}/${model}`,
    `Endpoint ${endpoint.toString()}`,
    `输出 ${String(params?.outputPath ?? "").trim() || "(未指定)"}`,
    `尺寸 ${size}`,
    `质量 ${quality}`,
    params?.referencePath
      ? `参考图 ${String(params.referencePath).trim()}`
      : "",
    estimate === undefined
      ? "费用 Provider 计费，调用后显示 usage"
      : `预计输出费 USD ${estimate.toFixed(3)}，输入费和实际账单以 Provider 为准`,
  ].filter(Boolean).join("\n");
}

function redactReviewValue(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [credential redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[credential redacted]");
}

function reviewableImageGenInput(input) {
  return {
    mode: input?.mode === "edit" ? "edit" : "generate",
    prompt: redactReviewValue(input?.prompt),
    outputPath: redactReviewValue(input?.outputPath),
    ...(input?.referencePath
      ? { referencePath: redactReviewValue(input.referencePath) }
      : {}),
    ...(input?.size ? { size: redactReviewValue(input.size) } : {}),
    ...(input?.quality ? { quality: redactReviewValue(input.quality) } : {}),
  };
}

export async function authorizeImageGenToolCall({
  conversationId,
  event,
  approvalBroker,
}) {
  if (event?.toolName !== codingImageGenToolName) return undefined;
  const approved = await approvalBroker.request({
    conversationId,
    toolName: codingImageGenToolName,
    content: formatImageGenApprovalInput(event.input),
    input: JSON.stringify(reviewableImageGenInput(event.input), null, 2).slice(0, 16_000),
  });
  return approved
    ? undefined
    : {
        block: true,
        reason: "MilkSU user denied this ImageGen request",
      };
}

/**
 * Structured ImageGen failure. Message stays user- and model-readable;
 * `code` / `retryable` travel in the Error for tests and UI recovery.
 */
export function imageGenFailureError(code, message, extras = {}) {
  const error = new Error(String(message ?? "").trim() || "MilkSU ImageGen failed");
  error.name = "MilkSUImageGenError";
  error.code = String(code ?? "imagegen_failed");
  error.retryable = extras.retryable !== false;
  if (extras.size !== undefined) error.size = extras.size;
  if (extras.quality !== undefined) error.quality = extras.quality;
  if (extras.status !== undefined) error.status = extras.status;
  return error;
}

function validateParams(params) {
  const mode = params?.mode === "edit" ? "edit" : "generate";
  const prompt = String(params?.prompt ?? "").trim();
  const outputPath = String(params?.outputPath ?? "").trim();
  const referencePath = String(params?.referencePath ?? "").trim();
  if (!prompt || prompt.length > 32_000) {
    throw imageGenFailureError(
      "invalid_prompt",
      "MilkSU ImageGen requires a prompt of 1-32000 characters",
      { retryable: true },
    );
  }
  if (!outputPath || extname(outputPath).toLowerCase() !== ".png") {
    throw imageGenFailureError(
      "invalid_output_path",
      "MilkSU ImageGen outputPath must name a new .png file",
      { retryable: true },
    );
  }
  const normalized = normalizeImageGenSizeQuality(params?.size, params?.quality);
  if (mode === "edit" && !referencePath) {
    throw imageGenFailureError(
      "missing_reference",
      "MilkSU ImageGen edit mode requires one workspace referencePath",
      { retryable: true },
    );
  }
  if (mode === "generate" && referencePath) {
    throw imageGenFailureError(
      "unexpected_reference",
      "MilkSU ImageGen generate mode does not accept referencePath",
      { retryable: true },
    );
  }
  return {
    mode,
    prompt,
    outputPath,
    referencePath,
    size: normalized.size,
    quality: normalized.quality,
    sizeMappedFrom: normalized.sizeMappedFrom,
    qualityMappedFrom: normalized.qualityMappedFrom,
  };
}

/**
 * Build the JSON / FormData body for the selected model profile.
 * GPT-Image keeps quality / output_format / background / moderation;
 * compat-minimal relays only get fields they commonly accept.
 */
export function buildImageGenRequestBody(params, {
  model,
  profile = imageGenRequestProfile(model),
  reference,
} = {}) {
  const selectedModel = String(model ?? "").trim() || codingImageGenModel;
  if (profile === "gemini") {
    const parts = [{ text: params.prompt }];
    return {
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      headers: { "Content-Type": "application/json" },
    };
  }
  if (params.mode === "edit") {
    const body = new FormData();
    body.append("model", selectedModel);
    body.append("prompt", params.prompt);
    body.append("n", "1");
    body.append("size", params.size);
    if (profile === "gpt-image") {
      body.append("quality", params.quality);
      body.append("output_format", "png");
      body.append("background", "opaque");
      body.append("moderation", "auto");
    } else {
      body.append("response_format", "b64_json");
    }
    body.append(
      "image[]",
      new Blob([reference.data], { type: reference.mediaType }),
      basename(reference.path),
    );
    return { body, headers: {} };
  }
  const payload = {
    model: selectedModel,
    prompt: params.prompt,
    n: 1,
  };
  if (profile === "gpt-image") {
    payload.size = params.size;
    payload.quality = params.quality;
    payload.output_format = "png";
    payload.background = "opaque";
    payload.moderation = "auto";
  } else if (String(selectedModel).toLowerCase().includes("grok-imagine")) {
    // x-ai-image accepts model/prompt/response_format. GPT-Image size and
    // quality fields are what made this group return 502.
    payload.response_format = "b64_json";
  } else {
    payload.size = params.size;
    payload.response_format = "b64_json";
  }
  return {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  };
}

export function imageBytesFromProvider(decoded) {
  const direct = decoded?.data?.[0]?.b64_json;
  if (typeof direct === "string" && direct) {
    return {
      encoded: direct,
      declaredMime: String(decoded.data[0].mime_type || decoded.data[0].mimeType || ""),
    };
  }
  const parts = decoded?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (typeof inline?.data === "string" && inline.data) {
      return {
        encoded: inline.data,
        declaredMime: String(inline.mimeType || inline.mime_type || ""),
      };
    }
  }
  return null;
}

function referenceMimeType(data) {
  if (
    data.length >= 8
    && data.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) return "image/png";
  if (
    data.length >= 3
    && data[0] === 0xff
    && data[1] === 0xd8
    && data[2] === 0xff
  ) return "image/jpeg";
  if (
    data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return "";
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    const startOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb);
    if (startOfFrame) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function imageInfo(data) {
  const mediaType = referenceMimeType(data);
  let dimensions = null;
  if (mediaType === "image/png") {
    if (data.length >= 24 && data.subarray(12, 16).toString("ascii") === "IHDR") {
      dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
  } else if (mediaType === "image/jpeg") {
    dimensions = jpegDimensions(data);
  }
  if (!mediaType || !dimensions?.width || !dimensions?.height || dimensions.width > 8192 || dimensions.height > 8192) {
    return null;
  }
  const ext = mediaType === "image/png" ? ".png" : mediaType === "image/jpeg" ? ".jpg" : ".webp";
  return { mediaType, ext, width: dimensions.width, height: dimensions.height };
}

function boundedInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function projectedUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  const inputDetails = usage.input_tokens_details
    && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details
    : {};
  const outputDetails = usage.output_tokens_details
    && typeof usage.output_tokens_details === "object"
    ? usage.output_tokens_details
    : {};
  return {
    inputTokens: boundedInteger(usage.input_tokens),
    inputImageTokens: boundedInteger(inputDetails.image_tokens),
    inputTextTokens: boundedInteger(inputDetails.text_tokens),
    outputTokens: boundedInteger(usage.output_tokens),
    outputImageTokens: boundedInteger(outputDetails.image_tokens),
    outputTextTokens: boundedInteger(outputDetails.text_tokens),
    totalTokens: boundedInteger(usage.total_tokens),
  };
}

async function readBoundedResponse(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw imageGenFailureError(
      "response_too_large",
      "MilkSU ImageGen Provider response exceeded the safe size limit",
      { retryable: true },
    );
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw imageGenFailureError(
        "response_too_large",
        "MilkSU ImageGen Provider response exceeded the safe size limit",
        { retryable: true },
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function redactProviderMessage(value, apiKey) {
  let message = String(value ?? "").trim();
  if (apiKey) message = message.replaceAll(apiKey, "[credential redacted]");
  message = message
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [credential redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[credential redacted]");
  return message.slice(0, 800);
}

function providerFailureHint(message) {
  const text = String(message ?? "").toLowerCase();
  if (/size|dimension|resolution|1792|1536|1024x|width|height/.test(text)) {
    return " Retry with size 1024x1024, 1536x1024, or 1024x1536.";
  }
  if (/quality|hd|standard/.test(text)) {
    return " Retry with quality low, medium, or high.";
  }
  if (/unknown parameter|unsupported|invalid.*(?:field|param|argument)|extra inputs/.test(text)) {
    return " This ImageGen model may reject GPT-Image-only fields; MilkSU will omit them on the next call for non-GPT-Image models.";
  }
  return " Adjust size or quality, or switch the ImageGen model in Settings → Models, then retry.";
}

function providerFailure(status, data, apiKey, model) {
  let decoded;
  try {
    decoded = JSON.parse(data.toString("utf8"));
  } catch {
    decoded = undefined;
  }
  const message = redactProviderMessage(
    decoded?.error?.message || decoded?.message || "",
    apiKey,
  );
  const code = redactProviderMessage(decoded?.error?.code || "", apiKey);
  const hint = providerFailureHint(message || code);
  return imageGenFailureError(
    code || "provider_rejected",
    `MilkSU ImageGen failed (${status})`
      + (model ? ` for ${model}` : "")
      + (code ? ` [${code}]` : "")
      + (message ? `: ${message}` : "")
      + `.${hint}`,
    { status, retryable: true },
  );
}

async function writeNewFile(path, displayPath, data) {
  let file;
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(data);
    await file.sync();
    await file.close();
    file = undefined;
    await link(temporary, path);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw imageGenFailureError(
        "output_exists",
        `MilkSU ImageGen will not overwrite existing output: ${displayPath}`,
        { retryable: true },
      );
    }
    throw imageGenFailureError(
      "write_failed",
      `MilkSU ImageGen could not write output ${displayPath}: ${
        redactProviderMessage(error?.message || error, "")
      }`,
      { retryable: true },
    );
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function combinedSignal(signal) {
  const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createImageGenTool(
  workspace,
  {
    ensureRead,
    ensureMutation,
    fetchImpl = globalThis.fetch,
    apiKey = resolveImageGenAPIKey(),
    baseURL = resolveImageGenBaseURLValue(),
    model = resolveImageGenModel(),
    provider = resolveImageGenProvider(),
  } = {},
) {
  const selectedModel = String(model ?? "").trim() || codingImageGenModel;
  const selectedProvider = String(provider ?? "").trim() || "tokenflux";
  const requestProfile = imageGenRequestProfile(selectedModel);
  return defineTool({
    name: codingImageGenToolName,
    label: "Generate or edit a project image",
    description: "Generate one PNG from a text prompt or edit one workspace image with the "
      + `configured ImageGen model (${selectedModel}). Every call pauses for separate user `
      + "approval because it uses a credentialed network request with Provider cost. The "
      + "Provider credential never enters tool input or output. outputPath must be a new "
      + "workspace .png path and is never overwritten. Providers that return JPEG are saved "
      + "as .jpg next to that name. This tool is independent of the chat "
      + "model selected in the composer. Preferred sizes: 1024x1024, 1536x1024, 1024x1536; "
      + "quality: low, medium, or high.",
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal("generate"),
        Type.Literal("edit"),
      ]),
      prompt: Type.String({ minLength: 1, maxLength: 32_000 }),
      outputPath: Type.String({
        minLength: 1,
        maxLength: 1024,
        description: "New workspace-relative .png path. Existing files are rejected.",
      }),
      referencePath: Type.Optional(Type.String({
        minLength: 1,
        maxLength: 1024,
        description: "One workspace PNG/JPEG/WebP used only in edit mode.",
      })),
      // Accept string aliases (DALL·E 1792x1024, hd, standard). Normalization
      // happens in execute so TypeBox does not discard the call before mapping.
      size: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
      quality: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    }),
    execute: async (_toolCallId, rawParams, signal) => {
      const params = validateParams(rawParams);
      if (!String(apiKey ?? "").trim()) {
        throw imageGenFailureError(
          "not_configured",
          "ImageGen is unavailable: choose an ImageGen model in Settings > Models "
            + "and enable an account or personal TokenFlux key",
          { retryable: false },
        );
      }
      if (params.mode === "edit" && !imageGenSupportsEdit(selectedModel)) {
        throw imageGenFailureError(
          "edit_unsupported",
          `MilkSU ImageGen model ${selectedModel} does not support reference edits; `
            + "switch to GPT Image or Grok Imagine, or use generate mode",
          { retryable: true },
        );
      }
      if (typeof ensureRead !== "function" || typeof ensureMutation !== "function") {
        throw imageGenFailureError(
          "policy_unavailable",
          "MilkSU ImageGen workspace policy is unavailable",
          { retryable: false },
        );
      }
      const requestedOutput = isAbsolute(params.outputPath)
        ? params.outputPath
        : resolve(workspace, params.outputPath);
      const output = await ensureMutation(requestedOutput);
      const outputRelative = relative(workspace, output).replaceAll("\\", "/");
      await ensureMutation(dirname(output), true);
      try {
        await lstat(output);
        throw imageGenFailureError(
          "output_exists",
          `MilkSU ImageGen will not overwrite existing output: ${outputRelative}`,
          { retryable: true },
        );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      let reference;
      if (params.mode === "edit") {
        const requestedReference = isAbsolute(params.referencePath)
          ? params.referencePath
          : resolve(workspace, params.referencePath);
        const referencePath = await ensureRead(requestedReference);
        const metadata = await lstat(referencePath);
        if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxReferenceBytes) {
          throw imageGenFailureError(
            "invalid_reference",
            "MilkSU ImageGen reference must be a regular image up to 8 MiB",
            { retryable: true },
          );
        }
        const data = await readFile(referencePath);
        const mediaType = referenceMimeType(data);
        if (!mediaType) {
          throw imageGenFailureError(
            "invalid_reference_type",
            "MilkSU ImageGen reference must be PNG, JPEG, or WebP",
            { retryable: true },
          );
        }
        reference = {
          path: referencePath,
          relativePath: relative(workspace, referencePath).replaceAll("\\", "/"),
          data,
          mediaType,
        };
      }

      const base = normalizeImageGenBaseURL(baseURL);
      const endpoint = endpointFor(params.mode, base, requestProfile, selectedModel);
      const built = buildImageGenRequestBody(params, {
        model: selectedModel,
        profile: requestProfile,
        reference,
      });
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        ...built.headers,
      };

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: built.body,
          redirect: "error",
          signal: combinedSignal(signal),
        });
      } catch (error) {
        if (signal?.aborted) {
          throw imageGenFailureError(
            "cancelled",
            "MilkSU ImageGen request was cancelled",
            { retryable: true },
          );
        }
        if (error?.name === "TimeoutError") {
          throw imageGenFailureError(
            "timeout",
            "MilkSU ImageGen request timed out after 180 seconds",
            { retryable: true },
          );
        }
        throw imageGenFailureError(
          "network",
          `MilkSU ImageGen network request failed: ${
            redactProviderMessage(error?.message || error, apiKey)
          }. Check the network, then retry.`,
          { retryable: true },
        );
      }
      const responseData = await readBoundedResponse(
        response,
        response.ok ? maxResponseBytes : 64 * 1024,
      );
      if (!response.ok) {
        throw providerFailure(response.status, responseData, apiKey, selectedModel);
      }

      let decoded;
      try {
        decoded = JSON.parse(responseData.toString("utf8"));
      } catch {
        throw imageGenFailureError(
          "invalid_json",
          "MilkSU ImageGen Provider returned invalid JSON",
          { retryable: true },
        );
      }
      const extracted = imageBytesFromProvider(decoded);
      const encoded = extracted?.encoded ?? "";
      if (
        !encoded
        || encoded.length > Math.ceil(maxOutputBytes * 4 / 3) + 8
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      ) {
        throw imageGenFailureError(
          "invalid_image_data",
          "MilkSU ImageGen Provider returned invalid image data",
          { retryable: true },
        );
      }
      const image = Buffer.from(encoded, "base64");
      if (!image.length || image.length > maxOutputBytes) {
        throw imageGenFailureError(
          "output_too_large",
          "MilkSU ImageGen output exceeds the 8 MiB preview limit",
          { retryable: true },
        );
      }
      const info = imageInfo(image);
      if (!info) {
        throw imageGenFailureError(
          "invalid_image",
          "MilkSU ImageGen Provider returned an image MilkSU cannot preview",
          { retryable: true },
        );
      }
      let finalOutput = output;
      let finalRelative = outputRelative;
      if (extname(output).toLowerCase() !== info.ext) {
        const redirected = output.replace(/\.[^.]+$/, info.ext);
        finalOutput = await ensureMutation(redirected);
        finalRelative = relative(workspace, finalOutput).replaceAll("\\", "/");
      }
      await mkdir(dirname(finalOutput), { recursive: true, mode: 0o700 });
      await writeNewFile(finalOutput, finalRelative, image);

      const estimate = imageGenOutputEstimate(params.size, params.quality);
      const receipt = {
        schema: "milksu-imagegen-receipt/v1",
        status: "completed",
        operation: params.mode,
        provider: selectedProvider,
        model: selectedModel,
        endpoint: endpoint.toString(),
        input: {
          promptCharacters: params.prompt.length,
          referencePath: reference?.relativePath,
          referenceBytes: reference?.data.length,
        },
        output: {
          path: finalRelative,
          mediaType: info.mediaType,
          bytes: image.length,
          width: info.width,
          height: info.height,
          sha256: createHash("sha256").update(image).digest("hex"),
        },
        request: {
          size: params.size,
          quality: params.quality,
          profile: requestProfile,
          ...(params.sizeMappedFrom ? { sizeMappedFrom: params.sizeMappedFrom } : {}),
          ...(params.qualityMappedFrom
            ? { qualityMappedFrom: params.qualityMappedFrom }
            : {}),
        },
        usage: projectedUsage(decoded?.usage),
        cost: {
          currency: "USD",
          status: "output-estimate-only",
          outputEstimateUsd: estimate,
          inputEstimateUsd: null,
          actualTotalUsd: null,
          pricingAsOf: "2026-08-03",
          note: "Provider does not return the billed USD total here; actual input and total cost remain in Provider billing.",
        },
        providerRequestId: redactProviderMessage(
          response.headers.get("x-request-id") || "",
          apiKey,
        ).slice(0, 200),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
        details: receipt,
      };
    },
  });
}
