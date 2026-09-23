import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve, sep } from "node:path";
import test from "node:test";
import {
  authorizeImageGenToolCall,
  codingImageGenToolName,
  codingImageGenModel,
  createImageGenTool,
  formatImageGenApprovalInput,
  imageGenOutputEstimate,
  normalizeImageGenBaseURL,
} from "./bridge-imagegen.js";

const validPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function response(value, options = {}) {
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": options.requestId ?? "request_imagegen_test",
    },
  });
}

function workspacePolicy(workspace) {
  const ensure = async path => {
    const candidate = resolve(path);
    const child = relative(workspace, candidate);
    if (child === ".." || child.startsWith(`..${sep}`)) {
      throw new Error(`test workspace denied ${path}`);
    }
    return candidate;
  };
  return {
    ensureRead: ensure,
    ensureMutation: ensure,
  };
}

async function fixture(t) {
  const workspace = await mkdtemp(joinPath(tmpdir(), "milksu-imagegen-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return workspace;
}

function joinPath(...parts) {
  return resolve(...parts);
}

test("ImageGen approval shows the exact paid scope without any credential", () => {
  const summary = formatImageGenApprovalInput(
    {
      mode: "edit",
      prompt: "Keep the subject and use a blue background",
      outputPath: "assets/edited.png",
      referencePath: "assets/source.png",
      size: "1024x1536",
      quality: "medium",
    },
    "https://api.openai.com/v1",
  );
  assert.match(summary, /ImageGen 参考图编辑/);
  assert.match(summary, new RegExp(codingImageGenModel.replace("/", "\\/")));
  assert.match(summary, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(summary, /assets\/edited\.png/);
  assert.match(summary, /assets\/source\.png/);
  assert.match(summary, /USD 0\.041/);
  assert.doesNotMatch(summary, /api.?key|authorization|bearer/i);
  assert.equal(imageGenOutputEstimate("1024x1024", "low"), 0.006);
});

test("ImageGen approval remains a separate boundary in every Coding mode", async () => {
  const requests = [];
  const secret = "sk-approval-secret-imagegen";
  const event = {
    toolName: codingImageGenToolName,
    input: {
      mode: "generate",
      prompt: `A blue circle with Bearer ${secret}`,
      outputPath: "assets/circle.png",
      apiKey: secret,
      headers: { Authorization: `Bearer ${secret}` },
    },
  };
  const approved = await authorizeImageGenToolCall({
    conversationId: "conversation-imagegen",
    event,
    approvalBroker: {
      request: async request => {
        requests.push(request);
        return true;
      },
    },
  });
  assert.equal(approved, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolName, codingImageGenToolName);
  assert.match(requests[0].content, /预计输出费/);
  assert.match(requests[0].input, /A blue circle/);
  assert.doesNotMatch(requests[0].input, new RegExp(secret));
  assert.doesNotMatch(requests[0].input, /apiKey|Authorization/);
  assert.match(requests[0].input, /\[credential redacted\]/);

  const denied = await authorizeImageGenToolCall({
    conversationId: "conversation-imagegen",
    event,
    approvalBroker: { request: async () => false },
  });
  assert.deepEqual(denied, {
    block: true,
    reason: "MilkSU user denied this ImageGen request",
  });
});

test("Draw page send authorizes ImageGen without a tool card", async () => {
  let requests = 0;
  const decision = await authorizeImageGenToolCall({
    conversationId: "conversation-imagegen",
    event: {
      toolName: codingImageGenToolName,
      input: {
        mode: "generate",
        prompt: "画个牛奶猫",
        outputPath: "milk-cat.png",
      },
    },
    approvalBroker: {
      request: async () => {
        requests += 1;
        return false;
      },
    },
    authorizedByDraw: true,
  });
  assert.equal(decision, undefined);
  assert.equal(requests, 0);
});

test("ImageGen rejects credentialed and non-loopback insecure Provider URLs", () => {
  assert.throws(
    () => normalizeImageGenBaseURL("https://user:secret@api.openai.com/v1"),
    /credentialed or ambiguous/,
  );
  assert.throws(
    () => normalizeImageGenBaseURL("http://provider.example.test/v1"),
    /requires HTTPS/,
  );
  assert.equal(
    normalizeImageGenBaseURL("http://127.0.0.1:43127/v1").toString(),
    "http://127.0.0.1:43127/v1",
  );
});

test("ImageGen generates a bounded new PNG and returns a reviewable receipt", async t => {
  const workspace = await fixture(t);
  let request;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    baseURL: "https://api.openai.com/v1",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({
        data: [{ b64_json: validPNG.toString("base64") }],
        usage: {
          input_tokens: 11,
          input_tokens_details: { text_tokens: 11, image_tokens: 0 },
          output_tokens: 196,
          output_tokens_details: { text_tokens: 0, image_tokens: 196 },
          total_tokens: 207,
        },
      });
    },
  });
  const result = await tool.execute("generate", {
    mode: "generate",
    prompt: "A tiny blue dot",
    outputPath: "assets/dot.png",
    size: "1024x1024",
    quality: "low",
  });
  assert.equal(request.url, "https://api.openai.com/v1/images/generations");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.Authorization, "Bearer test-imagegen-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    model: codingImageGenModel,
    prompt: "A tiny blue dot",
    n: 1,
    size: "1024x1024",
    quality: "low",
    output_format: "png",
    background: "opaque",
    moderation: "auto",
  });
  assert.deepEqual(await readFile(joinPath(workspace, "assets/dot.png")), validPNG);
  const receipt = result.details;
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.operation, "generate");
  assert.equal(receipt.output.path, "assets/dot.png");
  assert.equal(receipt.output.mediaType, "image/png");
  assert.equal(receipt.output.width, 1);
  assert.equal(receipt.output.height, 1);
  assert.equal(receipt.usage.totalTokens, 207);
  assert.equal(receipt.cost.outputEstimateUsd, 0.006);
  assert.equal(receipt.cost.actualTotalUsd, null);
  assert.doesNotMatch(result.content[0].text, /test-imagegen-key/);
});

test("ImageGen edit sends one reviewed workspace image as multipart", async t => {
  const workspace = await fixture(t);
  await mkdir(joinPath(workspace, "assets"), { recursive: true });
  await writeFile(joinPath(workspace, "assets/source.png"), validPNG);
  let request;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    baseURL: "https://api.openai.com/v1",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({
        data: [{ b64_json: validPNG.toString("base64") }],
        usage: {
          input_tokens: 42,
          input_tokens_details: { text_tokens: 10, image_tokens: 32 },
          output_tokens: 196,
          output_tokens_details: { image_tokens: 196, text_tokens: 0 },
          total_tokens: 238,
        },
      });
    },
  });
  const result = await tool.execute("edit", {
    mode: "edit",
    prompt: "Make the background blue",
    referencePath: "assets/source.png",
    outputPath: "assets/edited.png",
    size: "1024x1024",
    quality: "low",
  });
  assert.equal(request.url, "https://api.openai.com/v1/images/edits");
  assert.equal(request.options.body.get("model"), codingImageGenModel);
  assert.equal(request.options.body.get("prompt"), "Make the background blue");
  assert.equal(request.options.body.get("input_fidelity"), null);
  const image = request.options.body.get("image[]");
  assert.equal(image.type, "image/png");
  assert.equal(image.name, "source.png");
  assert.equal(result.details.input.referencePath, "assets/source.png");
  assert.equal(result.details.input.referenceBytes, validPNG.length);
  assert.equal(result.details.usage.inputImageTokens, 32);
});

test("ImageGen never overwrites and does not call the Provider for an existing output", async t => {
  const workspace = await fixture(t);
  const output = joinPath(workspace, "existing.png");
  await writeFile(output, "keep");
  let calls = 0;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    fetchImpl: async () => {
      calls += 1;
      return response({ data: [{ b64_json: validPNG.toString("base64") }] });
    },
  });
  await assert.rejects(
    tool.execute("generate", {
      mode: "generate",
      prompt: "Do not replace the file",
      outputPath: "existing.png",
    }),
    /will not overwrite/,
  );
  assert.equal(calls, 0);
  assert.equal(await readFile(output, "utf8"), "keep");
});

test("ImageGen rejects output outside the workspace before contacting the Provider", async t => {
  const workspace = await fixture(t);
  let calls = 0;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    fetchImpl: async () => {
      calls += 1;
      return response({ data: [{ b64_json: validPNG.toString("base64") }] });
    },
  });
  await assert.rejects(
    tool.execute("generate", {
      mode: "generate",
      prompt: "Do not leave the project",
      outputPath: "../escaped.png",
    }),
    /workspace denied/,
  );
  assert.equal(calls, 0);
});

test("ImageGen rejects an oversized Provider response without leaving a partial output", async t => {
  const workspace = await fixture(t);
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    fetchImpl: async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(13 * 1024 * 1024) },
    }),
  });
  await assert.rejects(
    tool.execute("generate", {
      mode: "generate",
      prompt: "Reject the oversized response",
      outputPath: "too-large.png",
    }),
    /safe size limit/,
  );
  await assert.rejects(readFile(joinPath(workspace, "too-large.png")), /ENOENT/);
});

test("ImageGen redacts Provider failures and leaves no partial output", async t => {
  const workspace = await fixture(t);
  const secret = "sk-test-secret-imagegen";
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: secret,
    fetchImpl: async () => response({
      error: {
        code: "rate_limit",
        message: `Bearer ${secret} exceeded the limit`,
      },
    }, { status: 429 }),
  });
  let message = "";
  try {
    await tool.execute("generate", {
      mode: "generate",
      prompt: "This will fail",
      outputPath: "failed.png",
    });
    assert.fail("expected ImageGen to reject the Provider failure");
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /MilkSU ImageGen failed \(429\)/);
  assert.doesNotMatch(message, new RegExp(secret));
  await assert.rejects(readFile(joinPath(workspace, "failed.png")), /ENOENT/);
});

test("ImageGen maps DALL·E size aliases before contacting the Provider", async t => {
  const workspace = await fixture(t);
  let body;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    model: "openai/gpt-image-2",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(String(options.body));
      return response({ data: [{ b64_json: validPNG.toString("base64") }] });
    },
  });
  await tool.execute("generate", {
    mode: "generate",
    prompt: "Map DALL-E landscape size",
    outputPath: "mapped.png",
    size: "1792x1024",
    quality: "hd",
  });
  assert.equal(body.size, "1536x1024");
  assert.equal(body.quality, "high");
});

test("ImageGen omits GPT-Image-only fields for generic image routes", async t => {
  const workspace = await fixture(t);
  let body;
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    model: "future-lab-image/example",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(String(options.body));
      return response({ data: [{ b64_json: validPNG.toString("base64") }] });
    },
  });
  await tool.execute("generate", {
    mode: "generate",
    prompt: "Compat-minimal body",
    outputPath: "imagen.png",
    size: "1024x1024",
    quality: "low",
  });
  assert.equal(body.model, "future-lab-image/example");
  assert.equal(body.size, "1024x1024");
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.quality, undefined);
  assert.equal(body.output_format, undefined);
  assert.equal(body.background, undefined);
  assert.equal(body.moderation, undefined);
});

test("ImageGen saves a JPEG response as .jpg", async t => {
  const workspace = await fixture(t);
  const jpeg = Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc00011080001000103011100021101031101ffc40014000100000000000000000000000000000008ffc40014100100000000000000000000000000000000ffda000c03010002110311003f00bf8000ffd9",
    "hex",
  );
  const tool = createImageGenTool(workspace, {
    ...workspacePolicy(workspace),
    apiKey: "test-imagegen-key",
    model: "x-ai-image/grok-imagine-image-2.0",
    fetchImpl: async () => response({
      data: [{ b64_json: jpeg.toString("base64"), mime_type: "image/jpeg" }],
    }),
  });
  const result = await tool.execute("generate", {
    mode: "generate",
    prompt: "jpeg provider",
    outputPath: "triangle.png",
  });
  const receipt = JSON.parse(result.content[0].text);
  assert.equal(receipt.output.path, "triangle.jpg");
  assert.equal(receipt.output.mediaType, "image/jpeg");
  assert.equal(receipt.output.width, 1);
  assert.equal(receipt.output.height, 1);
});

test("ImageGen calls Gemini generateContent for google-image and Images API without GPT fields for x-ai-image", async () => {
  const { buildImageGenRequestBody, imageGenRequestProfile } = await import("./bridge-imagegen.js");
  const google = buildImageGenRequestBody({
    mode: "generate",
    prompt: "a blue circle",
    size: "1024x1024",
    quality: "low",
  }, { model: "google-image/gemini-3.1-flash-image" });
  const googleBody = JSON.parse(google.body);
  assert.equal(imageGenRequestProfile("google-image/nano-banana-2"), "gemini");
  assert.equal(googleBody.generationConfig.responseModalities[1], "IMAGE");
  assert.equal(googleBody.contents[0].parts[0].text, "a blue circle");
  assert.equal(googleBody.quality, undefined);

  const grok = JSON.parse(buildImageGenRequestBody({
    mode: "generate",
    prompt: "a green triangle",
    size: "1024x1024",
    quality: "low",
  }, { model: "x-ai-image/grok-imagine-image-2.0" }).body);
  assert.equal(grok.model, "x-ai-image/grok-imagine-image-2.0");
  assert.equal(grok.response_format, "b64_json");
  assert.equal(grok.size, undefined);
  assert.equal(grok.quality, undefined);
  assert.equal(grok.output_format, undefined);
});

test("ImageGen size alias helper maps domestic and DALL·E values", async () => {
  const {
    normalizeImageGenSizeQuality,
    imageGenRequestProfile,
  } = await import("./bridge-imagegen.js");
  assert.deepEqual(normalizeImageGenSizeQuality("1792x1024", "hd"), {
    size: "1536x1024",
    quality: "high",
    sizeMappedFrom: "1792x1024",
    qualityMappedFrom: "hd",
  });
  assert.equal(imageGenRequestProfile("google-image/nano-banana-2"), "gemini");
  assert.equal(imageGenRequestProfile("google-image/gemini-3.1-flash-image"), "gemini");
  assert.equal(imageGenRequestProfile("openai-image/gpt-image-2"), "gpt-image");
  assert.equal(imageGenRequestProfile("x-ai-image/grok-imagine-image-2.0"), "images-minimal");
  assert.equal(imageGenRequestProfile("future-lab-image/example"), "images-minimal");
  assert.throws(
    () => normalizeImageGenSizeQuality("999x999", "low"),
    /unsupported size/,
  );
});
