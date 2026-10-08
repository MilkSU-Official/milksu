// PR-2 批次 B1：审批判定链移植到 pi-durable 的 hook(ToolTask, {beforeTool})。
//
// 源头是 bridge.js createCodingPermissionExtension 的 pi.on("tool_call") 判定链
// （bridge.js:945-1218）+ bridge-hang-guard 的 bash 超时注入 + pi.on("context") 的
// 消息过滤/用户记忆注入（→ hook(GenerationTask, {beforeRequest})）。本文件只做移植，
// 不改门关路径的任何字节：两条链并存，靠 MILKSU_PI_HARNESS 门各走各的。
//
// 形状映射（旧 → 新）：
//   event.toolName / event.input / event.toolCallId → call.name / call.arguments / call.id
//   返回 {block: true, reason}            → {block: reason}（pi-durable ToolHooks）
//   返回 {block: true, terminate, reason} → {block: reason + 终止提示}（见下）
//   改 event.input 原地写                 → 返回 {arguments: {...}}（钩子后会再过 schema 校验）
//
// 语义缺口（PREP §3.4 缺口 1，DECISIONS Q3）：旧 terminate:true（repeat 刹车 block 时
// 建议整批停，pi-agent-core agent-loop.js:466 every(result.terminate) 后不再请求模型）
// 在 beforeTool 没有对应物——pi-durable 只有**结果侧** control.terminate（tool.js 的
// afterTool/finalResult 路径），而 beforeTool block 的调用走 tool.js call 相位的
// settle(harnessError("blocked")) 直落盘，不经 finalResult/afterTool，所以无法给被拦
// 调用挂 control。用 conversation.abort 模拟则会在钩子内自锁（abort join 活跃调用
// 相位）且把 run inputs 落成 unanswered(aborted) 并撤回 inbox，比旧行为更破坏性。
// 故本移植**接受行为变化**：repeat 刹车只 block 本调用；block 文本追加明确的停止
// 指引，让模型在下一轮读到错误结果后收尾。桌面侧不再收到「整批已停」的隐式保证。
//
// repeat guard 重置语义差异：旧链在 before_agent_start（每个 agent run 一次）里
// reset；beforeRequest 每次请求尝试都触发（含恢复/重试），在那里 reset 会把 run 内
// 多轮工具的重复历史抹掉（10 次同命令熔断永远不触发）。所以 reset 挪到事件管线的
// run_start（每个 run 一次，等价于「每个用户提示一次」），beforeRequest 只做消息
// 过滤与用户记忆注入（旧 context 事件本来就是每次请求触发，粒度一致）。
//
// 改参点核对（钩子改参后会再过 schema 校验，比旧的「原地改完不再验」更严）：
// 现有改参点只有 bridge-hang-guard 的 bash timeout 注入/收敛（applyBashTimeout 只写
// 正整数秒，bash schema 是 TOptional(TNumber)，schema-clean）。bridge.js:945-1218 的
// 判定链本身不改参。经逐点核对，无既有改参点会被钩子的二次校验拒绝。

import {
  codingTurnContractBlocksTool,
  filterCodingTurnContractMessages,
} from "./bridge-turn-contract.js";
import { withUserMemoryMessages, tracksUserMemory } from "./user-memory.js";
import {
  commandForTool,
  destructiveDeleteDecision,
  destructiveJustification,
  issueDestructiveDeleteCredential,
  recursiveDeleteTargets,
} from "./bridge-destructive-delete.js";
import {
  codingMcpOperationRequiresApproval,
  mcpConversationGrantKey,
  subagentCallRequiresApproval,
} from "./bridge-auto-approval.js";
import { authorizeImageGenToolCall } from "./bridge-imagegen.js";
import { codingCollaborationToolName, formatSubagentApproval, validateSubagentInput } from "./bridge-collaboration.js";
import {
  expandHarnessSubagentAsyncToolNames,
  MILKSU_SUBAGENT_ASYNC_TOOL_NAMES,
} from "./harness-bridge-subagents-async.js";
import {
  browserUseMcpServerName,
  codingBrowserEvidenceFileBlockReason,
  codingBrowserMcpServerName,
  codingBrowserToolBlockReason,
  researchBrowserToolBlockReason,
} from "./bridge-browser-policy.js";
import { codingWorkspaceToolName, formatCodingWorkspaceInput } from "./bridge-workspace.js";
import { redactResearchText } from "./bridge-subagent-yield.js";
import { applyBashTimeout } from "./bridge-hang-guard.js";
import { toolBudgetPrompt, toolBudgetToolName } from "./bridge-tool-repeat.js";

// bridge.js:287 的白名单拷贝（原文件不能动字节；纯集合无状态，复制并注明出处）。
const approvalRequiredCodingTools = new Set(["bash", "edit", "write"]);
// bridge.js:721-730 的后台任务效果判定拷贝（同上）。
const backgroundEffectfulActions = new Set(["spawn", "watch", "stop", "clear"]);
// PR-2 批次 C2：异步子代理路面的工具名与挂载扩展（纯常量/纯函数导入——扩展
// 构造器仍不进判定链；门开在 policy 含 subagent 时经 expandHarnessSubagentAsyncToolNames
// 把这四件并入挂载面，审判链的白名单/审批对它们同判）。
const harnessSubagentAsyncToolNames = new Set(MILKSU_SUBAGENT_ASYNC_TOOL_NAMES);

function backgroundToolAction(toolName, input) {
  if (toolName !== "bg_task" && toolName !== "bg_status") return "";
  return String(input?.action ?? "").trim();
}

function backgroundToolRequiresApproval(toolName, input) {
  return backgroundEffectfulActions.has(backgroundToolAction(toolName, input));
}

function truncateValue(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

// repeat 刹车 block 时追加的停止指引（terminate 缺口的缓解，见文件头）。
const repeatStopSuffix = "请停止重试同一调用，直接总结当前进展并给出最终答复。";

/**
 * 构造 beforeTool 判定链。context 由 harness-bridge-session 提供：
 *   resolveConversation(durableConversationId) → MilkSU conversationId（别名）
 *   getPolicy(conversationId) / getTurnContract(conversationId)
 *   getUserMemories() / providerSecrets(conversationId)
 *   emit(conversationId, type, data)
 *   approvalBroker（原样复用 bridge-approval.js：pending map + grantKey 缓存）
 *   formatToolInput / formatMcpApprovalInput / selectedMcpServer（bridge.js 同名函数）
 *   hasActiveResearchRun / activeResearchRunContext / researchSubagentBlockReason
 *   repeatGuardFor(conversationId) → createToolRepeatGuard()（run_start 时 reset）
 *   bashTimeoutConfig() → hang-guard 的默认/上限秒数（环境可覆盖）
 */
export function createHarnessBeforeToolJudge(context) {
  const {
    resolveConversation,
    getPolicy,
    getTurnContract,
    getUserMemories,
    providerSecrets,
    emit,
    approvalBroker,
    formatToolInput,
    formatMcpApprovalInput,
    selectedMcpServer,
    hasActiveResearchRun,
    activeResearchRunContext,
    researchSubagentBlockReason,
    repeatGuardFor,
    bashTimeoutConfig,
    environment = process.env,
  } = context;

  return async function beforeTool(call, api) {
    const conversationId = resolveConversation(api.conversationId);
    const event = {
      toolName: String(call?.name ?? ""),
      input: call?.arguments,
      toolCallId: String(call?.id ?? ""),
    };
    const policy = getPolicy(conversationId);
    if (!policy) return undefined;

    // bridge.js:948-953 —— turn contract 无工具 → block。
    if (codingTurnContractBlocksTool(getTurnContract(conversationId))) {
      return {
        block: "MilkSU blocked Agent tools for this explicitly no-tools turn",
      };
    }
    // bridge.js:954-960 —— activeTools 白名单 → block。C2：门开的异步路面四件经
    // expandHarnessSubagentAsyncToolNames 并入挂载面（policy.activeTools 的门关
    // 派生面不含它们），白名单按同一扩展判定。
    if (!expandHarnessSubagentAsyncToolNames(policy.activeTools).includes(event.toolName)) {
      return {
        block: `MilkSU Coding policy blocked ${event.toolName}: `
        + `${policy.executionMode}/${policy.approvalPolicy}`,
      };
    }
    // bridge.js:961-1024 —— 破坏性删除：判定 block / 审批 + 一次性凭据。
    let destructiveDeleteApproved = false;
    const deleteDecision = await destructiveDeleteDecision({
      toolName: event.toolName,
      input: event.input,
      policy,
    });
    if (deleteDecision?.action === "block") {
      emit(conversationId, "destructive.blocked", { notice: deleteDecision.reason });
      return { block: deleteDecision.reason };
    }
    if (deleteDecision?.action === "approval") {
      const chinese = policy?.uiLocale !== "en";
      // 后台任务弹不了卡（B1 未挂载 bg 工具，保留判定以防 B2 挂载后漂移）。
      if (event.toolName === "bg_task") {
        const blockReason = chinese
          ? "后台任务无法弹出确认。请在前台执行这条删除，以便确认。"
          : "MilkSU refused this deletion: a background task cannot be approved "
            + "interactively. Run it in the foreground so it can be reviewed.";
        emit(conversationId, "destructive.blocked", { notice: blockReason });
        return { block: blockReason };
      }
      const justification = destructiveJustification(event.input);
      const approved = await approvalBroker.request({
        conversationId,
        toolName: "destructive-delete",
        content: deleteDecision.content,
        input: truncateValue(deleteDecision.input, 16000),
        justification: justification.ok
          ? {
              purpose: justification.purpose,
              safety: justification.safety,
            }
          : {
              purpose: chinese ? "删除需要确认" : "Deletion requires confirmation",
              safety: deleteDecision.reason
                || (chinese
                  ? "运行前无法完整核验影响范围，由你确认后才会执行。"
                  : "Impact could not be fully checked before running. Confirm to run it."),
            },
      });
      if (!approved) {
        return { block: "MilkSU user denied broad recursive deletion" };
      }
      destructiveDeleteApproved = true;
      // 审批在这里花掉：恰好授权这条命令对这批目标、本会话、一次。
      const approvedCommand = commandForTool(event.toolName, event.input);
      issueDestructiveDeleteCredential({
        command: approvedCommand,
        conversationId,
        targets: recursiveDeleteTargets(approvedCommand),
      });
    }
    // bridge.js:1025-1057 —— MCP 浏览器/研究隔离 block 面。
    if (event.toolName === "mcp") {
      const serverName = selectedMcpServer(policy, event.input);
      const researchActive = hasActiveResearchRun(conversationId);
      if (researchActive && serverName !== codingBrowserMcpServerName) {
        return {
          block: "Deep Research uses Pi web tools and this conversation's managed Browser, not other MCP servers.",
        };
      }
      const researchBrowserBlockReason = researchBrowserToolBlockReason(
        event.input,
        serverName,
        researchActive,
        activeResearchRunContext(conversationId)?.browserTabId,
      );
      const browserBlockReason = codingBrowserToolBlockReason(
        event.input,
        serverName,
      );
      const evidenceBlockReason = codingBrowserEvidenceFileBlockReason(
        event.input,
        serverName,
        serverName === browserUseMcpServerName
          ? policy.browserUse?.sessionId
          : policy.codingBrowser?.sessionId,
      );
      if (researchBrowserBlockReason || browserBlockReason || evidenceBlockReason) {
        return {
          block: researchBrowserBlockReason || browserBlockReason || evidenceBlockReason,
        };
      }
    }
    // bridge.js:1058-1064 —— ImageGen 逐次审批。
    const imageGenDecision = await authorizeImageGenToolCall({
      conversationId,
      event,
      approvalBroker,
      authorizedByDraw: policy.imageDraw === true,
    });
    if (imageGenDecision) return { block: imageGenDecision.reason };
    // bridge.js:1065-1116 —— 子代理协作：校验 + 研究隔离 + 逐次审批。
    if (event.toolName === codingCollaborationToolName) {
      let subagentRequest;
      try {
        subagentRequest = validateSubagentInput(
          event.input,
          policy.codingCollaboration,
          policy.workspace,
        );
      } catch (error) {
        return {
          block: error instanceof Error ? error.message : String(error),
        };
      }
      const researchBlockReason = researchSubagentBlockReason(
        conversationId,
        event.input,
        event.toolCallId,
      );
      if (researchBlockReason) {
        return { block: researchBlockReason };
      }
      if (
        subagentCallRequiresApproval(
          subagentRequest.externalCli,
          policy.approvalPolicy,
        )
      ) {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: codingCollaborationToolName,
          content: redactResearchText(formatSubagentApproval(
            event.input,
            policy.codingCollaboration,
            policy.workspace,
          ), environment, providerSecrets(conversationId)),
          input: truncateValue(JSON.stringify(redactResearchText(
            event.input ?? {},
            environment,
            providerSecrets(conversationId),
          ), null, 2), 16000),
          grantKey: codingCollaborationToolName,
        });
        if (!approved) {
          return { block: "MilkSU user denied subagent delegation" };
        }
      }
    }
    // PR-2 批次 C2 —— 异步子代理路面（subagent_async 四件）：与 C1 的 subagent 分支
    // 同一套门关判定语义——校验（spawn 形状走 validateSubagentInput 共享契约；外部
    // CLI 角色直拒指路 C1 工具，不弹无谓审批）+ 研究隔离 + ask 档逐次审批
    //（grantKey 共用 subagent：门关单工具单 grant 的会话档复用语义）。
    if (harnessSubagentAsyncToolNames.has(event.toolName)) {
      const isSpawn = event.toolName === "subagent_async";
      if (isSpawn) {
        let asyncRequest;
        try {
          asyncRequest = validateSubagentInput(
            event.input,
            policy.codingCollaboration,
            policy.workspace,
          );
        } catch (error) {
          return {
            block: error instanceof Error ? error.message : String(error),
          };
        }
        if (asyncRequest.externalCli) {
          return {
            block: "MilkSU runs external CLI agents through the subagent tool (foreground); subagent_async spawns harness child conversations only",
          };
        }
      }
      const researchBlockReason = researchSubagentBlockReason(
        conversationId,
        // 控制三件按等价 action 形状过研究隔离（research 只放行 list/status/get）。
        isSpawn ? event.input : { action: event.toolName === "subagent_async_status" ? "status" : "steer" },
        event.toolCallId,
      );
      if (researchBlockReason) {
        return { block: researchBlockReason };
      }
      if (
        subagentCallRequiresApproval(
          false,
          policy.approvalPolicy,
        )
      ) {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: event.toolName,
          content: redactResearchText(
            isSpawn
              ? formatSubagentApproval(
                event.input,
                policy.codingCollaboration,
                policy.workspace,
              )
              : `${event.toolName} · ${String(event.input?.id ?? "").trim()}`,
            environment,
            providerSecrets(conversationId),
          ),
          input: truncateValue(JSON.stringify(redactResearchText(
            event.input ?? {},
            environment,
            providerSecrets(conversationId),
          ), null, 2), 16000),
          grantKey: codingCollaborationToolName,
        });
        if (!approved) {
          return { block: "MilkSU user denied subagent delegation" };
        }
      }
    }
    // bridge.js:1117-1132 —— 后台效果面按模式 block。
    const backgroundEffect = backgroundToolRequiresApproval(event.toolName, event.input);
    if (
      backgroundEffect
      && (
        policy.executionMode !== "go"
        || policy.approvalPolicy === "read-only"
      )
    ) {
      return {
        block: `MilkSU Coding policy blocked ${event.toolName}/${backgroundToolAction(
          event.toolName,
          event.input,
        )}: ${policy.executionMode}/${policy.approvalPolicy}`,
      };
    }
    // bridge.js:1133-1167 —— ask 策略逐次审批（bash/edit/write/后台效果）。
    if (
      policy.approvalPolicy === "ask"
      && !destructiveDeleteApproved
      && (
        approvalRequiredCodingTools.has(event.toolName)
        || backgroundEffect
      )
    ) {
      const approved = await approvalBroker.request({
        conversationId,
        toolName: event.toolName,
        content: redactResearchText(formatToolInput(
          event.toolName,
          event.input,
          providerSecrets(conversationId),
        ), environment, providerSecrets(conversationId)),
        input: event.toolName === codingWorkspaceToolName
          ? formatCodingWorkspaceInput(event.input, {
            environment,
            secrets: providerSecrets(conversationId),
          })
          : truncateValue(JSON.stringify(redactResearchText(
            event.input ?? {},
            environment,
            providerSecrets(conversationId),
          ), null, 2), 16000),
        grantKey: event.toolName,
      });
      if (!approved) {
        return { block: `MilkSU user denied ${event.toolName}` };
      }
    }
    // bridge.js:1168-1198 —— MCP 操作逐次审批。
    if (
      event.toolName === "mcp"
      && codingMcpOperationRequiresApproval(
        event.input,
        policy.approvalPolicy,
        selectedMcpServer(policy, event.input),
      )
    ) {
      const serverName = selectedMcpServer(policy, event.input);
      const approved = await approvalBroker.request({
        conversationId,
        toolName: `mcp:${serverName}`,
        content: redactResearchText(
          formatMcpApprovalInput(event.input, serverName),
          environment,
          providerSecrets(conversationId),
        ),
        input: truncateValue(JSON.stringify(redactResearchText(
          event.input ?? {},
          environment,
          providerSecrets(conversationId),
        ), null, 2), 16000),
        grantKey: mcpConversationGrantKey(event.input, serverName),
      });
      if (!approved) {
        return { block: `MilkSU user denied MCP server ${serverName}` };
      }
    }
    // bridge.js:1199-1217 —— 重复调用熔断（ask / block）。
    const repeatGuard = repeatGuardFor(conversationId);
    const repeat = repeatGuard?.inspect(event.toolName, event.input);
    if (repeat?.ask) {
      const approved = await approvalBroker.request({
        conversationId,
        toolName: toolBudgetToolName,
        content: toolBudgetPrompt(repeat.count),
        input: String(repeat.count),
      });
      if (!approved) {
        return { block: `${repeat.reason}${repeatStopSuffix}` };
      }
      return undefined;
    }
    if (repeat) return { block: `${repeat.reason}${repeatStopSuffix}` };
    // bridge-hang-guard.js:69-83 —— bash 默认超时注入/收敛（唯一改参点，schema-clean：
    // 只写正整数秒，bash schema timeout 是 TOptional(TNumber)）。
    if (event.toolName === "bash" && event.input && typeof event.input === "object") {
      const next = { ...event.input };
      if (applyBashTimeout(next, bashTimeoutConfig()) !== undefined) {
        return { arguments: next };
      }
    }
    return undefined;
  };
}

/**
 * beforeRequest 移植（旧 pi.on("context")）：turn contract 消息过滤 + 用户记忆注入。
 * 旧 context 事件与 beforeRequest 都是每次请求触发，粒度一致；repeat guard 的 reset
 * 不在这里（见文件头）。
 */
export function createHarnessBeforeRequestFilter(context) {
  const {
    resolveConversation,
    getPolicy,
    getTurnContract,
    getUserMemories,
  } = context;
  return async function beforeRequest(request, api) {
    const conversationId = resolveConversation(api.conversationId);
    const contracted = filterCodingTurnContractMessages(
      request?.messages,
      getTurnContract(conversationId),
    );
    const memories = tracksUserMemory(conversationId) && typeof getUserMemories === "function"
      ? getUserMemories()
      : [];
    const messages = withUserMemoryMessages(contracted, memories, {
      locale: getPolicy(conversationId)?.uiLocale,
    });
    if (
      messages.length === contracted.length
      && messages.every((message, index) => message === contracted[index])
    ) {
      return undefined;
    }
    return { messages };
  };
}
