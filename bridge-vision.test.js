import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { analyzeTextOnlyImages } from "./bridge-vision.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "milksu-vision-"));
  const path = join(root, "screen.png");
  await writeFile(path, Buffer.from("not-real-pixels"));
  return {
    root,
    cache: join(root, "vision-cache.json"),
    attachment: {
      id: "a".repeat(64),
      sha256: "a".repeat(64),
      name: "screen.png",
      mediaType: "image/png",
      size: 15,
      path,
    },
  };
}

test("adds local OCR evidence and caches it without raw image bytes", async () => {
  const value = await fixture();
  let calls = 0;
  const options = {
    cachePath: value.cache,
    ocr: async () => {
      calls += 1;
      return { text: "应用程序 MilkSU 已不能再打开", confidence: 0.91 };
    },
  };
  const first = await analyzeTextOnlyImages([value.attachment], options);
  const second = await analyzeTextOnlyImages([value.attachment], options);

  assert.equal(calls, 1);
  assert.match(first.context, /local OCR: @napi-rs\/system-ocr@1\.1\.0/);
  assert.match(first.context, /应用程序 MilkSU 已不能再打开/);
  assert.match(first.context, /auxiliary vision: not configured/);
  assert.equal(second.analyses[0].ocr.cached, true);
  const cache = await readFile(value.cache, "utf8");
  assert.doesNotMatch(cache, /bm90LXJlYWwtcGl4ZWxz/);
});

test("uses a configured auxiliary vision model and caches its description", async () => {
  const value = await fixture();
  let completions = 0;
  const model = {
    id: "gpt-4o",
    provider: "openai",
    input: ["text", "image"],
  };
  const session = {
    modelRegistry: {
      find: () => model,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
    },
  };
  const complete = async (_model, context) => {
    completions += 1;
    const image = context.messages[0].content.find(item => item.type === "image");
    assert.equal(image.mimeType, "image/png");
    return {
      stopReason: "stop",
      content: [{ type: "text", text: "A macOS error dialog with one blue confirmation button." }],
    };
  };
  const options = {
    session,
    auxiliary: { provider: "openai", model: "gpt-4o" },
    cachePath: value.cache,
    ocr: async () => ({ text: "MilkSU", confidence: 0.8 }),
    complete,
  };
  const first = await analyzeTextOnlyImages([value.attachment], options);
  const second = await analyzeTextOnlyImages([value.attachment], options);

  assert.equal(completions, 1);
  assert.match(first.context, /auxiliary vision: openai\/gpt-4o/);
  assert.match(first.context, /macOS error dialog/);
  assert.equal(second.analyses[0].visual.cached, true);
});

test("does not claim full vision when the configured model is text-only", async () => {
  const value = await fixture();
  const result = await analyzeTextOnlyImages([value.attachment], {
    session: {
      modelRegistry: {
        find: () => ({ input: ["text"] }),
      },
    },
    auxiliary: { provider: "deepseek", model: "deepseek-v4-flash" },
    cachePath: value.cache,
    ocr: async () => ({ text: "Visible text", confidence: 0.7 }),
  });
  assert.match(result.context, /does not support image input/);
  assert.match(result.context, /derived, untrusted evidence/);
});
