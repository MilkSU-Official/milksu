import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const codingImageGenToolName = "milksu_imagegen";
export const codingImageGenModel = "gpt-image-2";

const defaultBaseURL = "https://api.openai.com/v1";
const maxReferenceBytes = 8 * 1024 * 1024;
const maxOutputBytes = 8 * 1024 * 1024;
const maxResponseBytes = 12 * 1024 * 1024;
const requestTimeoutMilliseconds = 180_000;
const supportedSizes = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const supportedQualities = new Set(["low", "medium", "high"]);
const outputCostUSD = {
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
  "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
};

function isLoopbackHost(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || normalized.startsWith("127.");
}

export function normalizeImageGenBaseURL(value = process.env.OPENAI_BASE_URL) {
  let url;
  try {
    url = new URL(String(value || defaultBaseURL));
  } catch {
    throw new Error("MilkSU ImageGen rejected an invalid OpenAI Base URL");
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error("MilkSU ImageGen rejected a credentialed or ambiguous OpenAI Base URL");
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("MilkSU ImageGen requires HTTPS except for a loopback test endpoint");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url;
}

function endpointFor(mode, baseURL) {
  const endpoint = new URL(baseURL);
  endpoint.pathname = `${endpoint.pathname}/images/${
    mode === "edit" ? "edits" : "generations"
  }`.replace(/\/{2,}/g, "/");
  return endpoint;
}

export function imageGenOutputEstimate(size, quality) {
  return outputCostUSD[size]?.[quality];
}

export function formatImageGenApprovalInput(
  params,
  baseURL = process.env.OPENAI_BASE_URL,
) {
  const mode = params?.mode === "edit" ? "参考图编辑" : "文本生成";
  const size = supportedSizes.has(params?.size) ? params.size : "1024x1024";
  const quality = supportedQualities.has(params?.quality) ? params.quality : "low";
  const endpoint = endpointFor(params?.mode, normalizeImageGenBaseURL(baseURL));
  const estimate = imageGenOutputEstimate(size, quality);
  return [
    `ImageGen ${mode}`,
    `Provider openai/${codingImageGenModel}`,
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
    input: JSON.stringify(event.input ?? {}, null, 2).slice(0, 16_000),
  });
  return approved
    ? undefined
    : {
        block: true,
        reason: "MilkSU user denied this ImageGen request",
      };
}

function validateParams(params) {
  const mode = params?.mode === "edit" ? "edit" : "generate";
  const prompt = String(params?.prompt ?? "").trim();
  const outputPath = String(params?.outputPath ?? "").trim();
  const referencePath = String(params?.referencePath ?? "").trim();
  const size = params?.size || "1024x1024";
  const quality = params?.quality || "low";
  if (!prompt || prompt.length > 32_000) {
    throw new Error("MilkSU ImageGen requires a prompt of 1-32000 characters");
  }
  if (!outputPath || extname(outputPath).toLowerCase() !== ".png") {
    throw new Error("MilkSU ImageGen outputPath must name a new .png file");
  }
  if (!supportedSizes.has(size)) {
    throw new Error(`MilkSU ImageGen rejected unsupported size ${size}`);
  }
  if (!supportedQualities.has(quality)) {
    throw new Error(`MilkSU ImageGen rejected unsupported quality ${quality}`);
  }
  if (mode === "edit" && !referencePath) {
    throw new Error("MilkSU ImageGen edit mode requires one workspace referencePath");
  }
  if (mode === "generate" && referencePath) {
    throw new Error("MilkSU ImageGen generate mode does not accept referencePath");
  }
  return { mode, prompt, outputPath, referencePath, size, quality };
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

function pngDimensions(data) {
  if (
    data.length < 24
    || !data.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    || data.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("MilkSU ImageGen Provider returned an invalid PNG");
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height || width > 3840 || height > 3840) {
    throw new Error("MilkSU ImageGen Provider returned invalid PNG dimensions");
  }
  return { width, height };
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
    throw new Error("MilkSU ImageGen Provider response exceeded the safe size limit");
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
      throw new Error("MilkSU ImageGen Provider response exceeded the safe size limit");
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

function providerFailure(status, data, apiKey) {
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
  return new Error(
    `MilkSU ImageGen Provider rejected the request (${status})`
      + (code ? ` [${code}]` : "")
      + (message ? `: ${message}` : ""),
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
      throw new Error(
        `MilkSU ImageGen will not overwrite existing output: ${displayPath}`,
      );
    }
    throw error;
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
    apiKey = process.env.OPENAI_API_KEY,
    baseURL = process.env.OPENAI_BASE_URL,
  } = {},
) {
  return defineTool({
    name: codingImageGenToolName,
    label: "Generate or edit a project image",
    description: "Generate one PNG from a text prompt or edit one workspace image with OpenAI "
      + `${codingImageGenModel}. Every call pauses for separate user approval because it uses a `
      + "credentialed network request with Provider cost. The Provider credential never enters "
      + "tool input or output. outputPath must be a new workspace .png file and is never overwritten.",
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
      size: Type.Optional(Type.Union([
        Type.Literal("1024x1024"),
        Type.Literal("1536x1024"),
        Type.Literal("1024x1536"),
      ])),
      quality: Type.Optional(Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
      ])),
    }),
    execute: async (_toolCallId, rawParams, signal) => {
      const params = validateParams(rawParams);
      if (!String(apiKey ?? "").trim()) {
        throw new Error(
          "OpenAI ImageGen is unavailable: configure and enable OpenAI in Settings > API Keys",
        );
      }
      if (typeof ensureRead !== "function" || typeof ensureMutation !== "function") {
        throw new Error("MilkSU ImageGen workspace policy is unavailable");
      }
      const requestedOutput = isAbsolute(params.outputPath)
        ? params.outputPath
        : resolve(workspace, params.outputPath);
      const output = await ensureMutation(requestedOutput);
      const outputRelative = relative(workspace, output).replaceAll("\\", "/");
      const outputParent = await ensureMutation(dirname(output), true);
      try {
        await lstat(output);
        throw new Error(
          `MilkSU ImageGen will not overwrite existing output: ${outputRelative}`,
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
          throw new Error("MilkSU ImageGen reference must be a regular image up to 8 MiB");
        }
        const data = await readFile(referencePath);
        const mediaType = referenceMimeType(data);
        if (!mediaType) {
          throw new Error("MilkSU ImageGen reference must be PNG, JPEG, or WebP");
        }
        reference = {
          path: referencePath,
          relativePath: relative(workspace, referencePath).replaceAll("\\", "/"),
          data,
          mediaType,
        };
      }

      const base = normalizeImageGenBaseURL(baseURL);
      const endpoint = endpointFor(params.mode, base);
      let body;
      let headers = {
        Authorization: `Bearer ${apiKey}`,
      };
      if (params.mode === "edit") {
        body = new FormData();
        body.append("model", codingImageGenModel);
        body.append("prompt", params.prompt);
        body.append("n", "1");
        body.append("size", params.size);
        body.append("quality", params.quality);
        body.append("output_format", "png");
        body.append("background", "opaque");
        body.append("moderation", "auto");
        body.append(
          "image[]",
          new Blob([reference.data], { type: reference.mediaType }),
          basename(reference.path),
        );
      } else {
        headers = { ...headers, "Content-Type": "application/json" };
        body = JSON.stringify({
          model: codingImageGenModel,
          prompt: params.prompt,
          n: 1,
          size: params.size,
          quality: params.quality,
          output_format: "png",
          background: "opaque",
          moderation: "auto",
        });
      }

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: combinedSignal(signal),
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new Error("MilkSU ImageGen request was cancelled");
        }
        if (error?.name === "TimeoutError") {
          throw new Error("MilkSU ImageGen request timed out after 180 seconds");
        }
        throw new Error(
          `MilkSU ImageGen network request failed: ${
            redactProviderMessage(error?.message || error, apiKey)
          }`,
        );
      }
      const responseData = await readBoundedResponse(
        response,
        response.ok ? maxResponseBytes : 64 * 1024,
      );
      if (!response.ok) throw providerFailure(response.status, responseData, apiKey);

      let decoded;
      try {
        decoded = JSON.parse(responseData.toString("utf8"));
      } catch {
        throw new Error("MilkSU ImageGen Provider returned invalid JSON");
      }
      const encoded = decoded?.data?.[0]?.b64_json;
      if (
        typeof encoded !== "string"
        || !encoded
        || encoded.length > Math.ceil(maxOutputBytes * 4 / 3) + 8
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      ) {
        throw new Error("MilkSU ImageGen Provider returned invalid image data");
      }
      const image = Buffer.from(encoded, "base64");
      if (!image.length || image.length > maxOutputBytes) {
        throw new Error("MilkSU ImageGen output exceeds the 8 MiB preview limit");
      }
      const dimensions = pngDimensions(image);
      await mkdir(outputParent, { recursive: true, mode: 0o700 });
      await writeNewFile(output, outputRelative, image);

      const estimate = imageGenOutputEstimate(params.size, params.quality);
      const receipt = {
        schema: "milksu-imagegen-receipt/v1",
        status: "completed",
        operation: params.mode,
        provider: "openai",
        model: codingImageGenModel,
        endpoint: endpoint.toString(),
        input: {
          promptCharacters: params.prompt.length,
          referencePath: reference?.relativePath,
          referenceBytes: reference?.data.length,
        },
        output: {
          path: outputRelative,
          mediaType: "image/png",
          bytes: image.length,
          width: dimensions.width,
          height: dimensions.height,
          sha256: createHash("sha256").update(image).digest("hex"),
        },
        request: {
          size: params.size,
          quality: params.quality,
        },
        usage: projectedUsage(decoded?.usage),
        cost: {
          currency: "USD",
          status: "output-estimate-only",
          outputEstimateUsd: estimate,
          inputEstimateUsd: null,
          actualTotalUsd: null,
          pricingAsOf: "2026-08-03",
          note: "OpenAI does not return the billed USD total here; actual input and total cost remain in Provider billing.",
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
