import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReviewedLspFixTool } from "./bridge-lsp.js";

const beforeText = "const answer: string = 42\n";
const afterText = "const answer: number = 42\n";

function policy(workspace, approvalPolicy = "workspace-auto") {
  return {
    ctf: false,
    workspace,
    executionMode: "go",
    approvalPolicy,
    activeTools: ["lsp_fix"],
  };
}

function fakeLspTool(calls) {
  return {
    name: "lsp_fix",
    promptGuidelines: [],
    async execute(_toolCallId, params) {
      calls.push({ ...params });
      const path = join(params.root, params.path);
      if (params.write) await writeFile(path, afterText, "utf8");
      return {
        content: [{ type: "text", text: "fake LSP result" }],
        details: {
          path: params.path,
          changed: true,
          write: Boolean(params.write),
          kind: params.kind ?? "source.fixAll",
          actions: [{ title: "Use number", kind: "quickfix" }],
          appliedActions: [{ title: "Use number", kind: "quickfix" }],
          edits: [],
          text: params.write ? undefined : afterText,
        },
      };
    },
  };
}

async function fixture(approvalPolicy = "workspace-auto", request = async () => true) {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-reviewed-lsp-"));
  const path = join(workspace, "main.ts");
  await writeFile(path, beforeText, "utf8");
  const calls = [];
  const requests = [];
  const tool = createReviewedLspFixTool(fakeLspTool(calls), {
    conversationId: "conversation-lsp",
    getPolicy: () => policy(workspace, approvalPolicy),
    approvalBroker: {
      async request(value) {
        requests.push(value);
        return request(value, path);
      },
    },
  });
  return { workspace, path, calls, requests, tool };
}

test("Project Auto previews, applies, and reports the exact LSP Diff", async () => {
  const value = await fixture();
  const result = await value.tool.execute(
    "fix-1",
    { path: "main.ts", write: true },
    undefined,
    undefined,
    {},
  );

  assert.equal(await readFile(value.path, "utf8"), afterText);
  assert.equal(value.requests.length, 0);
  assert.equal(value.calls.length, 2);
  assert.equal(value.calls[0].write, false);
  assert.equal(value.calls[1].write, true);
  assert.match(result.content[0].text, /LSP applied the reviewed source fix/);
  assert.match(result.content[0].text, /-const answer: string = 42/);
  assert.match(result.content[0].text, /\+const answer: number = 42/);
  assert.equal(result.details.reviewed, true);
  assert.equal(result.details.write, true);
});

test("Request Approval shows the Diff before applying an LSP fix", async () => {
  const value = await fixture("ask");
  await value.tool.execute(
    "fix-2",
    { path: "main.ts", kind: "quickfix", write: true },
    undefined,
    undefined,
    {},
  );

  assert.equal(value.requests.length, 1);
  assert.equal(value.requests[0].toolName, "lsp_fix");
  assert.match(value.requests[0].content, /LSP 修复 · main\.ts/);
  assert.match(value.requests[0].content, /-const answer: string = 42/);
  assert.match(value.requests[0].content, /\+const answer: number = 42/);
  assert.match(value.requests[0].input, /"kind": "quickfix"/);
  assert.equal(await readFile(value.path, "utf8"), afterText);
});

test("denied LSP approval leaves the file unchanged", async () => {
  const value = await fixture("ask", async () => false);
  await assert.rejects(
    value.tool.execute(
      "fix-3",
      { path: "main.ts", write: true },
      undefined,
      undefined,
      {},
    ),
    /denied lsp_fix/,
  );

  assert.equal(await readFile(value.path, "utf8"), beforeText);
  assert.equal(value.calls.length, 1);
});

test("Request Approval refuses a Diff that cannot be shown in full", async () => {
  const value = await fixture("ask");
  const largeAfter = `const answer = "${"x".repeat(61_000)}"\n`;
  value.tool = createReviewedLspFixTool({
    ...fakeLspTool(value.calls),
    async execute(_toolCallId, params) {
      value.calls.push({ ...params });
      if (params.write) await writeFile(value.path, largeAfter, "utf8");
      return {
        details: {
          path: params.path,
          text: params.write ? undefined : largeAfter,
        },
      };
    },
  }, {
    conversationId: "conversation-lsp",
    getPolicy: () => policy(value.workspace, "ask"),
    approvalBroker: {
      async request(request) {
        value.requests.push(request);
        return true;
      },
    },
  });

  await assert.rejects(
    value.tool.execute(
      "fix-large",
      { path: "main.ts", write: true },
      undefined,
      undefined,
      {},
    ),
    /exceeds the 60000-character review limit/,
  );
  assert.equal(value.requests.length, 0);
  assert.equal(await readFile(value.path, "utf8"), beforeText);
});

test("LSP preview is read-only and does not request approval", async () => {
  const value = await fixture("ask");
  const result = await value.tool.execute(
    "fix-4",
    { path: "main.ts", write: false },
    undefined,
    undefined,
    {},
  );

  assert.equal(await readFile(value.path, "utf8"), beforeText);
  assert.equal(value.requests.length, 0);
  assert.equal(value.calls.length, 1);
  assert.match(result.content[0].text, /no files were changed/);
});

test("LSP apply aborts when the file changed after the reviewed preview", async () => {
  const changedText = "const answer = 'changed while waiting'\n";
  const value = await fixture("ask", async (_request, path) => {
    await writeFile(path, changedText, "utf8");
    return true;
  });
  await assert.rejects(
    value.tool.execute(
      "fix-5",
      { path: "main.ts", write: true },
      undefined,
      undefined,
      {},
    ),
    /changed after preview/,
  );

  assert.equal(await readFile(value.path, "utf8"), changedText);
  assert.equal(value.calls.length, 1);
});

test("LSP fix cannot use a model-supplied root outside the selected project", async () => {
  const value = await fixture();
  await value.tool.execute(
    "fix-6",
    { root: tmpdir(), path: "main.ts", write: true },
    undefined,
    undefined,
    {},
  );

  assert.equal(value.calls.every(call => call.root === value.workspace), true);
  assert.equal(await readFile(value.path, "utf8"), afterText);
});
