import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import {
  boundModelText,
  boundToolResultContent,
  clipUtf8,
  createToolResultBoundExtension,
  persistOverflowText,
  toolResultCaptureRoot,
} from "./bridge-tool-result-bound.js";

function dumpLines(count, map = (index) => `line-${index}`) {
  return Array.from({ length: count }, (_, index) => map(index));
}

test("small tool text stays byte-equal to the tool source", () => {
  const bound = boundModelText("ok");
  assert.equal(bound.truncated, false);
  assert.equal(bound.text, "ok");
});

test("short text with a trailing newline stays byte-equal", () => {
  const source = "ok\n";
  const bound = boundModelText(source);
  assert.equal(bound.truncated, false);
  assert.equal(bound.text, source);
  assert.equal(Buffer.byteLength(bound.text, "utf8"), Buffer.byteLength(source, "utf8"));
});

test("output just under Pi's 2000-line and 50KB limits stays original", () => {
  const source = dumpLines(DEFAULT_MAX_LINES).join("\n");
  const bound = boundModelText(source);
  assert.equal(bound.truncated, false);
  assert.equal(bound.text, source);

  const exactBytes = "h".repeat(DEFAULT_MAX_BYTES);
  const exact = boundModelText(exactBytes);
  assert.equal(exact.truncated, false);
  assert.equal(exact.text, exactBytes);
});

test("multiline output past Pi's 50KB/2000-line limit keeps head and tail", () => {
  const lines = dumpLines(2500, (index) => `line-${index}${index === 2499 ? "-END" : ""}`);
  const bound = boundModelText(lines.join("\n"));
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-2499-END"), true);
  assert.match(bound.text, /omitted \d+ lines/);
  assert.equal(bound.text.includes("line-1249"), false);
  assert.ok(bound.text.split("\n").length <= DEFAULT_MAX_LINES);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
  assert.match(bound.text, /content_hash: [0-9a-f]{16}/);
  const expectedHash = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, 16);
  assert.equal(bound.contentHash, expectedHash);
});

test("already-bounded read plus a short continuation notice keeps the head", () => {
  const head = dumpLines(DEFAULT_MAX_LINES).join("\n");
  const source = `${head}\n\n[Showing lines 1-${DEFAULT_MAX_LINES} of 2500. Use offset=${DEFAULT_MAX_LINES + 1} to continue.]`;
  const bound = boundModelText(source, {
    toolName: "read",
    path: "src/app.ts",
  });
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-1500"), true);
  assert.doesNotMatch(bound.text, /omitted \d+ lines/);
  assert.match(bound.text, /^path: src\/app\.ts/m);
  assert.match(bound.text, /content_hash: [0-9a-f]{16}/);
});

test("read-class previews number lines and include path when provided", () => {
  const source = dumpLines(2500).join("\n");
  const bound = boundModelText(source, {
    toolName: "read",
    path: "src/app.ts",
    startLine: 10,
  });
  assert.equal(bound.truncated, true);
  assert.match(bound.text, /^path: src\/app\.ts/m);
  assert.match(bound.text, /10\|line-0/);
  assert.match(bound.text, /2509\|line-2499/);
  assert.match(bound.text, /omitted \d+ lines/);
});

test("path is omitted from the preview when the event has none", () => {
  const bound = boundModelText(dumpLines(2500).join("\n"), { toolName: "bash" });
  assert.equal(bound.truncated, true);
  assert.doesNotMatch(bound.text, /^path:/m);
  assert.match(bound.text, /content_hash: [0-9a-f]{16}/);
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-2499"), true);
});

test("output just over Pi's 50KB byte limit keeps head and tail", () => {
  const head = `HEAD ${"a".repeat(20_000)}`;
  const middle = `MID ${"b".repeat(20_000)}`;
  const tail = `TAIL ${"c".repeat(20_000)}-END`;
  const source = [head, middle, tail].join("\n");
  const bound = boundModelText(source);
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("HEAD "), true);
  assert.equal(bound.text.includes("TAIL "), true);
  assert.equal(bound.text.includes("-END"), true);
  assert.equal(bound.text.includes("MID "), false);
  assert.match(bound.text, /omitted \d+ lines/);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
});

test("a minified one-line dump keeps the head and the tail", () => {
  const blob = `var x="${"a".repeat(DEFAULT_MAX_BYTES + 2048)}";`;
  const bound = boundModelText(blob);
  assert.equal(bound.truncated, true);
  assert.ok(bound.text.includes("var x="));
  assert.ok(bound.text.includes('";'));
  assert.match(bound.text, /omitted middle/);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
  assert.ok(bound.totalBytes > DEFAULT_MAX_BYTES);
});

test("head+tail byte clipping does not split UTF-8 code points", () => {
  const snowman = "☃";
  const blob = snowman.repeat(Math.ceil((DEFAULT_MAX_BYTES + 64) / 3));
  const bound = boundModelText(blob);
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("\uFFFD"), false);
  assert.equal(Buffer.from(bound.text, "utf8").toString("utf8"), bound.text);
  const midChar = clipUtf8(blob, 7);
  const onBoundary = clipUtf8(blob, 6);
  assert.equal(midChar.text.includes("\uFFFD"), false);
  assert.equal(onBoundary.text, snowman.repeat(2));
  assert.ok(midChar.bytes <= 7);
});

test("long HTML and key-like dumps are clipped, not rewritten into a summary", () => {
  const secret = "sk-live-EXAMPLEKEY";
  const lines = [
    `API_KEY=${secret}`,
    ...dumpLines(2498, (index) => `<div id="${index}">${"x".repeat(8)}</div>`),
    `<html><body>${"y".repeat(32)}</body></html>`,
  ];
  const bound = boundModelText(lines.join("\n"));
  assert.equal(bound.truncated, true);
  assert.doesNotMatch(bound.text, /secrets?:/i);
  assert.doesNotMatch(bound.text, /summary:/i);
  assert.equal(bound.text.includes(`API_KEY=${secret}`), true);
  assert.equal(bound.text.includes("</html>"), true);
  assert.match(bound.text, /omitted \d+ lines/);
});

test("overflow is saved under the private runtime for on-demand read", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "milksu-tool-bound-"));
  const path = await persistOverflowText("full-output", "call-1", {
    MILKSU_WORKSPACE_RUNTIME: runtime,
  });
  assert.equal(path.startsWith(toolResultCaptureRoot({
    MILKSU_WORKSPACE_RUNTIME: runtime,
  }).replaceAll("\\", "/")), true);
  assert.equal(await readFile(path, "utf8"), "full-output");
});

test("overflow file still contains the omitted middle for read+offset", async () => {
  const source = dumpLines(2500).join("\n");
  const bound = boundModelText(source);
  assert.equal(bound.text.includes("line-1249"), false);
  const runtime = await mkdtemp(join(tmpdir(), "milksu-tool-bound-"));
  const path = await persistOverflowText(source, "call-mid", {
    MILKSU_WORKSPACE_RUNTIME: runtime,
  });
  assert.equal((await readFile(path, "utf8")).includes("line-1249"), true);
});

test("keeps non-text blocks when rewriting the model-visible result", () => {
  const content = boundToolResultContent(
    [
      { type: "text", text: "preview" },
      { type: "image", data: "abc", mimeType: "image/png" },
    ],
    {
      text: "preview",
      previewBytes: 7,
      totalBytes: 99,
      omittedLines: 12,
      capturePath: "/tmp/full.txt",
    },
  );
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /Full output saved to \/tmp\/full.txt/);
  assert.match(content[0].text, /omitted 12 lines/);
  assert.equal(content[1].type, "image");
});

test("tool_result extension passes toolName and path into the bound shape", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "milksu-tool-bound-"));
  const listeners = new Map();
  createToolResultBoundExtension({
    environment: { MILKSU_WORKSPACE_RUNTIME: runtime },
    cwd: runtime,
  })({
    on: (name, listener) => listeners.set(name, listener),
  });
  const source = dumpLines(2500).join("\n");
  const result = await listeners.get("tool_result")({
    toolCallId: "read-1",
    toolName: "read",
    input: { path: "src/app.ts", offset: 4 },
    content: [{ type: "text", text: source }],
  });
  assert.match(result.content[0].text, /^path: src\/app\.ts/m);
  assert.match(result.content[0].text, /4\|line-0/);
  assert.match(result.content[0].text, /2503\|line-2499/);
  assert.match(result.content[0].text, /Full output saved to /);
  assert.equal(
    await readFile(join(runtime, "tool-results", "read-1.txt"), "utf8"),
    source,
  );
});

test("tool_result extension leaves short results and missing paths alone", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "milksu-tool-bound-"));
  const listeners = new Map();
  createToolResultBoundExtension({
    environment: { MILKSU_WORKSPACE_RUNTIME: runtime },
    cwd: runtime,
  })({
    on: (name, listener) => listeners.set(name, listener),
  });
  const short = await listeners.get("tool_result")({
    toolCallId: "bash-1",
    toolName: "bash",
    input: { command: "echo ok" },
    content: [{ type: "text", text: "ok" }],
  });
  assert.equal(short, undefined);

  const long = await listeners.get("tool_result")({
    toolCallId: "bash-2",
    toolName: "bash",
    input: { command: "find ." },
    content: [{ type: "text", text: dumpLines(2500).join("\n") }],
  });
  assert.doesNotMatch(long.content[0].text, /^path:/m);
  assert.match(long.content[0].text, /omitted \d+ lines/);
});
