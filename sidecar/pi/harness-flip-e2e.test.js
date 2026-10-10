// PR-2 批次 D2：扳机翻转的真桥 E2E（翻转日就绪验证的主证据面）。
//
// 与既有 harness-bridge-* 测试（buildTestLayer 进程内层）不同，本文件 spawn 真正的
// run-bridge.mjs 子进程（产品入口：stdin/stdout JSON 协议、真 bridge.js 分发、真文件
// 落盘），模型层用本地 mock OpenAI 兼容 SSE 服务器（MILKSU_CUSTOM_PROVIDER_* 三件套指
// 过去——新旧引擎共用同一份 provider 解析），零网络零真实密钥。
//
// 场景（工单 D2 验收点）：
//   1. 缺省（不设 MILKSU_PI_HARNESS）：新会话走 Harness——ready/事件面 + durable 存储
//      落盘 + 不写旧 JSONL；
//   2. CTF 工作区（challenge.json）：一律旧引擎——JSONL 落盘 + 无 harness 存储；
//   3. 研究角色（cve-research）/ ctf_ 前缀：旧引擎；
//   4. 回退（MILKSU_PI_HARNESS=0）：旧引擎全功能——普通回合 + 审批（ask 档真弹卡真
//      批准真执行）+ MCP（真 stdio 夹具服务器真调用）+ 子代理（builtin 角色真 spawn）；
//   5. 归档全链路：合成旧 JSONL → 首启翻转导出 → archive_query → 继续聊（自动导入 +
//      上下文含旧转录的实证）→ 重开续聊 → destroy（源删除/归档副本保留）；
//   6. 双工作区并存（同一 agentDir，两个真桥进程同时活）：D2 按工作区分存储后不再锁
//      冲突（翻转前的 P0 阻塞面，见交付报告取证）。
//
// 红线：数据全在 mkdtemp 临时目录（合成）；不碰真实 runtime-data（真实 66 会话的导出
// 发生在用户装机首启，不在测试里）。

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bridgeEntry = join(here, "run-bridge.mjs");
const repositoryRoot = join(here, "..", "..");
const mcpFixtureSource = join(repositoryRoot, "scripts", "fixture-project-mcp-server.mjs");

// ---------- mock OpenAI 兼容服务器（SSE 流式） ----------

class MockModelServer {
  constructor() {
    this.requests = [];
    this.queue = [];
    this.responder = undefined;
    this.server = createServer((request, response) => {
      const chunks = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = {};
        }
        this.requests.push(body);
        const script = this.responder
          ? this.responder(body, this.requests.length)
          : this.queue.shift() ?? { text: "mock answer" };
        this.writeSse(response, script);
      });
    });
    this.listening = new Promise(resolve => {
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
  }

  async url() {
    await this.listening;
    const address = this.server.address();
    return `http://127.0.0.1:${address.port}/v1`;
  }

  writeSse(response, script) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const model = "e2e-model";
    const base = { id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 1, model };
    const send = payload => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (script.toolCall) {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      send({
        ...base,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: script.toolCall.id,
              type: "function",
              function: { name: script.toolCall.name, arguments: JSON.stringify(script.toolCall.input ?? {}) },
            }],
          },
          finish_reason: null,
        }],
      });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      for (const piece of String(script.text ?? "").match(/[\s\S]{1,64}/gu) ?? []) {
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      }
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    send({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } });
    response.write("data: [DONE]\n\n");
    response.end();
  }

  async close() {
    await new Promise(resolve => this.server.close(resolve));
  }
}

// ---------- 真桥子进程驱动 ----------

async function makeSidecarTempDirectory(root) {
  // 宿主给每个 sidecar 独立的 per-workspace TMPDIR（sidecar.go
  // withWorkspaceTemporaryDirectory：runtimeHome 下 workspace 隔离目录）。测试镜像同款：
  // 不继承测试进程的 /var/folders 路径——sandbox-exec profile 的 subpath 是字面匹配，
  // /var 与 /private/var 的符号链接形态差异会让子代理 runner 写状态文件吃 EPERM
  //（纯测试环境artifact，产品路径无此问题）。
  const directory = await realpath(await mkdir(join(root, "sidecar-tmp"), { recursive: true }).then(() => join(root, "sidecar-tmp")));
  return directory;
}

function spawnBridge({ workspace, agentDir, modelUrl, extraEnv = {}, entry = bridgeEntry, tempDirectory }) {
  const child = spawn(process.execPath, [entry], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TMPDIR: tempDirectory,
      MILKSU_PI_AGENT_DIR: agentDir,
      MILKSU_CUSTOM_PROVIDER_ID: "e2e-relay",
      MILKSU_CUSTOM_PROVIDER_URL: modelUrl,
      MILKSU_CUSTOM_PROVIDER_KEY: "e2e-key",
      MILKSU_CUSTOM_PROVIDER_API: "openai-completions",
      ...extraEnv,
    },
  });
  const events = [];
  let stderr = "";
  let closed = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // 事件行外输出忽略。
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });
  const exited = new Promise(resolve => {
    child.on("exit", code => {
      closed = true;
      resolve(code);
    });
  });
  const send = command => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("bridge child already exited"));
    child.stdin.write(`${JSON.stringify(command)}\n`, error => (error ? reject(error) : resolve()));
  });
  const waitForEvent = (type, predicate = () => true, timeoutMs = 30000) => {
    const startedAt = Date.now();
    const seen = () => events.find(event => event.type === type && predicate(event));
    return new Promise((resolve, reject) => {
      const poll = () => {
        const found = seen();
        if (found) return resolve(found);
        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error(
            `timeout waiting for ${type}; events: ${JSON.stringify(events.slice(-25))}; stderr tail: ${stderr.slice(-2000)}`,
          ));
        }
        setTimeout(poll, 60);
      };
      poll();
    });
  };
  const stop = async () => {
    if (closed) return exited;
    await send({ action: "shutdown" });
    const code = await Promise.race([
      exited,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error("bridge did not exit")), 10000))
        .finally(() => {}),
    ]).catch(async () => {
      child.kill("SIGKILL");
      return exited;
    });
    return code;
  };
  return { child, events, send, waitForEvent, stop, stderr: () => stderr };
}

// ---------- 夹具 ----------

function iso(seconds) {
  return new Date(Date.UTC(2026, 8, 3, 8, 0, seconds * 1000)).toISOString();
}

/** 合成旧 JSONL：header + model_change + 3 组 user/assistant（最后一条 assistant 文本
 * 固定，供「继续聊后模型请求里必须看到旧转录」的断言用）。 */
function oldSessionLines(conversationId) {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: conversationId, timestamp: iso(0), cwd: "/tmp/ws" }),
    JSON.stringify({ type: "model_change", id: "m0", parentId: null, timestamp: iso(1), provider: "e2e-relay", modelId: "e2e-model" }),
  ];
  let parent = "m0";
  for (let index = 0; index < 3; index += 1) {
    lines.push(JSON.stringify({
      type: "message", id: `u${index}`, parentId: parent, timestamp: iso(2 + index * 2),
      message: { role: "user", content: [{ type: "text", text: `old question ${index}` }] },
    }));
    lines.push(JSON.stringify({
      type: "message", id: `a${index}`, parentId: `u${index}`, timestamp: iso(3 + index * 2),
      message: {
        role: "assistant",
        provider: "e2e-relay",
        model: "e2e-model",
        // 真实数据面：旧引擎的 assistant 消息带当轮用量（pi-durable 的 estimateContext
        // 直接读 message.usage；缺 usage 的 error/aborted 消息由导入器补零加固）。
        usage: { input: 30, output: 12, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop",
        content: [{ type: "text", text: index === 2 ? "old final answer" : `old answer ${index}` }],
      },
    }));
    parent = `a${index}`;
  }
  return lines;
}

function sendTurn(conversationId, prompt, extra = {}) {
  return {
    action: "send_message",
    conversationId,
    prompt,
    locale: "zh",
    provider: "e2e-relay",
    model: "e2e-model",
    thinking: "off",
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    ...extra,
  };
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function harnessStorageExists(agentDir, workspace) {
  // 宿主 spawn 前 Abs+EvalSymlinks+Clean（sidecar.go resolveAgentWorkspace）；macOS 的
  // /var→/private/var 符号链接让进程 cwd 与测试给的路径文本不同——这里同样 canonical 化。
  const canonical = await realpath(workspace);
  const key = `ws-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16)}`;
  return exists(join(agentDir, "harness", key, "harness.sqlite"));
}

async function legacyJsonlFor(agentDir, conversationId) {
  const sessionsDir = join(agentDir, "sessions");
  if (!await exists(sessionsDir)) return undefined;
  for (const name of await readdir(sessionsDir)) {
    if (!name.endsWith(".jsonl")) continue;
    if (name.includes(`_${conversationId}.jsonl`) || name === `${conversationId}.jsonl`) {
      return join(sessionsDir, name);
    }
  }
  return undefined;
}

async function withRoot(run) {
  // realpath 根：macOS 的 $TMPDIR 是 /var/folders/...（符号链接），sandbox-exec 的
  // subpath 字面匹配 + 进程 cwd 的 /private/var 形态会让子代理 runner 在两种形态间
  // 吃 EPERM——夹具根 canonical 化后两边一致（生产路径宿主已 EvalSymlinks，无此问题）。
  const root = await realpath(await mkdtemp(join(tmpdir(), "milksu-flip-e2e-")));
  const agentDir = join(root, "agent");
  const server = new MockModelServer();
  const modelUrl = await server.url();
  const sidecarTempDirectory = await makeSidecarTempDirectory(root);
  const spawnSidecar = (options) => spawnBridge({
    ...options,
    modelUrl,
    tempDirectory: sidecarTempDirectory,
  });
  try {
    return await run({ root, agentDir, modelUrl, server, spawnSidecar });
  } finally {
    await server.close();
    if (!process.env.MILKSU_FLIP_E2E_KEEP_ROOT) {
      await rm(root, { recursive: true, force: true });
    } else {
      console.error(`[flip-e2e] root kept: ${root}`);
    }
  }
}

async function makeCodingWorkspace(root, name = "ws-coding") {
  const workspace = join(root, name);
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "README.md"), "e2e coding workspace\n", { mode: 0o600 });
  return workspace;
}

async function makeCtfWorkspace(root, name = "ws-ctf") {
  const workspace = join(root, name);
  await mkdir(join(workspace, "materials"), { recursive: true });
  await writeFile(join(workspace, "challenge.json"), `${JSON.stringify({
    schemaVersion: "ctf-workspace.milksu.dev/v1alpha2",
    challenge: { id: "e2e", title: "e2e" },
  })}\n`, { mode: 0o600 });
  return workspace;
}

// ---------- 场景 1：缺省（门开）→ 新会话走 Harness ----------

test("default env: new coding sessions run on the Harness engine", async () => {
  await withRoot(async ({ root, agentDir, server, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-default");
    server.queue.push({ text: "harness says hello" });
    const bridge = spawnSidecar({ workspace, agentDir });
    try {
      await bridge.send(sendTurn("conv-default", "ping"));
      const ready = await bridge.waitForEvent("ready", event => event.id === "conv-default");
      assert.ok(Array.isArray(ready.tools) && ready.tools.length > 0, "harness ready carries the tool face");
      assert.ok(ready.extensions.includes("milksu-coding-tools"), "harness extensions are the ported mounts");
      await bridge.waitForEvent("turn_settled", event => event.id === "conv-default");
      const message = await bridge.waitForEvent("message_done", event => (
        event.id === "conv-default"
        && String(event.content ?? "").includes("harness says hello")
      ));
      assert.ok(message, "assistant text streams through the ported event projector");
      // 引擎判定：durable 存储落盘（按工作区分目录），不写旧 JSONL。
      assert.ok(await harnessStorageExists(agentDir, workspace), "harness sqlite lands in the per-workspace directory");
      assert.equal(await legacyJsonlFor(agentDir, "conv-default"), undefined, "legacy JSONL is not written");
      // 事件面：usage 复用同一投影。
      await bridge.waitForEvent("usage_recorded", event => event.id === "conv-default");
    } finally {
      await bridge.stop();
    }
  });
});

// ---------- 场景 2：CTF 工作区 → 一律旧引擎 ----------

test("CTF workspace sessions stay on the legacy engine regardless of the open gate", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCtfWorkspace(root);
    server.queue.push({ text: "legacy says hello" });
    const bridge = spawnSidecar({ workspace, agentDir });
    try {
      await bridge.send(sendTurn("conv-ctf-ws", "ping"));
      await bridge.waitForEvent("ready", event => event.id === "conv-ctf-ws");
      await bridge.waitForEvent("turn_settled", event => event.id === "conv-ctf-ws");
      // 引擎判定：旧 JSONL 落盘，无 harness 存储。
      const jsonl = await legacyJsonlFor(agentDir, "conv-ctf-ws");
      assert.ok(jsonl, "legacy engine writes the JSONL transcript");
      assert.equal(await harnessStorageExists(agentDir, workspace), false, "no harness storage for a CTF workspace");
    } finally {
      await bridge.stop();
    }
  });
});

// ---------- 场景 3：研究角色 / ctf_ 前缀 → 旧引擎 ----------

test("research roles and ctf_ ids stay on the legacy engine in a normal workspace", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-research");
    server.queue.push({ text: "legacy research" }, { text: "legacy ctf" });
    const bridge = spawnSidecar({ workspace, agentDir });
    try {
      await bridge.send(sendTurn("conv-cve", "ping", { sessionRole: "cve-research" }));
      await bridge.waitForEvent("turn_settled", event => event.id === "conv-cve");
      assert.ok(await legacyJsonlFor(agentDir, "conv-cve"), "cve-research sessions run legacy");
      assert.equal(await harnessStorageExists(agentDir, workspace), false, "no harness storage is opened at all");

      await bridge.send(sendTurn("ctf_probe_1", "ping"));
      await bridge.waitForEvent("turn_settled", event => event.id === "ctf_probe_1");
      assert.ok(await legacyJsonlFor(agentDir, "ctf_probe_1"), "ctf_-prefixed ids run legacy");
    } finally {
      await bridge.stop();
    }
  });
});

// ---------- 场景 4：回退（MILKSU_PI_HARNESS=0）——旧引擎全功能 ----------

test("rollback MILKSU_PI_HARNESS=0: legacy engine runs full sessions (turn + approval + tool)", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-rollback");
    // 请求 1：bash 工具调用；请求 2：终答。
    server.queue.push(
      { toolCall: { id: "call_bash", name: "bash", input: { command: "printf rollback-proof > approval-proof.txt" } } },
      { text: "legacy tool done" },
    );
    const bridge = spawnSidecar({
      workspace,
      agentDir,
      extraEnv: { MILKSU_PI_HARNESS: "0" },
    });
    try {
      await bridge.send(sendTurn("conv-rollback", "run a command", { approvalPolicy: "ask" }));
      await bridge.waitForEvent("ready", event => event.id === "conv-rollback");
      // ask 档：真弹审批卡（请求里的 bash 命令逐字可见），回批准后真执行。
      const approval = await bridge.waitForEvent(
        "approval_requested",
        event => event.id === "conv-rollback" && event.input?.includes?.("rollback-proof") === true,
      );
      assert.ok(approval.requestId, "approval carries a requestId");
      await bridge.send({
        action: "approval_response",
        conversationId: "conv-rollback",
        requestId: approval.requestId,
        approved: true,
      });
      await bridge.waitForEvent("turn_settled", event => event.id === "conv-rollback");
      const message = await bridge.waitForEvent("message_done", event => (
        event.id === "conv-rollback" && String(event.content ?? "").includes("legacy tool done")
      ));
      assert.ok(message, "the post-tool answer streams back");
      assert.ok(await exists(join(workspace, "approval-proof.txt")), "the approved bash command really executed");
      // 引擎判定：旧 JSONL + 无 harness 存储。
      assert.ok(await legacyJsonlFor(agentDir, "conv-rollback"), "legacy engine writes the JSONL transcript");
      assert.equal(await harnessStorageExists(agentDir, workspace), false, "no harness storage under rollback");
    } finally {
      await bridge.stop();
    }
  });
});

test("rollback MILKSU_PI_HARNESS=0: legacy MCP mount serves a real fixture server call", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-rollback-mcp");
    const fixtureText = "MilkSU D2 rollback MCP fixture.\n";
    await writeFile(join(workspace, "fixture.txt"), fixtureText, { mode: 0o600 });
    const fixtureServer = join(workspace, "fixture-project-mcp-server.mjs");
    await copyFile(mcpFixtureSource, fixtureServer);
    await chmod(fixtureServer, 0o700);
    const projectConfig = JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [fixtureServer],
          includeTools: ["fixture_read"],
          milksu: {
            source: "fixture:d2-rollback-mcp",
            version: "1.0.0",
            taskScope: "D2 rollback MCP acceptance fixture",
          },
        },
      },
    }, null, 2);
    await writeFile(join(workspace, ".mcp.json"), projectConfig, { mode: 0o600 });
    const digest = createHash("sha256").update(projectConfig).digest("hex");
    server.queue.push(
      {
        toolCall: {
          id: "call_mcp",
          name: "mcp",
          input: {
            server: "fixture",
            tool: "fixture_read",
            args: { expectedSha256: createHash("sha256").update(fixtureText).digest("hex") },
          },
        },
      },
      { text: "legacy mcp done" },
    );
    const bridge = spawnSidecar({
      workspace,
      agentDir,
      extraEnv: { MILKSU_PI_HARNESS: "0" },
    });
    try {
      await bridge.send(sendTurn("conv-rollback-mcp", "read the fixture", {
        approvalPolicy: "ask",
        mcpServers: ["fixture"],
        mcpConfigDigest: digest,
      }));
      const ready = await bridge.waitForEvent("ready", event => event.id === "conv-rollback-mcp");
      assert.ok(ready.tools.includes("mcp"), "the legacy engine mounts the mcp proxy tool");
      // ask 档 MCP 逐调用审批：批准后真调用夹具服务器。
      const approval = await bridge.waitForEvent(
        "approval_requested",
        event => event.id === "conv-rollback-mcp" && event.toolName === "mcp:fixture",
      );
      await bridge.send({
        action: "approval_response",
        conversationId: "conv-rollback-mcp",
        requestId: approval.requestId,
        approved: true,
      });
      await bridge.waitForEvent("turn_settled", event => event.id === "conv-rollback-mcp");
      const message = await bridge.waitForEvent("message_done", event => (
        event.id === "conv-rollback-mcp" && String(event.content ?? "").includes("legacy mcp done")
      ));
      assert.ok(message, "the model saw the fixture result and answered");
      // 夹具工具结果（含 fixture.txt 原文）在工具结果事件里可见（旧引擎事件名
      // tool_call_end；门开投影器对齐为 tool_execution_end——两套事件面已知的命名差）。
      const toolEnd = await bridge.waitForEvent("tool_call_end", event => (
        event.id === "conv-rollback-mcp" && event.toolName === "mcp"
      ));
      assert.equal(toolEnd.isError, false, "the fixture call succeeded");
      assert.ok(String(toolEnd.content ?? "").includes("MilkSU D2 rollback MCP fixture"), "fixture content round-trips");
    } finally {
      await bridge.stop();
    }
  });
});

test("rollback MILKSU_PI_HARNESS=0: legacy subagent spawns a bundled role and returns its answer", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-rollback-subagent");
    // responder：父回合（历史含 "delegate a review"）→ 首发派单工具调用、拿到回执后终答；
    // 子代理回合（提示只有任务文本、无父历史）→ 子答。完成通知会把父再次唤醒。
    let parentCalledTool = false;
    server.responder = (body) => {
      const text = JSON.stringify(body.messages ?? []);
      const isParentTurn = text.includes("delegate a review");
      if (isParentTurn) {
        if (!parentCalledTool) {
          parentCalledTool = true;
          return {
            toolCall: {
              id: "call_subagent",
              name: "subagent",
              input: { agent: "reviewer", task: "review the workspace and report" },
            },
          };
        }
        return { text: "parent got the child answer" };
      }
      return { text: "child reviewer says all good" };
    };
    const bridge = spawnSidecar({
      workspace,
      agentDir,
      extraEnv: { MILKSU_PI_HARNESS: "0" },
    });
    try {
      await bridge.send(sendTurn("conv-rollback-sub", "delegate a review"));
      await bridge.waitForEvent("ready", event => event.id === "conv-rollback-sub");
      const message = await bridge.waitForEvent(
        "message_done",
        event => event.id === "conv-rollback-sub" && String(event.content ?? "").includes("parent got the child answer"),
        90000,
      );
      assert.ok(message, "the parent finishes on top of the async receipt");
      // 子代理 roster 面：builtin 角色真 spawn、真跑到 succeeded，子答在 transcript 里。
      const roster = await bridge.waitForEvent(
        "subagent_tasks",
        event => event.id === "conv-rollback-sub"
          && Array.isArray(event.subagentTasks)
          && event.subagentTasks.some(task => (
            task.status === "succeeded"
            && String(task.transcript ?? "").includes("child reviewer says all good")
          )),
        90000,
      );
      assert.ok(roster, "the bundled reviewer child really ran and its answer is on the roster");
      assert.ok(await legacyJsonlFor(agentDir, "conv-rollback-sub"), "legacy engine writes the JSONL transcript");
    } finally {
      await bridge.stop();
    }
  });
});

// ---------- 场景 5：归档全链路（导出 → 查询 → 只读 → 继续聊 → 重开 → 销毁） ----------

test("archived legacy session: flip export → query → continue-chat import → reopen → destroy", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspace = await makeCodingWorkspace(root, "ws-archive");
    // 合成旧 JSONL（翻转前的存量会话）。
    await mkdir(join(agentDir, "sessions"), { recursive: true });
    const sourceName = "20260903_conv-old.jsonl";
    const sourcePath = join(agentDir, "sessions", sourceName);
    await writeFile(sourcePath, `${oldSessionLines("conv-old").join("\n")}\n`);

    // 「继续聊」的模型回合：请求里必须带着导入后的旧转录（继续性的实证）。
    server.responder = (body) => {
      const text = JSON.stringify(body.messages ?? []);
      // 判定顺序：重开后的回合历史里同时有旧转录与首次续聊的回文——先认回文。
      if (text.includes("continued from old transcript")) {
        return { text: "second life after reopen" };
      }
      if (text.includes("old final answer") && text.includes("continue this")) {
        return { text: "continued from old transcript" };
      }
      return { text: "unexpected context shape" };
    };

    const bridge = spawnSidecar({ workspace, agentDir });
    try {
      // 归档查询（未导入）：首启翻转导出由 harness 层触发（archive_query 走层）。
      await bridge.send({ action: "archive_query", conversationId: "conv-old", id: "q1" });
      const status = await bridge.waitForEvent("archive_status", event => event.id === "q1");
      assert.equal(status.archived, true, "the flip-day export archived the synthetic session");
      assert.equal(status.imported, false, "not imported until the user continues chatting");
      assert.equal(status.entry.conversationId, "conv-old");
      // 翻转导出完成态 + 归档副本。
      assert.equal(await exists(join(agentDir, "archive", "sessions", sourceName)), true, "archive copy is made");
      const flipState = JSON.parse(await readFile(join(agentDir, "archive", "flip-export.json"), "utf8"));
      assert.equal(flipState.completed, true);

      // 继续聊（桌面按既有流程发 send_message——渲染器零改动的桥侧等价面）：
      // 自动导入 + 续聊；模型请求含旧转录（“old final answer”）即继续性实证。
      await bridge.send(sendTurn("conv-old", "continue this"));
      const ready = await bridge.waitForEvent("ready", event => event.id === "conv-old");
      assert.equal(ready.resumed, true, "imported transcript makes the session resumed");
      const continued = await bridge.waitForEvent("message_done", event => (
        event.id === "conv-old" && String(event.content ?? "").includes("continued from old transcript")
      ));
      assert.ok(continued, "the turn continues on top of the imported history");
      const sawOldTranscript = server.requests.some(body => (
        JSON.stringify(body.messages ?? []).includes("old final answer")
      ));
      assert.ok(sawOldTranscript, "the model request carried the imported old transcript");

      // 查询面翻转为已导入。
      await bridge.send({ action: "archive_query", conversationId: "conv-old", id: "q2" });
      const status2 = await bridge.waitForEvent("archive_status", event => event.id === "q2");
      assert.equal(status2.imported, true);
    } finally {
      await bridge.stop();
    }

    // 重开（新 sidecar 进程）：durable 会话续聊 + 归档面 imported=true。
    const bridge2 = spawnSidecar({ workspace, agentDir });
    try {
      await bridge2.send({ action: "archive_query", conversationId: "conv-old", id: "q3" });
      const status3 = await bridge2.waitForEvent("archive_status", event => event.id === "q3");
      assert.equal(status3.archived, true);
      assert.equal(status3.imported, true, "the imported conversation is durable across sidecar restarts");
      await bridge2.send(sendTurn("conv-old", "continue again"));
      const reopened = await bridge2.waitForEvent("message_done", event => (
        event.id === "conv-old" && String(event.content ?? "").includes("second life after reopen")
      ));
      assert.ok(reopened, "the conversation keeps running on the durable transcript");
      const sawPreviousContinuation = server.requests.some(body => (
        JSON.stringify(body.messages ?? []).includes("continued from old transcript")
      ));
      assert.ok(sawPreviousContinuation, "the reopened request carried the previous turn");
    } finally {
      await bridge2.stop();
    }

    // 销毁（deletePersisted）：旧引擎源 JSONL 删除；归档副本与 manifest 行保留。
    const bridge3 = spawnSidecar({ workspace, agentDir });
    try {
      await bridge3.send({ action: "destroy_session", conversationId: "conv-old", deletePersisted: true });
      await bridge3.waitForEvent("session_destroyed", event => event.id === "conv-old");
      assert.equal(await exists(sourcePath), false, "the legacy source JSONL is deleted (manifest touchpoint)");
      assert.equal(await exists(join(agentDir, "archive", "sessions", sourceName)), true, "the archive copy stays (Q1 保底)");
    } finally {
      await bridge3.stop();
    }
  });
});

// ---------- 场景 6：双工作区并存（同一 agentDir，两个真桥进程同时活） ----------

test("two live bridges on different workspaces share one agentDir without lock contention", async () => {
  await withRoot(async ({ agentDir, server, root, spawnSidecar }) => {
    const workspaceA = await makeCodingWorkspace(root, "ws-park-a");
    const workspaceB = await makeCodingWorkspace(root, "ws-park-b");
    server.queue.push(
      { text: "workspace a answer" },
      { text: "workspace b answer" },
      { text: "workspace a again" },
    );
    // 进程 A 先活（持有自己工作区存储的锁——翻转前共享布局下会挡住 B，D2 取证复现）。
    const bridgeA = spawnSidecar({ workspace: workspaceA, agentDir });
    const bridgeB = spawnSidecar({ workspace: workspaceB, agentDir });
    try {
      await bridgeA.send(sendTurn("conv-park-a", "ping"));
      await bridgeA.waitForEvent("ready", event => event.id === "conv-park-a");
      await bridgeA.waitForEvent("turn_settled", event => event.id === "conv-park-a");

      // B 在 A 存活期间（parked-sidecar 的现场布局）建会话：必须成功。
      await bridgeB.send(sendTurn("conv-park-b", "ping"));
      await bridgeB.waitForEvent("ready", event => event.id === "conv-park-b");
      await bridgeB.waitForEvent("turn_settled", event => event.id === "conv-park-b");
      assert.ok(await harnessStorageExists(agentDir, workspaceB), "B has its own per-workspace storage");

      // A 还能继续跑（两把锁互不干扰）。
      await bridgeA.send(sendTurn("conv-park-a", "again"));
      await bridgeA.waitForEvent("message_done", event => (
        event.id === "conv-park-a" && String(event.content ?? "").includes("workspace a again")
      ));
    } finally {
      await bridgeA.stop();
      await bridgeB.stop();
    }
  });
});
