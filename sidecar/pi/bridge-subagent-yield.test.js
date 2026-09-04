import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSubagentYieldExtension,
  formatSubagentToolInput,
  formatSubagentYieldLines,
  normalizeSubagentYield,
  projectSubagentRosterEnd,
  projectSubagentRosterStart,
  projectSubagentToolResult,
  readSubagentYieldField,
  validateSubagentYield,
} from "./bridge-subagent-yield.js";

function validYield(overrides = {}) {
  return {
    status: "succeeded",
    cwd: ".",
    files: ["a.ts"],
    findings: [{ path: "a.ts", note: "renamed" }],
    exitCode: 0,
    ...overrides,
  };
}

test("normalize and validate accept a complete yield", () => {
  const value = normalizeSubagentYield(validYield());
  assert.equal(value.status, "succeeded");
  assert.deepEqual(value.files, ["a.ts"]);
  assert.equal(value.findings[0].path, "a.ts");
  assert.equal(value.exitCode, 0);
  assert.equal(validateSubagentYield(value), value);
});

test("validate rejects missing required fields", () => {
  assert.throws(() => validateSubagentYield({
    status: "succeeded",
    cwd: ".",
    exitCode: 0,
  }), /missing files/);
  assert.throws(() => validateSubagentYield({
    status: "succeeded",
    files: ["a.ts"],
    findings: [],
    exitCode: 0,
  }), /cwd or worktreeId/);
  assert.throws(() => validateSubagentYield({
    cwd: ".",
    files: [],
    findings: [],
    exitCode: 0,
  }), /missing status/);
  assert.throws(() => validateSubagentYield({
    status: "succeeded",
    cwd: ".",
    files: [],
    findings: [],
  }), /missing exitCode/);
  assert.throws(
    () => normalizeSubagentYield({ status: "succeeded", cwd: ".", exitCode: 0 }, { requireFields: true }),
    /missing files or findings/,
  );
});

test("read-only roles reject writer worktree paths in files and findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-yield-"));
  const writer = join(root, "writer-1");
  assert.throws(
    () => validateSubagentYield(validYield({
      files: [join(writer, "a.ts")],
      findings: [{ path: join(writer, "a.ts"), note: "wrote" }],
    }), {
      role: "scout",
      writerWorktreePaths: [writer],
    }),
    /Read-only subagent yield cannot include writer worktree paths/,
  );
  assert.throws(
    () => normalizeSubagentYield(validYield({
      files: ["writer-1/a.ts"],
      findings: [{ path: "writer-1/src.ts", note: "edited" }],
    }), {
      role: "planner",
      worktrees: [{ id: "writer-1", path: writer }],
    }),
    /Read-only subagent yield cannot include writer worktree paths/,
  );
  const allowed = normalizeSubagentYield(validYield({
    files: ["src/review.ts"],
    findings: [{ path: "src/review.ts", note: "looks fine" }],
  }), {
    role: "reviewer",
    workspace: root,
  });
  assert.deepEqual(allowed.files, ["src/review.ts"]);
});

test("strips keys, home directories, and relay credentials from yield", () => {
  const home = join(tmpdir(), "milksu-home-user");
  const worktree = join(home, "collab", "writer-1");
  const value = normalizeSubagentYield({
    status: "succeeded",
    cwd: worktree,
    worktreeId: "writer-1",
    files: [join(worktree, "src", "a.ts")],
    findings: [{
      path: join(home, "secret.ts"),
      note: "token sk-live-abcdef12345678 and key=TOKENFLUX_SECRET_VALUE",
    }],
    exitCode: 0,
  }, {
    worktrees: [{ id: "writer-1", path: worktree }],
    workspace: join(home, "repo"),
    homeDirectory: home,
    environment: {
      MILKSU_RELAY_KEY: "relay-secret-value-123456",
      TOKENFLUX_API_KEY: "unused-but-present-key",
    },
    role: "worker",
  });
  assert.equal(value.files[0], "src/a.ts");
  assert.equal(value.worktreeId, "writer-1");
  assert.equal(value.files[0].includes(home), false);
  assert.equal(JSON.stringify(value).includes(home), false);
  assert.equal(JSON.stringify(value).includes("sk-live-"), false);
  assert.equal(JSON.stringify(value).includes("relay-secret-value-123456"), false);
  assert.match(value.findings[0].note, /\[REDACTED\]/);
});

test("parent loop reads files[0] from structured tool_result without extra tools", () => {
  const wrapped = projectSubagentToolResult({
    toolName: "subagent",
    content: [{ type: "text", text: "I renamed the helper and updated the imports." }],
    details: {
      results: [{
        agent: "worker",
        exitCode: 0,
        files: ["a.ts"],
        findings: [{ path: "a.ts", note: "renamed" }],
        cwd: "/work/writer-1",
      }],
    },
    input: { agent: "worker", cwd: "/work/writer-1" },
  }, {
    workspace: "/work",
    collaboration: { worktrees: [{ id: "writer-1", path: "/work/writer-1" }] },
  });

  function fakeProviderReadFiles0(toolResult) {
    return readSubagentYieldField(toolResult, "files[0]");
  }

  assert.equal(fakeProviderReadFiles0(wrapped), "a.ts");
  assert.equal(readSubagentYieldField(wrapped, "findings[0].path"), "a.ts");
  assert.equal(readSubagentYieldField(wrapped, "exitCode"), 0);
  const visible = wrapped.content[0].text;
  assert.match(visible, /^files\[0\]=a\.ts/m);
  assert.match(visible, /"files":\s*\[\s*"a\.ts"\s*\]/);
  assert.equal(wrapped.details.yield.files[0], "a.ts");
  assert.equal(wrapped.details.schema, "milksu-subagent-yield/v1");
});

test("roster start appears and end becomes succeeded or failed", () => {
  const started = projectSubagentRosterStart({
    agent: "scout",
    task: "map the module",
  }, { toolCallId: "call-1" });
  assert.equal(started.length, 1);
  assert.equal(started[0].id, "call-1");
  assert.equal(started[0].role, "scout");
  assert.equal(started[0].status, "start");

  const succeeded = projectSubagentRosterEnd(started, {
    details: {
      results: [{
        agent: "scout",
        exitCode: 0,
        files: ["readme.md"],
        findings: [{ path: "readme.md", note: "entry" }],
        cwd: ".",
      }],
    },
  }, { durationMs: 1200, toolCallId: "call-1" });
  assert.equal(succeeded[0].status, "succeeded");
  assert.equal(succeeded[0].exitCode, 0);
  assert.equal(succeeded[0].yield.files[0], "readme.md");
  assert.equal(succeeded[0].durationMs, 1200);

  const failed = projectSubagentRosterEnd(started, {
    details: {
      results: [{
        agent: "scout",
        exitCode: 2,
        files: [],
        findings: [],
        cwd: ".",
      }],
    },
  }, { durationMs: 40, isError: true, toolCallId: "call-1" });
  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].exitCode, 2);
});

test("tool_result hook only wraps subagent results", async () => {
  const listeners = new Map();
  const extension = createSubagentYieldExtension({
    workspace: "/work",
  });
  extension({
    on(type, handler) {
      listeners.set(type, handler);
    },
  });
  const handler = listeners.get("tool_result");
  assert.equal(await handler({ toolName: "bash", content: [{ type: "text", text: "ok" }] }), undefined);
  const wrapped = await handler({
    toolName: "subagent",
    content: [{ type: "text", text: "done" }],
    details: {
      results: [{
        agent: "worker",
        exitCode: 0,
        files: ["a.ts"],
        findings: [],
        cwd: ".",
      }],
    },
    input: { agent: "worker" },
  });
  assert.equal(readSubagentYieldField(wrapped, "files[0]"), "a.ts");
});

test("formatSubagentToolInput stays compact", () => {
  assert.equal(formatSubagentToolInput({ agent: "scout", task: "look" }), "scout");
  assert.equal(formatSubagentToolInput({
    agent: "worker",
    cwd: "/work/writer-1",
    task: "edit",
  }, {
    worktrees: [{ id: "writer-1", path: "/work/writer-1" }],
  }), "worker · writer-1");
});

test("field lines stay stable for a fake provider", () => {
  const lines = formatSubagentYieldLines(validYield());
  assert.equal(lines.split("\n")[0], "files[0]=a.ts");
});
