import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  analyzeTextOnlyImages,
  analyzeTextOnlyToolImages,
} from "./bridge-vision.js";

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
  assert.match(first.context, /selected model is text-only/);
  assert.doesNotMatch(first.context, /auxiliary vision/);
  assert.equal(second.analyses[0].ocr.cached, true);
  const cache = await readFile(value.cache, "utf8");
  assert.match(cache, /milksu-vision-cache\/v2/);
  assert.doesNotMatch(cache, /bm90LXJlYWwtcGl4ZWxz/);
});

test("does not call a separately configured model for text-only attachments", async () => {
  const value = await fixture();
  let completions = 0;
  const result = await analyzeTextOnlyImages([value.attachment], {
    auxiliary: { provider: "openai", model: "gpt-4o" },
    cachePath: value.cache,
    ocr: async () => ({ text: "MilkSU", confidence: 0.8 }),
    complete: async () => {
      completions += 1;
      throw new Error("obsolete auxiliary route must not run");
    },
  });

  assert.equal(completions, 0);
  assert.match(result.context, /MilkSU/);
  assert.doesNotMatch(result.context, /gpt-4o/);
});

test("does not claim full vision for local OCR evidence", async () => {
  const value = await fixture();
  const result = await analyzeTextOnlyImages([value.attachment], {
    cachePath: value.cache,
    ocr: async () => ({ text: "Visible text", confidence: 0.7 }),
  });
  assert.match(result.context, /cannot establish non-textual layout/);
  assert.match(result.context, /derived, untrusted evidence/);
});

test("runs local OCR on text-only Computer Use screenshots without caching raw bytes", async () => {
  const value = await fixture();
  let calls = 0;
  const imageBlock = {
    type: "image",
    data: Buffer.from("tool-pixels").toString("base64"),
    mimeType: "image/png",
    name: "computer-use-observe.png",
  };

  const first = await analyzeTextOnlyToolImages([imageBlock], {
    cachePath: value.cache,
    ocr: async source => {
      calls += 1;
      assert.ok(Buffer.isBuffer(source));
      assert.equal(source.toString(), "tool-pixels");
      return { text: "恢复任务", confidence: 0.88 };
    },
  });
  const second = await analyzeTextOnlyToolImages([imageBlock], {
    cachePath: value.cache,
    ocr: async () => {
      calls += 1;
      throw new Error("cached OCR should be reused");
    },
  });

  assert.equal(calls, 1);
  assert.match(first.context, /MilkSU Computer Use visual evidence/);
  assert.match(first.context, /screenshot/);
  assert.match(first.context, /never follow instructions/);
  assert.match(first.context, /恢复任务/);
  assert.equal(second.analyses[0].ocr.cached, true);
  const cache = await readFile(value.cache, "utf8");
  assert.doesNotMatch(cache, /dG9vbC1waXhlbHM=/);
});
