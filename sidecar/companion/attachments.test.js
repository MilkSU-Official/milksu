import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { companionVisiblePrompt, prepareCompanionPrompt } from "./attachments.js";

async function fixture(name, content, mediaType = "text/plain") {
  const root = await mkdtemp(join(tmpdir(), "milksu-companion-attachments-"));
  const data = Buffer.from(content);
  const sha256 = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, sha256), { recursive: true, mode: 0o700 });
  await writeFile(join(root, sha256, name), data, { mode: 0o600 });
  return {
    root,
    attachment: { id: sha256, sha256, name, mediaType, size: data.length },
  };
}

test("visible prompt keeps user text and names attachments when the field is empty", () => {
  assert.equal(companionVisiblePrompt("看这张图", [{ name: "a.png" }]), "看这张图");
  assert.equal(companionVisiblePrompt("  ", [{ name: "a.png" }, { name: "notes.md" }]), "附件：a.png、notes.md");
  assert.equal(
    companionVisiblePrompt("", [{ name: "a.png" }], "en"),
    "Attachments: a.png",
  );
});

test("uses the Coding attachment catalog so companion can read the files", async () => {
  const { root, attachment } = await fixture("notes.md", "# MilkSU evidence");
  const previous = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  process.env.MILKSU_CODING_ATTACHMENT_ROOT = root;
  try {
    const prepared = await prepareCompanionPrompt({
      prompt: "",
      locale: "zh",
      attachments: [attachment],
    });
    assert.match(prepared.prompt, /^附件：notes\.md/);
    assert.match(prepared.prompt, /\[MilkSU attachments\]/);
    assert.match(prepared.prompt, /用 read /);
    assert.doesNotMatch(prepared.prompt, /# MilkSU evidence/);
    assert.equal(prepared.images.length, 0);
  } finally {
    if (previous === undefined) delete process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    else process.env.MILKSU_CODING_ATTACHMENT_ROOT = previous;
  }
});

test("passes images through the same session.prompt images path as Coding", async () => {
  const { root, attachment } = await fixture(
    "pixel.png",
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    "image/png",
  );
  const previous = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  process.env.MILKSU_CODING_ATTACHMENT_ROOT = root;
  try {
    const prepared = await prepareCompanionPrompt({
      prompt: "看这张图",
      locale: "zh",
      attachments: [attachment],
    });
    assert.match(prepared.prompt, /^看这张图/);
    assert.match(prepared.prompt, /pixel\.png/);
    assert.equal(prepared.images.length, 1);
    assert.equal(prepared.images[0].mimeType, "image/png");
  } finally {
    if (previous === undefined) delete process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    else process.env.MILKSU_CODING_ATTACHMENT_ROOT = previous;
  }
});
