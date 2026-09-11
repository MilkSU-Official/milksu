import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDshPromptBlocks } from "./prompt-blocks.js";

test("sends attached images to DeepSeek Harness instead of dropping them", async () => {
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
  }, { attachmentRoot: root });

  assert.equal(blocks[0].type, "text");
  assert.match(blocks[0].text, /描述这张图/);
  const image = blocks.find(block => block.type === "image");
  assert.ok(image);
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.data, data.toString("base64"));
});
