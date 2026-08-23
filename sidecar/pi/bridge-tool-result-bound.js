import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export function clipUtf8(text, maxBytes) {
  const buffer = Buffer.from(String(text), "utf8");
  if (buffer.length <= maxBytes) {
    return { text: String(text), truncated: false, bytes: buffer.length };
  }
  let slice = buffer.subarray(0, maxBytes);
  while (slice.length > 0 && (slice[slice.length - 1] & 0xc0) === 0x80) {
    slice = slice.subarray(0, slice.length - 1);
  }
  return { text: slice.toString("utf8"), truncated: true, bytes: slice.length };
}

export function boundModelText(text, {
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
} = {}) {
  const source = String(text ?? "");
  const truncation = truncateHead(source, { maxBytes, maxLines });
  if (!truncation.truncated) {
    return {
      text: source,
      truncated: false,
      previewBytes: truncation.outputBytes,
      totalBytes: truncation.totalBytes,
    };
  }
  if (truncation.firstLineExceedsLimit || truncation.content === "") {
    const clipped = clipUtf8(source, maxBytes);
    return {
      text: clipped.text,
      truncated: true,
      previewBytes: clipped.bytes,
      totalBytes: Buffer.byteLength(source, "utf8"),
    };
  }
  return {
    text: truncation.content,
    truncated: true,
    previewBytes: truncation.outputBytes,
    totalBytes: truncation.totalBytes,
  };
}

export function toolResultCaptureRoot(
  environment = process.env,
  cwd = process.cwd(),
) {
  const runtime = String(environment.MILKSU_WORKSPACE_RUNTIME ?? "").trim();
  return runtime ? join(runtime, "tool-results") : join(cwd, "work", "tool-results");
}

export async function persistOverflowText(text, toolCallId, environment = process.env, cwd = process.cwd()) {
  const id = String(toolCallId || "tool").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const root = toolResultCaptureRoot(environment, cwd);
  const relative = join(root, `${id}.txt`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(relative, text, { mode: 0o600 });
  return relative.replaceAll("\\", "/");
}

export function boundToolResultContent(content, bound) {
  const blocks = Array.isArray(content) ? content : [];
  const rest = blocks.filter(block => block?.type !== "text");
  const notice = `\n\n[Truncated: showing ${formatSize(bound.previewBytes)} of ${formatSize(bound.totalBytes)}. `
    + `Full output saved to ${bound.capturePath}. Use the read tool with offset to continue.]`;
  return [
    { type: "text", text: `${bound.text}${notice}` },
    ...rest,
  ];
}

export function createToolResultBoundExtension() {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      const content = Array.isArray(event.content) ? event.content : [];
      const text = content
        .filter(block => block?.type === "text")
        .map(block => String(block.text ?? ""))
        .join("\n");
      if (!text) return undefined;
      const bound = boundModelText(text);
      if (!bound.truncated) return undefined;
      const capturePath = await persistOverflowText(text, event.toolCallId);
      return {
        content: boundToolResultContent(content, { ...bound, capturePath }),
      };
    });
  };
}
