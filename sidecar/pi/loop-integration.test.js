import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { composeContextUsage } from "./bridge-context-composition.js";
import {
  hashFileText,
  wrapEditToolDefinition,
} from "./bridge-edit-anchor.js";
import {
  shouldAbortAssistantStream,
  steerSession,
} from "./bridge-steering.js";
import {
  boundModelText,
  createToolResultBoundExtension,
} from "./bridge-tool-result-bound.js";
import {
  createSubagentYieldExtension,
  readSubagentYieldField,
} from "./bridge-subagent-yield.js";

const require = createRequire(import.meta.url);
const { resolveModelContextWindow } = require("./known-context-window.cjs");
const fixture = JSON.parse(await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures", "loop-context-integration", "turn.json"),
  "utf8",
));

const sample = [
  "export function greet(name: string) {",
  "  return `hello ${name}`;",
  "}",
  "",
].join("\n");

function dumpLines(count) {
  return Array.from({ length: count }, (_, index) => (
    `line-${index}${index === count - 1 ? "-END" : ""}`
  ));
}

function sha16(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 16);
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "milksu-loop-integration-"));
  await writeFile(join(dir, "sample.ts"), sample);
  await writeFile(join(dir, "dump.txt"), dumpLines(2500).join("\n"));
  return dir;
}

function editTool(dir) {
  return wrapEditToolDefinition(createEditToolDefinition(dir), { root: dir });
}

async function runEdit(dir, input, tool = editTool(dir)) {
  try {
    const result = await tool.execute(
      "edit-1",
      { path: "sample.ts", ...input },
      new AbortController().signal,
    );
    return {
      ok: true,
      text: result.content[0].text,
      body: await readFile(join(dir, "sample.ts"), "utf8"),
    };
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
      code: reason?.code,
      body: await readFile(join(dir, "sample.ts"), "utf8"),
    };
  }
}

async function chainToolResult(event, { runtime, cwd, workspace: root } = {}) {
  const handlers = [];
  const pi = {
    on(_name, handler) {
      handlers.push(handler);
    },
  };
  createSubagentYieldExtension({ workspace: root })(pi);
  createToolResultBoundExtension({
    environment: { MILKSU_WORKSPACE_RUNTIME: runtime },
    cwd,
  })(pi);
  const current = { ...event };
  for (const handler of handlers) {
    const next = await handler(current);
    if (!next) continue;
    if (next.content !== undefined) current.content = next.content;
    if (next.details !== undefined) current.details = next.details;
  }
  return current;
}

test("integration: long read keeps head+tail, overflow, and a hash the edit wrapper accepts", async () => {
  const dir = await workspace();
  const source = await readFile(join(dir, "dump.txt"), "utf8");
  const bound = boundModelText(source, {
    toolName: "read",
    path: "dump.txt",
  });
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-2499-END"), true);
  assert.match(bound.text, /omitted \d+ lines/);
  assert.equal(bound.contentHash, sha16(source));

  const runtime = await mkdtemp(join(tmpdir(), "milksu-loop-runtime-"));
  const chained = await chainToolResult({
    toolCallId: "read-1",
    toolName: "read",
    input: { path: "dump.txt" },
    content: [{ type: "text", text: source }],
  }, { runtime, cwd: dir, workspace: dir });
  assert.match(chained.content[0].text, /Full output saved to /);
  assert.equal(await readFile(join(runtime, "tool-results", "read-1.txt"), "utf8"), source);

  const edited = await runEdit(dir, {
    contentHash: bound.contentHash,
    edits: [{
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  // dump.txt hash is not sample.ts; this must refuse, not silently write.
  assert.equal(edited.ok, false);
  assert.equal(edited.code, "stale-hash");
  assert.equal(edited.body, sample);

  const fileHash = sha16(sample);
  const ok = await runEdit(dir, {
    contentHash: fileHash,
    edits: [{
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 2, endLine: 2 },
    }],
  });
  assert.equal(ok.ok, true);
  assert.match(ok.body, /hi \$\{name\}/);
});

test("integration: Pi-truncated read notice keeps the useful head; two bad anchors fall back once", async () => {
  const head = dumpLines(2000).join("\n");
  const notice = `${head}\n\n[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]`;
  const bound = boundModelText(notice, { toolName: "read", path: "dump.txt" });
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-1500"), true);
  assert.doesNotMatch(bound.text, /omitted \d+ lines/);

  const dir = await workspace();
  const tool = editTool(dir);
  const bad = {
    contentHash: hashFileText(sample),
    edits: [{
      oldText: "  return `hello ${name}`;",
      newText: "  return `hi ${name}`;",
      anchor: { startLine: 99, endLine: 99 },
    }],
  };
  const first = await runEdit(dir, bad, tool);
  assert.equal(first.ok, false);
  const second = await runEdit(dir, bad, tool);
  assert.equal(second.ok, true);
  assert.match(second.body, /hi \$\{name\}/);
});

test("integration: yield fields survive the later bound hook; parent reads files[0]", async () => {
  const dir = await workspace();
  const runtime = await mkdtemp(join(tmpdir(), "milksu-loop-yield-"));
  const prose = [
    "I renamed the helper.",
    ...dumpLines(2500),
  ].join("\n");
  const chained = await chainToolResult({
    toolCallId: "sub-1",
    toolName: "subagent",
    input: { agent: "worker", cwd: dir },
    content: [{ type: "text", text: prose }],
    details: {
      results: [{
        agent: "worker",
        exitCode: 0,
        files: ["a.ts"],
        findings: [{ path: "a.ts", note: "renamed" }],
        cwd: dir,
      }],
    },
  }, { runtime, cwd: dir, workspace: dir });

  assert.equal(readSubagentYieldField(chained, "files[0]"), "a.ts");
  assert.equal(chained.details.yield.files[0], "a.ts");
  assert.match(chained.content[0].text, /files\[0\]=a\.ts/);
  const payload = JSON.stringify(chained.details.yield);
  for (const needle of fixture.forbidden) {
    assert.equal(payload.includes(needle), false, needle);
  }
});

test("integration: steer aborts text stream but not an in-flight edit", async () => {
  const streaming = {
    isStreaming: true,
    isIdle: false,
    isBashRunning: false,
    calls: [],
    async steer(message) { this.calls.push(["steer", message]); },
    async abort() { this.calls.push("abort"); },
    async prompt() { this.calls.push("prompt"); },
  };
  await steerSession(new Map([["c1", streaming]]), {
    conversationId: "c1",
    prompt: "不要改 API",
  });
  assert.deepEqual(streaming.calls, [["steer", "不要改 API"], "abort"]);

  const editing = {
    isStreaming: true,
    isIdle: false,
    isBashRunning: false,
    state: { pendingToolCalls: new Set(["edit-1"]) },
    calls: [],
    async steer(message) { this.calls.push(["steer", message]); },
    async abort() { this.calls.push("abort"); },
  };
  await steerSession(new Map([["c1", editing]]), {
    conversationId: "c1",
    prompt: "先别写",
  });
  assert.equal(shouldAbortAssistantStream(editing), false);
  assert.deepEqual(editing.calls, [["steer", "先别写"]]);
});

test("integration: assembled context categories scale to billed prompt and omit secrets", () => {
  const composition = composeContextUsage({
    systemPrompt: "You are the Coding agent.\nSKILL.md\nUse read and edit.",
    skills: [{ name: "SKILL.md", description: "Use read and edit." }],
    tools: [
      { name: "read", description: "Read a file", parameters: { path: "string" } },
      { name: "edit", description: "Edit a file", parameters: { path: "string" } },
      { name: "subagent", description: "Run a child agent", parameters: { agent: "string" } },
      { name: "milksu_workspace", description: "Workspace UI", parameters: { action: "string" } },
    ],
    activeToolNames: ["read", "edit", "subagent", "milksu_workspace"],
    messages: [
      { role: "user", content: "Rename greet." },
      { role: "assistant", content: [{ type: "text", text: "I will edit sample.ts" }] },
    ],
    billedPromptTokens: fixture.billedPromptTokens,
    contextWindow: fixture.overrideWindow,
  });
  assert.equal(composition.estimatedTokens, fixture.billedPromptTokens);
  assert.equal(composition.contextWindow, fixture.overrideWindow);
  const ids = composition.categories.map(item => item.id);
  assert.ok(ids.includes("system"));
  assert.ok(ids.includes("tools"));
  assert.ok(ids.includes("conversation"));
  assert.ok(ids.includes("subagent") || ids.includes("mcp"));
  const sum = composition.categories.reduce((total, item) => total + item.tokens, 0);
  assert.equal(sum, fixture.billedPromptTokens);
  const serialized = JSON.stringify(composition);
  assert.doesNotMatch(serialized, /Rename greet/);
  assert.doesNotMatch(serialized, /sample\.ts/);
  for (const needle of fixture.forbidden) {
    assert.equal(serialized.includes(needle), false, needle);
  }
});

test("integration: manual window override beats the 128000 catalog placeholder", () => {
  assert.equal(
    resolveModelContextWindow(fixture.model, fixture.catalogWindow, fixture.overrideWindow),
    fixture.overrideWindow,
  );
  assert.equal(
    resolveModelContextWindow(fixture.model, fixture.catalogWindow),
    500000,
  );
});
