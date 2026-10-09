// PR-2 批次 B1：MILKSU_PI_HARNESS 门开路径的 bridge 会话层。
//
// 结构：一个 sidecar 进程一个 openMilkSUHarness handle（适配层单点收口），每条桌面
// conversationId 是其中一条 durable Conversation（别名登记见 harness-adapter）。门关
// 路径（bridge.js 的 SessionManager/AgentSession 流程）一字节不动，本模块只被
// createSession/sendMessage/abort/destroy/compact 的门内分叉调用。
//
// 接线总览（对照 PREP §3）：
//   模型  —— wireHarnessModelSelection（三路 provider 工厂）+ configureConversation
//            （Q8），替代 configureRuntimeModel/setSessionModel。
//   事件  —— watchConversationEvents → harness-events 投影器 → bridge emit 管线
//            （60ms text 合并 / redact / formatToolInput / usage&view 复用）。
//   审批  —— harness-bridge-approval 的 beforeTool/beforeRequest 钩子（registry 安装）。
//   压缩  —— settings.compaction 活配置 getter + conversation.compact；压缩状态从
//            任务收条/docs["pi.live"] 读，替换 trackCompaction 的心跳 deadline 机制
//            （pi-durable 自带有界 retry/backoff）。
//   提交  —— submitInput（requestId 直通，两层幂等）+ enqueueConversationPrompt FIFO。
//   退出  —— dispose→handle.close()（停心跳→落盘→释放锁）；宿主 Go 侧已有
//            shutdown→waitpid 确认（supervisor.go shutdownChildProcess/process.done）。
//
// 调度纪律：createSession 不主动 resume()——恢复（崩溃残留任务）由下一条进度类调用
// （submitInput/waitSubmission 等，pi-durable 会自行翻起调度）触发，对齐 REHEARSAL s5
// 的「重开→补提交→resume→审批重弹」口径。
//
// 测试注入面：context.resolveAgentDirectory / context.harnessRuntimeOptions /
// context.installRegistryExtensions / context.modelsCollection / context.personalModelFor
// 均可覆盖（faux provider + 临时目录，零网络零密钥）。

import { randomUUID } from "node:crypto";
import {
  createRegistry,
  defineExtension,
  GenerationTask,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openMilkSUHarness, resolveHarnessAgentDir } from "./harness-adapter.js";
import {
  createHarnessModels,
  wireHarnessModelSelection,
} from "./harness-model-providers.js";
import { createHarnessEventProjector } from "./harness-events.js";
import {
  createHarnessBeforeRequestFilter,
  createHarnessBeforeToolJudge,
} from "./harness-bridge-approval.js";
import {
  createMilksuCodingToolsExtension,
  createMilksuHangGuardHooks,
  createMilksuLspExtension,
  createMilksuPromptSectionsExtension,
  createMilksuSkillsExtension,
  LSP_PROMPT_CONTRIBUTIONS,
  milksuCwdSection,
  milksuWorkflowSection,
  MILKSU_CODING_TOOLS_EXTENSION,
  MILKSU_LSP_EXTENSION,
  MILKSU_SKILLS_EXTENSION,
} from "./harness-bridge-tools.js";
import {
  createMilksuMcpExtension,
  MILKSU_MCP_EXTENSION,
  MILKSU_MCP_PROMPT_SNIPPET,
} from "./harness-bridge-mcp.js";
import {
  createMilksuDailyToolsExtension,
  createMilksuSecurityToolsExtension,
  MILKSU_DAILY_TOOLS_EXTENSION,
  MILKSU_SECURITY_TOOLS_EXTENSION,
  securityToolsMountFingerprint,
} from "./harness-bridge-daily-tools.js";
import {
  createMilksuComputerUseExtension,
  MILKSU_COMPUTER_USE_EXTENSION,
} from "./harness-bridge-computer-use.js";
import { answerDecisionQuery } from "../decision/query.js";
import {
  isReasoningOnlyFinal,
  logReasoningOnlyFinal,
  reasoningOnlyRecoveryPrompt,
  summarizeReasoningOnlyFinal,
} from "./bridge-reasoning-recovery.js";
import {
  assignResearchSubagentTaskID,
  projectResearchSubagentUpdates,
  projectSubagentRosterEnd,
  projectSubagentRosterStart,
  projectSubagentTaskForRenderer,
  projectSubagentToolResult,
} from "./bridge-subagent-yield.js";
import { codingCollaborationToolName } from "./bridge-collaboration.js";
import {
  createHarnessSubagentHalt,
  createMilksuSubagentsExtension,
  createSubagentChildRegistry,
  MILKSU_SUBAGENTS_EXTENSION,
} from "./harness-bridge-subagents.js";
import {
  adoptSessionAsyncSubagents,
  createHarnessSubagentAsyncHalt,
  createMilksuSubagentsAsyncExtension,
  expandHarnessSubagentAsyncToolNames,
} from "./harness-bridge-subagents-async.js";
import {
  adoptSessionBackgroundTasks,
  createMilksuBackgroundTasksExtension,
  spawnHarnessBackgroundTask,
  stopHarnessBackgroundTaskById,
} from "./harness-bridge-background-tasks.js";
import {
  backgroundTaskMetasForSession,
  projectBackgroundTaskMetas,
} from "./bridge-background-view.js";
// PR-2 批次 B2e：goal 自主续跑状态机（pi-goal 全量移植；见 harness-bridge-goal.js 文件头）。
import { createHarnessGoalMachine } from "./harness-bridge-goal.js";
import {
  listPiBackgroundTaskMetas,
  readPiBackgroundTaskLog,
} from "./reviewed-ts/extensions.js";
import { enqueueConversationPrompt } from "./bridge-conversation-prompt.js";
import { preparePromptAttachments } from "./bridge-attachments.js";
import { withTurnHeartbeat } from "./bridge-turn-heartbeat.js";
import { normalizeCodingTurnContract, withCodingTurnContract } from "./bridge-turn-contract.js";
import {
  compactionInstructions,
  COMPACTION_HEADROOM_TOKENS,
  trackCompaction,
  waitForCompaction,
} from "./bridge-compaction.js";
import { createToolRepeatGuard } from "./bridge-tool-repeat.js";
import { normalizeThinkingProfile } from "./bridge-thinking.js";
import { assistantFailureText } from "./bridge-model-failure.js";
import { projectSessionContextComposition } from "./bridge-context-composition.js";
import { contextUsageWindowPayload, resolveMaxOutput } from "./context-window-payload.js";
import { knownMaxTokens } from "./known-context-window.cjs";
import { redactResearchText } from "./bridge-subagent-yield.js";
import { modelSourceFailureMessage } from "./model-source-routing.js";
import { isCompanionRelay, tracksUserMemory } from "./user-memory.js";
import { THINKING_REPEAT_NOTICE } from "./bridge-thinking-repetition.js";
import {
  forgetSessionProviders,
  sessionProviderSecrets,
} from "./pi-subagent-model-registry.cjs";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const { currentProviderDefinition } = currentProviderRuntime;

export const MILKSU_HARNESS_SESSION_KIND = "milksu-harness";

// pi-durable CompactionReason → 旧 wire 的 compaction reason（manual/auto）。
function bridgeCompactionReason(reason) {
  return reason === "manual" ? "manual" : "auto";
}

function truncateValue(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

function userContentBlocks(prompt, images) {
  const blocks = [{ type: "text", text: String(prompt ?? "") }];
  for (const image of Array.isArray(images) ? images : []) {
    if (image?.type === "image" && image.data && image.mimeType) {
      blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
  }
  return blocks;
}

function inboxItemText(item) {
  if (item?.mode !== "steer" && item?.mode !== "followUp") return "";
  const content = item.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(block => String(block?.text ?? "")).join("");
  }
  return "";
}

function requestedSourceOrder(command, environment) {
  const raw = Array.isArray(command?.modelSourceOrder)
    ? command.modelSourceOrder.map(value => String(value ?? "").trim())
    : String(environment.MILKSU_MODEL_SOURCE_ORDER ?? "").split(",");
  return [...new Set(raw.filter(id => id === "account" || id === "personal"))];
}

export function createHarnessBridgeSessionLayer(context) {
  const {
    emit,
    queueTextDelta,
    approvalBroker,
    workspaceActionBroker,
    formatToolInput,
    formatMcpApprovalInput,
    selectedMcpServer,
    loadRuntimeSessionPolicy,
    loadProjectInstructions,
    applyUserMemories,
    applyWorkerModelOverride,
    dropSendAfterAbort,
    describeError,
    getUserMemories,
    thinkingRepetition,
    noteUserMemory,
    hasActiveResearchRun,
    activeResearchRunContext,
    researchSubagentBlockReason,
    rememberChildModelRegistry,
    haltConversationSubagents,
    // PR-2 批次 B2c：bridge.js 模块内的研究动作观测（milksu_workspace 的研究
    // run 投影用；门关 bridge.js:2118 同一函数）。测试层可不注入。
    observeResearchWorkspaceAction,
    maps: {
      sessions,
      sessionPolicies,
      sessionPolicyControllers,
      sessionTurnContracts,
      promptQueues,
      compactionRuns,
      compactionRequestIds,
      pendingWorkspaceCompaction,
      sessionContextUsage,
      sessionModelSources,
      sessionConfiguredProviders,
      sessionCreateCommands,
      abortedSessions,
      suppressedQueueUpdates,
      reasoningOnlyRecovered,
      sessionSubagentTasks,
      researchRunContexts,
    },
    environment = process.env,
    resolveAgentDirectory = () => resolveHarnessAgentDir(environment),
    harnessRuntimeOptions = () => ({}),
    installRegistryExtensions,
    modelsCollection = () => createHarnessModels(),
    personalModelFor = () => undefined,
    compactionPolicyOverrides = undefined,
  } = context;

  // ---------- 运行时单例 ----------

  let runtime = undefined;
  let runtimeOpening = undefined;
  // durable ConversationId（数字）→ MilkSU conversationId（别名）。
  const durableToAlias = new Map();
  // MilkSU conversationId → 会话记录（事件/状态/投影器）。
  const conversations = new Map();
  // MilkSU conversationId → 会话技能路径清单（milksu-skills section 按会话渲染）。
  const sessionSkillPaths = new Map();
  // PR-2 批次 B2d：MilkSU conversationId → effectiveSessionRole（门关
  // createSession 的同一位；milksu-workflow section 的角色指引按会话渲染）。
  const sessionRoles = new Map();
  // MilkSU conversationId → 会话 MCP 配置（B2b：loadRuntimeSessionPolicy 返回的
  // mcpConfig 按会话登记；未传即不挂载——门关 `if (mcpConfig)` 同款门）。
  const sessionMcpConfigs = new Map();
  // MilkSU conversationId → 已挂载 MCP 配置指纹（sendMessage 的 policy 刷新每回合
  // 都跑，配置不变不重做发现连接）。
  const sessionMcpFingerprints = new Map();
  // B2c：capa 目录挂载指纹（command/args/version）。会话策略刷新时目录变化才按名
  // 原位替换 milksu-security-tools（registry.install 的 replace-in-place 语义）。
  let securityMountFingerprint = undefined;
  // reasoning-only recovery：恢复前的工具面（恢复回合无工具，结束后还原）。
  const reasoningOnlyPreviousTools = new Map();
  // PR-2 批次 C1：subagent 工具调用的 args/起始时刻缓存（tool_execution_end 的
  // roster 投影需要 args；pi-durable 的 end 事件不带）。
  const subagentCallRecords = new Map();
  // C1：子代理 child 注册表（控制动作/外部 CLI halt 的进程内状态）。
  const subagentChildRegistry = createSubagentChildRegistry();
  // C2：异步路面专用的 child 注册表（与 C1 协作路面分账：children.list/status 只见
  // 各自面的 child；异步面的控制工具读 durable 真相，registry 只服务 roster/halt）。
  const subagentAsyncChildRegistry = createSubagentChildRegistry();
  // 已告警过的缺失工具名（暂缓面只报一次，避免每次 send 刷屏）。
  const warnedMissingToolNames = new Set();
  // PR-2 批次 B2e：goal 自主续跑状态机（durable 真相在 Conversation Document；这里只
  // 是 run 归属/收尾态的进程内面）。revealTools 接 after-first-goal 可见性解锁后的
  // 工具面重配（configureAgentTools 经 filterAgentToolNames 过滤）。
  const goalMachine = createHarnessGoalMachine({
    emit,
    resolveConversation,
    getRuntime: () => runtime,
    resolveAgentDirectory: () => resolveAgentDirectory(),
    revealTools: alias => {
      const controller = sessionPolicyControllers.get(alias);
      const names = sessionPolicies.get(alias)?.activeTools;
      if (controller && Array.isArray(names)) controller.setActiveTools(names);
    },
  });
  // settings.compaction 的活快照：最近一次接线/提交的会话模型参数。
  let compactionSnapshot = undefined;
  let projectInstructionsText = "";
  const bashTimeoutConfig = () => {
    const read = (name, fallback) => {
      const raw = environment?.[name];
      if (raw === undefined || raw === null || raw === "") return fallback;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
      defaultTimeoutSeconds: read("MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS", 600),
      maxTimeoutSeconds: read("MILKSU_PI_BASH_MAX_TIMEOUT_SECONDS", 3600),
    };
  };

  /**
   * 活配置 getter（PREP §1.7：每次使用都读）。reserveTokens 按旧 compactionThreshold
   * 口径（窗口 − maxOutput − min(88k, 10%窗口)）；窗口/上限未知时只开 enabled（回落
   * pi-durable 默认 16384，溢出压缩兜底仍在）。快照在每次模型接线/提交时刷新——
   * settings 是 harness 级的，多会话并发时次要会话可能读到主会话参数（已知限制，
   * 影响有界：reserve 偏小→溢出压缩兜底，偏大→多余但更早的摘要）。
   */
  function liveCompactionPolicy() {
    if (typeof compactionPolicyOverrides === "function") {
      return { enabled: true, ...compactionPolicyOverrides() };
    }
    const window = Math.max(0, Number(compactionSnapshot?.contextWindow ?? 0));
    const output = Number(compactionSnapshot?.maxOutput ?? 0);
    if (!(window > 0) || !(output > 0)) {
      return { enabled: true };
    }
    const step = Math.min(COMPACTION_HEADROOM_TOKENS, window * 0.10);
    return {
      enabled: true,
      reserveTokens: Math.max(16384, Math.round(Math.min(output, window) + step)),
      keepRecentTokens: 20000,
      backgroundTokens: 32768,
    };
  }

  function resolveConversation(durableConversationId) {
    return durableToAlias.get(durableConversationId) ?? "";
  }

  function conversationRecord(alias) {
    return conversations.get(alias);
  }

  async function openRuntime() {
    if (runtime) return runtime;
    if (!runtimeOpening) {
      runtimeOpening = (async () => {
        const models = modelsCollection();
        const registry = createRegistry();
        const judge = createHarnessBeforeToolJudge({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          getTurnContract: id => sessionTurnContracts.get(id),
          getUserMemories,
          providerSecrets: sessionProviderSecrets,
          emit,
          approvalBroker,
          formatToolInput,
          formatMcpApprovalInput,
          selectedMcpServer,
          hasActiveResearchRun,
          activeResearchRunContext,
          researchSubagentBlockReason,
          repeatGuardFor: id => conversations.get(id)?.repeatGuard,
          bashTimeoutConfig,
          environment,
        });
        const requestFilter = createHarnessBeforeRequestFilter({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          getTurnContract: id => sessionTurnContracts.get(id),
          getUserMemories,
        });
        const core = defineExtension({
          name: "milksu-core",
          sections: [
            // B2b：cwd 段（system-prompt.js:105）。milksu-core 是最后安装的扩展，
            // 段序保持在 skills 之后，对齐门关默认段序；preamble/tools/rules/docs
            // 段在 milksu-prompt（见上）。项目说明（AGENTS.md）现在作为
            // milksu-prompt 的无标签 preamble 段渲染（Pi 的 customPrompt 语义）。
            milksuCwdSection(),
            // PR-2 批次 B2d：workflow 后缀段（角色指引/运行时上下文/工作区身份/
            // 引号引用）。门关由 before_agent_start 的
            // composeMilkSUWorkflowSystemPrompt 拼在完整系统提示末尾（cwd 之后），
            // 这里以同一段位渲染，保证段序与门关一致。
            milksuWorkflowSection({
              resolveConversation,
              sessionRoleFor: alias => sessionRoles.get(alias) ?? "",
              policyFor: alias => sessionPolicies.get(alias),
            }),
          ],
          hooks: [
            hook(ToolTask, { beforeTool: judge }),
            hook(GenerationTask, { beforeRequest: requestFilter }),
            // PR-2 批次 B2：hang-guard 结果面（超时错误上的 iCloud 事后诊断）。
            ...createMilksuHangGuardHooks({ environment }),
          ],
        });
        // PR-2 批次 B2：工具面替换——撤 pi-durable 裸 CodingTools，按对照表挂载
        // milksu-coding-tools / milksu-lsp / milksu-skills（语义对照见
        // harness-bridge-tools.js 文件头与交付报告总表）。审判链在 milksu-core，
        // 对这里挂载的一切工具自动生效。
        const codingTools = await createMilksuCodingToolsExtension({
          workspace: process.cwd(),
          resolveModel: ref => models.models.getModel(
            String(ref?.provider ?? ""),
            String(ref?.modelId ?? ""),
          ),
        });
        // PR-2 批次 B2b：MCP 挂载（单 "mcp" 代理工具）。配置按会话经 adopt() 注入
        //（见 createSession）；未传 mcpConfig 的会话不 adopt、不连接、工具面也不含
        // mcp（activeTools 由策略决定）。审批/隔离在审判链，对这里自动生效。
        const mcpMount = createMilksuMcpExtension({
          resolveConversation,
          mcpConfigFor: alias => sessionMcpConfigs.get(alias),
          environment,
        });
        // PR-2 批次 B2c：日常 UX 与产品面板面（ask/progress/web×2/workspace/
        // imagegen/archify；定义与事件契约对照见 harness-bridge-daily-tools.js
        // 文件头）。安装位在 milksu-core 前，审判链对其自动生效。
        const dailyTools = await createMilksuDailyToolsExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          approvalBroker,
          workspaceActionBroker,
          pendingWorkspaceCompaction,
          inspectUsage: id => ({
            usage: sessionContextUsage.get(id),
            contextWindow: conversationRecord(id)?.model?.contextWindow
              ?? sessionContextUsage.get(id)?.contextWindow,
          }),
          observeResearchAction: observeResearchWorkspaceAction,
          researchSecrets: sessionProviderSecrets,
          isResearchActive: hasActiveResearchRun,
          workspace: process.cwd(),
        });
        // PR-2 批次 C1：子代理·协作工具面（milksu-subagents：builtin 角色 = 任务
        // 拥有的会话 + 外部 CLI 外部进程 + worktree 消费面；审判链的 subagent 分支
        // 对挂上即自动生效——校验/审批在 beforeTool，execute 只做执行）。安装位在
        // milksu-core 前。
        const subagentsExtension = createMilksuSubagentsExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          getProjectInstructions: () => projectInstructionsText,
          modelsCollection: () => models.models,
          getHarnessHandle: () => runtime?.handle,
          agentDirectory: () => resolveAgentDirectory(),
          childRegistry: subagentChildRegistry,
          updateSubagentTasks: updateSubagentTasksForSession,
          environment,
        });
        const subagentHalt = createHarnessSubagentHalt(
          subagentChildRegistry,
          () => runtime?.handle,
        );
        // PR-2 批次 C2：子代理·异步路面（milksu-subagents-async：background anchor
        // 任务拥有的 child 会话 + spawn/status/steer/stop 四件 + 完成通知回投；
        // anchor 任务定义随扩展注册——崩溃重开后 pending/running 的 anchor 由
        // 调度器续跑，定义缺位会 orphan，故本扩展与 C1 一样常驻安装）。
        const subagentsAsyncExtension = createMilksuSubagentsAsyncExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          getProjectInstructions: () => projectInstructionsText,
          modelsCollection: () => models.models,
          getHarnessHandle: () => runtime?.handle,
          childRegistry: subagentAsyncChildRegistry,
          updateSubagentTasks: updateSubagentTasksForSession,
          environment,
          // C2：anchor 侧效（registry/roster）只投给活会话——destroy 后迟到的 abort
          // handler 不再翻新已清场的进程内面（durable 真相不受影响）。
          isSessionActive: alias => sessions.has(alias),
        });
        const subagentAsyncHalt = createHarnessSubagentAsyncHalt(
          subagentAsyncChildRegistry,
          () => runtime?.handle,
        );
        // PR-2 批次 B2d：后台任务面（bg_task/bg_status，C2 anchor 模式重建；审批面
        // spawn/watch/stop/clear 在审判链对挂上即生效）。安装位在 milksu-core 前。
        const backgroundTasksMount = createMilksuBackgroundTasksExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          getHarnessHandle: () => runtime?.handle,
          emitTasksChanged: alias => emitHarnessBackgroundTasks(alias),
          environment,
        });
        // PR-2 批次 B2e：goal 状态机扩展（goal_complete/goal_blocked 两件 +
        // milksu-goal 系统提示段 + tool_call 守卫 hook）。安装位在 milksu-core 前
        //（beforeTool 先于审判链）；goal 工具按会话策略 activeTools 过滤挂载
        //（codingReadOnly/codingWorkspaceAuto 清单本就含两件）。
        const goalMount = goalMachine.extension;
        // PR-2 批次 B2f：Computer Use 控窗两件（prepare_computer_use_driver /
        // computer_use——门关工厂原样复用，executor 缓存按会话分槽；policy 门在
        // execute 内逐字保真，plan 档工具面不配置）。安装位在 milksu-core 前，
        // 审判链白名单对挂上即自动生效。
        const computerUseMount = createMilksuComputerUseExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          workspaceActionBroker,
        });
        // B2b：milksu-prompt 段的提示贡献（tools/rules 段按 snippet/guideline 渲染）。
        // 编码工具来自上面的定义构造器；LSP/MCP 是钉版字符串（pi-lsp.ts:53/113、
        // pi-mcp-adapter index.ts:2061——两个包的工具定义都不导出）；B2c 的 web
        // 两件从收集到的门关定义带出 promptSnippet（bridge-web-research.js:358/427）。
        const promptSnippets = new Map([
          ...(codingTools.promptContributions?.snippets ?? []),
          ...Object.entries(LSP_PROMPT_CONTRIBUTIONS.snippets),
          ["mcp", MILKSU_MCP_PROMPT_SNIPPET],
          ...(dailyTools.promptContributions?.snippets ?? []),
          ...(subagentsExtension.promptContributions?.snippets ?? []),
          ...(subagentsAsyncExtension.promptContributions?.snippets ?? []),
          ...(goalMount.promptContributions?.snippets ?? []),
        ]);
        const promptGuidelines = new Map([
          ...(codingTools.promptContributions?.guidelines ?? []),
          ...Object.entries(LSP_PROMPT_CONTRIBUTIONS.guidelines),
          ...(subagentsExtension.promptContributions?.guidelines ?? []),
          ...(subagentsAsyncExtension.promptContributions?.guidelines ?? []),
          ...(goalMount.promptContributions?.guidelines ?? []),
        ]);
        const promptSections = createMilksuPromptSectionsExtension({
          projectInstructionsFor: () => projectInstructionsText,
          promptSnippets,
          promptGuidelines,
        });
        // PR-2 批次 B2c：安全工具面（capa_analyze）。openRuntime 时首个已登记策略
        // 里带 capa 目录就挂真工具，否则挂空壳占位（保持挂载位稳定）；会话策略
        // 刷新时按目录指纹原位替换（refreshSecurityToolsMount）。
        const initialSecurityPolicy = [...sessionPolicies.values()]
          .find(policy => securityToolsMountFingerprint(policy));
        securityMountFingerprint = initialSecurityPolicy
          ? securityToolsMountFingerprint(initialSecurityPolicy)
          : "";
        const securityToolsMount = createMilksuSecurityToolsExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          policy: initialSecurityPolicy,
        });
        registry.install(promptSections);
        registry.install(codingTools);
        registry.install(createMilksuLspExtension({
          resolveConversation,
          getPolicy: id => sessionPolicies.get(id),
          approvalBroker,
        }));
        registry.install(createMilksuSkillsExtension({
          resolveConversation,
          skillPathsFor: alias => sessionSkillPaths.get(alias),
          cwd: process.cwd(),
        }));
        registry.install(mcpMount.extension);
        registry.install(dailyTools);
        registry.install(securityToolsMount);
        registry.install(subagentsExtension);
        registry.install(subagentsAsyncExtension);
        registry.install(backgroundTasksMount);
        registry.install(goalMount);
        registry.install(computerUseMount);
        registry.install(core);
        if (typeof installRegistryExtensions === "function") {
          await installRegistryExtensions(registry, { models: models.models });
        }
        const handle = await openMilkSUHarness({
          agentDir: resolveAgentDirectory(),
          models: models.models,
          registry,
          settings: {
            get compaction() {
              return liveCompactionPolicy();
            },
          },
          env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
          ...harnessRuntimeOptions(),
        });
        return { handle, models, registry, mcpMount, subagentHalt, subagentAsyncHalt };
      })();
      runtimeOpening.catch(() => {
        runtimeOpening = undefined;
      });
    }
    const opened = await runtimeOpening;
    runtime = opened;
    return runtime;
  }

  // ---------- 模型接线 ----------

  function makeProjector(alias) {
    return createHarnessEventProjector({
      module: sessionPolicies.get(alias)?.ctf ? "ctf" : "coding",
      conversationId: alias,
      provider: sessionConfiguredProviders.get(alias),
      source: sessionModelSources.get(alias),
    });
  }

  /**
   * B2c：capa 目录按会话策略对账挂载。目录指纹（command/args/version）变化时按名
   * 原位替换 milksu-security-tools——注册面元数据（描述嵌版本号）随之刷新；
   * execute 本身每次按会话策略重新解析定义，不受此处时序影响。runtime 未开时
   * 由 openRuntime 的初始挂载负责（它总能看到首个已登记策略）。
   */
  function refreshSecurityToolsMount(alias, policy) {
    void alias;
    if (!runtime) return;
    const fingerprint = securityToolsMountFingerprint(policy);
    if (fingerprint === securityMountFingerprint) return;
    securityMountFingerprint = fingerprint;
    runtime.registry.install(createMilksuSecurityToolsExtension({
      resolveConversation,
      getPolicy: id => sessionPolicies.get(id),
      policy,
    }));
  }

  async function configureAgentTools(alias, names) {
    const { handle, registry } = await openRuntime();
    // PR-2 批次 C2：policy.activeTools 含 subagent（subagentAvailable 派生）时一并
    // 挂异步路面四件；受限清单（turn contract 的无工具回合等）不含 subagent 即
    // 不扩——门关共享的 bridge-policy 派生面不动。
    const requested = expandHarnessSubagentAsyncToolNames(names);
    const byName = new Map(
      registry.snapshot().tools().map(entry => [entry.tool.name, entry.tool]),
    );
    const tools = [];
    const missing = [];
    const record = conversationRecord(alias);
    // PR-2 批次 B2e：after-first-goal 可见性（pi-goal toolVisibility 设置）——goal
    // 工具在首个 goal 激活前从挂载面摘除（pi-goal hideGoalToolsIfLocked）。
    const effective = goalMachine.filterAgentToolNames(record?.durableId, requested);
    for (const name of [...new Set(effective ?? [])]) {
      const tool = byName.get(String(name));
      if (tool) tools.push(tool);
      else missing.push(String(name));
    }
    // 暂缓面（B2 对照表的差集）只告警一次：门开路径还没挂载的域工具在这里显式
    // 可见，而不是静默消失。
    for (const name of missing) {
      if (warnedMissingToolNames.has(name)) continue;
      warnedMissingToolNames.add(name);
      console.warn(
        `MilkSU harness registry has no tool ${name}; the surface is deferred (see PR-2 B2 report)`,
      );
    }
    await handle.configureConversation(alias, { tools });
    if (record) {
      record.activeToolNames = tools.map(tool => tool.name);
      record.toolsConfiguring = undefined;
    }
    return tools;
  }

  function rememberHarnessChildRegistry({ command, selection, wiring }) {
    const alias = String(command.conversationId ?? "").trim();
    const provider = String(command.provider ?? "").trim();
    const model = String(command.model ?? "").trim();
    const definition = currentProviderDefinition(
      provider,
      model,
      environment,
      command.customProvider,
    );
    const accountModel = wiring.sources.find(source => source.id === "account")?.model;
    rememberChildModelRegistry({
      conversationId: alias,
      provider,
      model,
      thinking: command.thinking,
      turnProvider: command.customProvider,
      definition,
      account: accountModel
        ? { id: accountModel.id, model: accountModel, unavailable: false }
        : undefined,
      sources: wiring.sources,
      effectiveProvider: selection.provider,
    });
  }

  async function wireConversationModel(command) {
    const alias = String(command.conversationId ?? "").trim();
    const { handle, models } = await openRuntime();
    const wiring = wireHarnessModelSelection({
      models: models.models,
      provider: command.provider,
      model: command.model,
      thinking: command.thinking,
      sourceOrder: command.modelSourceOrder,
      personalModel: personalModelFor(command),
      environment,
      turnProvider: command.customProvider,
      autoFallback: environment.MILKSU_MODEL_SOURCE_FALLBACK === "1",
      onSource: selected => {
        // 双来源路由的活来源跟踪（对齐旧 configureRuntimeModel 的 onSource）。
        sessionModelSources.set(alias, selected);
        emit(alias, "model_source_selected", { source: selected });
      },
      onFallback: fallback => emit(alias, "model_source_fallback", fallback),
    });
    sessionConfiguredProviders.set(alias, String(command.provider ?? "").trim());
    if (wiring.failure) {
      const order = requestedSourceOrder(command, environment);
      const message = modelSourceFailureMessage({
        provider: command.provider,
        model: command.model,
        requestedOrder: order,
        source: wiring.failure.intendedSource,
        locale: command.locale,
      });
      emit(alias, "model_source_unavailable", {
        provider: command.provider,
        model: command.model,
        requestedOrder: order,
        reason: wiring.failure.reason,
        message,
        notice: message,
      });
      throw new Error(message);
    }
    const selection = wiring.selection;
    sessionModelSources.set(alias, selection.source);
    const relayEnabledNow = environment.MILKSU_RELAY_ENABLED === "1"
      && Boolean(String(environment.MILKSU_RELAY_KEY ?? "").trim());
    if (
      relayEnabledNow
      && requestedSourceOrder(command, environment)[0] === "account"
      && selection.source === "personal"
    ) {
      emit(alias, "model_source_fallback", { from: "account", to: "personal", reason: "model" });
    }
    emit(alias, "model_source_selected", { source: selection.source });
    const profile = normalizeThinkingProfile(command.thinking);
    await handle.configureConversation(alias, {
      provider: selection.provider,
      modelId: selection.modelId,
      thinkingLevel: profile.enabled ? profile.level : "off",
    });
    const resolved = models.models.getModel(selection.provider, selection.modelId);
    compactionSnapshot = {
      contextWindow: Number(resolved?.contextWindow ?? 0),
      maxOutput: resolveMaxOutput({
        modelIds: [selection.modelId, resolved?.name],
        sessionMaxTokens: resolved?.maxTokens,
        lookupMaxTokens: knownMaxTokens,
      }),
    };
    const record = conversationRecord(alias);
    if (record) {
      record.model = {
        id: selection.modelId,
        modelId: selection.modelId,
        name: resolved?.name ?? selection.modelId,
        contextWindow: resolved?.contextWindow,
        maxTokens: resolved?.maxTokens,
      };
      // decision_query（B2 遗留接线）：记录 pi-ai 模型对象，供 models.completeSimple。
      record.piModel = resolved;
      record.projector = makeProjector(alias);
    }
    emit(alias, "model_selected", {
      provider: selection.provider,
      model: selection.modelId,
    });
    emit(alias, "thinking_level_selected", {
      enabled: profile.enabled,
      levels: profile.levels,
      level: profile.enabled ? profile.level : "off",
    });
    rememberHarnessChildRegistry({ command, selection, wiring });
  }

  // ---------- 子代理任务投影（PR-2 批次 C1；对照 bridge.js:581-712 的同款管线） ----------

  function emitResearchTaskUpdatesForSession(conversationId, tasks) {
    const contexts = researchRunContexts.get(conversationId);
    if (!contexts) return;
    for (const context of contexts.values()) {
      const matched = [];
      for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!assignResearchSubagentTaskID(task, context)) continue;
        matched.push(task);
      }
      const updates = projectResearchSubagentUpdates(
        matched,
        new Set(),
        new Set(),
        environment,
        sessionProviderSecrets(conversationId),
      );
      for (const update of updates) {
        update.id = context.workerTaskIDs.get(update.id) ?? update.id;
      }
      if (updates.length) {
        emit(conversationId, "research_tasks", {
          researchRunId: context.runId,
          researchTasks: updates,
        });
      }
    }
  }

  function emitSubagentTasksForSession(conversationId, tasks) {
    const next = Array.isArray(tasks) ? tasks : [];
    if (next.length) sessionSubagentTasks.set(conversationId, next);
    else sessionSubagentTasks.delete(conversationId);
    const secrets = sessionProviderSecrets(conversationId);
    emit(conversationId, "subagent_tasks", {
      subagentTasks: next.map(task => projectSubagentTaskForRenderer(task, environment, secrets)),
    });
    emitResearchTaskUpdatesForSession(conversationId, next);
  }

  /** C1：execute 精确收尾用的更新面（bridge.js emitSubagentTasks 的 updater 形状）。 */
  function updateSubagentTasksForSession(conversationId, update) {
    const current = sessionSubagentTasks.get(conversationId) ?? [];
    emitSubagentTasksForSession(conversationId, update(current));
  }

  /**
   * PR-2 批次 B2d：桌面 background_tasks 投影（bridge.js emitBackgroundTasks:409 的
   * 门开同款）——读磁盘 meta 面（与门关同一目录约定），按会话过滤 + log tail 投影，
   * redact 后原样 emit。bg 扩展的每次工具执行/anchor 终态都重发。
   */
  function emitHarnessBackgroundTasks(alias) {
    try {
      emit(alias, "background_tasks", {
        tasks: redactResearchText(projectBackgroundTaskMetas(
          backgroundTaskMetasForSession(listPiBackgroundTaskMetas(), alias),
          Date.now(),
          readPiBackgroundTaskLog,
        ), environment, sessionProviderSecrets(alias)),
      });
    } catch (error) {
      console.error("MilkSU could not project harness background tasks", error);
      emit(alias, "background_tasks", { tasks: [] });
    }
  }

  /**
   * tool_execution_end 的 subagent roster 兜底（对照 bridge.js:1960-1993）。execute
   * 正常收尾时已通过 updateSubagentTasks 给出精确行（status 非 start）；这里只把
   * 仍处 start 态的行（execute 抛错/中断的场景）按内容投影收尾——从
   * docs["pi.live"].tools[callId] 读 details（事件本体不带）。注：本轮最后一个
   * 工具的 end 事件与 endRun 同提交，live.tools 可能已被清场，details 读不到时
   * 按 content 兜底投影。
   */
  async function finalizeSubagentRoster(alias, event) {
    const policy = sessionPolicies.get(alias);
    const current = sessionSubagentTasks.get(alias) ?? [];
    const owned = current.filter(task => (
      task.toolCallId === event.toolCallId
      && (task.status === "start" || task.status === "running")
    ));
    if (!owned.length) return;
    const others = current.filter(task => (
      task.toolCallId !== event.toolCallId
      || (task.status !== "start" && task.status !== "running")
    ));
    const record = subagentCallRecords.get(event.toolCallId);
    subagentCallRecords.delete(event.toolCallId);
    const message = (event?.entry?.model ?? [])
      .find(candidate => candidate?.role === "toolResult");
    let details = undefined;
    try {
      const { handle } = await openRuntime();
      const live = await handle.conversationLive(alias);
      const slot = (live?.tools ?? []).find(slot => slot.callId === event.toolCallId);
      details = slot?.details;
    } catch {
      // live 读取失败按无 details 收尾（content 兜底投影）。
    }
    const wrapped = projectSubagentToolResult({
      content: message?.content,
      details,
      input: record?.args,
      isError: Boolean(message?.isError),
    }, {
      workspace: policy?.workspace,
      collaboration: policy?.codingCollaboration,
      worktrees: policy?.codingCollaboration?.worktrees,
      secrets: sessionProviderSecrets(alias),
      environment,
    });
    const projected = projectSubagentRosterEnd(owned, wrapped, {
      toolCallId: event.toolCallId,
      durationMs: record?.startedAt === undefined
        ? undefined
        : Math.max(0, Date.now() - record.startedAt),
      isError: Boolean(message?.isError),
      secrets: sessionProviderSecrets(alias),
      environment,
    });
    emitSubagentTasksForSession(alias, [...others, ...projected]);
  }

  /**
   * C2：subagent_async 的收尾兜底——只处理仍处 start 态的行（execute 抛错/中断：
   * 校验/模型串解析失败等，对照 C1 finalizeSubagentRoster 的兜底场景）。正常路径
   * 的行（async 收据 running / 前台终态 / anchor 终态）由 execute 与 anchor 的
   * upsert 给出，不走这里。
   */
  async function finalizeAsyncSubagentRoster(alias, event) {
    const current = sessionSubagentTasks.get(alias) ?? [];
    const owned = current.filter(task => (
      task.toolCallId === event.toolCallId && task.status === "start"
    ));
    if (!owned.length) return;
    const others = current.filter(task => (
      task.toolCallId !== event.toolCallId || task.status !== "start"
    ));
    const message = (event?.entry?.model ?? [])
      .find(candidate => candidate?.role === "toolResult");
    const content = Array.isArray(message?.content)
      ? message.content
        .filter(block => block?.type === "text")
        .map(block => String(block?.text ?? ""))
        .join("\n")
        : String(message?.content ?? "");
    const summary = (content || "Async subagent launch failed.").replace(/\s+/g, " ").slice(0, 240);
    emitSubagentTasksForSession(alias, [
      ...others,
      ...owned.map(task => ({ ...task, status: "failed", exitCode: 1, summary })),
    ]);
  }

  // ---------- 事件管线 ----------

  function recordSessionContextUsage(alias, usage, contextWindow) {
    sessionContextUsage.set(alias, {
      inputTokens: Math.max(0, Number(usage?.inputTokens ?? 0)),
      cacheReadTokens: Math.max(0, Number(usage?.cacheReadTokens ?? 0)),
      contextWindow: Number(contextWindow ?? usage?.contextWindow ?? 0),
    });
  }

  function emitHarnessContextComposition(alias) {
    const record = conversationRecord(alias);
    if (!record) return;
    try {
      const stored = sessionContextUsage.get(alias);
      const windowTokens = record.model?.contextWindow ?? stored?.contextWindow;
      const composition = projectSessionContextComposition({
        systemPrompt: projectInstructionsText,
        getAllTools: () => record.agentTools ?? [],
        getActiveToolNames: () => record.activeToolNames ?? [],
        messages: record.compositionMessages ?? [],
        model: record.model,
      }, {
        billedPromptTokens: Math.max(0, Number(stored?.inputTokens ?? 0))
          + Math.max(0, Number(stored?.cacheReadTokens ?? 0)),
        contextWindow: windowTokens,
      });
      if (!composition) return;
      const maxOutput = resolveMaxOutput({
        modelIds: [record.model?.id, record.model?.name, sessionModelSources.get(alias)],
        sessionMaxTokens: record.model?.maxTokens,
        lookupMaxTokens: knownMaxTokens,
      });
      emit(alias, "context_composition", {
        contextComposition: {
          ...composition,
          ...contextUsageWindowPayload(windowTokens, maxOutput),
        },
      });
    } catch (error) {
      console.error("MilkSU could not project harness context composition", error);
    }
  }

  async function refreshCompositionMessages(alias) {
    const record = conversationRecord(alias);
    if (!record) return;
    try {
      const { handle } = await openRuntime();
      const viewState = await handle.conversationViewState(alias);
      try {
        const messages = [];
        for (const entry of viewState?.value?.entries ?? []) {
          for (const message of entry.model ?? []) messages.push(message);
        }
        record.compositionMessages = messages;
      } finally {
        viewState?.dispose?.();
      }
    } catch {
      // 组合面板尽力而为；拿不到视图就保留旧值。
    }
  }

  function cacheInboxItems(alias, items) {
    const record = conversationRecord(alias);
    if (!record) return;
    record.inboxItems = Array.isArray(items) ? items : [];
  }

  async function emitHarnessQueueUpdate(alias) {
    if (suppressedQueueUpdates.has(alias)) return;
    try {
      const { handle } = await openRuntime();
      const items = await handle.conversationInbox(alias);
      cacheInboxItems(alias, items);
      const steering = [];
      const followUp = [];
      for (const item of items) {
        const text = inboxItemText(item);
        if (!text) continue;
        (item.mode === "steer" ? steering : followUp).push(text);
      }
      emit(alias, "queue_update", { steering, followUp });
    } catch (error) {
      console.error("MilkSU could not project harness inbox", error);
    }
  }

  async function waitAndEmitCompactionEnd(alias, taskId, reason) {
    const { handle } = await openRuntime();
    const record = conversationRecord(alias);
    let settled;
    try {
      settled = await handle.waitTask(taskId);
    } catch (error) {
      if (record) record.compactionCount = Math.max(0, (record.compactionCount ?? 1) - 1);
      emit(alias, "compaction_end", {
        requestId: reason === "manual" ? compactionRequestIds.get(alias) : undefined,
        reason: bridgeCompactionReason(reason),
        aborted: false,
        error: describeError(error),
      });
      return;
    }
    if (record) record.compactionCount = Math.max(0, (record.compactionCount ?? 1) - 1);
    const outcome = settled?.state?.outcome ?? {};
    const requestId = reason === "manual" ? compactionRequestIds.get(alias) : undefined;
    if (reason === "manual" && requestId) compactionRequestIds.delete(alias);
    if (outcome.status === "completed") {
      emit(alias, "compaction_end", {
        requestId,
        reason: bridgeCompactionReason(reason),
        aborted: false,
        compaction: {
          // pi-durable 不给 token 计数；before 用桥侧已记用量，after 留空由下一次
          // usage_recorded 刷新（Go 侧字段 omitempty，可省）。
          tokensBefore: Number(sessionContextUsage.get(alias)?.inputTokens ?? 0),
          estimatedTokensAfter: undefined,
        },
      });
      await refreshCompositionMessages(alias);
      emitHarnessContextComposition(alias);
      return;
    }
    if (outcome.status === "aborted") {
      emit(alias, "compaction_end", {
        requestId,
        reason: bridgeCompactionReason(reason),
        aborted: true,
        error: "Context compaction cancelled",
      });
      return;
    }
    emit(alias, "compaction_end", {
      requestId,
      reason: bridgeCompactionReason(reason),
      aborted: false,
      error: outcome.error?.message ?? "Context compaction failed",
    });
  }

  // ---------- reasoning-only recovery（bridge-reasoning-recovery 的门开移植） ----------

  function restoreReasoningOnlyTools(alias) {
    const previous = reasoningOnlyPreviousTools.get(alias);
    sessionTurnContracts.delete(alias);
    if (previous) {
      sessionPolicyControllers.get(alias)?.setActiveTools(previous);
    }
    reasoningOnlyPreviousTools.delete(alias);
    // 还原是异步 configure：等它落盘，恢复流程的调用方（run_end）再继续。
    return Promise.resolve(conversationRecord(alias)?.toolsConfiguring)
      .then(() => undefined)
      .catch(() => undefined);
  }

  async function harnessLastAssistantMessage(alias) {
    try {
      const { handle } = await openRuntime();
      const page = await handle.conversationEntries(alias, { limit: 8 });
      for (const entry of page?.items ?? []) {
        const message = (entry.model ?? []).find(candidate => candidate?.role === "assistant");
        if (message) return message;
      }
    } catch {
      // 会话刚销毁：按无消息处理。
    }
    return undefined;
  }

  async function maybeRecoverReasoningOnlyTurn(alias) {
    // 门关语义（bridge-reasoning-recovery.js:96-118）：
    //   aborted → 只还原工具面；已恢复过 → 还原工具面（恢复回合收尾）；
    //   末条 assistant 是 reasoning-only final → 标记已恢复、压无工具回合、投恢复
    //   输入（旧 pi.sendMessage deliverAs:followUp + triggerTurn → submitInput）。
    if (abortedSessions.has(alias)) {
      await restoreReasoningOnlyTools(alias);
      return;
    }
    if (reasoningOnlyRecovered.get(alias) === true) {
      await restoreReasoningOnlyTools(alias);
      return;
    }
    const last = await harnessLastAssistantMessage(alias);
    if (!isReasoningOnlyFinal(last)) return;
    reasoningOnlyRecovered.set(alias, true);
    const tools = typeof sessions.get(alias)?.getActiveToolNames === "function"
      ? sessions.get(alias).getActiveToolNames()
      : [];
    reasoningOnlyPreviousTools.set(alias, tools);
    sessionTurnContracts.set(alias, { toolAccess: "none", reason: "text_projection" });
    sessionPolicyControllers.get(alias)?.setActiveTools([]);
    logReasoningOnlyFinal(summarizeReasoningOnlyFinal(last, {
      provider: last.provider,
      model: last.model,
    }));
    try {
      const { handle } = await openRuntime();
      // 无工具面配置先落盘，恢复回合的 prepare 读到的是 tools:[]。
      await conversationRecord(alias)?.toolsConfiguring;
      await handle.submitInput(alias, {
        requestId: `milksu-recovery:${alias}:${randomUUID()}`,
        content: reasoningOnlyRecoveryPrompt(sessionPolicies.get(alias)?.uiLocale),
      });
    } catch (error) {
      // 恢复投递失败：还原工具面，让下一轮正常进行（不吞错误，上报）。
      await restoreReasoningOnlyTools(alias);
      reasoningOnlyRecovered.delete(alias);
      emit(alias, "error", { error: describeError(error) });
    }
  }

  async function handleHarnessEvent(alias, event) {
    const record = conversationRecord(alias);
    if (!record) return;
    // PR-2 批次 B2e：goal 观察门的会话引用（handle/durableId/工具面/忙闲）。
    const goalSessionRef = () => ({
      handle: runtime?.handle,
      durableId: record.durableId,
      activeToolNames: [...record.activeToolNames],
      isBusy: record.busy === true,
    });
    if (event.type === "compaction_start") {
      record.compactionCount = (record.compactionCount ?? 0) + 1;
      emit(alias, "compaction_start", {
        requestId: event.reason === "manual"
          ? compactionRequestIds.get(alias)
          : undefined,
        reason: bridgeCompactionReason(event.reason),
      });
      void waitAndEmitCompactionEnd(alias, event.taskId, event.reason);
      return;
    }
    if (event.type === "inbox_update") {
      await emitHarnessQueueUpdate(alias);
      return;
    }
    if (event.type === "run_start") {
      // repeat guard 重置：每个 run 一次 ≈ 旧 before_agent_start 的每个 agent run 一
      // 次（语义核对见 harness-bridge-approval 文件头）。
      record.repeatGuard.reset();
      record.busy = true;
      record.pendingToolCalls = [];
      // PR-2 批次 B2e：goal run 观察门（输入归属/epoch 重置/工具面缺失暂停）。
      try {
        await goalMachine.handleRunStart(alias, goalSessionRef(alias), event);
      } catch (error) {
        console.error("MilkSU harness goal run_start gate failed", error);
      }
      emit(alias, "turn_started");
      return;
    }
    if (event.type === "turn_end") {
      // PR-2 批次 B2e：pi-goal turn_end 的逐 turn 计数（automaticModelTurns）。
      try {
        await goalMachine.handleTurnEnd(alias, goalSessionRef(alias));
      } catch (error) {
        console.error("MilkSU harness goal turn_end gate failed", error);
      }
      return;
    }
    if (event.type === "run_end") {
      // reasoning-only recovery（B1 遗留接线，bridge-reasoning-recovery 移植）：上一
      // 回合只有思考没有可见答复时，投一条恢复输入再开一轮（无工具）。顺序对齐门关
      // （扩展 agent_end 先于公共 agent_settled 监听器），turn_settled 照常发——恢复
      // 回合自己的 run_start/run_end 会再发一对。
      // PR-2 批次 B2e：goal run_end 观察门（守卫链+续跑投递）。goal 活着时抑制
      // turn_settled（门关 bridge.js:1825-1831 的 goalKeepsSessionRunning 语义）。
      let goalKeepsRunning = false;
      try {
        const outcome = await goalMachine.handleRunEnd(alias, goalSessionRef(alias));
        goalKeepsRunning = Boolean(outcome?.keepsRunning);
      } catch (error) {
        console.error("MilkSU harness goal run_end gate failed", error);
      }
      await maybeRecoverReasoningOnlyTurn(alias);
      record.busy = false;
      record.pendingToolCalls = [];
      if (!goalKeepsRunning) emit(alias, "turn_settled");
      return;
    }
    if (event.type === "snapshot") {
      record.busy = Boolean(event.run);
      record.compactionCount = Array.isArray(event.compactions) ? event.compactions.length : 0;
      await emitHarnessQueueUpdate(alias);
      return;
    }
    if (event.type === "tool_execution_start") {
      record.pendingToolCalls = [...record.pendingToolCalls, event.toolCallId];
      // PR-2 批次 B2e：pi-goal tool_call 的 markAgentToolAttempted（无进展守卫的
      // toolAttempted 位）。
      goalMachine.markToolAttempted(record.durableId);
      // C1：subagent 开场 roster（对照 bridge.js:1916-1928）——task 行形状由共享的
      // projectSubagentRosterStart 保证，渲染器零改动。
      if (event.toolName === codingCollaborationToolName) {
        const policy = sessionPolicies.get(alias);
        subagentCallRecords.set(event.toolCallId, {
          args: event.args,
          startedAt: Date.now(),
        });
        emitSubagentTasksForSession(alias, [
          ...(sessionSubagentTasks.get(alias) ?? []),
          ...projectSubagentRosterStart(event.args, {
            toolCallId: event.toolCallId,
            workspace: policy?.workspace,
            worktrees: policy?.codingCollaboration?.worktrees,
          }),
        ]);
      }
      // C2：subagent_async 开场 roster（同款共享行形状；execute 里的登记行带
      // runId/conversationId，按 toolCallId upsert 覆盖此占位行）。
      if (event.toolName === "subagent_async") {
        const policy = sessionPolicies.get(alias);
        subagentCallRecords.set(event.toolCallId, {
          args: event.args,
          startedAt: Date.now(),
        });
        emitSubagentTasksForSession(alias, [
          ...(sessionSubagentTasks.get(alias) ?? []),
          ...projectSubagentRosterStart(event.args, {
            toolCallId: event.toolCallId,
            workspace: policy?.workspace,
            worktrees: policy?.codingCollaboration?.worktrees,
          }),
        ]);
      }
    }
    if (event.type === "tool_execution_end") {
      record.pendingToolCalls = record.pendingToolCalls.filter(id => id !== event.toolCallId);
      if (event.toolName === codingCollaborationToolName) {
        try {
          await finalizeSubagentRoster(alias, event);
        } catch (error) {
          console.error("MilkSU harness subagent roster projection failed", error);
        }
      }
      // C2：subagent_async 收尾 roster——async 收据/终态行由 execute/anchor 的
      // upsert 覆盖；这里只把仍处 start 态的行（execute 抛错/中断的场景）按失败
      // 收尾，避免悬挂的 start 行（对照 C1 finalizeSubagentRoster 的兜底语义，
      // 但不重投影已收尾行——前台结果的 yield 重投影会造重复行）。
      if (event.toolName === "subagent_async") {
        try {
          await finalizeAsyncSubagentRoster(alias, event);
        } catch (error) {
          console.error("MilkSU harness async subagent roster projection failed", error);
        }
      }
    }
    if (event.type === "message_end") {
      const message = event?.entry?.model?.[0];
      const failure = message?.role === "assistant" ? assistantFailureText(message) : "";
      // PR-2 批次 B2e：run 内 assistant 消息收集（终态分类与无进展指纹的输入）。
      goalMachine.noteRunMessage(record.durableId, message);
      if (failure) {
        // pi-durable 的重试有界（settings.retry 默认 3 次），这里只上报不主动 abort
        //（旧路径 abort 是因为旧引擎无限重试烧额度；差异见报告）。
        emit(alias, "error", { error: failure });
      }
    }
    if (event.type === "task_failed" && event.kind === "pi.generation") {
      // PR-2 批次 B2e：重试耗尽的 generation 失败（可能无 assistant 条目）——goal
      // run_end 终态分类的兜底信号（pi-goal agent_end 的 error 分类对应物）。
      goalMachine.noteGenerationFailure(record.durableId, event.message);
    }

    for (const projected of record.projector.project(event)) {
      switch (projected.type) {
        case "thinking_start":
          thinkingRepetition.reset(alias);
          record.thinkingStartedAt = Date.now();
          emit(alias, "thinking_start", projected.data);
          break;
        case "thinking_delta": {
          emit(alias, "thinking_delta", projected.data);
          const repeat = thinkingRepetition.push(alias, String(projected.data?.delta ?? ""));
          if (repeat) {
            emit(alias, "guard.alarm", {
              toolName: "",
              reason: `thinking repeated ${repeat.run} lines: ${repeat.line}`,
              repeatLine: repeat.line,
              sample: repeat.sample,
              notice: THINKING_REPEAT_NOTICE.notice,
              noticeEnglish: THINKING_REPEAT_NOTICE.noticeEnglish,
            });
          }
          break;
        }
        case "thinking_done":
          emit(alias, "thinking_done", {
            ...projected.data,
            durationMs: record.thinkingStartedAt === undefined
              ? undefined
              : Math.max(0, Date.now() - record.thinkingStartedAt),
          });
          record.thinkingStartedAt = undefined;
          break;
        case "text_delta":
          queueTextDelta(alias, String(projected.data?.delta ?? ""));
          break;
        case "usage_recorded":
          recordSessionContextUsage(alias, projected.data?.usage, record.model?.contextWindow);
          emit(alias, "usage_recorded", projected.data);
          void refreshCompositionMessages(alias).then(() => emitHarnessContextComposition(alias));
          break;
        case "tool_call_start":
          emit(alias, "tool_call_start", {
            ...projected.data,
            content: redactResearchText(formatToolInput(
              projected.data.toolName,
              event.args ?? {},
              sessionProviderSecrets(alias),
            ), environment, sessionProviderSecrets(alias)),
          });
          break;
        case "tool_call_end":
          emit(alias, "tool_call_end", {
            ...projected.data,
            content: truncateValue(redactResearchText(
              String(projected.data.content ?? ""),
              environment,
              sessionProviderSecrets(alias),
            ), record.maxToolEventOutputBytes),
          });
          break;
        default:
          emit(alias, projected.type, projected.data);
      }
    }
  }

  async function subscribeHarnessEvents(alias) {
    const { handle } = await openRuntime();
    const stream = await handle.watchConversationEvents(alias);
    stream.start(async (events) => {
      for (const event of Array.isArray(events) ? events : []) {
        try {
          await handleHarnessEvent(alias, event);
        } catch (error) {
          console.error("MilkSU harness event projection failed", error);
          emit(alias, "error", { error: describeError(error) });
        }
      }
    });
    // 附着帧（snapshot）喂一次，初始化 busy/排队缓存。
    await handleHarnessEvent(alias, stream.snapshot);
    return stream;
  }

  // ---------- 会话对象（duck-typed：bridge-steering / dispose 共用面） ----------

  function makeSessionObject(alias, handle) {
    const record = () => conversationRecord(alias);
    const submit = async (message, options = {}) => handle.submitInput(alias, {
      requestId: options.requestId ?? randomUUID(),
      content: String(message ?? ""),
      ...(options.whenBusy ? { whenBusy: options.whenBusy } : {}),
    });
    const refreshInbox = async () => {
      try {
        cacheInboxItems(alias, await handle.conversationInbox(alias));
      } catch {
        // 会话可能刚销毁；缓存保留旧值。
      }
    };
    const queueTexts = mode => (record()?.inboxItems ?? [])
      .filter(item => item?.mode === mode)
      .map(inboxItemText);
    return {
      kind: MILKSU_HARNESS_SESSION_KIND,
      conversationId: alias,
      get durableConversationId() {
        return record()?.durableId;
      },
      async steer(message) {
        await submit(message, { whenBusy: "steer" });
        await refreshInbox();
      },
      async followUp(message) {
        await submit(message);
        await refreshInbox();
      },
      async prompt(message) {
        // relay 语义：空闲会话直接开一轮（忙时 pi-durable 按 followUp 排队）。
        await submit(message);
      },
      getSteeringMessages() {
        return queueTexts("steer");
      },
      getFollowUpMessages() {
        return queueTexts("followUp");
      },
      clearQueue() {
        // 旧语义：原子清空两队列并返回原文，由调用方按需重建。pi-durable 面上用
        // abortSubmission 逐条撤回排队 input（已放置的返回 already_placed/settled，
        // 与旧「已被消费」竞态一致）。
        const original = {
          steering: queueTexts("steer"),
          followUp: queueTexts("followUp"),
        };
        for (const item of record()?.inboxItems ?? []) {
          if (item?.mode === "steer" || item?.mode === "followUp") {
            void handle.abortSubmission(item.id).catch(() => undefined);
          }
        }
        cacheInboxItems(alias, []);
        return original;
      },
      getActiveToolNames() {
        return [...(record()?.activeToolNames ?? [])];
      },
      isStreaming() {
        return record()?.busy === true;
      },
      isIdle() {
        return record()?.busy !== true;
      },
      get isCompacting() {
        return (conversationRecord(alias)?.compactionCount ?? 0) > 0;
      },
      get state() {
        return { pendingToolCalls: [...(record()?.pendingToolCalls ?? [])] };
      },
      async abort() {
        await handle.abortConversation(alias);
      },
      dispose() {
        const current = record();
        if (current?.stream) {
          void current.stream.stop().catch(() => undefined);
        }
      },
    };
  }

  // ---------- createSession ----------

  async function createSession(command) {
    const alias = String(command.conversationId ?? "").trim();
    if (!alias) throw new Error("conversationId is required");
    applyWorkerModelOverride(command.workerModel);
    const existing = sessions.get(alias);
    if (existing?.kind === MILKSU_HARNESS_SESSION_KIND) {
      sessionCreateCommands.set(alias, command);
      return existing;
    }
    const cwd = process.cwd();
    const instructions = await loadProjectInstructions(
      cwd,
      command.locale === "en" ? "en" : "zh",
    );
    if (instructions) projectInstructionsText = instructions;
    const { policy: sessionPolicy, effectiveSessionRole, codingSkillPaths, mcpConfig } = await loadRuntimeSessionPolicy(cwd, command);
    sessionPolicies.set(alias, sessionPolicy);
    // PR-2 批次 B2d：角色按会话登记（milksu-workflow section 的角色指引渲染源；
    // 门关 createSession 在 resource loader 上绑同一份 effectiveSessionRole）。
    sessionRoles.set(alias, String(effectiveSessionRole ?? ""));
    // 技能路径按会话登记：milksu-skills section 据此渲染目录（disabled 技能变化
    // → 路径清单变化 → section 内容变化 → 位置型 pi.system 只重发差异）。
    sessionSkillPaths.set(alias, Array.isArray(codingSkillPaths) ? codingSkillPaths : []);
    // B2b：MCP 配置按会话登记并做一次发现连接（连上→列目录→关 lazy 连接；目录
    // 进程内缓存）。未传 mcpConfig 即不挂载——门关 createMilkSUResourceLoader 的
    // `if (mcpConfig)` 同款门。发现失败只记 backoff，不阻断会话创建（adapter
    // init.ts:357-380 同款语义）。
    const mcpFingerprint = mcpConfig ? JSON.stringify(mcpConfig) : "";
    if (sessionMcpFingerprints.get(alias) !== mcpFingerprint) {
      sessionMcpConfigs.set(alias, mcpConfig);
      sessionMcpFingerprints.set(alias, mcpFingerprint);
      const { mcpMount } = await openRuntime();
      await mcpMount.adopt(alias, mcpConfig);
    }
    const { handle, registry } = await openRuntime();
    // B2c：本会话带 capa 目录而挂载面还是空壳/旧目录时，按名原位替换。
    refreshSecurityToolsMount(alias, sessionPolicy);
    const { conversation } = await handle.ensureConversation(alias, { agent: { cwd } });
    durableToAlias.set(conversation.id, alias);
    let record = conversations.get(alias);
    if (!record) {
      record = {
        alias,
        durableId: conversation.id,
        repeatGuard: createToolRepeatGuard(),
        projector: makeProjector(alias),
        activeToolNames: [],
        agentTools: [],
        pendingToolCalls: [],
        busy: false,
        inboxItems: [],
        compactionCount: 0,
        maxToolEventOutputBytes: Number(sessionPolicy.maxToolEventOutputBytes ?? 60000),
        model: undefined,
        stream: undefined,
        toolsConfiguring: undefined,
      };
      conversations.set(alias, record);
    } else {
      record.durableId = conversation.id;
      record.maxToolEventOutputBytes = Number(sessionPolicy.maxToolEventOutputBytes ?? 60000);
    }
    const sessionObject = makeSessionObject(alias, handle);
    sessions.set(alias, sessionObject);
    sessionPolicyControllers.set(alias, {
      setActiveTools: names => {
        const current = conversationRecord(alias);
        if (!current) return;
        current.toolsConfiguring = configureAgentTools(alias, names).catch(error => {
          console.error("MilkSU harness agent tools update failed", error);
        });
      },
    });
    try {
      // 配置次序对齐旧 createSession：policy → 模型 → 工具面 → 事件订阅 → ready。
      await wireConversationModel(command);
      const tools = await configureAgentTools(alias, sessionPolicy.activeTools);
      // PR-2 批次 C2：按 durable 真相重建异步路面进程内面——崩溃重开后飞行中的
      // anchor run 恢复 running 行（调度器续跑 anchor，完成时按 toolCallId upsert
      // 终态行），已终态的 run 恢复终态行。无 anchor 的会话为 no-op。
      await adoptSessionAsyncSubagents({
        handle,
        durableConversationId: record.durableId,
        alias,
        childRegistry: subagentAsyncChildRegistry,
        updateSubagentTasks: updateSubagentTasksForSession,
      });
      // PR-2 批次 B2d：按 durable 真相恢复后台任务面（有 anchor 即 resume 续跑，
      // anchor 终态时完成通知原生唤醒本会话）+ 桌面投影重建。
      await adoptSessionBackgroundTasks({
        handle,
        durableConversationId: record.durableId,
        emitTasksChanged: () => emitHarnessBackgroundTasks(alias),
      });
      const agent = await handle.conversationAgent(alias);
      record.agentTools = [...(agent?.tools ?? [])];
      record.stream = await subscribeHarnessEvents(alias);
      const page = await handle.conversationEntries(alias, { limit: 1 });
      const resumed = (page?.items?.length ?? 0) > 0;
      sessionCreateCommands.set(alias, command);
      promptQueues.set(alias, Promise.resolve());
      emit(alias, "ready", {
        workspace: cwd,
        tools: tools.map(tool => tool.name),
        // registry 实际安装的扩展名（B2 起：coding-tools/lsp/skills + core，测试注入
        // 的扩展也会如实上报）。
        extensions: registry.snapshot().installed().map(extension => extension.name),
        extensionErrors: [],
        skills: sessionPolicy.skillNames ?? [],
        executionMode: sessionPolicy.executionMode,
        approvalPolicy: sessionPolicy.approvalPolicy,
        capabilities: sessionPolicy.capabilities,
        resumed,
      });
      await refreshCompositionMessages(alias);
      emitHarnessContextComposition(alias);
      emitHarnessBackgroundTasks(alias);
      // PR-2 批次 B2e：goal 状态按 Conversation Document 真相恢复（B1/B2d 的恒 null
      // 投影收口）：队列冻结判定/queued 激活/预算与上限复查/pendingAction 派发/空闲
      // 续跑重挂，最后按门关同形投影 goal_state（projectGoalStateData 共享纯函数）。
      await goalMachine.adoptSessionGoal(alias, {
        handle,
        durableId: record.durableId,
        isBusy: record.busy === true,
      });
      return sessionObject;
    } catch (error) {
      await cleanupFailedCreate(alias);
      throw error;
    }
  }

  async function cleanupFailedCreate(alias) {
    const record = conversations.get(alias);
    if (record?.stream) {
      await record.stream.stop().catch(() => undefined);
    }
    // PR-2 批次 B2e：创建失败的 goal 进程内面一并清场。
    goalMachine.forgetSessionGoal(record?.durableId);
    if (record?.durableId !== undefined) durableToAlias.delete(record.durableId);
    conversations.delete(alias);
    sessions.delete(alias);
    sessionPolicies.delete(alias);
    sessionPolicyControllers.delete(alias);
    sessionModelSources.delete(alias);
    sessionConfiguredProviders.delete(alias);
    sessionCreateCommands.delete(alias);
    sessionSkillPaths.delete(alias);
    sessionRoles.delete(alias);
    sessionMcpConfigs.delete(alias);
    sessionMcpFingerprints.delete(alias);
    // PR-2 批次 C1：创建失败的清理也收掉子代理 child 登记。
    subagentChildRegistry.forget(alias);
    subagentAsyncChildRegistry.forget(alias);
    try {
      await runtime?.mcpMount?.close(alias);
    } catch {
      // 创建失败的清理不因 MCP 连接收尾失败而中断。
    }
    reasoningOnlyPreviousTools.delete(alias);
    promptQueues.delete(alias);
  }

  // ---------- sendMessage ----------

  async function sendMessage(command) {
    const alias = String(command.conversationId ?? "").trim();
    if (!alias) throw new Error("conversationId is required");
    applyUserMemories(command);
    applyWorkerModelOverride(command.workerModel);
    if (dropSendAfterAbort(abortedSessions, sessions, alias)) {
      emit(alias, "turn_settled");
      return;
    }
    reasoningOnlyRecovered.delete(alias);
    let session = sessions.get(alias);
    if (!session) {
      session = await createSession(command);
    } else {
      // 旧路径对已存在会话每次 send_message 都重载 policy 并重接模型
      //（bridge.js:2518-2553）；durable 会话不重建（这正是 Harness 的意义），只刷新
      // policy/模型/工具面，观测事件对齐 policy_updated。
      const { policy: sessionPolicy, effectiveSessionRole, codingSkillPaths, mcpConfig } = await loadRuntimeSessionPolicy(process.cwd(), command);
      sessionPolicies.set(alias, sessionPolicy);
      // B2d：角色随 policy 刷新重登记（milksu-workflow section 下一回合生效）。
      sessionRoles.set(alias, String(effectiveSessionRole ?? ""));
      sessionSkillPaths.set(alias, Array.isArray(codingSkillPaths) ? codingSkillPaths : []);
      // B2b：MCP 配置指纹变化才重挂（每回合都重载 policy，配置没变不重做发现连接）。
      const mcpFingerprint = mcpConfig ? JSON.stringify(mcpConfig) : "";
      if (sessionMcpFingerprints.get(alias) !== mcpFingerprint) {
        sessionMcpConfigs.set(alias, mcpConfig);
        sessionMcpFingerprints.set(alias, mcpFingerprint);
        const { mcpMount } = await openRuntime();
        await mcpMount.adopt(alias, mcpConfig);
      }
      // B2c：capa 目录指纹变化才原位替换安全工具挂载面。
      refreshSecurityToolsMount(alias, sessionPolicy);
      const controller = sessionPolicyControllers.get(alias);
      if (!controller) {
        throw new Error("MilkSU Coding permission controller is unavailable");
      }
      controller.setActiveTools(sessionPolicy.activeTools);
      await conversationRecord(alias)?.toolsConfiguring;
      await wireConversationModel(command);
      emit(alias, "policy_updated", {
        tools: session.getActiveToolNames(),
        executionMode: sessionPolicy.executionMode,
        approvalPolicy: sessionPolicy.approvalPolicy,
        capabilities: sessionPolicy.capabilities,
      });
      await refreshCompositionMessages(alias);
      emitHarnessContextComposition(alias);
    }
    if (abortedSessions.delete(alias)) {
      try {
        await session.abort();
      } catch {
        // 取消后的 create 也要让桌面 run clock 收尾。
      }
      emit(alias, "turn_settled");
      return;
    }
    // PR-2 批次 B2e：/goal 命令拦截（门关由 AgentSession 的扩展命令面消化，命令不
    // 产生模型回合；门开在这里拦截后同样不投用户原文）。goal 输入由状态机自带
    // requestId 幂等投递。非 /goal 命令照常走下面的 prompt 队列。
    {
      const goalRecord = conversationRecord(alias);
      const { handle } = await openRuntime();
      const goalCommand = await goalMachine.handleGoalCommand(alias, {
        handle,
        durableId: goalRecord?.durableId,
        activeToolNames: [...(goalRecord?.activeToolNames ?? [])],
      }, command.prompt ?? "");
      if (goalCommand?.handled) return;
    }
    const rememberTurn = tracksUserMemory(alias) && !isCompanionRelay(command.prompt);
    enqueueConversationPrompt(promptQueues, alias, async () => {
      if (rememberTurn) noteUserMemory(alias, "begin");
      let settled = false;
      try {
        if (abortedSessions.delete(alias)) {
          try {
            await session.abort();
          } catch {
            // Queued prompt was cancelled before submit.
          }
          return;
        }
        // 手动压缩在途必须先落定（compactionRuns 由手动 RPC 维护）。
        await waitForCompaction(compactionRuns, alias);
        if (command.branchFromUserOccurrence !== undefined) {
          throw new Error(
            "MilkSU harness conversations do not support branching from an earlier message yet (batch D)",
          );
        }
        if (pendingWorkspaceCompaction.has(alias)) {
          pendingWorkspaceCompaction.delete(alias);
          await runManualCompaction(alias);
        }
        const attachmentRoot = environment.MILKSU_CODING_ATTACHMENT_ROOT;
        const prepared = await preparePromptAttachments(
          command.attachments,
          attachmentRoot,
          { uiLocale: command.locale === "en" ? "en" : "zh" },
        );
        const contract = normalizeCodingTurnContract(command.turnPolicy);
        const prompt = `${command.prompt ?? ""}${prepared.context}`;
        const controller = sessionPolicyControllers.get(alias);
        if (contract && !controller) {
          throw new Error("MilkSU Coding permission controller is unavailable");
        }
        const { handle } = await openRuntime();
        await withTurnHeartbeat({ emit, conversationId: alias }, () => withCodingTurnContract({
          contracts: sessionTurnContracts,
          conversationId: alias,
          contract,
          getActiveTools: () => session.getActiveToolNames(),
          setActiveTools: tools => {
            controller?.setActiveTools(tools);
          },
          onApplied: tools => emit(alias, "turn_policy", {
            tools,
            reason: contract?.reason,
          }),
          onRestored: tools => emit(alias, "turn_policy_cleared", {
            tools,
          }),
        }, async () => {
          // 工具面配置提交先于 submit 落盘，避免 run 的 prepare 读到旧 agent。
          await conversationRecord(alias)?.toolsConfiguring;
          const submission = await handle.submitInput(alias, {
            requestId: String(command.requestId ?? "").trim() || randomUUID(),
            content: userContentBlocks(prompt, prepared.images),
          });
          await handle.waitSubmission(submission);
        }));
        if (abortedSessions.has(alias)) return;
        settled = true;
        if (rememberTurn) {
          noteUserMemory(alias, "finish", {
            userText: String(command.prompt ?? ""),
            assistantText: await harnessLastAssistantText(alias),
          });
        }
      } finally {
        if (rememberTurn && !settled) noteUserMemory(alias, "finish", { aborted: true });
      }
    }, (error) => {
      if (abortedSessions.delete(alias)) return;
      emit(alias, "error", { error: describeError(error) });
    });
  }

  async function harnessLastAssistantText(alias) {
    try {
      const { handle } = await openRuntime();
      const page = await handle.conversationEntries(alias, { limit: 20 });
      for (const entry of page?.items ?? []) {
        const message = (entry.model ?? []).find(candidate => candidate?.role === "assistant");
        if (!message) continue;
        const content = message.content;
        if (typeof content === "string") return content.trim();
        if (Array.isArray(content)) {
          return content.map(block => String(block?.text ?? "")).join("").trim();
        }
        return "";
      }
    } catch {
      // 会话刚销毁：按无文本处理。
    }
    return "";
  }

  // ---------- abort / destroy / compact ----------

  async function abortSession(command) {
    const alias = String(command.conversationId ?? "").trim();
    if (!alias) throw new Error("conversationId is required");
    abortedSessions.add(alias);
    approvalBroker.cancelConversation(alias, "turn aborted");
    workspaceActionBroker.cancelConversation(alias, "turn aborted");
    pendingWorkspaceCompaction.delete(alias);
    const session = sessions.get(alias);
    if (!session) {
      emit(alias, "turn_settled");
      return;
    }
    // conversation.abort 撤回排队 input + 中止普通任务（含非 background 的手动压缩
    // 任务），对应旧 session.abort() + abortCompaction() 两个面。
    try {
      await session.abort();
    } catch {
      // 可能刚好空闲。
    }
    if (tracksUserMemory(alias)) {
      noteUserMemory(alias, "finish", { aborted: true });
    }
    emit(alias, "turn_settled");
  }

  async function destroySession(command) {
    const alias = String(command.conversationId ?? "").trim();
    if (!alias) throw new Error("conversationId is required");
    const session = sessions.get(alias);
    const compactionRequestId = compactionRequestIds.get(alias);
    if (compactionRequestId) {
      emit(alias, "compaction_end", {
        requestId: compactionRequestId,
        reason: "manual",
        aborted: true,
        error: "Coding session was destroyed during context compaction",
      });
    }
    approvalBroker.cancelConversation(alias, "session destroyed");
    approvalBroker.clearConversationGrants(alias);
    workspaceActionBroker.cancelConversation(alias, "session destroyed");
    pendingWorkspaceCompaction.delete(alias);
    sessionContextUsage.delete(alias);
    compactionRuns.delete(alias);
    compactionRequestIds.delete(alias);
    sessionTurnContracts.delete(alias);
    reasoningOnlyRecovered.delete(alias);
    reasoningOnlyPreviousTools.delete(alias);
    // PR-2 批次 B2e：goal 进程内面清场（destroyed 标记让迟到的 aborted run_end 不翻
    // 新 durable 真相——pi-goal session_shutdown 语义：active goal 原样保留，重开会话
    // 按 Document 恢复续跑；排队 goal 输入经 abortConversation 撤回，不泄漏续跑）。
    goalMachine.forgetSessionGoal(conversations.get(alias)?.durableId, { destroyed: true });
    await haltConversationSubagents(alias);
    // PR-2 批次 C1：门开路径的子代理停止面——外部 CLI 受管进程树杀 + harness child
    // 显式 abort 兜底（abortConversation 的级联已覆盖普通所有权范围；background
    // 边界的 child 在这里补刀）。上面注入的 haltConversationSubagents 继续负责门关
    // 异步 run 目录的 pid 面（对 harness 任务行无 asyncDir，天然 no-op）。
    try {
      const open = runtime;
      if (open?.subagentHalt) await open.subagentHalt(alias);
    } catch (error) {
      console.error("MilkSU harness subagent halt failed", error);
    }
    // PR-2 批次 C2：异步路面收场——background anchor 不随父会话 abort 级联，这里
    // 显式 abortTask（child 子树自底向上收场后 anchor 终态落盘；对应门关
    // destroySession 杀 async runner 进程的面）。
    try {
      const open = runtime;
      if (open?.subagentAsyncHalt) await open.subagentAsyncHalt(alias);
    } catch (error) {
      console.error("MilkSU harness async subagent halt failed", error);
    }
    subagentCallRecords.clear();
    try {
      await session?.abort();
    } catch {
      // Disposal still proceeds.
    }
    session?.dispose();
    const record = conversations.get(alias);
    if (record?.stream) {
      await record.stream.stop().catch(() => undefined);
    }
    if (record?.durableId !== undefined) durableToAlias.delete(record.durableId);
    conversations.delete(alias);
    sessions.delete(alias);
    sessionPolicies.delete(alias);
    sessionPolicyControllers.delete(alias);
    sessionModelSources.delete(alias);
    sessionConfiguredProviders.delete(alias);
    forgetSessionProviders(alias);
    sessionSubagentTasks.delete(alias);
    researchRunContexts.delete(alias);
    promptQueues.delete(alias);
    abortedSessions.delete(alias);
    sessionCreateCommands.delete(alias);
    sessionSkillPaths.delete(alias);
    sessionRoles.delete(alias);
    sessionMcpConfigs.delete(alias);
    sessionMcpFingerprints.delete(alias);
    // PR-2 批次 C2：终扫子代理注册表——halt 之后才落地的 anchor abort handler 侧效
    //（registry/roster）可能在 halt 的 forget 之后再次登记；sessions 已删，此后
    // isSessionActive=false 侧效自抑制，这里做最终清场。
    subagentChildRegistry.forget(alias);
    subagentAsyncChildRegistry.forget(alias);
    // B2b：收掉本会话的 MCP 连接（lazy 服务器一般已关，这里兜底 idle 窗口内的
    // 常驻连接与清扫定时器）。
    try {
      await runtime?.mcpMount?.close(alias);
    } catch {
      // 会话销毁不因 MCP 清理失败而中断。
    }
    // pi-durable 1.0.0 没有删除 Conversation 的 API：durable 转录保留（deletePersisted
    // 对 Harness 会话无效，见报告）。别名登记保留，重开同 id 会继续同一会话。
    emit(alias, "session_destroyed");
  }

  async function runManualCompaction(alias) {
    const { handle } = await openRuntime();
    const taskId = await handle.compactConversation(alias, compactionInstructions);
    const run = (async () => {
      try {
        await handle.waitTask(taskId);
      } finally {
        // 兜底：事件管线正常会带 requestId 发 compaction_end 并清登记；这里只补事件
        // 缺失（流溢出等）的场景，避免 Supervisor 等待悬挂。
        const pending = compactionRequestIds.get(alias);
        if (pending) {
          compactionRequestIds.delete(alias);
          emit(alias, "compaction_end", {
            requestId: pending,
            reason: "manual",
            aborted: false,
            compaction: {
              tokensBefore: Number(sessionContextUsage.get(alias)?.inputTokens ?? 0),
              estimatedTokensAfter: undefined,
            },
          });
        }
      }
    })();
    await trackCompaction(compactionRuns, alias, run);
  }

  async function compactSessionCommand(command) {
    const alias = String(command.conversationId ?? "").trim();
    const requestId = String(command.requestId ?? "").trim();
    try {
      if (!alias) throw new Error("conversationId is required");
      if (!requestId) throw new Error("requestId is required");
      if (compactionRuns.has(alias)) {
        throw new Error("Coding session is already compacting");
      }
      const session = sessions.get(alias);
      if (!session || session.kind !== MILKSU_HARNESS_SESSION_KIND) {
        throw new Error(`Coding session not found: ${alias}`);
      }
      if (!sessionPolicies.get(alias)) {
        throw new Error(`Coding session is not ready: ${alias}`);
      }
      compactionRequestIds.set(alias, requestId);
      await runManualCompaction(alias);
    } catch (error) {
      if (compactionRequestIds.get(alias) === requestId) {
        compactionRequestIds.delete(alias);
      }
      emit(alias || null, "compaction_end", {
        requestId,
        reason: "manual",
        aborted: false,
        error: describeError(error),
      });
    }
  }

  // ---------- dispose ----------

  async function disposeAll() {
    for (const record of [...conversations.values()]) {
      if (record.stream) {
        await record.stream.stop().catch(() => undefined);
      }
    }
    conversations.clear();
    durableToAlias.clear();
    sessionSkillPaths.clear();
    sessionMcpConfigs.clear();
    sessionMcpFingerprints.clear();
    reasoningOnlyPreviousTools.clear();
    const open = runtime;
    runtime = undefined;
    runtimeOpening = undefined;
    if (open) {
      // B2b：先收 MCP 子进程与定时器，再关 Harness（handle.close 会落盘）。
      if (open.mcpMount) {
        await open.mcpMount.dispose().catch(() => undefined);
      }
      await open.handle.close();
    }
  }

  function isHarnessConversation(conversationId) {
    return sessions.get(String(conversationId ?? "").trim())?.kind === MILKSU_HARNESS_SESSION_KIND;
  }

  // ---------- decision_query（B1 遗留接线：bridge.js handleDecisionQuery 的门开分支） ----------

  /**
   * PR-2 批次 B2d：桌面后台任务控制（bridge.js controlBackgroundTask:3145 的门开
   * 分支）。list/stop 读写 bg anchor 的 durable 真相 + 磁盘 meta 投影；spawn 直接建
   * anchor（callback:false——门关桌面 spawn 同款，用户在面板看输出，不打扰模型回合），
   * 不再走 backgroundTaskControllers 的 pi 扩展回退面。事件形状与门关
   * background_task_controlled 一致（requestId/tasks/error）。
   */
  async function controlBackgroundTask(command) {
    const alias = String(command.conversationId ?? "").trim();
    const requestId = String(command.requestId ?? "").trim();
    const controlled = (extra = {}) => {
      emit(alias || null, "background_task_controlled", {
        requestId,
        tasks: projectedTasksFor(alias),
        ...extra,
      });
    };
    const projectedTasksFor = (id) => {
      try {
        return redactResearchText(projectBackgroundTaskMetas(
          backgroundTaskMetasForSession(listPiBackgroundTaskMetas(), id),
          Date.now(),
          readPiBackgroundTaskLog,
        ), environment, sessionProviderSecrets(id));
      } catch {
        return [];
      }
    };
    try {
      if (!alias) throw new Error("conversationId is required");
      if (!requestId) throw new Error("requestId is required");
      const control = String(command.control ?? "").trim();
      if (control === "list") {
        controlled();
        return;
      }
      if (control === "spawn") {
        const commandText = String(command.command ?? "").trim();
        if (!commandText) throw new Error("terminal command is required");
        if (commandText.includes("\u0000")) {
          throw new Error("terminal command contains an invalid null byte");
        }
        if (commandText.length > 16_000) {
          throw new Error("terminal command must be at most 16000 characters");
        }
        const policy = sessionPolicies.get(alias);
        if (
          !policy
          || policy.executionMode !== "go"
          || policy.approvalPolicy === "read-only"
        ) {
          throw new Error(
            `MilkSU Coding policy blocked terminal command: `
            + `${policy?.executionMode ?? "unknown"}/${policy?.approvalPolicy ?? "unknown"}`,
          );
        }
        const record = conversations.get(alias);
        if (!record?.durableId) {
          throw new Error(`Coding session is not ready: ${alias}`);
        }
        const { handle } = await openRuntime();
        await spawnHarnessBackgroundTask({
          handle,
          durableConversationId: record.durableId,
          alias,
          commandText,
          name: command.name,
          cwd: policy.workspace,
          environment,
        });
        controlled();
        return;
      }
      if (control !== "stop") {
        throw new Error(`unsupported background task control: ${control}`);
      }
      const taskId = String(command.taskId ?? "").trim();
      if (!/^bg_[a-z0-9_]+$/i.test(taskId)) {
        throw new Error("invalid background task id");
      }
      const record = conversations.get(alias);
      if (!record?.durableId) {
        throw new Error(`background task not found: ${taskId}`);
      }
      const { handle } = await openRuntime();
      await stopHarnessBackgroundTaskById({
        handle,
        durableConversationId: record.durableId,
        taskId,
        environment,
      });
      emitHarnessBackgroundTasks(alias);
      controlled();
    } catch (error) {
      emit(alias || null, "background_task_controlled", {
        requestId,
        error: describeError(error),
        tasks: projectedTasksFor(alias),
      });
    }
  }

  /**
   * 决策层主模型兜底（decision/query.js answerDecisionQuery）的门开实现：门关走
   * session.modelRuntime.completeSimple（pi-coding-agent ModelRuntime），门开用同一
   * 个 pi-ai Models 集合的 completeSimple（Q8 的 Models 面）+ 会话已解析的模型对象。
   * 回答原样 decision_answer，模型未接线时与门关一样回显式 error。
   */
  async function decisionQuery(command) {
    const alias = String(command?.conversationId ?? "").trim();
    const record = conversations.get(alias);
    const piModel = record?.piModel;
    const complete = piModel
      ? async context => {
        const { models } = await openRuntime();
        return models.models.completeSimple(piModel, context, { reasoning: "low" });
      }
      : undefined;
    await answerDecisionQuery(command, {
      emitEvent: (type, data) => emit(alias || null, type, data),
      complete,
      // bridge.js 的 messageText（bridge-session-tree.js）是同一形状的纯函数；
      // 这里不 import SessionManager 一族，就地实现。
      readText: message => {
        const content = message?.content;
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) return "";
        return content
          .filter(block => block?.type === "text")
          .map(block => String(block.text ?? ""))
          .join("");
      },
    });
  }

  return {
    createSession,
    sendMessage,
    abortSession,
    destroySession,
    compactSessionCommand,
    controlBackgroundTask,
    disposeAll,
    isHarnessConversation,
    decisionQuery,
    // 诊断/测试面。
    heartbeatState: () => runtime?.handle.heartbeatState(),
    lockState: () => runtime?.handle.lockState(),
    /** C1：子代理 child 登记快照（控制动作/halt 的同一份进程内状态）。 */
    subagentChildren: alias => subagentChildRegistry.list(alias),
    /** C2：异步路面 child 登记快照（anchor 级联 halt 的进程内状态；durable 真相
     *  以 anchor 任务记录为准，此处为 roster/halt 优化面）。 */
    subagentAsyncChildren: alias => subagentAsyncChildRegistry.list(alias),
    /** C1/C2：适配层 handle（子会话转录/视图的原始观察面）。 */
    async harnessHandle() {
      const open = await openRuntime();
      return open.handle;
    },
    async conversationAgent(alias) {
      const open = await openRuntime();
      return open.handle.conversationAgent(alias);
    },
    async conversationEntries(alias, options = {}) {
      const open = await openRuntime();
      return open.handle.conversationEntries(alias, options);
    },
  };
}
