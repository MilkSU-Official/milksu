// PR-2 批次 B2：工具面挂载单元测试（faux/假核心，零网络零真实语言服务）。
//
// 覆盖工单验收点：
//   - 适配器：签名翻译、结果直通、onUpdate 快照→增量、replay 声明、错误传播
//   - milksu-coding-tools：七个编码工具挂载 + 真 read/bash 经适配器执行
//   - milksu-lsp：受审链逐环节（策略门禁/强制 dry-run/圈界/无变化/预览/ask 审批
//     /超限拒审/过期/回滚/进度 details）+ diagnostics 原样语义 + replay safe
//   - milksu-skills：目录渲染不贴正文、disable-model-invocation 排除、负向路径
//   - hang-guard afterTool：超时诊断追加、非超时不碰、env 关闭
//   - 工具面对照：mounted/deferred 清单推导

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import {
  adaptCodingToolDefinition,
  createMilksuCodingToolsExtension,
  createMilksuHangGuardHooks,
  createMilksuLspExtension,
  createMilksuSkillsExtension,
  defaultLspRuntime,
  deferredHarnessToolNames,
  mountedHarnessToolNames,
} from "./harness-bridge-tools.js";
import { codingWorkspaceAutoToolNames } from "./bridge-coding-policy.js";

function fakeApi(overrides = {}) {
  const outputs = [];
  const detailsValues = [];
  return {
    callId: "call-1",
    conversationId: 7,
    agent: async () => ({ cwd: "/workspace", model: undefined }),
    output: chunk => outputs.push(String(chunk)),
    details: async value => {
      detailsValues.push(value);
    },
    outputs,
    detailsValues,
    ...overrides,
  };
}

const runContext = () => ({ abortSignal: new AbortController().signal });

// ---------- 适配器 ----------

test("adaptCodingToolDefinition passes through results and declares replay per tool", async () => {
  const definition = {
    name: "read",
    description: "read files",
    parameters: Type.Object({ path: Type.String() }),
    async execute(toolCallId, params, signal, onUpdate) {
      assert.equal(toolCallId, "call-1");
      assert.equal(params.path, "x.txt");
      assert.ok(signal instanceof AbortSignal);
      onUpdate?.({ content: [{ type: "text", text: "partial" }] });
      return {
        content: [{ type: "text", text: "done" }],
        details: { path: "x.txt" },
        isError: false,
      };
    },
  };
  const tool = adaptCodingToolDefinition(definition);
  assert.equal(tool.name, "read");
  assert.equal(tool.replay, "safe", "pure-read tools replay safely");
  assert.equal(tool.parameters, definition.parameters);
  const api = fakeApi();
  const result = await tool.execute({ path: "x.txt" }, api, runContext());
  assert.deepEqual(result.content, [{ type: "text", text: "done" }]);
  assert.deepEqual(result.details, { path: "x.txt" });
  assert.equal(result.isError, false);
  assert.deepEqual(api.outputs, ["partial"], "snapshot updates stream as deltas");
});

test("adaptCodingToolDefinition keeps effectful tools replay-unsafe and errors propagating", async () => {
  const definition = {
    name: "bash",
    description: "shell",
    parameters: Type.Object({ command: Type.String() }),
    async execute() {
      throw new Error("Command timed out after 3 seconds");
    },
  };
  const tool = adaptCodingToolDefinition(definition);
  assert.equal(tool.replay, undefined, "default unsafe");
  assert.deepEqual(tool.outputLimits, { retain: "tail" }, "bash keeps its tail window");
  await assert.rejects(
    tool.execute({ command: "x" }, fakeApi(), runContext()),
    /timed out/,
  );
});

test("adaptCodingToolDefinition stops streaming once the snapshot truncates", async () => {
  const definition = {
    name: "bash",
    description: "shell",
    parameters: Type.Object({ command: Type.String() }),
    async execute(_id, _params, _signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: "abc" }] });
      onUpdate?.({
        content: [{ type: "text", text: "truncated tail" }],
        details: { truncation: { truncated: true } },
      });
      onUpdate?.({ content: [{ type: "text", text: "truncated tail2" }] });
      return { content: [{ type: "text", text: "final" }] };
    },
  };
  const tool = adaptCodingToolDefinition(definition);
  const api = fakeApi();
  await tool.execute({ command: "x" }, api, runContext());
  assert.deepEqual(api.outputs, ["abc"], "truncated snapshots stop streaming");
});

test("adaptCodingToolDefinition resolves the conversation agent cwd and model", async () => {
  const seen = [];
  const definition = {
    name: "read",
    description: "read",
    parameters: Type.Object({ path: Type.String() }),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      seen.push(ctx);
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const model = { id: "faux-1", provider: "faux", input: ["text"] };
  const tool = adaptCodingToolDefinition(definition, {
    resolveModel: ref => (ref?.provider === "faux" ? model : undefined),
  });
  await tool.execute({ path: "x" }, fakeApi({
    agent: async () => ({ cwd: "/resolved", model: { provider: "faux", modelId: "faux-1" } }),
  }), runContext());
  assert.deepEqual(seen, [{ cwd: "/resolved", model }]);
});

// ---------- milksu-coding-tools（真定义经适配器） ----------

test("milksu-coding-tools mounts the seven ported coding tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-b2-coding-"));
  try {
    const extension = await createMilksuCodingToolsExtension({ workspace });
    assert.equal(extension.name, "milksu-coding-tools");
    assert.deepEqual(
      extension.tools.map(tool => tool.name).sort(),
      ["bash", "edit", "find", "grep", "ls", "read", "write"],
    );
    for (const tool of extension.tools) {
      assert.equal(typeof tool.execute, "function", `${tool.name} is executable`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the ported read tool reads files with the same truncation contract", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-b2-read-"));
  try {
    await writeFile(join(workspace, "small.txt"), "hello world\n", "utf8");
    const big = Array.from({ length: 2500 }, (_, index) => `line-${index}`).join("\n");
    await writeFile(join(workspace, "big.txt"), big, "utf8");
    const extension = await createMilksuCodingToolsExtension({ workspace });
    const read = extension.tools.find(tool => tool.name === "read");

    const small = await read.execute(
      { path: join(workspace, "small.txt") },
      fakeApi({ agent: async () => ({ cwd: workspace }) }),
      runContext(),
    );
    assert.equal(small.content[0].text, "hello world\n");
    assert.equal(small.isError, undefined);

    const clipped = await read.execute(
      { path: join(workspace, "big.txt") },
      fakeApi({ agent: async () => ({ cwd: workspace }) }),
      runContext(),
    );
    const text = clipped.content[0].text;
    assert.ok(text.includes("line-0"), "head is kept");
    assert.ok(!text.includes("line-2499"), "beyond the 2000-line contract is cut");
    assert.ok(clipped.details?.truncation?.truncated === true, "truncation details reported");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the ported bash tool executes real commands with full output and notices", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-b2-bash-"));
  try {
    const extension = await createMilksuCodingToolsExtension({ workspace });
    const bash = extension.tools.find(tool => tool.name === "bash");
    const api = fakeApi({ agent: async () => ({ cwd: workspace }) });
    const result = await bash.execute(
      { command: "echo harness-b2", timeout: 10 },
      api,
      runContext(),
    );
    assert.match(result.content[0].text, /harness-b2/);
    assert.equal(result.isError, undefined);

    const failing = await bash.execute(
      { command: "exit 3", timeout: 10 },
      fakeApi({ agent: async () => ({ cwd: workspace }) }),
      runContext(),
    );
    assert.equal(failing.isError, true, "nonzero exit is an error result");
    assert.match(failing.content[0].text, /Command exited with code 3/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

// ---------- milksu-lsp（受审链，假 LSP 核心） ----------

const beforeText = "const answer: string = 42\n";
const afterText = "const answer: number = 42\n";

function lspPolicy(workspace, approvalPolicy = "workspace-auto", activeTools = ["lsp_fix", "lsp_diagnostics"]) {
  return {
    ctf: false,
    workspace,
    executionMode: "go",
    approvalPolicy,
    activeTools,
  };
}

function fakeLspRuntime(calls, { after = afterText, applyWrites = true } = {}) {
  return {
    defaultFileLimit: 50,
    loadRuntime(root) {
      calls.push({ kind: "loadRuntime", root });
      return { adapters: [{ name: "fake-lsp" }], timeoutMs: 1234 };
    },
    selectFixRoute(adapters, params) {
      calls.push({ kind: "selectFixRoute", params: { ...params } });
      return { root: params.root, route: { adapter: adapters[0], reason: "fake route" } };
    },
    selectDiagnosticRoutes(adapters, params, limit) {
      calls.push({ kind: "selectDiagnosticRoutes", params: { ...params }, limit });
      return {
        root: params.root,
        routes: [{ adapter: adapters[0], reason: "fake diagnostics route", files: ["main.ts"] }],
        skipped: [],
      };
    },
    async runFix(adapter, params) {
      calls.push({ kind: "runFix", params: { ...params } });
      if (params.write && applyWrites) {
        await writeFile(join(params.root, params.path), after, "utf8");
      }
      return {
        content: [{ type: "text", text: "fake LSP fix output" }],
        details: {
          path: params.path,
          changed: true,
          write: Boolean(params.write),
          kind: params.kind ?? "source.fixAll",
          actions: [{ title: "Use number", kind: "quickfix" }],
          appliedActions: [{ title: "Use number", kind: "quickfix" }],
          edits: [],
          text: params.write ? undefined : after,
        },
      };
    },
    async runDiagnostics(adapter, params) {
      calls.push({ kind: "runDiagnostics", params: { ...params } });
      return {
        content: [{ type: "text", text: "main.ts: no diagnostics" }],
        details: { files: [{ path: params.files?.[0] ?? "main.ts", diagnostics: [] }] },
      };
    },
  };
}

async function lspFixture(options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-b2-lsp-"));
  await writeFile(join(workspace, "main.ts"), beforeText, "utf8");
  const calls = [];
  const requests = [];
  const approvalBroker = {
    async request(value) {
      requests.push(value);
      return options.approval ? options.approval(value) : true;
    },
  };
  // runtime 工厂拿 fixture 自己的 calls 数组，断言才能看见调用。
  const makeRuntime = options.makeRuntime ?? (runtimeCalls => fakeLspRuntime(runtimeCalls, options));
  const extension = createMilksuLspExtension({
    resolveConversation: () => "conv-lsp",
    getPolicy: () => lspPolicy(workspace, options.approvalPolicy ?? "workspace-auto"),
    approvalBroker,
    lsp: makeRuntime(calls),
  });
  const fixTool = extension.tools.find(tool => tool.name === "lsp_fix");
  const diagnosticsTool = extension.tools.find(tool => tool.name === "lsp_diagnostics");
  return {
    workspace,
    path: join(workspace, "main.ts"),
    calls,
    requests,
    extension,
    fixTool,
    diagnosticsTool,
    async runFixTool(args, apiOverrides = {}) {
      return fixTool.execute(args, fakeApi(apiOverrides), runContext());
    },
  };
}

test("milksu-lsp declares both tools replay-safe", async () => {
  const value = await lspFixture();
  try {
    assert.equal(value.fixTool.replay, "safe");
    assert.equal(value.diagnosticsTool.replay, "safe");
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix gates on the coding policy", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-b2-lsp-gate-"));
  try {
    const calls = [];
    const extension = createMilksuLspExtension({
      resolveConversation: () => "conv-lsp",
      getPolicy: () => lspPolicy(workspace, "workspace-auto", ["read"]),
      approvalBroker: { request: async () => true },
      lsp: fakeLspRuntime(calls),
    });
    const fixTool = extension.tools.find(tool => tool.name === "lsp_fix");
    await assert.rejects(
      fixTool.execute({ path: "main.ts", write: true }, fakeApi(), runContext()),
      /does not allow lsp_fix/,
    );
    assert.equal(calls.length, 0, "the LSP core never runs without policy");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("lsp_fix always dry-runs first and ignores a model-supplied root", async () => {
  const value = await lspFixture();
  try {
    const result = await value.runFixTool({ root: tmpdir(), path: "main.ts", write: true });
    assert.equal(value.calls[0].kind, "loadRuntime");
    assert.equal(value.calls[0].root, value.workspace);
    assert.equal(value.calls.filter(call => call.kind === "runFix").length, 2);
    assert.equal(value.calls.find(call => call.kind === "runFix").params.write, false,
      "the preview pass is forced to write:false");
    assert.equal(
      value.calls.every(call => call.params?.root === undefined || call.params.root === value.workspace),
      true,
      "the workspace root always comes from the policy",
    );
    assert.equal(await readFile(value.path, "utf8"), afterText);
    assert.equal(value.requests.length, 0, "workspace-auto needs no approval");
    assert.match(result.content[0].text, /LSP applied the reviewed source fix/);
    assert.match(result.content[0].text, /-const answer: string = 42/);
    assert.match(result.content[0].text, /\+const answer: number = 42/);
    assert.equal(result.details.reviewed, true);
    assert.equal(result.details.write, true);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix preview is read-only and shows the Diff", async () => {
  const value = await lspFixture();
  try {
    const result = await value.runFixTool({ path: "main.ts", write: false });
    assert.equal(await readFile(value.path, "utf8"), beforeText);
    assert.equal(value.calls.filter(call => call.kind === "runFix").length, 1);
    assert.match(result.content[0].text, /no files were changed/);
    assert.match(result.content[0].text, /\+const answer: number = 42/);
    assert.equal(result.details.write, false);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix reports when the LSP proposes no change", async () => {
  const value = await lspFixture({
    makeRuntime: runtimeCalls => {
      const runtime = fakeLspRuntime(runtimeCalls);
      runtime.runFix = async (adapter, params) => {
        runtimeCalls.push({ kind: "runFix", params: { ...params } });
        return {
          content: [{ type: "text", text: "nothing to fix" }],
          details: { path: params.path, changed: false, write: false, text: beforeText },
        };
      };
      return runtime;
    },
  });
  try {
    const result = await value.runFixTool({ path: "main.ts", write: true });
    assert.match(result.content[0].text, /found no applicable source fix/);
    assert.equal(await readFile(value.path, "utf8"), beforeText);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix confines writes to the workspace via realpath", async () => {
  const value = await lspFixture();
  try {
    // 圈界需要目标真实存在：在临时根（工作区上一级）放一个文件，用相对路径逃逸。
    const outside = join(value.workspace, "..", "escaped-secret.ts");
    await writeFile(outside, "const escaped: string = 42\n", "utf8");
    await assert.rejects(
      value.runFixTool({ path: "../escaped-secret.ts", write: true }),
      /outside the workspace/,
    );
    assert.equal(
      value.calls.filter(call => call.kind === "runFix").length, 1,
      "only the in-workspace preview ran",
    );
    await rm(outside, { force: true });
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("Request Approval shows the Diff and denial leaves the file unchanged", async () => {
  const value = await lspFixture({ approvalPolicy: "ask", approval: async () => false });
  try {
    await assert.rejects(
      value.runFixTool({ path: "main.ts", kind: "quickfix", write: true }),
      /denied lsp_fix/,
    );
    assert.equal(value.requests.length, 1);
    assert.equal(value.requests[0].toolName, "lsp_fix");
    assert.match(value.requests[0].content, /LSP 修复 · main\.ts/);
    assert.match(value.requests[0].content, /-const answer: string = 42/);
    assert.match(value.requests[0].input, /"kind": "quickfix"/);
    assert.match(value.requests[0].input, /"beforeSha256"/);
    assert.equal(await readFile(value.path, "utf8"), beforeText);
    assert.equal(value.calls.filter(call => call.kind === "runFix").length, 1,
      "the apply pass never ran after denial");
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("Request Approval refuses a Diff beyond the review limit", async () => {
  const huge = `const answer = "${"x".repeat(61_000)}"\n`;
  const value = await lspFixture({
    approvalPolicy: "ask",
    makeRuntime: runtimeCalls => {
      const runtime = fakeLspRuntime(runtimeCalls);
      runtime.runFix = async (adapter, params) => {
        runtimeCalls.push({ kind: "runFix", params: { ...params } });
        if (params.write) await writeFile(join(params.root, params.path), huge, "utf8");
        return {
          content: [{ type: "text", text: "huge fix" }],
          details: { path: params.path, text: params.write ? undefined : huge },
        };
      };
      return runtime;
    },
  });
  try {
    await assert.rejects(
      value.runFixTool({ path: "main.ts", write: true }),
      /60000-character review limit/,
    );
    assert.equal(value.requests.length, 0, "no approval card for an unshowable Diff");
    assert.equal(await readFile(value.path, "utf8"), beforeText);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix aborts when the file changed after the reviewed preview", async () => {
  const changed = "const answer = 'changed while waiting'\n";
  const value = await lspFixture({
    approvalPolicy: "ask",
    approval: async () => {
      await writeFile(value.path, changed, "utf8");
      return true;
    },
  });
  try {
    await assert.rejects(
      value.runFixTool({ path: "main.ts", write: true }),
      /changed after preview/,
    );
    assert.equal(await readFile(value.path, "utf8"), changed);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix rolls back when the applied edit differs from the reviewed proposal", async () => {
  const mismatched = "const answer: boolean = true\n";
  const value = await lspFixture({
    makeRuntime: runtimeCalls => {
      const runtime = fakeLspRuntime(runtimeCalls);
      runtime.runFix = async (adapter, params) => {
        runtimeCalls.push({ kind: "runFix", params: { ...params } });
        if (params.write) await writeFile(join(params.root, params.path), mismatched, "utf8");
        return {
          content: [{ type: "text", text: "mismatched fix" }],
          details: { path: params.path, text: params.write ? undefined : afterText },
        };
      };
      return runtime;
    },
  });
  try {
    await assert.rejects(
      value.runFixTool({ path: "main.ts", write: true }),
      /rolled back main\.ts/,
    );
    assert.equal(await readFile(value.path, "utf8"), beforeText,
      "the rollback restores the pre-preview content");
    assert.equal(value.calls.filter(call => call.kind === "runFix").length, 2);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_fix publishes the preview details as progress", async () => {
  const value = await lspFixture();
  try {
    const api = fakeApi();
    await value.fixTool.execute({ path: "main.ts", write: false }, api, runContext());
    assert.ok(api.detailsValues.length >= 1, "api.details carries the preview progress");
    assert.equal(api.detailsValues[0].reviewed, true);
    assert.match(api.detailsValues[0].diff, /\+const answer: number = 42/);
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("lsp_diagnostics routes through the separable core unchanged", async () => {
  const value = await lspFixture();
  try {
    const result = await value.diagnosticsTool.execute(
      { paths: ["main.ts"] },
      fakeApi(),
      runContext(),
    );
    assert.match(result.content[0].text, /fake diagnostics route/);
    assert.match(result.content[0].text, /no diagnostics/);
    assert.equal(result.details.root, value.workspace);
    assert.deepEqual(
      value.calls.find(call => call.kind === "runDiagnostics").params.files,
      ["main.ts"],
    );
  } finally {
    await rm(value.workspace, { recursive: true, force: true });
  }
});

test("defaultLspRuntime wires the reviewed pi-lsp core", () => {
  const runtime = defaultLspRuntime();
  assert.equal(typeof runtime.runFix, "function");
  assert.equal(typeof runtime.runDiagnostics, "function");
  assert.equal(typeof runtime.selectFixRoute, "function");
  assert.equal(typeof runtime.loadRuntime, "function");
  assert.equal(runtime.defaultFileLimit, 50);
});

// ---------- milksu-skills（目录渲染，不贴正文） ----------

async function skillsFixture({ disableModelInvocation = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-b2-skills-"));
  const demo = join(root, "demo-skill");
  await mkdir(demo, { recursive: true });
  await writeFile(join(demo, "SKILL.md"), [
    "---",
    "name: demo-skill",
    "description: Use demo-skill when the task matches its description.",
    ...(disableModelInvocation ? ["disable-model-invocation: true"] : []),
    "---",
    "",
    "SKILL BODY SECRET: this paragraph must never enter the system prompt.",
    "",
  ].join("\n"), "utf8");
  const extra = join(root, "extra-skill");
  await mkdir(extra, { recursive: true });
  await writeFile(join(extra, "SKILL.md"), [
    "---",
    "name: extra-skill",
    "description: Use extra-skill for user-provided paths.",
    "---",
    "",
    "EXTRA BODY SECRET: also never rendered.",
    "",
  ].join("\n"), "utf8");
  const extension = createMilksuSkillsExtension({
    resolveConversation: id => (id === 7 ? "conv-skills" : ""),
    skillPathsFor: alias => (alias === "conv-skills" ? [demo, extra] : []),
  });
  const render = input => extension.sections[0].render(input);
  return { root, demo, extra, extension, render };
}

test("milksu-skills renders a catalog of names and descriptions, never bodies", async () => {
  const { render, root } = await skillsFixture();
  try {
    const text = render({
      conversationId: 7,
      agent: { tools: [{ name: "read" }] },
    });
    assert.ok(text.includes("<available_skills>"));
    assert.ok(text.includes("<name>demo-skill</name>"));
    assert.ok(text.includes("Use demo-skill when the task matches"));
    assert.ok(text.includes("<name>extra-skill</name>"));
    assert.ok(!text.includes("SKILL BODY SECRET"), "skill bodies stay out of the prompt");
    assert.ok(!text.includes("EXTRA BODY SECRET"));
    assert.ok(text.includes("Use the read tool to load a skill's file"),
      "body reading is delegated to the read tool");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("milksu-skills excludes disable-model-invocation skills like Pi does", async () => {
  const { render, root } = await skillsFixture({ disableModelInvocation: true });
  try {
    const text = render({ conversationId: 7, agent: { tools: [{ name: "read" }] } });
    assert.ok(!text.includes("demo-skill"), "invocation-disabled skills stay out");
    assert.ok(text.includes("extra-skill"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("milksu-skills renders nothing without paths or a body-reading tool", async () => {
  const { render, root, demo, extra } = await skillsFixture();
  try {
    assert.equal(render({ conversationId: 8, agent: { tools: [{ name: "read" }] } }), undefined,
      "conversations without skill paths get no section");
    assert.equal(
      render({ conversationId: 7, agent: { tools: [{ name: "lsp_diagnostics" }] } }),
      undefined,
      "no read/bash in the offered tools means no catalog",
    );
    const bashText = render({ conversationId: 7, agent: { tools: [{ name: "bash" }] } });
    assert.ok(bashText.includes("Use bash to load a skill's file"),
      "bash sessions keep the catalog with the bash wording");
    void demo;
    void extra;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------- hang-guard afterTool ----------

test("hang-guard afterTool appends the iCloud diagnostic on timeout errors", async () => {
  const hooks = createMilksuHangGuardHooks({
    environment: {},
    platform: "darwin",
    home: "/Users/tester",
    spawn: (command, args) => {
      assert.equal(command, "/bin/sh");
      return {
        error: undefined,
        status: 0,
        stdout: Array.from({ length: 30 }, () => "dataless").join("\n"),
      };
    },
  });
  assert.equal(hooks.length, 1);
  const afterTool = hooks[0].handlers.afterTool;
  const result = {
    isError: true,
    content: [{ type: "text", text: "partial output\nCommand timed out after 600 seconds" }],
    diagnostics: [],
  };
  const next = await afterTool(
    { name: "bash", id: "c1", arguments: { command: "cd ~/Documents/project && grep -r x .", timeout: 600 } },
    result,
  );
  assert.notEqual(next, undefined);
  assert.equal(next.content.length, 2);
  assert.match(next.content[1].text, /exceeded its 600s foreground limit/);
  assert.match(next.content[1].text, /30\+? files under .*Documents.*only in iCloud/);
  assert.match(next.content[1].text, /brctl download/);
});

test("hang-guard afterTool scans diagnostics text and leaves other errors alone", async () => {
  const hooks = createMilksuHangGuardHooks({
    environment: {},
    platform: "darwin",
    home: "/Users/tester",
    spawn: () => ({ error: undefined, status: 0, stdout: "x\n" }),
  });
  const afterTool = hooks[0].handlers.afterTool;
  // pi-durable 把抛错的文本放进 diagnostics（tool_error）而不是 content。
  const fromDiagnostics = await afterTool(
    { name: "bash", id: "c1", arguments: { command: "sleep", timeout: 1 } },
    {
      isError: true,
      content: [{ type: "text", text: "" }],
      diagnostics: [{ severity: "error", code: "tool_error", message: "Command timed out after 1 seconds" }],
    },
  );
  assert.notEqual(fromDiagnostics, undefined, "timeout text in diagnostics still triggers");
  assert.match(fromDiagnostics.content.at(-1).text, /exceeded its 1s foreground limit/);

  const untouched = await afterTool(
    { name: "bash", id: "c2", arguments: { command: "exit 1", timeout: 5 } },
    { isError: true, content: [{ type: "text", text: "Command exited with code 1" }], diagnostics: [] },
  );
  assert.equal(untouched, undefined, "non-timeout errors pass through untouched");

  const ok = await afterTool(
    { name: "bash", id: "c3", arguments: { command: "echo hi" } },
    { isError: false, content: [{ type: "text", text: "hi" }] },
  );
  assert.equal(ok, undefined, "successful results are untouched");
});

test("hang-guard hooks vanish when disabled by environment", () => {
  assert.deepEqual(createMilksuHangGuardHooks({ environment: { MILKSU_PI_HANG_GUARD: "0" } }), []);
});

// ---------- 工具面对照清单 ----------

test("mounted/deferred tool lists partition the gate-closed active surface", () => {
  const mounted = new Set(mountedHarnessToolNames);
  assert.deepEqual(
    [...mounted].filter(name => codingWorkspaceAutoToolNames.includes(name)).sort(),
    ["bash", "edit", "find", "grep", "ls", "lsp_diagnostics", "lsp_fix", "read", "write"],
  );
  const deferred = deferredHarnessToolNames(codingWorkspaceAutoToolNames);
  assert.deepEqual(deferred.sort(), [
    "bg_status",
    "bg_task",
    "computer_use",
    "goal_blocked",
    "goal_complete",
    "milksu_archify",
    "milksu_ask",
    "milksu_imagegen",
    "milksu_progress",
    "milksu_workspace",
    "prepare_computer_use_driver",
    "web_fetch",
    "web_search",
  ], "the deferred surface is explicit and enumerated");
  assert.equal(deferred.includes("bash"), false, "bash is mounted, not deferred");
  assert.equal(deferred.includes("milksu_ask"), true, "milksu_ask is deferred in B2");
});
