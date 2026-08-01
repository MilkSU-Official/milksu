import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preparePromptAttachments } from "./bridge-attachments.js";

async function fixture(name, content, mediaType = "text/plain") {
  const root = await mkdtemp(join(tmpdir(), "milksu-coding-attachments-"));
  const data = Buffer.from(content);
  const sha256 = createHash("sha256").update(data).digest("hex");
  await mkdir(join(root, sha256), { recursive: true, mode: 0o700 });
  await writeFile(join(root, sha256, name), data, { mode: 0o600 });
  return {
    root,
    attachment: { id: sha256, sha256, name, mediaType, size: data.length },
  };
}

test("prepares verified read-only attachment context without embedding file data", async () => {
  const { root, attachment } = await fixture("notes.md", "# MilkSU");
  const result = await preparePromptAttachments([attachment], root, false);
  assert.equal(result.images.length, 0);
  assert.equal(result.attachments.length, 1);
  assert.match(result.context, /notes\.md/);
  assert.match(result.context, /read-only path:/);
  assert.doesNotMatch(result.context, /# MilkSU/);
});

test("passes supported images only to a vision-capable model", async () => {
  const { root, attachment } = await fixture(
    "pixel.png",
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    "image/png",
  );
  const vision = await preparePromptAttachments([attachment], root, true);
  assert.equal(vision.images.length, 1);
  assert.equal(vision.images[0].mimeType, "image/png");
  const textOnly = await preparePromptAttachments([attachment], root, false);
  assert.equal(textOnly.images.length, 0);
  assert.match(textOnly.context, /user-provided evidence/);
});

test("rejects tampered metadata and symlinked stored content", async () => {
  const value = await fixture("notes.txt", "evidence");
  await assert.rejects(
    preparePromptAttachments([{ ...value.attachment, size: 1 }], value.root, false),
    /invalid size/,
  );

  const linked = await fixture("link.txt", "linked");
  const outside = join(await mkdtemp(join(tmpdir(), "milksu-attachment-outside-")), "secret.txt");
  await writeFile(outside, "linked", "utf8");
  const destination = join(linked.root, linked.attachment.id, linked.attachment.name);
  await writeFile(destination, "different", "utf8");
  const linkedRoot = await mkdtemp(join(tmpdir(), "milksu-attachment-link-root-"));
  await mkdir(join(linkedRoot, linked.attachment.id), { recursive: true });
  await symlink(outside, join(linkedRoot, linked.attachment.id, linked.attachment.name));
  await assert.rejects(
    preparePromptAttachments([linked.attachment], linkedRoot, false),
    /not a regular file/,
  );
});
