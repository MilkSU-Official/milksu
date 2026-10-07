// PR-2 批次 B1 测试脚手架（非产品代码）：给 harness-bridge-session 层构造一个
// faux provider + 临时目录 + 假桌面回包的测试 context。E2E 测试与崩溃注入子进程
// 共用本模块。零网络零真实密钥，数据全在调用方给的临时目录。

import { Type } from "typebox";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { basename } from "node:path";
import { createApprovalBroker } from "./bridge-approval.js";
import { dropSendAfterAbort } from "./bridge-abort.js";
import { resolveCodingMcpServer } from "./bridge-auto-approval.js";
import { loadSessionPolicy } from "./bridge-policy.js";
import { createThinkingRepetitionGuard } from "./bridge-thinking-repetition.js";
import { createHarnessBridgeSessionLayer } from "./harness-bridge-session.js";
import { MILKSU_MCP_EXTENSION } from "./harness-bridge-mcp.js";
import {
  MILKSU_CODING_TOOLS_EXTENSION,
  MILKSU_LSP_EXTENSION,
  MILKSU_SKILLS_EXTENSION,
} from "./harness-bridge-tools.js";

export const defaultFauxModelDefinitions = [
  {
    id: "faux-1",
    name: "Faux Model",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: "faux-2",
    name: "Faux Model 2",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
];

export function makeFauxModels(definitions = defaultFauxModelDefinitions) {
  const faux = fauxProvider({ models: definitions });
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

/** 测试 bash：与真 bash 同名同 schema（timeout 可选数字），可注入副作用与睡眠。 */
export function makeTestBashTool({ workspace, onExecute, sleepMs = 0 } = {}) {
  return defineTool({
    name: "bash",
    description: "test bash",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(args, api) {
      onExecute?.(args);
      api.output(`ran ${args.command}\n`);
      if (args.command === "sleep") {
        await new Promise(resolve => setTimeout(resolve, sleepMs));
        api.output("slept\n");
      }
      return {};
    },
  });
}

/**
 * 构造测试层。options：
 *   agentDir / workspace      临时目录（必填）
 *   faux / models             makeFauxModels 的产物（必填）
 *   approvalBehavior          () => "approve" | "deny" | "manual"（manual=永不回包）
 *   onEvent                   每条 emit 事件的观察者
 *   extraTools                额外注入的工具（默认替换产品工具面）
 *   keepProductTools          true 保留 B2 产品挂载（coding/lsp/skills 扩展）
 *   lspExtension              覆盖 milksu-lsp 的扩展（假 LSP 核心注入面）
 *   skillPaths                会话技能路径（milksu-skills section 渲染源）
 *   onToolExecute             工具执行观察者
 *   toolSleepMs               bash sleep 命令的睡眠时长
 *   environment               环境对象（默认空对象：无 relay/custom provider）
 *   userMemories              getUserMemories 的返回
 *   projectInstructions       项目说明文本（section 渲染）
 *   mcpConfig                 会话 MCP 配置（B2b：loadRuntimeSessionPolicy 的
 *                             mcpConfig 返回位；传了才挂载 mcp 工具）
 *   policyLoader              覆盖 loadRuntimeSessionPolicy 整个实现（17 服务器
 *                             拒绝等需要真实漏斗路径的断言用）
 *   researchActive            hasActiveResearchRun 的返回（研究隔离 block 断言用）
 *   compactionPolicyOverrides () => ({keepRecentTokens, ...})
 */
export function buildTestLayer({
  agentDir,
  workspace,
  faux,
  models,
  approvalBehavior = () => "approve",
  approvalScope = "",
  onEvent = undefined,
  extraTools = [],
  toolSleepMs = 0,
  environment = {},
  userMemories = [],
  projectInstructions = "",
  mcpConfig = undefined,
  policyLoader = undefined,
  researchActive = false,
  skillPaths = [],
  keepProductTools = false,
  lspExtension = undefined,
  extraActiveToolNames = [],
  compactionPolicyOverrides = undefined,
  heartbeatOptions = { heartbeatMs: 250, settleMs: 20, unrefHeartbeat: true },
}) {
  const events = [];
  let approvalBroker;
  const emit = (conversationId, type, data = {}) => {
    const record = { type, id: conversationId ?? null, ...data };
    events.push(record);
    try {
      onEvent?.(record);
    } catch {
      // 观察者异常不影响桥。
    }
    if (type === "approval_requested") {
      const behavior = approvalBehavior();
      if (behavior === "manual") return;
      approvalBroker.respond({
        conversationId: record.id,
        requestId: record.requestId,
        approved: behavior !== "deny",
        // grantKey 复用断言用：按会话档批准（bridge-approval.js:115-121 只在
        // scope==="conversation" 时记 grant）。
        ...(approvalScope && behavior !== "deny" ? { scope: approvalScope } : {}),
      });
    }
  };
  approvalBroker = createApprovalBroker(emit);
  const maps = {
    sessions: new Map(),
    sessionPolicies: new Map(),
    sessionPolicyControllers: new Map(),
    sessionTurnContracts: new Map(),
    promptQueues: new Map(),
    compactionRuns: new Map(),
    compactionRequestIds: new Map(),
    pendingWorkspaceCompaction: new Set(),
    sessionContextUsage: new Map(),
    sessionModelSources: new Map(),
    sessionConfiguredProviders: new Map(),
    sessionCreateCommands: new Map(),
    abortedSessions: new Set(),
    suppressedQueueUpdates: new Set(),
    reasoningOnlyRecovered: new Map(),
    sessionSubagentTasks: new Map(),
    researchRunContexts: new Map(),
  };
  const layer = createHarnessBridgeSessionLayer({
    emit,
    queueTextDelta: (id, delta) => emit(id, "text_delta", { delta }),
    approvalBroker,
    workspaceActionBroker: {
      request: async () => true,
      cancelConversation: () => undefined,
    },
    formatToolInput: (toolName, args) => (
      toolName === "bash" && args?.command !== undefined
        ? `$ ${args.command}`
        : JSON.stringify(args ?? {})
    ),
    // bridge.js:1348-1365 的同款实现（非浏览器分支）：MCP 审批卡面与 grantKey 解析
    // 都要真的读 input.server/input.tool 与 policy.mcpServers。
    formatMcpApprovalInput: (input, serverName) => {
      const tool = String(input?.tool ?? "").trim();
      const action = String(input?.action ?? input?.connect ?? "").trim();
      return [
        `服务器 ${serverName}`,
        tool ? `工具 ${tool}` : "",
        action ? `操作 ${action}` : "",
      ].filter(Boolean).join(" · ");
    },
    selectedMcpServer: (policy, input) => (
      resolveCodingMcpServer(input, policy) || "已选择的 MCP 服务器"
    ),
    loadRuntimeSessionPolicy: policyLoader ?? (async (cwd, command) => {
      const mcpServerNames = mcpConfig && typeof mcpConfig === "object"
        ? Object.keys(mcpConfig.mcpServers ?? {})
        : [];
      const policy = await loadSessionPolicy(cwd, "", {
        executionMode: command.executionMode === "plan" ? "plan" : "go",
        approvalPolicy: command.approvalPolicy ?? "ask",
        // 门关的真实派生（bridge-policy.js:1540-1561）：go 档 + 非 read-only 且有
        // 选中服务器时 activeTools 带 "mcp"。
        ...(mcpServerNames.length > 0 ? {
          mcpServers: mcpServerNames,
          projectMcpServers: mcpServerNames,
        } : {}),
      });
      policy.uiLocale = command.locale === "en" ? "en" : "zh";
      policy.skillNames = skillPaths.map(path => basename(path));
      // 测试注入的额外工具名并进 activeTools（如 outputLimits 断言用的 giant_dump）。
      for (const name of extraActiveToolNames) {
        if (!policy.activeTools.includes(name)) policy.activeTools.push(name);
      }
      return {
        policy,
        effectiveSessionRole: "",
        codingSkillPaths: [...skillPaths],
        mcpConfig,
        securityTools: [],
      };
    }),
    loadProjectInstructions: async () => projectInstructions || undefined,
    applyUserMemories: () => undefined,
    applyWorkerModelOverride: () => undefined,
    dropSendAfterAbort,
    describeError: error => (
      error instanceof Error ? (error.stack || error.message) : String(error)
    ),
    getUserMemories: () => userMemories,
    thinkingRepetition: createThinkingRepetitionGuard(),
    noteUserMemory: () => undefined,
    hasActiveResearchRun: () => researchActive,
    activeResearchRunContext: () => undefined,
    researchSubagentBlockReason: () => "",
    rememberChildModelRegistry: () => undefined,
    haltConversationSubagents: async () => undefined,
    maps,
    environment,
    resolveAgentDirectory: () => agentDir,
    harnessRuntimeOptions: () => heartbeatOptions,
    installRegistryExtensions: registry => {
      // 默认卸掉产品工具面换测试注入；keepProductTools=true 保留 B2 的产品挂载
      //（coding-tools/lsp/skills + B2b 的 mcp），milksu-core（审判链/压缩接线）
      // 始终保留。
      if (!keepProductTools) {
        registry.uninstall({ name: MILKSU_CODING_TOOLS_EXTENSION });
        registry.uninstall({ name: MILKSU_LSP_EXTENSION });
        registry.uninstall({ name: MILKSU_SKILLS_EXTENSION });
        registry.uninstall({ name: MILKSU_MCP_EXTENSION });
      }
      if (lspExtension) {
        // 测试注入的 milksu-lsp（通常是带假 LSP 核心的同形扩展）；后装覆盖先装。
        registry.install(lspExtension);
      }
      if (extraTools.length > 0) {
        registry.install(defineExtension({
          name: "milksu-test-tools",
          tools: extraTools,
        }));
      }
    },
    modelsCollection: () => ({ models }),
    personalModelFor: command => ({
      provider: "faux",
      modelId: String(command?.model ?? "faux-1"),
    }),
    ...(compactionPolicyOverrides ? { compactionPolicyOverrides } : {}),
  });
  return { layer, events, emit, maps, approvalBroker, faux, models };
}

export async function waitForEvent(events, type, predicate = () => true, timeoutMs = 15000) {
  const startedAt = Date.now();
  for (;;) {
    const found = events.filter(
      event => event.type === type && predicate(event),
    );
    if (found.length > 0) return found;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `timeout waiting for ${type}; saw: ${JSON.stringify(events.map(event => event.type))}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export function kindCounts(items) {
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}
