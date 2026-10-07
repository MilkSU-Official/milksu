// PR-2 批次 B2b：门开路径 MCP 挂载端到端（faux provider + #220 的本地夹具，零外网，
// 数据全在临时目录）。keepProductTools=true 跑真的 milksu-prompt/coding-tools/lsp/
// skills/mcp/core 挂载；MCP 配置走**真**漏斗（bridge-mcp.js loadCodingMcpConfig：
// sandbox 包装 + includeTools 评审 + protocolVersion auto 盖章）。
//
// 覆盖工单验收点（对照 harness-bridge-mcp.js 文件头的挂载架构说明）：
//   - 未传 mcpConfig 不加载（无 mcp 工具、无连接、无 mcp__ 代理面）
//   - 旧协议服务器可连（fixture_read 真调用，走 ask 审批弹卡）
//   - 双纪元服务器 auto 探测（versionNegotiation auto → server/discover → modern）
//   - 17 台服务器拒（真漏斗的上限在 createSession 处炸出）
//   - MCP 工具逐调用审批（项目服务器每调必问）+ 会话级 grantKey 复用（内置服务器
//     名单：第二调不再弹）
//   - 研究/浏览器隔离 block（审判链 beforeTool 对挂载的 mcp 工具自动生效）
//   - namespaceProxyTools:false 不产生 mcp__ 代理工具（#220 关闭理由的实证）
//
// 进程纪律：coding 工具面按进程 cwd 解析工作区，本文件在临时工作区 chdir 后跑，
// finally 恢复（node --test 每文件独立进程）。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRegistry } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { loadCodingMcpConfig } from "./bridge-mcp.js";
import {
  createMilksuMcpExtension,
  MILKSU_MCP_TOOL_NAME,
} from "./harness-bridge-mcp.js";
import { loadSessionPolicy } from "./bridge-policy.js";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

const originalCwd = process.cwd();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const legacyFixtureSource = join(repositoryRoot, "scripts", "fixture-project-mcp-server.mjs");
const dualEraFixtureSource = join(repositoryRoot, "scripts", "fixture-dual-era-mcp-server.mjs");

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/**
 * 搭一个带真实 .mcp.json 的临时工作区并走真漏斗。projectServers 决定 .mcp.json 的
 * 项目服务器；userServers 直接传用户目录（漏斗同样会 sanitize + 盖 auto 章）；
 * buildMcpConfig=false 时只搭工作区不写 .mcp.json（17 上限等要自己摆盘的测试用）。
 */
async function withMcpFixture(run, {
  projectServers = {},
  userServers = undefined,
  selectProjectServers = undefined,
  buildMcpConfig = true,
  layerOptions = {},
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2b-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  process.chdir(workspace);
  let layer = undefined;
  try {
    await writeFile(join(workspace, "fixture.txt"),
      "MilkSU B2b harness fixture: real allowlisted tool call.\n", { mode: 0o600 });
    const fixtureDigest = createHash("sha256")
      .update("MilkSU B2b harness fixture: real allowlisted tool call.\n")
      .digest("hex");
    // sandbox 包装只放行工作区内的文件：夹具服务器拷进工作区再引用（与
    // scripts/test-project-mcp-fixture.mjs 的摆盘方式一致）。
    const legacyFixturePath = join(workspace, "fixture-project-mcp-server.mjs");
    const dualEraFixturePath = join(workspace, "fixture-dual-era-mcp-server.mjs");
    await copyFile(legacyFixtureSource, legacyFixturePath);
    await copyFile(dualEraFixtureSource, dualEraFixturePath);
    await chmod(legacyFixturePath, 0o700);
    await chmod(dualEraFixturePath, 0o700);
    // projectServers/userServers 可以是函数：拿到工作区内的夹具路径后求值
    //（.mcp.json 必须引用工作区副本，sandbox 才放行）。
    const resolveServers = value => (
      typeof value === "function" ? value({ workspace, legacyFixturePath, dualEraFixturePath }) : value
    );
    const resolvedProjectServers = resolveServers(projectServers) ?? {};
    const resolvedUserServers = resolveServers(userServers);

    let mcpConfig;
    // loadCodingMcpConfig 的 user-server 路径不做 realpath（生产侧 cwd 已解析；
    // 这里 chdir 后取 process.cwd()，避免 macOS /var→/private/var 符号链接让
    // sandbox 配置的 subpath 与实际访问路径错位）。
    const resolvedWorkspace = process.cwd();
    if (buildMcpConfig && (Object.keys(resolvedProjectServers).length > 0 || resolvedUserServers !== undefined)) {
      const projectConfig = JSON.stringify({ mcpServers: resolvedProjectServers }, null, 2);
      await writeFile(join(workspace, ".mcp.json"), projectConfig, { mode: 0o600 });
      const digest = createHash("sha256").update(projectConfig).digest("hex");
      const selected = selectProjectServers ?? Object.keys(resolvedProjectServers);
      mcpConfig = (await loadCodingMcpConfig(
        resolvedWorkspace,
        selected,
        digest,
        undefined,
        undefined,
        undefined,
        [],
        resolvedUserServers,
      )).config;
    }

    const { faux, models } = makeFauxModels();
    const built = buildTestLayer({
      agentDir,
      workspace: resolvedWorkspace,
      faux,
      models,
      keepProductTools: true,
      mcpConfig,
      ...layerOptions,
    });
    layer = built.layer;
    const { events, emit, maps } = built;
    return await run({
      layer,
      events,
      emit,
      maps,
      faux,
      models,
      workspace,
      root,
      fixtureDigest,
      mcpConfig,
      legacyFixturePath,
      dualEraFixturePath,
    });
  } finally {
    try {
      await layer?.disposeAll();
    } catch {
      // 测试收尾不因清理失败挂死。
    }
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}

function reviewedFixtureServer(fixturePath, overrides = {}) {
  return {
    command: process.execPath,
    args: [fixturePath],
    includeTools: ["fixture_read"],
    milksu: {
      source: "fixture:project-local-stdio",
      version: "1.0.0",
      taskScope: "B2b harness MCP acceptance fixture",
    },
    ...overrides,
  };
}

// ---------- 挂载面：registry 级（namespaceProxyTools 实证 + 未传不加载） ----------

test("the milksu-mcp extension registers exactly one mcp proxy tool and no mcp__ surface", async () => {
  const registry = createRegistry();
  const mount = createMilksuMcpExtension({
    resolveConversation: () => "",
    mcpConfigFor: () => undefined,
  });
  registry.install(mount.extension);
  const names = registry.snapshot().tools().map(entry => entry.tool.name);
  assert.deepEqual(names, [MILKSU_MCP_TOOL_NAME]);
  assert.equal(names.filter(name => name.startsWith("mcp__")).length, 0,
    "#220 closed namespace proxies: no mcp__<server> tools may exist");
  await mount.dispose();
});

test("milksu-mcp rejects configs that bypass the bridge-mcp funnel guarantees", async () => {
  const mount = createMilksuMcpExtension({
    resolveConversation: () => "conv-guard",
    mcpConfigFor: () => undefined,
  });
  // 未盖 protocolVersion auto 的配置（漏斗被绕过）必须立即失败。
  await assert.rejects(
    mount.adopt("conv-guard", {
      settings: {
        toolPrefix: "server",
        hostConfigDiscovery: "off",
        namespaceProxyTools: false,
        scriptMode: false,
      },
      mcpServers: {
        raw: { command: process.execPath, args: [dualEraFixtureSource] },
      },
    }),
    /protocolVersion "auto"/,
  );
  // settings 面与 #220 漏斗不一致同样拒绝。
  await assert.rejects(
    mount.adopt("conv-guard", {
      settings: { hostConfigDiscovery: "off", namespaceProxyTools: true, scriptMode: false },
      mcpServers: {},
    }),
    /namespaceProxyTools: false/,
  );
  await mount.dispose();
});

test("without mcpConfig the conversation mounts no mcp tool and no connection is made", async () => {
  await withMcpFixture(async ({ layer, events, faux, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-no-mcp" });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.equal(ready.tools.includes("mcp"), false,
      "no mcpConfig means no mcp tool on the conversation surface");
    assert.equal(ready.tools.some(name => name.startsWith("mcp__")), false);
    // 未配置时模型点名 mcp：会话工具面本就没有这个工具（门关同款——adapter 不装
    // 即不存在），引擎按未知工具回错误结果，不弹任何审批卡。
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("mcp", { server: "anything" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("no mcp available"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-no-mcp", prompt: "call mcp" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "mcp"))[0];
    assert.equal(toolEnd.isError, true,
      "an unmounted tool surfaces the engine's unknown-tool diagnostic");
    assert.match(String(toolEnd.content), /not available|unknown|not configured|unavailable/i,
      `diagnostic is model-visible: ${toolEnd.content}`);
    assert.equal(
      events.filter(event => event.type === "approval_requested" && String(event.toolName ?? "").startsWith("mcp")).length,
      0,
      "no MCP approval cards without mcpConfig",
    );
  }, { projectServers: {} });
});

// ---------- 旧协议服务器：真连接、真调用、ask 审批 ----------

test("a legacy-handshake project server answers a real fixture_read call behind ask approval", async () => {
  await withMcpFixture(async ({ layer, events, faux, fixtureDigest, mcpConfig, legacyFixturePath }) => {
    assert.ok(mcpConfig, "the funnel produced a config");
    // 漏斗的 #220 口径在门开同样成立：sandbox 包装 + auto 章 + lazy。
    const definition = mcpConfig.mcpServers.fixture;
    assert.equal(definition.protocolVersion, "auto");
    assert.equal(definition.lifecycle, "lazy");
    if (process.platform === "darwin") {
      assert.equal(definition.command, "/usr/bin/sandbox-exec");
    }
    assert.equal(definition.env && Object.keys(definition.env).length, 0);

    await layer.createSession({ ...goCommand, conversationId: "conv-legacy" });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.ok(ready.tools.includes("mcp"), "the mcp proxy tool is on the conversation surface");

    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("calling fixture_read"),
          fauxToolCall("mcp", {
            server: "fixture",
            tool: "fixture_read",
            args: { expectedSha256: fixtureDigest },
          })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("fixture read done"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-legacy", prompt: "read the fixture" });
    await waitForEvent(events, "turn_settled");

    // 审判链逐调用审批：卡片带 mcp:fixture 与格式化面。
    const requested = (await waitForEvent(events, "approval_requested",
      event => event.toolName === "mcp:fixture"))[0];
    assert.ok(requested.content.includes("fixture_read"),
      `approval card shows the tool: ${requested.content}`);

    // 真调用：夹具文本经 sandbox 包装的 stdio 连接回来。
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "mcp"))[0];
    assert.equal(toolEnd.isError, false);
    assert.match(toolEnd.content, /project-fixture/);
    assert.match(toolEnd.content, /MilkSU B2b harness fixture/);
  }, { projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }) });
});

// ---------- 双纪元服务器：versionNegotiation auto 探测 ----------

test("a dual-era server is reached through the modern 2026-07-28 revision by auto negotiation", async () => {
  await withMcpFixture(async ({ layer, events, faux, mcpConfig, dualEraFixturePath }) => {
    assert.equal(mcpConfig.mcpServers["dual-era"].protocolVersion, "auto");
    await layer.createSession({ ...goCommand, conversationId: "conv-dual" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mcp", { server: "dual-era", tool: "negotiation_echo", args: {} })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("modern era confirmed"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-dual", prompt: "echo the era" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "mcp"))[0];
    assert.equal(toolEnd.isError, false);
    assert.match(toolEnd.content, /dual-era-fixture/);
    // auto 的方向证明：探测成功 → 现代纪元（旧握手会回 era:"legacy"）。夹具把
    // era 写进工具文本与 structuredContent 两处，断言任一即可。
    assert.match(toolEnd.content, /"era":"modern"/);
  }, {
    userServers: ({ dualEraFixturePath }) => ({
      "dual-era": {
        command: process.execPath,
        args: [dualEraFixturePath],
        includeTools: ["negotiation_echo"],
      },
    }),
  });
});

// ---------- 上限：17 台服务器拒（真漏斗在 createSession 处炸） ----------

test("selecting 17 project servers fails the session at the funnel's 16-server cap", async () => {
  await withMcpFixture(async ({ workspace, legacyFixturePath }) => {
    const servers = {};
    for (let index = 0; index < 17; index += 1) {
      servers[`server-${index}`] = reviewedFixtureServer(legacyFixturePath);
    }
    const projectConfig = JSON.stringify({ mcpServers: servers });
    await writeFile(join(workspace, ".mcp.json"), projectConfig, "utf8");
    const digest = createHash("sha256").update(projectConfig).digest("hex");
    const names = Object.keys(servers);
    const { faux, models } = makeFauxModels();
    const { layer, events } = buildTestLayer({
      agentDir: join(workspace, "..", "agent-17"),
      workspace,
      faux,
      models,
      keepProductTools: true,
      // 真 bridge.js loadRuntimeSessionPolicy 的路径：loadCodingMcpConfig 在
      // normalizeSelectedMcpServers 处执行 16 台上限，错误在 createSession 炸出。
      policyLoader: async (cwd, command) => {
        const selected = await loadCodingMcpConfig(cwd, command.mcpServers, digest);
        const policy = await loadSessionPolicy(cwd, "", {
          executionMode: "go",
          approvalPolicy: "ask",
          mcpServers: selected.selected,
          projectMcpServers: selected.projectSelected,
        });
        return {
          policy,
          effectiveSessionRole: "",
          codingSkillPaths: [],
          mcpConfig: selected.config,
          securityTools: [],
        };
      },
    });
    try {
      await assert.rejects(
        layer.createSession({ ...goCommand, conversationId: "conv-17", mcpServers: names }),
        /at most 16 MCP servers/,
      );
      assert.equal(events.filter(event => event.type === "ready").length, 0);
    } finally {
      await layer.disposeAll();
    }
  }, { buildMcpConfig: false });
});

// ---------- 逐调用审批 + 会话级 grantKey 复用 ----------

test("project MCP calls each request approval; grantable built-in servers reuse the session grant", async () => {
  // 漏斗产出的项目服务器 grantKey 为空（mcpConversationGrantKey 只对内置服务器
  // 放行 grantKey），每调必问。
  await withMcpFixture(async ({ layer, events, faux, fixtureDigest, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-percall" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mcp", {
          server: "fixture",
          tool: "fixture_read",
          args: { expectedSha256: fixtureDigest },
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("mcp", {
          server: "fixture",
          tool: "fixture_read",
          args: { expectedSha256: fixtureDigest },
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("two calls done"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-percall", prompt: "read twice" });
    await waitForEvent(events, "turn_settled");
    const approvals = events.filter(
      event => event.type === "approval_requested" && event.toolName === "mcp:fixture",
    );
    assert.equal(approvals.length, 2,
      "ordinary project servers ask per call (no grantKey reuse)");
    const toolEnds = events.filter(
      event => event.type === "tool_call_end" && event.toolName === "mcp",
    );
    assert.equal(toolEnds.length, 2);
    assert.ok(toolEnds.every(event => event.isError === false));
  }, { projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }) });

  // 内置服务器名单（milksu-computer-use 等）走会话级 grantKey：第二调不再弹。
  // 漏斗保留这些名字给一方服务器，测试按一方构造器的产物形状手工组配置。
  await withMcpFixture(async ({ layer, events, faux, fixtureDigest, legacyFixturePath }) => {
    const handBuilt = {
      settings: {
        toolPrefix: "server",
        hostConfigDiscovery: "off",
        idleTimeout: 10,
        outputGuard: true,
        directTools: false,
        namespaceProxyTools: false,
        scriptMode: false,
        disableProxyTool: false,
        sampling: false,
        samplingAutoApprove: false,
        elicitation: false,
        autoAuth: false,
      },
      mcpServers: {
        "milksu-computer-use": {
          command: process.execPath,
          args: [legacyFixturePath],
          includeTools: ["fixture_read"],
          lifecycle: "lazy",
          directTools: false,
          protocolVersion: "auto",
        },
      },
    };
    const { faux: faux2, models } = makeFauxModels();
    const agentDir2 = join(await mkdtemp(join(tmpdir(), "milksu-b2b-grant-")), "agent");
    const { layer: layer2, events: events2 } = buildTestLayer({
      agentDir: agentDir2,
      workspace: process.cwd(),
      faux: faux2,
      models,
      keepProductTools: true,
      mcpConfig: handBuilt,
      // 第一次批准按会话档记 grant（真实桌面卡有「本对话始终允许」；桥只在
      // scope==="conversation" 时记 grantKey）。
      approvalScope: "conversation",
    });
    try {
      await layer2.createSession({ ...goCommand, conversationId: "conv-grant" });
      faux2.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("mcp", {
            server: "milksu-computer-use",
            tool: "fixture_read",
            args: { expectedSha256: fixtureDigest },
          })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          [fauxToolCall("mcp", {
            server: "milksu-computer-use",
            tool: "fixture_read",
            args: { expectedSha256: fixtureDigest },
          })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("grant reused"),
      ]);
      await layer2.sendMessage({ ...goCommand, conversationId: "conv-grant", prompt: "twice" });
      await waitForEvent(events2, "turn_settled");
      const approvals = events2.filter(
        event => event.type === "approval_requested"
          && event.toolName === "mcp:milksu-computer-use",
      );
      assert.equal(approvals.length, 1,
        "the session grant covers the second call to a grantable built-in server");
      const toolEnds = events2.filter(
        event => event.type === "tool_call_end" && event.toolName === "mcp",
      );
      assert.equal(toolEnds.length, 2);
      assert.ok(toolEnds.every(event => event.isError === false));
    } finally {
      await layer2.disposeAll();
    }
  }, { projectServers: {} });
});

// ---------- 研究/浏览器隔离 block（审判链自动生效实证） ----------

test("research isolation blocks non-browser MCP servers through the auto-applied judge", async () => {
  await withMcpFixture(async ({ layer, events, faux, fixtureDigest, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-research" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("mcp", {
          server: "fixture",
          tool: "fixture_read",
          args: { expectedSha256: fixtureDigest },
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("blocked as expected"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-research", prompt: "read during research" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "mcp"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(
      toolEnd.content,
      /Deep Research uses Pi web tools and this conversation's managed Browser/,
    );
    // 隔离 block 在审批之前：不弹卡。
    assert.equal(
      events.filter(event => event.type === "approval_requested" && event.toolName === "mcp:fixture").length,
      0,
    );
  }, {
    projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }),
    layerOptions: { researchActive: true },
  });
});

// ---------- 目录面：status/list/describe（网关语义冒烟） ----------

test("the mcp gateway surfaces status, list, and describe for the mounted servers", async () => {
  await withMcpFixture(async ({ layer, events, faux, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-gateway" });
    const callGateway = input => fauxToolCall("mcp", input);
    faux.setResponses([
      fauxAssistantMessage([callGateway({})], { stopReason: "toolUse" }),
      fauxAssistantMessage([callGateway({ server: "fixture" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([callGateway({ describe: "fixture_read", server: "fixture" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("gateway surveyed"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-gateway", prompt: "survey mcp" });
    await waitForEvent(events, "turn_settled");
    const ends = events.filter(
      event => event.type === "tool_call_end" && event.toolName === "mcp",
    );
    assert.equal(ends.length, 3);
    const [status, list, describe] = ends.map(event => String(event.content));
    assert.match(status, /MCP: \d+\/1 servers, 1 tools/);
    assert.match(list, /fixture \(1 tools/);
    assert.match(list, /fixture_read/);
    assert.match(describe, /Parameters:/);
    assert.match(describe, /expectedSha256/);
    // 网关只读操作（status/list/describe）在 ask 档不弹卡
    //（codingMcpOperationRequiresApproval 只认 tool/connect/auth 操作；connect 在
    // ask 档会弹卡，懒连接已由 tool 调用路径覆盖）。
    assert.equal(
      events.filter(event => event.type === "approval_requested").length,
      0,
    );
  }, { projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }) });
});

// ---------- 系统提示补齐（B2 遗留）：Pi 默认段结构 ----------

test("without AGENTS.md the harness prompt carries the Pi default preamble/tools/rules/docs/cwd sections", async () => {
  await withMcpFixture(async ({ layer, events, faux, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-prompt" });
    faux.setResponses([fauxAssistantMessage("just chatting")]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-prompt", prompt: "hi" });
    await waitForEvent(events, "turn_settled");
    const sections = events
      .filter(event => event.type === "context_composition" || event.type === "message_start")
      .flatMap(event => event.sections ?? []);
    void sections;
    // 直接读 durable 转录里的 pi.system 段（位置型系统条目）。
    const entries = await layer.conversationEntries("conv-prompt", { limit: 50 });
    const systemEntries = (entries?.items ?? [])
      .filter(entry => (entry.model ?? []).some(message => message?.role === "system"))
      .flatMap(entry => entry.model.filter(message => message?.role === "system"));
    assert.ok(systemEntries.length > 0, "a system message with sections exists");
    const shown = {};
    for (const message of systemEntries) {
      Object.assign(shown, message.sections ?? {});
    }
    assert.match(shown.preamble ?? "", /expert coding assistant operating inside pi/);
    assert.match(shown.tools ?? "", /- read: Read file contents/);
    assert.match(shown.tools ?? "", /- mcp: MCP gateway/);
    assert.match(shown.rules ?? "", /Use edit for precise changes/);
    assert.match(shown.docs ?? "", /Pi documentation/);
    assert.match(shown.cwd ?? "", /workspace/u);
  }, { projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }) });
});

test("with project instructions the preamble replaces the Pi default and tools/rules/docs stay off", async () => {
  await withMcpFixture(async ({ layer, events, faux, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-prompt-custom" });
    faux.setResponses([fauxAssistantMessage("ok")]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-prompt-custom", prompt: "hi" });
    await waitForEvent(events, "turn_settled");
    const entries = await layer.conversationEntries("conv-prompt-custom", { limit: 50 });
    const shown = {};
    for (const entry of entries?.items ?? []) {
      for (const message of entry.model ?? []) {
        if (message?.role === "system") Object.assign(shown, message.sections ?? {});
      }
    }
    assert.match(shown.preamble ?? "", /来自 .* 的项目说明：/);
    assert.equal(shown.tools, undefined, "customPrompt replaces the default tools section (system-prompt.js:76-94)");
    assert.equal(shown.rules, undefined);
    assert.equal(shown.docs, undefined);
    assert.match(shown.cwd ?? "", /workspace/u);
  }, {
    projectServers: {},
    layerOptions: {
      projectInstructions: "来自 /workspace/AGENTS.md 的项目说明：\n\nAGENTS.md: 本项目只做演示。\n总是先读 README。",
    },
  });
});

test("milksu-prompt renders the section order preamble → tools → rules → docs → skills → cwd", async () => {
  // 段序断言在扩展层面做（pi-durable 按 section 数组顺序渲染）。
  const { createMilksuPromptSectionsExtension, createMilksuSkillsExtension, milksuCwdSection, LSP_PROMPT_CONTRIBUTIONS } =
    await import("./harness-bridge-tools.js");
  const prompt = createMilksuPromptSectionsExtension({
    projectInstructionsFor: () => "",
    promptSnippets: new Map([["read", "Read file contents"], ["mcp", "MCP gateway"]]),
    promptGuidelines: new Map(),
  });
  const skills = createMilksuSkillsExtension({
    resolveConversation: () => "conv",
    skillPathsFor: () => ["/tmp/some-skill"],
    cwd: "/tmp",
  });
  const cwd = milksuCwdSection(() => "/tmp/ws");
  assert.deepEqual(prompt.sections.map(s => s.key), ["preamble", "tools", "rules", "docs"]);
  assert.deepEqual(skills.sections.map(s => s.key), ["skills"]);
  assert.deepEqual([cwd.key], ["cwd"]);
  assert.equal(LSP_PROMPT_CONTRIBUTIONS.snippets.lsp_fix, "Apply configured LSP source fixes to a file");
});

// ---------- 未评审工具的 includeTools 门（评审面实证） ----------

test("includeTools filters the catalog so unreviewed server tools never surface", async () => {
  await withMcpFixture(async ({ layer, events, faux, legacyFixturePath }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-include" });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("mcp", { server: "fixture" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("listed"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-include", prompt: "list" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "mcp"))[0];
    // 夹具只广播 fixture_read；includeTools 列表同名单 → 目录恰好一个工具。
    assert.match(toolEnd.content, /fixture \(1 tools/);
    assert.doesNotMatch(toolEnd.content, /unreviewed_tool/);
  }, { projectServers: ({ legacyFixturePath }) => ({ fixture: reviewedFixtureServer(legacyFixturePath) }) });
});
