import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acpImagePromptsEnabled,
  buildDshPromptBlocks,
  dshReadImageFallbackGuidance,
} from "./prompt-blocks.js";

test("reads ACP inline image advertisement from initialize", () => {
  assert.equal(acpImagePromptsEnabled(undefined), false);
  assert.equal(acpImagePromptsEnabled({ agentCapabilities: {} }), false);
  assert.equal(acpImagePromptsEnabled({
    agentCapabilities: { promptCapabilities: { image: false } },
  }), false);
  assert.equal(acpImagePromptsEnabled({
    agentCapabilities: { promptCapabilities: { image: true } },
  }), true);
});

test("sends attached images to DeepSeek Harness instead of dropping them", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-dsh-attach-"));
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const sha256 = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, sha256), { recursive: true, mode: 0o700 });
  await writeFile(join(root, sha256, "pixel.png"), data, { mode: 0o600 });

  const command = {
    prompt: "描述这张图",
    attachments: [{
      id: sha256,
      sha256,
      name: "pixel.png",
      mediaType: "image/png",
      size: data.length,
    }],
  };
  const blocks = await buildDshPromptBlocks(command, { attachmentRoot: root, imagePrompts: true });

  assert.equal(blocks[0].type, "text");
  assert.match(blocks[0].text, /描述这张图/);
  const image = blocks.find(block => block.type === "image");
  assert.ok(image);
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.data, data.toString("base64"));
});

test("omits inline images when ACP did not advertise promptCapabilities.image", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-dsh-attach-"));
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const sha256 = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, sha256), { recursive: true, mode: 0o700 });
  await writeFile(join(root, sha256, "pixel.png"), data, { mode: 0o600 });

  const blocks = await buildDshPromptBlocks({
    prompt: "描述这张图",
    attachments: [{
      id: sha256,
      sha256,
      name: "pixel.png",
      mediaType: "image/png",
      size: data.length,
    }],
  }, { attachmentRoot: root, imagePrompts: false });

  assert.equal(blocks.some(block => block.type === "image"), false);
  const text = blocks.map(block => block.text || "").join("\n");
  assert.match(text, /pixel\.png/);
  assert.match(text, /read_image/);
  assert.match(text, /文件路径/);
  assert.equal(text.includes(dshReadImageFallbackGuidance()), true);
  assert.doesNotMatch(text, /does not accept inline images/i);
  assert.doesNotMatch(text, /no multimodal/i);
  assert.doesNotMatch(text, /lacks multimodal/i);
  assert.doesNotMatch(text, /this model (has no|cannot|does not support)/i);
  assert.doesNotMatch(text, /text-only/i);
  assert.doesNotMatch(text, /tesseract|\bPIL\b|bash OCR/i);
});

test("read_image fallback never claims the selected model cannot read images", () => {
  const chinese = dshReadImageFallbackGuidance();
  assert.match(chinese, /read_image/);
  assert.match(chinese, /文件路径/);
  assert.doesNotMatch(chinese, /不能看图以外的借口|does not accept inline images/i);
  assert.doesNotMatch(chinese, /no multimodal|lacks multimodal|text-only/i);
  assert.doesNotMatch(chinese, /tesseract|\bPIL\b|bash OCR/i);

  const english = dshReadImageFallbackGuidance("en");
  assert.match(english, /read_image/);
  assert.match(english, /file path/);
  assert.doesNotMatch(english, /does not accept inline images/i);
  assert.doesNotMatch(english, /no multimodal|lacks multimodal|text-only/i);
});
