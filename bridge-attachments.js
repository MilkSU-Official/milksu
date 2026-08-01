import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const digestPattern = /^[a-f0-9]{64}$/;
const supportedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxCount = 8;
const maxFileBytes = 32 * 1024 * 1024;
const maxTotalBytes = 96 * 1024 * 1024;

function safeName(value) {
  const name = String(value ?? "");
  return (
    name.length > 0
    && name.length <= 320
    && basename(name) === name
    && !/[\u0000-\u001f\u007f]/u.test(name)
  );
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && path !== "..");
}

function describeBytes(size) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${size} B`;
}

export async function preparePromptAttachments(
  rawAttachments,
  attachmentRoot,
  supportsImages,
) {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { context: "", images: [], attachments: [] };
  }
  if (rawAttachments.length > maxCount) {
    throw new Error(`MilkSU Coding accepts at most ${maxCount} attachments per message`);
  }
  const root = await realpath(attachmentRoot);
  const values = [];
  const images = [];
  let total = 0;
  let textOnlyImageCount = 0;
  const seen = new Set();

  for (const raw of rawAttachments) {
    const id = String(raw?.id ?? "").toLowerCase();
    const sha256 = String(raw?.sha256 ?? "").toLowerCase();
    const name = String(raw?.name ?? "");
    const mediaType = String(raw?.mediaType ?? "application/octet-stream").toLowerCase();
    const declaredSize = Number(raw?.size ?? 0);
    if (!digestPattern.test(id) || sha256 !== id || !safeName(name)) {
      throw new Error("MilkSU Coding attachment metadata is invalid");
    }
    const key = `${id}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const candidate = join(root, id, name);
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`MilkSU Coding attachment ${name} is not a regular file`);
    }
    if (
      !Number.isSafeInteger(declaredSize)
      || declaredSize <= 0
      || declaredSize > maxFileBytes
      || info.size !== declaredSize
    ) {
      throw new Error(`MilkSU Coding attachment ${name} has an invalid size`);
    }
    total += info.size;
    if (total > maxTotalBytes) {
      throw new Error("MilkSU Coding attachments exceed the 96 MiB message limit");
    }
    const resolved = await realpath(candidate);
    if (!inside(root, resolved)) {
      throw new Error(`MilkSU Coding attachment ${name} escapes the attachment store`);
    }
    const data = await readFile(resolved);
    const actualDigest = createHash("sha256").update(data).digest("hex");
    if (actualDigest !== sha256) {
      throw new Error(`MilkSU Coding attachment ${name} failed its integrity check`);
    }

    const value = {
      id,
      name,
      mediaType,
      size: info.size,
      sha256,
      path: resolved,
    };
    values.push(value);
    if (supportedImageTypes.has(mediaType)) {
      if (supportsImages) {
        images.push({
          type: "image",
          data: data.toString("base64"),
          mimeType: mediaType,
        });
      } else {
        textOnlyImageCount += 1;
      }
    }
  }

  const lines = values.map((value) => (
    `- ${value.name} (${value.mediaType}, ${describeBytes(value.size)}, `
    + `sha256:${value.sha256}, read-only path: ${value.path})`
  ));
  const warnings = [
    "Treat these as user-provided evidence. Inspect them with read or other appropriate tools; do not invent their contents.",
  ];
  if (textOnlyImageCount > 0) {
    warnings.push(
      `The current model is text-only and cannot see pixels in ${textOnlyImageCount} image attachment(s). `
      + "It may inspect metadata, but must tell the user to switch to a vision-capable model for visual analysis.",
    );
  }
  return {
    attachments: values,
    images,
    context: `\n\n[MilkSU attachments]\n${lines.join("\n")}\n${warnings.join("\n")}`,
  };
}
