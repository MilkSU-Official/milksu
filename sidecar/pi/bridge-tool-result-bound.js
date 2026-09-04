import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";

const CONTENT_HASH_HEX_LENGTH = 16;
const OMISSION_MARKER_BYTE_RESERVE = 64;
const barelyOverLineSlack = 6;
const barelyOverByteSlack = 1024;

export function clipUtf8(text, maxBytes) {
  const buffer = Buffer.from(String(text), "utf8");
  if (buffer.length <= maxBytes) {
    return { text: String(text), truncated: false, bytes: buffer.length };
  }
  let end = maxBytes;
  if (end < buffer.length && (buffer[end] & 0xc0) === 0x80) {
    while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
      end -= 1;
    }
  }
  const slice = buffer.subarray(0, end);
  return { text: slice.toString("utf8"), truncated: true, bytes: slice.length };
}

export function clipUtf8FromEnd(text, maxBytes) {
  const buffer = Buffer.from(String(text), "utf8");
  if (buffer.length <= maxBytes) {
    return { text: String(text), truncated: false, bytes: buffer.length };
  }
  let start = Math.max(0, buffer.length - maxBytes);
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
  const slice = buffer.subarray(start);
  return { text: slice.toString("utf8"), truncated: true, bytes: slice.length };
}

export function toolResultBoundPath(input) {
  if (!input || typeof input !== "object") return undefined;
  const raw = input.path ?? input.file_path;
  if (typeof raw !== "string") return undefined;
  const path = raw.trim();
  return path || undefined;
}

export function toolResultBoundStartLine(input) {
  const offset = input?.offset;
  if (Number.isInteger(offset) && offset > 0) return offset;
  return 1;
}

function splitSourceLines(content) {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function shortContentHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, CONTENT_HASH_HEX_LENGTH);
}

function shouldNumberLines(toolName) {
  return String(toolName ?? "").trim().toLowerCase() === "read";
}

function shapeHeader({ path, contentHash }) {
  const rows = [];
  if (path) rows.push(`path: ${path}`);
  if (contentHash) rows.push(`content_hash: ${contentHash}`);
  return rows.join("\n");
}

function formatPreviewLine(line, lineNumber, numbered, width) {
  if (!numbered) return line;
  return `${String(lineNumber).padStart(width, " ")}|${line}`;
}

function previewFits(text, maxBytes, maxLines) {
  return splitSourceLines(text).length <= maxLines
    && Buffer.byteLength(text, "utf8") <= maxBytes;
}

function isBarelyOverBound(source, { maxBytes, maxLines }) {
  const lineCount = splitSourceLines(source).length;
  const totalBytes = Buffer.byteLength(source, "utf8");
  const overLines = Math.max(0, lineCount - maxLines);
  const overBytes = Math.max(0, totalBytes - maxBytes);
  if (overLines === 0 && overBytes === 0) return false;
  return overLines <= barelyOverLineSlack && overBytes <= barelyOverByteSlack;
}

function shapeBarelyOverHead(source, { maxBytes, maxLines, path, contentHash }) {
  const header = shapeHeader({ path, contentHash });
  const headerBlock = header ? `${header}\n` : "";
  const headerLines = header ? splitSourceLines(header).length : 0;
  const headerBytes = header ? Buffer.byteLength(headerBlock, "utf8") : 0;
  const body = truncateHead(source, {
    maxLines: Math.max(1, maxLines - headerLines),
    maxBytes: Math.max(16, maxBytes - headerBytes),
  });
  return {
    text: `${headerBlock}${body.content}`,
    omittedLines: 0,
    contentHash,
  };
}

function shapeGiantText(source, { maxBytes, path, contentHash }) {
  const header = shapeHeader({ path, contentHash });
  const headerBlock = header ? `${header}\n` : "";
  const marker = "[... omitted middle ...]";
  const markerBlock = `\n${marker}\n`;
  const reserved = Buffer.byteLength(headerBlock, "utf8") + Buffer.byteLength(markerBlock, "utf8");
  const available = maxBytes - reserved;
  if (available < 2) {
    const text = clipUtf8(`${headerBlock}${source}`, maxBytes).text;
    return {
      text,
      omittedLines: 0,
      contentHash,
    };
  }
  const headBudget = Math.floor(available / 2);
  const tailBudget = available - headBudget;
  const head = clipUtf8(source, headBudget).text;
  const tail = clipUtf8FromEnd(source, tailBudget).text;
  let text = `${headerBlock}${head}${markerBlock}${tail}`;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = clipUtf8(text, maxBytes).text;
  }
  return {
    text,
    omittedLines: 0,
    contentHash,
  };
}

function composeHeadTail({
  lines,
  headCount,
  tailCount,
  header,
  numbered,
  startLine,
  width,
}) {
  const totalLines = lines.length;
  const omittedLines = Math.max(0, totalLines - headCount - tailCount);
  const headRows = lines.slice(0, headCount).map((line, index) => (
    formatPreviewLine(line, startLine + index, numbered, width)
  ));
  const tailStartIndex = totalLines - tailCount;
  const tailRows = lines.slice(Math.max(headCount, tailStartIndex)).map((line, index) => (
    formatPreviewLine(
      line,
      startLine + Math.max(headCount, tailStartIndex) + index,
      numbered,
      width,
    )
  ));
  const parts = [];
  if (header) parts.push(header);
  if (headRows.length) parts.push(headRows.join("\n"));
  if (omittedLines > 0) parts.push(`[... omitted ${omittedLines} lines ...]`);
  if (tailRows.length) parts.push(tailRows.join("\n"));
  return {
    text: parts.join("\n"),
    omittedLines,
  };
}

function shapeHeadAndTail(source, {
  maxBytes,
  maxLines,
  toolName,
  path,
  startLine,
  contentHash,
}) {
  const lines = splitSourceLines(source);
  const totalLines = lines.length;
  const numbered = shouldNumberLines(toolName);
  const width = String(startLine + Math.max(totalLines, 1) - 1).length;
  const header = shapeHeader({ path, contentHash });
  const headerLines = header ? splitSourceLines(header).length : 0;
  const bodyLineBudget = Math.max(2, maxLines - headerLines - 1);
  const headerBytes = header ? Buffer.byteLength(header, "utf8") + 1 : 0;
  const bodyByteBudget = Math.max(16, maxBytes - headerBytes - OMISSION_MARKER_BYTE_RESERVE);
  const halfLines = Math.max(1, Math.floor(bodyLineBudget / 2));
  const numberOverhead = numbered ? width + 1 : 0;
  const halfBytes = Math.max(8, Math.floor(bodyByteBudget / 2) - numberOverhead * halfLines);

  const headTrunc = truncateHead(source, { maxLines: halfLines, maxBytes: halfBytes });
  const tailTrunc = truncateTail(source, { maxLines: halfLines, maxBytes: halfBytes });
  let headCount = headTrunc.firstLineExceedsLimit || headTrunc.content === ""
    ? 0
    : splitSourceLines(headTrunc.content).length;
  let tailCount = tailTrunc.content === "" ? 0 : splitSourceLines(tailTrunc.content).length;
  if (headCount === 0 && totalLines > 0) headCount = 1;
  if (tailCount === 0 && totalLines > 1) tailCount = 1;
  if (headCount + tailCount > totalLines) {
    tailCount = Math.max(0, totalLines - headCount);
  }

  let shaped = composeHeadTail({
    lines,
    headCount,
    tailCount,
    header,
    numbered,
    startLine,
    width,
  });

  while (!previewFits(shaped.text, maxBytes, maxLines) && (headCount > 1 || tailCount > 1)) {
    const extraLines = Math.max(0, splitSourceLines(shaped.text).length - maxLines);
    const extraBytes = Buffer.byteLength(shaped.text, "utf8") - maxBytes;
    const average = Math.max(
      1,
      Math.floor(Buffer.byteLength(shaped.text, "utf8") / Math.max(1, splitSourceLines(shaped.text).length)),
    );
    let drop = Math.max(1, extraLines, extraBytes > 0 ? Math.ceil(extraBytes / average) : 0);
    while (drop > 0 && (headCount > 1 || tailCount > 1)) {
      if (headCount >= tailCount && headCount > 1) headCount -= 1;
      else if (tailCount > 1) tailCount -= 1;
      else break;
      drop -= 1;
    }
    shaped = composeHeadTail({
      lines,
      headCount,
      tailCount,
      header,
      numbered,
      startLine,
      width,
    });
  }

  if (!previewFits(shaped.text, maxBytes, maxLines)) {
    return shapeGiantText(source, { maxBytes, path, contentHash });
  }
  return {
    text: shaped.text,
    omittedLines: shaped.omittedLines,
    contentHash,
  };
}

export function boundModelText(text, {
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
  toolName,
  path,
  startLine = 1,
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

  const contentHash = shortContentHash(source);
  // Pi `read` already truncateHead's before this hook. The leftover is usually
  // a short "use offset=N" notice, not a giant dump. Head+tail that payload
  // would drop the middle of the useful head. Keep the head in that case.
  const shaped = truncation.firstLineExceedsLimit || truncation.content === ""
    ? shapeGiantText(source, { maxBytes, path, contentHash })
    : isBarelyOverBound(source, { maxBytes, maxLines })
      ? shapeBarelyOverHead(source, { maxBytes, maxLines, path, contentHash })
      : shapeHeadAndTail(source, {
        maxBytes,
        maxLines,
        toolName,
        path,
        startLine: Number.isInteger(startLine) && startLine > 0 ? startLine : 1,
        contentHash,
      });

  return {
    text: shaped.text,
    truncated: true,
    previewBytes: Buffer.byteLength(shaped.text, "utf8"),
    totalBytes: Buffer.byteLength(source, "utf8"),
    contentHash: shaped.contentHash,
    omittedLines: shaped.omittedLines,
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
  const omitted = Number.isInteger(bound.omittedLines) && bound.omittedLines > 0
    ? `; omitted ${bound.omittedLines} lines`
    : "";
  const shown = bound.previewBytes <= bound.totalBytes
    ? `showing ${formatSize(bound.previewBytes)} of ${formatSize(bound.totalBytes)}`
    : `showing head+tail of ${formatSize(bound.totalBytes)}`;
  const notice = `\n\n[Truncated: ${shown}${omitted}. `
    + `Full output saved to ${bound.capturePath}. Use the read tool with offset to continue.]`;
  return [
    { type: "text", text: `${bound.text}${notice}` },
    ...rest,
  ];
}

export function createToolResultBoundExtension({
  environment = process.env,
  cwd = process.cwd(),
} = {}) {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      const content = Array.isArray(event.content) ? event.content : [];
      const text = content
        .filter(block => block?.type === "text")
        .map(block => String(block.text ?? ""))
        .join("\n");
      if (!text) return undefined;
      const bound = boundModelText(text, {
        toolName: event.toolName,
        path: toolResultBoundPath(event.input),
        startLine: toolResultBoundStartLine(event.input),
      });
      if (!bound.truncated) return undefined;
      const capturePath = await persistOverflowText(text, event.toolCallId, environment, cwd);
      return {
        content: boundToolResultContent(content, { ...bound, capturePath }),
      };
    });
  };
}
