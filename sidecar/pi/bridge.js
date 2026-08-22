import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { resolveModelContextWindow } from "./known-context-window.cjs";
import piGoalExtension from "@narumitw/pi-goal/src/index.ts";
import piLspExtension from "@narumitw/pi-lsp/src/index.ts";
import piBackgroundTasksExtension from "pi-better-background-tasks/src/index.ts";
import { readLog as readPiBackgroundTaskLog } from "pi-better-background-tasks/src/logs.ts";
import { listMetas as listPiBackgroundTaskMetas } from "pi-better-background-tasks/src/registry.ts";
import {
  spawnTask as spawnPiBackgroundTask,
  stopTask as stopPiBackgroundTask,
} from "pi-better-background-tasks/src/runtime.ts";
import { createMcpAdapter } from "pi-mcp-adapter";
import piSubAgentExtension from "pi-sub-agent/extensions/index.ts";
import { dropSendAfterAbort } from "./bridge-abort.js";
import {
  codingSessionToolNames,
  loadSessionPolicy,
  normalizeCodingProductAction,
} from "./bridge-policy.js";
import { createApprovalBroker } from "./bridge-approval.js";
import {
  codingCollaborationRequiresApproval,
  codingMcpOperationRequiresApproval,
  mcpConversationGrantKey,
  resolveCodingMcpServer,
} from "./bridge-auto-approval.js";
import { createReviewedLspExtension } from "./bridge-lsp.js";
import {
  applyCodingResourcePolicy,
  describeLoadedExtensions,
} from "./bridge-resource-policy.js";
import { preparePromptAttachments } from "./bridge-attachments.js";
import {
  analyzeTextOnlyImages,
  analyzeTextOnlyToolImages,
} from "./bridge-vision.js";
import {
  backgroundTaskMetasForSession,
  projectBackgroundTaskMetas,
} from "./bridge-background-view.js";
import {
  goalKeepsSessionRunning,
  projectSessionGoal,
} from "./bridge-goal-view.js";
import {
  browserUseMcpServerName,
  browserUseSelectionChanged,
  codingBrowserSelectionChanged,
  computerUseSelectionChanged,
  ensureMcpMetadataCache,
  loadCodingMcpConfig,
  mcpSelectionChanged,
  projectMcpServersFromSelection,
} from "./bridge-mcp.js";
import {
  createSecurityToolsExtension,
  normalizeSecurityTools,
  securityToolSelectionChanged,
} from "./bridge-security-tools.js";
import {
  codingBrowserEvidenceFileBlockReason,
  codingBrowserEvidenceRelativePath,
  codingBrowserGuidance,
  codingBrowserToolBlockReason,
  formatCodingBrowserApprovalInput,
} from "./bridge-browser-policy.js";
import {
  computerUseRoutingGuidance,
  isComputerUseMcpToolName,
} from "./bridge-computer-use-routing.js";
import { disposeAgentSession } from "./bridge-session-lifecycle.js";
import { createCTFTruncationContinuationExtension } from "./bridge-ctf-continuation.js";
import {
  compactSession,
  contextUsageSnapshot,
  projectCompactionEvent,
  trackCompaction,
  waitForCompaction,
} from "./bridge-compaction.js";
import {
  codingTurnContractBlocksTool,
  codingTurnContractContext,
  codingTurnContractGuidance,
  codingTurnContractMessageType,
  filterCodingTurnContractMessages,
  normalizeCodingTurnContract,
  withCodingTurnContract,
} from "./bridge-turn-contract.js";
import {
  codingCollaborationChanged,
  codingCollaborationToolName,
  formatSubagentApproval,
  normalizeCodingCollaboration,
  validateSubagentInput,
  codingSubagentGuidance,
} from "./bridge-collaboration.js";
import {
  authorizeImageGenToolCall,
  codingImageGenToolName,
} from "./bridge-imagegen.js";
import {
  codingWorkspaceGuidance,
  researchReportGuidance,
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  createWorkspaceActionBroker,
  formatCodingWorkspaceInput,
  queueWorkspaceCompaction,
} from "./bridge-workspace.js";
import { createComputerUseDriverExtension } from "./bridge-computer-use-driver.js";
import { reviewedCodingSkillPaths } from "./bridge-skills.js";
import {
  projectSteeringQueue,
  removeQueuedMessage,
  steerSession,
} from "./bridge-steering.js";
import { runtimeEnvironmentGuidance } from "./bridge-runtime-environment.js";
import {
  destructiveDeleteDecision,
} from "./bridge-destructive-delete.js";
import piWebResearchExtension from "./bridge-web-research.js";
import currentProviderRuntime from "./current-provider-runtime.cjs";
import {
  createModelSourceRouteProvider,
  normalizeModelSourceOrder,
} from "./model-source-routing.js";
import { projectAssistantMessageEnd } from "./bridge-message-view.js";
import {
  projectAssistantUsage,
  projectToolModelUsage,
} from "./bridge-usage-view.js";
import { withTokenFluxModelCompat } from "./tokenflux-model-compat.js";

const {
  currentProviderDefinition,
  tokenfluxAccountModelAvailability,
  tokenfluxModelIDForProvider,
} = currentProviderRuntime;

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://tokenflux.dev/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);
const configuredModelSourceOrder = normalizeModelSourceOrder(
  process.env.MILKSU_MODEL_SOURCE_ORDER,
);
const modelSourceFallbackEnabled = process.env.MILKSU_MODEL_SOURCE_FALLBACK === "1";

const sessions = new Map();
const sessionPolicies = new Map();
const sessionPolicyControllers = new Map();
const backgroundTaskControllers = new Map();
const promptQueues = new Map();
const compactionRuns = new Map();
const compactionRequestIds = new Map();
const suppressedQueueUpdates = new Set();
const sessionTurnContracts = new Map();
const sessionModelSources = new Map();
const sessionConfiguredProviders = new Map();
const abortedSessions = new Set();
const input = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();
let steeringCommandQueue = Promise.resolve();
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarResourceDirectory = existsSync(join(bridgeDirectory, "skills"))
  ? bridgeDirectory
  : resolve(bridgeDirectory, "..", "..");
const approvalRequiredCodingTools = new Set(["bash", "edit", "write"]);
function emit(conversationId, type, data = {}) {
  process.stdout.write(`${JSON.stringify({ type, id: conversationId ?? null, ...data })}\n`);
}

function emitBackgroundTasks(conversationId) {
  try {
    emit(conversationId, "background_tasks", {
      tasks: projectedBackgroundTasks(conversationId),
    });
  } catch (error) {
    console.error("MilkSU could not read Pi background task state", error);
    emit(conversationId, "background_tasks", {
      tasks: [],
      error: describeError(error),
    });
  }
}

function projectedBackgroundTasks(conversationId) {
  return projectBackgroundTaskMetas(
    backgroundTaskMetasForSession(
      listPiBackgroundTaskMetas(),
      conversationId,
    ),
    Date.now(),
    readPiBackgroundTaskLog,
  );
}

function createReviewedBackgroundTasksExtension(conversationId) {
  return (pi) => {
    backgroundTaskControllers.set(conversationId, pi);
    pi.on("session_shutdown", () => {
      if (backgroundTaskControllers.get(conversationId) === pi) {
        backgroundTaskControllers.delete(conversationId);
      }
    });
    piBackgroundTasksExtension(pi);
  };
}

function emitGoalState(conversationId, session) {
  const goal = projectSessionGoal(session?.sessionManager);
  emit(conversationId, "goal_state", {
    goal,
  });
  return goal;
}

const approvalBroker = createApprovalBroker(emit);
const workspaceActionBroker = createWorkspaceActionBroker(emit);
const pendingWorkspaceCompaction = new Set();
const sessionContextUsage = new Map();
const backgroundEffectfulActions = new Set(["spawn", "watch", "stop", "clear"]);

function backgroundToolAction(toolName, input) {
  if (toolName !== "bg_task" && toolName !== "bg_status") return "";
  return String(input?.action ?? "").trim();
}

function backgroundToolRequiresApproval(toolName, input) {
  return backgroundEffectfulActions.has(backgroundToolAction(toolName, input));
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const resource = error.resource ? `\nresource: ${error.resource}` : "";
  return `${error.stack || error.message}${resource}`;
}

function extractToolResultContent(result) {
  if (typeof result === "string") return result;
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function isComputerUseMcpResult(event) {
  if (event?.toolName !== "mcp") return false;
  const inputServer = String(event.input?.server ?? event.input?.connect ?? "").trim();
  const inputTool = String(event.input?.tool ?? "").trim();
  const detailServer = String(event.details?.server ?? "").trim();
  const detailTool = String(event.details?.tool ?? "").trim();
  return (inputServer === "milksu-computer-use" || detailServer === "milksu-computer-use")
    && (isComputerUseMcpToolName(inputTool) || isComputerUseMcpToolName(detailTool));
}

async function summarizeComputerUseToolImages(event, session) {
  if (!isComputerUseMcpResult(event)) return undefined;
  if (Array.isArray(session.model?.input) && session.model.input.includes("image")) {
    return undefined;
  }
  const images = Array.isArray(event.content)
    ? event.content.filter(block => block?.type === "image")
    : [];
  if (!images.length) return undefined;
  const analyzed = await analyzeTextOnlyToolImages(images, {
    label: "Computer Use tool result",
  });
  if (!analyzed.context) return undefined;
  return {
    content: [
      ...event.content,
      { type: "text", text: analyzed.context },
    ],
  };
}

function truncate(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

function createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession) {
  return (pi) => {
    let latestPlan = [];
    pi.registerTool({
      name: "milksu_progress",
      label: "MilkSU progress",
      description: "Publish or update a short execution plan (summary + up to 8 steps) so the desktop can show Codex-style progress. Call this when the task has multiple steps, and update statuses as you advance.",
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 240 }),
        steps: Type.Array(Type.Object({
          text: Type.String({ minLength: 1, maxLength: 180 }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }), { minItems: 1, maxItems: 8 }),
      }),
      async execute(_toolCallId, params) {
        const inProgress = params.steps.filter((step) => step.status === "in_progress").length;
        if (inProgress > 1) {
          throw new Error("MilkSU progress accepts at most one in-progress step");
        }
        latestPlan = params.steps.map((step) => ({ ...step }));
        return {
          content: [{
            type: "text",
            text: `${params.summary}\n${latestPlan.map((step) => (
              `[${step.status === "completed" ? "x" : step.status === "in_progress" ? ">" : " "}] ${step.text}`
            )).join("\n")}`,
          }],
          details: {
            summary: params.summary,
            steps: latestPlan,
          },
        };
      },
    });

    pi.on("before_agent_start", async (event) => {
      const roleGuidance = sessionRole === "strategist"
        ? "Act as an independent reviewer: challenge the current route and return an evidence-backed recommendation."
        : sessionRole === "tool-builder"
          ? "Treat the requested helper as a software deliverable and verify it."
          : sessionRole === "solver"
            ? "Advance one falsifiable CTF hypothesis at a time and preserve evidence for the learner."
            : sessionRole === "cve-research" || sessionRole === "lab-job"
              ? researchReportGuidance(sessionRole)
              : "";
      const policy = getPolicy?.();
      const researchSession = sessionRole === "cve-research" || sessionRole === "lab-job";
      const subagentGuidance = !sessionRole && policy?.activeTools?.includes("subagent")
        ? `\n\n${codingSubagentGuidance()}`
        : "";
      const browserGuidance = (!sessionRole || researchSession) && policy?.codingBrowser
        ? `\n\n${codingBrowserGuidance()}`
        : "";
      const workspaceGuidance = (!sessionRole || researchSession)
        && policy?.activeTools?.includes(codingWorkspaceToolName)
        ? `\n\n${codingWorkspaceGuidance()}`
        : "";
      return {
        systemPrompt: `${event.systemPrompt}`
          + (roleGuidance ? `\n\n${roleGuidance}` : "")
          + `\n\nRuntime context:\n${runtimeEnvironmentGuidance({
            uiLocale: policy?.uiLocale,
            modelInput: getSession?.()?.model?.input,
          })}`
          + subagentGuidance
          + browserGuidance
          + workspaceGuidance
          + "\n\nWhen a task needs more than one concrete step, publish a concise plan with milksu_progress and keep the in-progress step updated. Skip the tool for trivial one-shot replies.",
      };
    });
  };
}

function createCodingPermissionExtension(
  conversationId,
  getPolicy,
  getTurnContract,
  registerController,
) {
  return (pi) => {
    registerController({
      setActiveTools: names => pi.setActiveTools(names),
    });
    pi.on("context", async (event) => {
      const messages = filterCodingTurnContractMessages(
        event.messages,
        getTurnContract(),
      );
      if (
        messages.length === event.messages.length
        && messages.every((message, index) => message === event.messages[index])
      ) {
        return undefined;
      }
      return { messages };
    });

    pi.on("tool_call", async (event) => {
      const policy = getPolicy();
      if (!policy) return undefined;
      if (codingTurnContractBlocksTool(getTurnContract())) {
        return {
          block: true,
          reason: "MilkSU blocked Agent tools for this explicitly no-tools turn",
        };
      }
      if (!policy.activeTools.includes(event.toolName)) {
        return {
          block: true,
          reason: `MilkSU Coding policy blocked ${event.toolName}: `
          + `${policy.executionMode}/${policy.approvalPolicy}`,
        };
      }
      let destructiveDeleteApproved = false;
      const deleteDecision = await destructiveDeleteDecision({
        toolName: event.toolName,
        input: event.input,
        policy,
      });
      if (deleteDecision?.action === "block") {
        return {
          block: true,
          reason: deleteDecision.reason,
        };
      }
      if (deleteDecision?.action === "approval") {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: deleteDecision.content,
          input: truncate(deleteDecision.input, 16000),
        });
        if (!approved) {
          return {
            block: true,
            reason: "MilkSU user denied broad recursive deletion",
          };
        }
        destructiveDeleteApproved = true;
      }
      if (event.toolName === "mcp") {
        const serverName = selectedMcpServer(policy, event.input);
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
        if (browserBlockReason || evidenceBlockReason) {
          return {
            block: true,
            reason: browserBlockReason || evidenceBlockReason,
          };
        }
      }
      const imageGenDecision = await authorizeImageGenToolCall({
        conversationId,
        event,
        approvalBroker,
      });
      if (imageGenDecision) return imageGenDecision;
      if (event.toolName === codingCollaborationToolName) {
        try {
          validateSubagentInput(
            event.input,
            policy.codingCollaboration,
            policy.workspace,
          );
        } catch (error) {
          return {
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        if (codingCollaborationRequiresApproval(policy.approvalPolicy)) {
          const approved = await approvalBroker.request({
            conversationId,
            toolName: codingCollaborationToolName,
            content: formatSubagentApproval(
              event.input,
              policy.codingCollaboration,
              policy.workspace,
            ),
            input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
            grantKey: codingCollaborationToolName,
          });
          if (!approved) {
            return {
              block: true,
              reason: "MilkSU user denied subagent delegation",
            };
          }
        }
      }
      const backgroundEffect = backgroundToolRequiresApproval(event.toolName, event.input);
      if (
        backgroundEffect
        && (
          policy.executionMode !== "go"
          || policy.approvalPolicy === "read-only"
        )
      ) {
        return {
          block: true,
          reason: `MilkSU Coding policy blocked ${event.toolName}/${backgroundToolAction(
            event.toolName,
            event.input,
          )}: ${policy.executionMode}/${policy.approvalPolicy}`,
        };
      }
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
          content: formatToolInput(event.toolName, event.input),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
          grantKey: event.toolName,
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied ${event.toolName}`,
          };
        }
      }
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
          content: formatMcpApprovalInput(event.input, serverName),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
          grantKey: mcpConversationGrantKey(event.input, serverName),
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied MCP server ${serverName}`,
          };
        }
      }
      return undefined;
    });

    pi.on("before_agent_start", async (event) => {
      const turnGuidance = codingTurnContractGuidance(getTurnContract());
      if (!turnGuidance) return undefined;
      const result = {
        systemPrompt: `${event.systemPrompt}`
          + `\n\nMilkSU per-turn contract:\n${turnGuidance}`,
      };
      if (turnGuidance) {
        result.message = {
          customType: codingTurnContractMessageType,
          content: codingTurnContractContext(getTurnContract()),
          display: false,
          details: {
            scope: "current-turn",
            reason: getTurnContract()?.reason,
          },
        };
      }
      return result;
    });
  };
}

function createComputerUseVisionResultExtension(getSession) {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      const session = getSession();
      if (!session) return undefined;
      try {
        return await summarizeComputerUseToolImages(event, session);
      } catch (error) {
        if (!isComputerUseMcpResult(event) || !Array.isArray(event.content)) {
          return undefined;
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            ...event.content,
            {
              type: "text",
              text: "\n\n[MilkSU Computer Use visual evidence]\n"
                + `local OCR unavailable: ${message}`,
            },
          ],
        };
      }
    });
  };
}

function selectedMcpServer(policy, input) {
  return resolveCodingMcpServer(input, policy) || "已选择的 MCP 服务器";
}

function formatMcpApprovalInput(input, serverName) {
  const browserApproval = formatCodingBrowserApprovalInput(input, serverName);
  if (browserApproval) return browserApproval;
  const tool = String(input?.tool ?? "").trim();
  const action = String(input?.action ?? input?.connect ?? "").trim();
  return [
    `服务器 ${serverName}`,
    tool ? `工具 ${tool}` : "",
    action ? `操作 ${action}` : "",
  ].filter(Boolean).join(" · ");
}

function formatToolInput(toolName, args) {
  if (!args || typeof args !== "object") return "";
  if (toolName === "ctf_request_endpoint") {
    const protocol = String(args.protocol ?? "").trim().toLowerCase();
    let endpoint = "";
    if (["http", "https"].includes(protocol)) {
      try {
        endpoint = new URL(String(args.endpoint ?? "")).origin;
      } catch {
        endpoint = "[invalid endpoint omitted]";
      }
    } else {
      const candidate = String(args.endpoint ?? "").trim();
      try {
        const parsed = new URL(`tcp://${candidate}`);
        const port = Number(parsed.port);
        endpoint = parsed.hostname
          && Number.isInteger(port)
          && port >= 1
          && port <= 65535
          && parsed.username === ""
          && parsed.password === ""
          && parsed.pathname === ""
          && parsed.search === ""
          && parsed.hash === ""
          ? `${parsed.hostname}:${port}`
          : "[invalid endpoint omitted]";
      } catch {
        endpoint = "[invalid endpoint omitted]";
      }
    }
    return [protocol, endpoint].filter(Boolean).join(" · ");
  }
  if (toolName === "bash" && typeof args.command === "string") {
    return `$ ${args.command}`;
  }
  if (toolName === codingImageGenToolName) {
    const mode = args.mode === "edit" ? "编辑图片" : "生成图片";
    return [
      mode,
      args.outputPath,
      args.size || "1024x1024",
      args.quality || "low",
    ].map(value => String(value ?? "").trim()).filter(Boolean).join(" · ");
  }
  if (toolName === "bg_task") {
    const action = String(args.action ?? "").trim();
    const name = String(args.name ?? "").trim();
    const command = typeof args.command === "string"
      ? args.command
      : Array.isArray(args.argv)
        ? args.argv.join(" ")
        : "";
    return [action, name, command].filter(Boolean).join(" · ");
  }
  if (toolName === "bg_status") {
    return [args.action, args.id].map(value => String(value ?? "").trim())
      .filter(Boolean)
      .join(" · ");
  }
  if (toolName === codingWorkspaceToolName) {
    return formatCodingWorkspaceInput(args);
  }
  if (toolName === "milksu_progress") {
    // Same checklist shape as the tool result so the UI can project a live plan
    // before the call settles.
    const summary = String(args.summary ?? "").trim();
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const lines = steps.map((step) => {
      const status = step?.status === "completed"
        ? "x"
        : step?.status === "in_progress"
          ? ">"
          : " ";
      const text = String(step?.text ?? "").trim();
      return text ? `[${status}] ${text}` : "";
    }).filter(Boolean);
    return [summary, ...lines].filter(Boolean).join("\n");
  }
  const path = typeof args.path === "string" ? args.path : "";
  if (toolName === "read") {
    const range = [
      Number.isInteger(args.offset) ? `offset=${args.offset}` : "",
      Number.isInteger(args.limit) ? `limit=${args.limit}` : "",
    ].filter(Boolean).join(" ");
    return [path, range].filter(Boolean).join(" · ");
  }
  if (["edit", "write"].includes(toolName) && path) return path;
  if (toolName === "grep" && typeof args.pattern === "string") {
    return `${args.pattern}${path ? ` · ${path}` : ""}`;
  }
  if (["find", "ls"].includes(toolName) && path) return path;
  return truncate(JSON.stringify(args, null, 2), 4000);
}

function registerAccountModel(session, provider, model) {
  const accountModelID = tokenfluxModelIDForProvider(provider, model);
  const availability = tokenfluxAccountModelAvailability(accountModelID);
  if (availability.authoritative && !availability.model) {
    return { id: accountModelID, model: undefined, unavailable: true };
  }
  const accountDefinition = currentProviderDefinition("tokenflux", accountModelID, {
    TOKENFLUX_API_KEY: relayKey,
    TOKENFLUX_BASE_URL: relayUrl,
    MILKSU_MODEL_CATALOG_PATH: process.env.MILKSU_MODEL_CATALOG_PATH,
  });
  const source = accountDefinition?.models?.find(item => item.id === accountModelID);
  // Account keys may be single-model or composite; rewrite the request model id
  // only after TokenFlux rejects the catalog shape.
  session.modelRuntime.registerProvider("milksu-account", withTokenFluxModelCompat({
    name: "MilkSU 账户分配模型",
    baseUrl: relayUrl,
    apiKey: relayKey,
    api: "openai-completions",
    models: [{
      ...source,
      id: accountModelID,
      name: source?.name ?? accountModelID,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: resolveModelContextWindow(accountModelID, source?.contextWindow),
      maxTokens: source?.maxTokens ?? 16384,
    }],
  }));
  return {
    id: accountModelID,
    model: session.modelRuntime.getModel("milksu-account", accountModelID),
    unavailable: false,
  };
}

function normalizeCommandModelSourceOrder(value) {
  const source = Array.isArray(value) ? value : configuredModelSourceOrder;
  return [...new Set(source.filter(id => id === "account" || id === "personal"))];
}

function configureRuntimeModel(session, provider, model, conversationId, sourceOrder) {
  sessionConfiguredProviders.set(conversationId, String(provider ?? "").trim());
  const definition = currentProviderDefinition(provider, model);
  if (definition) {
    // Personal TokenFlux keys may be single-model (bare id) or composite
    // (prefix/model). Official providers keep their native ids unchanged.
    session.modelRuntime.registerProvider(
      provider,
      provider === "tokenflux" ? withTokenFluxModelCompat(definition) : definition,
    );
  }
  const personalModel = session.modelRuntime.getModel(provider, model);
  const account = relayEnabled
    ? registerAccountModel(session, provider, model)
    : { id: "", model: undefined, unavailable: false };
  const available = new Map([
    ["account", account.model],
    ["personal", personalModel && session.modelRuntime.hasConfiguredAuth(provider)
      ? personalModel
      : undefined],
  ]);
  const requestedOrder = normalizeCommandModelSourceOrder(sourceOrder);
  const sources = requestedOrder.flatMap(id => {
    const sourceModel = available.get(id);
    return sourceModel ? [{ id, model: sourceModel }] : [];
  });
  if (sources.length === 0) {
    if (account.unavailable && requestedOrder.includes("account")) {
      throw new Error(
        `账户分配模型不支持 ${account.id}，且没有可用的个人 API Key`,
      );
    }
    sessionModelSources.set(conversationId, "personal");
    return { provider, model };
  }
  if (sources.length === 1) {
    sessionModelSources.set(conversationId, sources[0].id);
    if (
      account.unavailable
      && requestedOrder[0] === "account"
      && sources[0].id === "personal"
    ) {
      emit(conversationId, "model_source_fallback", {
        from: "account", to: "personal", reason: "model",
      });
    }
    emit(conversationId, "model_source_selected", { source: sources[0].id });
    return { provider: sources[0].model.provider, model: sources[0].model.id };
  }

  const source = personalModel ?? account.model;
  session.modelRuntime.registerProvider("milksu-route", createModelSourceRouteProvider({
    source,
    model,
    sources,
    autoFallback: modelSourceFallbackEnabled,
    openSource: (selected, context, options) => session.modelRuntime.streamSimple(
      selected.model,
      context,
      options,
    ),
    onSource: selected => {
      sessionModelSources.set(conversationId, selected);
      emit(conversationId, "model_source_selected", { source: selected });
    },
    onFallback: fallback => emit(conversationId, "model_source_fallback", fallback),
  }));
  return { provider: "milksu-route", model };
}

async function setSessionModel(conversationId, session, provider, model) {
  if (!provider || !model) return;

  const desired = session.modelRuntime.getModel(provider, model);
  if (!desired) {
    throw new Error(`Model not found: ${provider}/${model}`);
  }
  await session.setModel(desired);
  emit(conversationId, "model_selected", { provider, model });
}

function subscribeSession(
  conversationId,
  session,
  maxToolEventOutputBytes,
  usageModule,
) {
  let assistantTextStreamed = false;
  const toolStartedAt = new Map();

  session.subscribe((event) => {
    if (
      event.type === "compaction_start"
      || event.type === "compaction_end"
    ) {
      const requestId = event.reason === "manual"
        ? compactionRequestIds.get(conversationId)
        : undefined;
      const projected = projectCompactionEvent(event, requestId);
      if (event.type === "compaction_end" && requestId) {
        compactionRequestIds.delete(conversationId);
      }
      if (projected) {
        emit(conversationId, projected.type, projected.data);
      }
      return;
    }

    if (event.type === "agent_start") {
      emit(conversationId, "turn_started");
      return;
    }

    if (event.type === "entry_appended") {
      if (
        event.entry?.type === "custom"
        && event.entry.customType === "goal-state"
      ) {
        emitGoalState(conversationId, session);
      }
      return;
    }

    if (event.type === "agent_settled") {
      const goal = emitGoalState(conversationId, session);
      if (!goalKeepsSessionRunning(goal)) {
        emit(conversationId, "turn_settled");
      }
      return;
    }

    if (event.type === "queue_update") {
      if (suppressedQueueUpdates.has(conversationId)) return;
      emit(conversationId, "queue_update", projectSteeringQueue(event));
      return;
    }

    if (event.type === "message_update" && event.assistantMessageEvent) {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        assistantTextStreamed = true;
        emit(conversationId, "text_delta", { delta: update.delta });
      }
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      for (const projected of projectAssistantMessageEnd(event.message, {
        textStreamed: assistantTextStreamed,
      })) {
        emit(conversationId, projected.type, projected.data);
      }
      const usage = projectAssistantUsage(event.message, {
        conversationId,
        module: usageModule,
        provider: sessionConfiguredProviders.get(conversationId),
        source: sessionModelSources.get(conversationId),
      });
      if (usage) {
        recordSessionContextUsage(conversationId, usage, session.model?.contextWindow);
        emit(conversationId, "usage_recorded", { usage, module: usageModule });
      }
      assistantTextStreamed = false;
      return;
    }

    if (event.type === "tool_execution_start") {
      toolStartedAt.set(event.toolCallId, Date.now());
      emit(conversationId, "tool_call_start", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: formatToolInput(event.toolName, event.args),
        module: usageModule,
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      // Progress is an activity heartbeat only. Child tool output stays inside Pi
      // and is emitted once, through the bounded tool_execution_end projection.
      emit(conversationId, "tool_call_progress", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        module: usageModule,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const startedAt = toolStartedAt.get(event.toolCallId);
      toolStartedAt.delete(event.toolCallId);
      if (event.toolName === "bg_task" || event.toolName === "bg_status") {
        emitBackgroundTasks(conversationId);
      }
      for (const usage of projectToolModelUsage(event.result, {
        conversationId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        module: usageModule,
        provider: sessionConfiguredProviders.get(conversationId),
        source: sessionModelSources.get(conversationId),
      })) {
        emit(conversationId, "usage_recorded", { usage, module: usageModule });
      }
      emit(conversationId, "tool_call_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: truncate(extractToolResultContent(event.result), maxToolEventOutputBytes),
        durationMs: startedAt === undefined
          ? undefined
          : Math.max(0, Date.now() - startedAt),
        isError: event.isError,
        module: usageModule,
      });
    }
  });
}

async function createSessionManager(cwd, agentDir, conversationId) {
  const sessionDir = join(agentDir, "sessions");
  const existing = (await SessionManager.list(cwd, sessionDir))
    .find((value) => value.id === conversationId);
  if (existing) {
    return SessionManager.open(existing.path, sessionDir, cwd);
  }
  return SessionManager.create(cwd, sessionDir, { id: conversationId });
}

async function loadProjectInstructions(cwd) {
  try {
    const content = await readFile(join(cwd, "AGENTS.md"), "utf8");
    return `Project instructions from ${join(cwd, "AGENTS.md")}:\n\n${truncate(content, 64000)}`;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function createMilkSUResourceLoader(
  cwd,
  agentDir,
  systemPrompt,
  sessionRole,
  codingSkillPaths,
  conversationId,
  getPolicy,
  registerPolicyController,
  mcpConfig,
  securityTools,
  getSession,
) {
  // Skills and extensions may execute instructions supplied by third parties.
  // Keep Pi's ambient discovery disabled and load only MilkSU-reviewed resources.
  const extensionFactories = [
    createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession),
  ];
  if (sessionRole) {
    extensionFactories.push(createCTFTruncationContinuationExtension(sessionRole));
  }
  extensionFactories.push(
      piGoalExtension,
      createReviewedBackgroundTasksExtension(conversationId),
      piWebResearchExtension,
      createCodingPermissionExtension(
        conversationId,
        getPolicy,
        () => sessionTurnContracts.get(conversationId),
        registerPolicyController,
      ),
      createReviewedLspExtension(
        piLspExtension,
        {
          conversationId,
          getPolicy,
          approvalBroker,
        },
      ),
      createComputerUseVisionResultExtension(getSession),
      createSecurityToolsExtension(cwd, securityTools),
      createCodingWorkspaceExtension(
        conversationId,
        getPolicy,
        request => workspaceActionBroker.request(request),
        id => queueWorkspaceCompaction(pendingWorkspaceCompaction, id),
        id => ({
          usage: sessionContextUsage.get(id),
          contextWindow: sessions.get(id)?.model?.contextWindow
            ?? sessionContextUsage.get(id)?.contextWindow,
        }),
      ),
      createComputerUseDriverExtension(
        conversationId,
        getPolicy,
        request => workspaceActionBroker.request(request),
      ),
      piSubAgentExtension,
  );
  if (mcpConfig) {
    extensionFactories.push(createMcpAdapter({ config: mcpConfig }));
  }
  return new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    additionalSkillPaths: codingSkillPaths,
    extensionFactories,
  });
}

function reviewedCodingResourceRoots(sessionRole = "", disabledSkills = []) {
  void sessionRole;
  const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  return [
    ...reviewedCodingSkillPaths(
      sidecarResourceDirectory,
      sessionRole,
      disabledSkills,
    ),
    attachmentRoot,
  ].filter((path) => path && existsSync(path));
}

function requestedBrowserUseDescriptor(command) {
  if (
    command.executionMode !== "go"
    || command.approvalPolicy === "read-only"
    || !Array.isArray(command.mcpServers)
    || !command.mcpServers.includes(browserUseMcpServerName)
  ) return undefined;
  const conversationId = String(command.conversationId ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,120}$/u.test(conversationId)) {
    throw new Error("MilkSU rejected Browser Use for an invalid conversation id");
  }
  return { sessionId: `browser_user-${conversationId}` };
}

async function loadRuntimeSessionPolicy(cwd, command) {
  const productAction = normalizeCodingProductAction(cwd, command.productAction);
  if (command.productAction !== undefined && !productAction) {
    throw new Error("MilkSU rejected an invalid typed Coding product action");
  }
  const codingCollaboration = normalizeCodingCollaboration(
    command.codingCollaboration,
    command.conversationId,
    cwd,
  );
  const browserUse = requestedBrowserUseDescriptor(command);
  const securityTools = await normalizeSecurityTools(command.securityTools);
  const selectedMcp = await loadCodingMcpConfig(
    cwd,
    command.mcpServers,
    command.mcpConfigDigest,
    command.codingBrowser,
    command.computerUse,
    browserUse,
    securityTools,
  );
  let policy = await loadSessionPolicy(cwd, command.sessionRole, {
    executionMode: command.executionMode,
    approvalPolicy: command.approvalPolicy,
    productAction,
    mcpServers: selectedMcp.selected,
    projectMcpServers: selectedMcp.projectSelected,
    mcpConfigDigest: command.mcpConfigDigest,
    codingBrowser: selectedMcp.codingBrowser,
    computerUse: selectedMcp.computerUse,
    browserUse: selectedMcp.browserUse,
    codingCollaboration,
    imageGenConfigured: Boolean(String(process.env.OPENAI_API_KEY ?? "").trim()),
  });
  const effectiveSessionRole = policy.ctf
    ? command.sessionRole || "solver"
    : "";
  const disabledSkills = Array.isArray(command.disabledSkills)
    ? command.disabledSkills
    : [];
  const codingSkillPaths = reviewedCodingSkillPaths(
    sidecarResourceDirectory,
    effectiveSessionRole,
    disabledSkills,
  );
  const codingResourceRoots = reviewedCodingResourceRoots(
    effectiveSessionRole,
    disabledSkills,
  );
  if (codingResourceRoots.length) {
    policy = await loadSessionPolicy(cwd, command.sessionRole, {
      executionMode: command.executionMode,
      approvalPolicy: command.approvalPolicy,
      productAction,
      mcpServers: selectedMcp.selected,
      projectMcpServers: selectedMcp.projectSelected,
      mcpConfigDigest: command.mcpConfigDigest,
      codingBrowser: selectedMcp.codingBrowser,
      computerUse: selectedMcp.computerUse,
      browserUse: selectedMcp.browserUse,
      codingCollaboration,
      imageGenConfigured: Boolean(String(process.env.OPENAI_API_KEY ?? "").trim()),
      readOnlyResourceRoots: codingResourceRoots,
    });
  }
  policy.skillNames = codingSkillPaths.map(path => basename(path));
  policy.securityTools = securityTools;
  if (securityTools.some(tool => tool.id === "capa")) {
    if (!policy.activeTools.includes("capa_analyze")) {
      policy.activeTools.push("capa_analyze");
    }
  }
  policy.uiLocale = command.locale === "en" ? "en" : "zh";
  return {
    policy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig: selectedMcp.config,
    securityTools,
  };
}

function configureSubagentRuntime(cwd, collaboration) {
  const launcher = join(bridgeDirectory, "pi-subagent-launcher.sh");
  const runner = join(bridgeDirectory, "pi-subagent-runner.cjs");
  const packagedCLI = join(bridgeDirectory, "pi-subagent-cli.cjs");
  const developmentCLI = join(
    sidecarResourceDirectory,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const packagedAgents = join(bridgeDirectory, "subagents", "agents");
  const developmentAgents = join(
    sidecarResourceDirectory,
    "node_modules",
    "pi-sub-agent",
    "extensions",
    "agents",
  );
  const cli = existsSync(packagedCLI) ? packagedCLI : developmentCLI;
  const agents = existsSync(packagedAgents) ? packagedAgents : developmentAgents;
  for (const [label, path] of [
    ["launcher", launcher],
    ["runner", runner],
    ["Pi CLI", cli],
    ["agent prompts", agents],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`MilkSU subagent ${label} is unavailable: ${path}`);
    }
  }
  process.env.MILKSU_PI_SUBAGENT_LAUNCHER = launcher;
  process.env.MILKSU_PI_SUBAGENT_RUNNER = runner;
  process.env.MILKSU_PI_SUBAGENT_CLI = cli;
  process.env.MILKSU_PI_SUBAGENT_AGENTS_DIR = agents;
  process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY = "1";
}

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const existing = sessions.get(conversationId);
  if (existing) return existing;

  const cwd = process.cwd();
  const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
  const projectInstructions = await loadProjectInstructions(cwd);
  const {
    policy: sessionPolicy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig,
    securityTools,
  } = await loadRuntimeSessionPolicy(cwd, command);
  applyCodingResourcePolicy();
  configureSubagentRuntime(cwd, sessionPolicy.codingCollaboration);
  sessionPolicies.set(conversationId, sessionPolicy);
  if (mcpConfig) {
    await ensureMcpMetadataCache(agentDir);
  }
  let session;
  const resourceLoader = createMilkSUResourceLoader(
    cwd,
    agentDir,
    projectInstructions,
    effectiveSessionRole,
    codingSkillPaths,
    conversationId,
    () => sessionPolicies.get(conversationId),
    controller => sessionPolicyControllers.set(conversationId, controller),
    mcpConfig,
    securityTools,
    () => session,
  );
  // MilkSU performs its own explicit, reviewed resource loading. Mark the
  // project untrusted at Pi's package-manager layer so it does not walk parent
  // directories looking for ambient .agents/.pi resources.
  await resourceLoader.reload({
    resolveProjectTrust: async () => false,
  });

  try {
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager: await createSessionManager(cwd, agentDir, conversationId),
      resourceLoader,
      tools: [...new Set([
        ...codingSessionToolNames,
        ...(sessionPolicy.ctf ? sessionPolicy.activeTools : []),
        codingCollaborationToolName,
        ...(sessionPolicy.mcpServers?.length || sessionPolicy.codingBrowser
          || sessionPolicy.computerUse || sessionPolicy.browserUse ? ["mcp"] : []),
        ...(sessionPolicy.securityTools?.some(tool => tool.id === "capa")
          ? ["capa_analyze"]
          : []),
      ])],
      customTools: sessionPolicy.customTools,
    }));
    // Pi's SDK constructs the extension runner but deliberately leaves
    // lifecycle binding to embedders. Without this call extension tools appear
    // available, while session_start handlers never run. Durable extensions
    // such as background tasks then cannot reconcile processes after a
    // Sidecar restart.
    await session.bindExtensions({ mode: "print" });
    const controller = sessionPolicyControllers.get(conversationId);
    if (!controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    controller.setActiveTools(sessionPolicy.activeTools);
    subscribeSession(
      conversationId,
      session,
      sessionPolicy.maxToolEventOutputBytes,
      sessionPolicy.ctf ? "ctf" : "coding",
    );

    const effectiveModel = configureRuntimeModel(
      session,
      command.provider,
      command.model,
      conversationId,
      command.modelSourceOrder,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
    );

    sessions.set(conversationId, session);
    promptQueues.set(conversationId, Promise.resolve());
    const loadedExtensions = describeLoadedExtensions(resourceLoader);
    emit(conversationId, "ready", {
      workspace: cwd,
      tools: session.getActiveToolNames(),
      extensions: loadedExtensions.names,
      extensionErrors: loadedExtensions.errors,
      skills: resourceLoader.getSkills().skills.map((skill) => skill.name),
      executionMode: sessionPolicy.executionMode,
      approvalPolicy: sessionPolicy.approvalPolicy,
      capabilities: sessionPolicy.capabilities,
      resumed: session.messages.length > 0,
    });
    if (!sessionPolicy.ctf) {
      emitBackgroundTasks(conversationId);
      emitGoalState(conversationId, session);
    }
    return session;
  } catch (error) {
    await disposeAgentSession(session, "create_failed");
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    sessionModelSources.delete(conversationId);
    sessionConfiguredProviders.delete(conversationId);
    throw error;
  }
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  // abort_session is handled immediately, while send_message is queued.
  // A stop click right after Send can therefore arrive before createSession.
  if (dropSendAfterAbort(abortedSessions, sessions, conversationId)) {
    emit(conversationId, "turn_settled");
    return;
  }

  let existing = sessions.get(conversationId);
  const previousPolicy = sessionPolicies.get(conversationId);
  const requestedFullAccess = command.approvalPolicy === "full-auto";
  const requestedProductAction = normalizeCodingProductAction(
    process.cwd(),
    command.productAction,
  );
  if (command.productAction !== undefined && !requestedProductAction) {
    throw new Error("MilkSU rejected an invalid typed Coding product action");
  }
  const previousProductAction = previousPolicy?.productAction;
  const productActionChanged = JSON.stringify(previousProductAction)
    !== JSON.stringify(requestedProductAction);
  const requestedMcpServers = command.mcpServers;
  const requestedProjectMcpServers = projectMcpServersFromSelection(requestedMcpServers);
  const requestedCodingBrowser = command.codingBrowser;
  const requestedComputerUse = command.computerUse;
  const requestedBrowserUse = requestedBrowserUseDescriptor(command);
  const requestedCodingCollaboration = command.codingCollaboration;
  if (
    existing
    && previousPolicy
    && (
      (previousPolicy.approvalPolicy === "full-auto") !== requestedFullAccess
      || productActionChanged
      || mcpSelectionChanged(previousPolicy.projectMcpServers, requestedProjectMcpServers)
      || String(previousPolicy.mcpConfigDigest ?? "")
        !== String(command.mcpConfigDigest ?? "")
      || codingBrowserSelectionChanged(
        previousPolicy.codingBrowser,
        requestedCodingBrowser,
      )
      || computerUseSelectionChanged(
        previousPolicy.computerUse,
        requestedComputerUse,
      )
      || browserUseSelectionChanged(
        previousPolicy.browserUse,
        requestedBrowserUse,
      )
      || codingCollaborationChanged(
        previousPolicy.codingCollaboration,
        requestedCodingCollaboration,
      )
      || securityToolSelectionChanged(
        previousPolicy.securityTools,
        command.securityTools,
      )
      || JSON.stringify(previousPolicy.skillNames ?? [])
        !== JSON.stringify(
          reviewedCodingSkillPaths(
            sidecarResourceDirectory,
            "",
            command.disabledSkills,
          ).map(path => basename(path)),
        )
    )
  ) {
    await disposeAgentSession(existing, "reload");
    sessions.delete(conversationId);
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    sessionModelSources.delete(conversationId);
    sessionConfiguredProviders.delete(conversationId);
    existing = undefined;
  }
  const session = existing ?? await createSession(command);
  if (abortedSessions.delete(conversationId)) {
    try {
      await session.abort();
    } catch {
      // The desktop run clock still has to settle after a cancelled create.
    }
    emit(conversationId, "turn_settled");
    return;
  }
  if (existing) {
    const { policy: sessionPolicy } = await loadRuntimeSessionPolicy(process.cwd(), command);
    sessionPolicies.set(conversationId, sessionPolicy);
    const controller = sessionPolicyControllers.get(conversationId);
    if (!controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    controller.setActiveTools(sessionPolicy.activeTools);
    const effectiveModel = configureRuntimeModel(
      session,
      command.provider,
      command.model,
      conversationId,
      command.modelSourceOrder,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
    );
    if (!sessionPolicy.ctf) {
      emit(conversationId, "policy_updated", {
        tools: session.getActiveToolNames(),
        executionMode: sessionPolicy.executionMode,
        approvalPolicy: sessionPolicy.approvalPolicy,
        capabilities: sessionPolicy.capabilities,
      });
    }
  }

  const previous = promptQueues.get(conversationId) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (abortedSessions.delete(conversationId)) {
      try {
        await session.abort();
      } catch {
        // Queued prompt was cancelled before session.prompt.
      }
      return;
    }
    // A manual compaction in flight for this conversation must finish before
    // the next prompt so Pi never runs a prompt against a session that is
    // mid-compaction. Compaction is bounded, so this wait cannot hang forever.
    await waitForCompaction(compactionRuns, conversationId);
    await compactIfContextNearLimit(
      conversationId,
      session,
      sessionPolicies.get(conversationId),
    );
    const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    const supportsImages = Array.isArray(session.model?.input)
      && session.model.input.includes("image");
    const prepared = await preparePromptAttachments(
      command.attachments,
      attachmentRoot,
      supportsImages,
    );
    const policy = sessionPolicies.get(conversationId);
    const contract = policy?.ctf
      ? undefined
      : normalizeCodingTurnContract(command.turnPolicy);
    const analyzed = supportsImages
      ? { context: "" }
      : await analyzeTextOnlyImages(prepared.attachments);
    const prompt = `${command.prompt ?? ""}${prepared.context}${analyzed.context}`;
    const controller = sessionPolicyControllers.get(conversationId);
    if (contract && !controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    await withCodingTurnContract({
      contracts: sessionTurnContracts,
      conversationId,
      contract,
      getActiveTools: () => session.getActiveToolNames(),
      setActiveTools: tools => {
        if (controller) controller.setActiveTools(tools);
      },
      onApplied: tools => emit(conversationId, "turn_policy", {
        tools,
        reason: contract?.reason,
      }),
      onRestored: tools => emit(conversationId, "turn_policy_cleared", {
        tools,
      }),
    }, () => session.prompt(
      prompt,
      prepared.images.length ? { images: prepared.images } : undefined,
    ));
    await compactIfContextNearLimit(
      conversationId,
      session,
      sessionPolicies.get(conversationId),
    );
  });
  promptQueues.set(conversationId, next.catch(() => undefined));
  try {
    await next;
  } catch (error) {
    if (abortedSessions.delete(conversationId)) return;
    throw error;
  }
}

async function abortSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  abortedSessions.add(conversationId);
  approvalBroker.cancelConversation(conversationId, "turn aborted");
  workspaceActionBroker.cancelConversation(conversationId, "turn aborted");
  pendingWorkspaceCompaction.delete(conversationId);
  const session = sessions.get(conversationId);
  if (!session) {
    emit(conversationId, "turn_settled");
    return;
  }
  await session.abort();
  // Do not synthesize empty message_done (it became a blank assistant bubble).
  // If Pi already emitted agent_settled, a second turn_settled is harmless in
  // the UI (finishRun is idempotent). If abort raced past agent_settled, this
  // closes the desktop run clock without inventing assistant text.
  emit(conversationId, "turn_settled");
}

async function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const session = sessions.get(conversationId);
  let sessionFile = session?.sessionFile;
  if (!sessionFile && command.deletePersisted) {
    const cwd = process.cwd();
    const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
    const sessionDir = join(agentDir, "sessions");
    const persisted = (await SessionManager.list(cwd, sessionDir))
      .find((value) => value.id === conversationId);
    sessionFile = persisted?.path;
  }
  const compactionRequestId = compactionRequestIds.get(conversationId);
  if (compactionRequestId) {
    emit(conversationId, "compaction_end", {
      requestId: compactionRequestId,
      reason: "manual",
      aborted: true,
      error: "Coding session was destroyed during context compaction",
    });
    try {
      session?.abortCompaction?.();
    } catch {
      // Disposal below still terminates the session.
    }
  }
  const backgroundController = backgroundTaskControllers.get(conversationId) ?? {
    sendUserMessage: async () => undefined,
  };
  for (const task of backgroundTaskMetasForSession(
    listPiBackgroundTaskMetas(),
    conversationId,
  )) {
    if (task.status === "running") {
      stopPiBackgroundTask(backgroundController, task.id, () => undefined);
    }
  }
  approvalBroker.cancelConversation(conversationId, "session destroyed");
  approvalBroker.clearConversationGrants(conversationId);
  workspaceActionBroker.cancelConversation(conversationId, "session destroyed");
  pendingWorkspaceCompaction.delete(conversationId);
  sessionContextUsage.delete(conversationId);
  compactionRuns.delete(conversationId);
  compactionRequestIds.delete(conversationId);
  sessionTurnContracts.delete(conversationId);
  await disposeAgentSession(session);
  sessions.delete(conversationId);
  sessionPolicies.delete(conversationId);
  sessionPolicyControllers.delete(conversationId);
  sessionModelSources.delete(conversationId);
  sessionConfiguredProviders.delete(conversationId);
  backgroundTaskControllers.delete(conversationId);
  promptQueues.delete(conversationId);
  abortedSessions.delete(conversationId);
  if (command.deletePersisted && sessionFile) {
    try {
      await unlink(sessionFile);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  emit(conversationId, "session_destroyed");
}

function respondToolApproval(command) {
  const conversationId = command.conversationId;
  const requestId = command.requestId;
  if (!conversationId) throw new Error("conversationId is required");
  if (!requestId) throw new Error("requestId is required");
  approvalBroker.respond({
    conversationId,
    requestId,
    approved: command.approved === true,
    scope: command.scope,
  });
}

function respondWorkspaceAction(command) {
  const requestId = String(command.requestId ?? "").trim();
  if (!requestId) throw new Error("requestId is required");
  workspaceActionBroker.respond({
    requestId,
    ok: command.ok !== false,
    result: command.result,
    error: command.error,
  });
}

function terminalCommandName(value, command) {
  const explicit = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim();
  if (explicit) return explicit.slice(0, 120);
  const firstLine = String(command ?? "").split(/\r?\n/, 1)[0].trim();
  return (firstLine || "终端命令").slice(0, 120);
}

function recordSessionContextUsage(conversationId, usage, contextWindow) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  sessionContextUsage.set(id, {
    inputTokens: Number(usage?.inputTokens ?? 0),
    cacheReadTokens: Number(usage?.cacheReadTokens ?? 0),
    contextWindow: Number(contextWindow ?? usage?.contextWindow ?? 0),
  });
}

async function compactIfContextNearLimit(conversationId, session, policy) {
  if (policy?.ctf || !session) return;
  const stored = sessionContextUsage.get(conversationId);
  const snapshot = contextUsageSnapshot(
    stored,
    session.model?.contextWindow || stored?.contextWindow,
  );
  const forced = pendingWorkspaceCompaction.has(conversationId);
  if (!snapshot.shouldCompact && !forced) return;
  pendingWorkspaceCompaction.delete(conversationId);
  try {
    const result = await compactSession(session);
    recordSessionContextUsage(conversationId, {
      inputTokens: Number(result?.estimatedTokensAfter ?? 0),
      cacheReadTokens: 0,
    }, session.model?.contextWindow || stored?.contextWindow);
  } catch (error) {
    emit(conversationId, "compaction_end", {
      reason: "auto",
      aborted: /cancelled|timed out|aborted/i.test(describeError(error)),
      error: describeError(error),
    });
  }
}

async function compactSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    if (compactionRuns.has(conversationId)) {
      throw new Error("Coding session is already compacting");
    }
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    const policy = sessionPolicies.get(conversationId);
    if (policy?.ctf) {
      throw new Error("CTF agent sessions cannot be compacted from the task UI");
    }
    compactionRequestIds.set(conversationId, requestId);
    const run = (async () => {
      try {
        const result = await compactSession(session);
        recordSessionContextUsage(conversationId, {
          inputTokens: Number(result?.estimatedTokensAfter ?? 0),
          cacheReadTokens: 0,
        }, session.model?.contextWindow);
      } catch (error) {
        // AgentSession.compact normally emits Pi's native compaction_end even
        // on failure. Keep a fallback only for wrapper validation/runtime
        // failures that happen before that native event.
        if (compactionRequestIds.get(conversationId) === requestId) {
          compactionRequestIds.delete(conversationId);
          const message = describeError(error);
          emit(conversationId, "compaction_end", {
            requestId,
            reason: "manual",
            aborted: /cancelled|timed out|aborted/i.test(message),
            error: message,
          });
        }
      } finally {
        if (compactionRequestIds.get(conversationId) === requestId) {
          compactionRequestIds.delete(conversationId);
        }
      }
    })();
    await trackCompaction(compactionRuns, conversationId, run);
  } catch (error) {
    // Validation failures that happen before a run exists still surface as an
    // explicit compaction_end so the Supervisor waiter never hangs.
    emit(conversationId || null, "compaction_end", {
      requestId,
      reason: "manual",
      aborted: false,
      error: describeError(error),
    });
  }
}

function currentSessionQueue(session) {
  if (!session) return { steering: [], followUp: [] };
  return projectSteeringQueue({
    steering: session.getSteeringMessages?.(),
    followUp: session.getFollowUpMessages?.(),
  });
}

async function removeQueuedMessageCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    suppressedQueueUpdates.add(conversationId);
    const queue = await removeQueuedMessage(sessions, command);
    suppressedQueueUpdates.delete(conversationId);
    emit(conversationId, "queued_message_removed", {
      requestId,
      ...projectSteeringQueue(queue),
    });
  } catch (error) {
    suppressedQueueUpdates.delete(conversationId);
    const queue = currentSessionQueue(sessions.get(conversationId));
    // A stale index can mean Pi already consumed a message. Re-project the
    // restored live queue so the renderer does not keep stale controls.
    if (conversationId && sessions.has(conversationId)) {
      emit(conversationId, "queue_update", queue);
    }
    emit(conversationId || null, "queued_message_removed", {
      requestId,
      ...queue,
      error: describeError(error),
    });
  }
}

async function controlBackgroundTask(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const control = String(command.control ?? "").trim();
    if (control === "list") {
      emit(conversationId, "background_task_controlled", {
        requestId,
        tasks: projectedBackgroundTasks(conversationId),
      });
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
      const policy = await loadSessionPolicy(process.cwd(), "", {
        executionMode: command.executionMode,
        approvalPolicy: command.approvalPolicy,
      });
      if (
        policy.ctf
        || policy.executionMode !== "go"
        || policy.approvalPolicy === "read-only"
      ) {
        throw new Error(
          `MilkSU Coding policy blocked terminal command: `
          + `${policy.executionMode}/${policy.approvalPolicy}`,
        );
      }
      const input = {
        command: commandText,
        cwd: policy.workspace,
        shell: true,
        callback: false,
        name: terminalCommandName(command.name, commandText),
      };
      const pi = backgroundTaskControllers.get(conversationId) ?? {
        sendUserMessage: async () => undefined,
      };
      spawnPiBackgroundTask(
        pi,
        input,
        policy.workspace,
        { cwd: policy.workspace, sessionId: conversationId },
        () => ({ cwd: policy.workspace, sessionId: conversationId }),
      );
      emit(conversationId, "background_task_controlled", {
        requestId,
        tasks: projectedBackgroundTasks(conversationId),
      });
      return;
    }
    if (control !== "stop") {
      throw new Error(`unsupported background task control: ${control}`);
    }
    const taskId = String(command.taskId ?? "").trim();
    if (!/^bg_[a-z0-9_]+$/i.test(taskId)) {
      throw new Error("invalid background task id");
    }
    const metas = backgroundTaskMetasForSession(
      listPiBackgroundTaskMetas(),
      conversationId,
    );
    const meta = metas.find(task => task.id === taskId);
    if (!meta) throw new Error(`background task not found: ${taskId}`);
    const pi = backgroundTaskControllers.get(conversationId) ?? {
      sendUserMessage: async () => undefined,
    };
    stopPiBackgroundTask(pi, taskId, () => undefined);
    emit(conversationId, "background_task_controlled", {
      requestId,
      tasks: projectedBackgroundTasks(conversationId),
    });
  } catch (error) {
    emit(conversationId || null, "background_task_controlled", {
      requestId,
      error: describeError(error),
      tasks: projectedBackgroundTasks(conversationId),
    });
  }
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      await createSession(command);
      break;
    case "send_message":
      await sendMessage(command);
      break;
    case "steer_message":
      await steerSession(sessions, command);
      break;
    case "remove_queued_message":
      await removeQueuedMessageCommand(command);
      break;
    case "abort_session":
      await abortSession(command);
      break;
    case "approval_response":
      respondToolApproval(command);
      break;
    case "workspace_action_response":
      respondWorkspaceAction(command);
      break;
    case "background_task_control":
      await controlBackgroundTask(command);
      break;
    case "compact_session":
      await compactSessionCommand(command);
      break;
    case "destroy_session":
      await destroySession(command);
      break;
    default:
      throw new Error(`Unknown action: ${command.action}`);
  }
}

input.on("line", (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch (error) {
    emit(null, "error", { error: describeError(error) });
    return;
  }
  if (command.action === "abort_session") {
    void abortSession(command).catch((error) => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  if (command.action === "steer_message") {
    steeringCommandQueue = steeringCommandQueue
      .then(() => steerSession(sessions, command))
      .catch((error) => {
        emit(command.conversationId ?? null, "steer_rejected", {
          error: describeError(error),
        });
      });
    return;
  }
  if (command.action === "remove_queued_message") {
    steeringCommandQueue = steeringCommandQueue
      .then(() => removeQueuedMessageCommand(command))
      .catch((error) => {
        emit(command.conversationId ?? null, "queued_message_removed", {
          requestId: String(command.requestId ?? "").trim(),
          error: describeError(error),
        });
      });
    return;
  }
  if (command.action === "approval_response") {
    try {
      respondToolApproval(command);
    } catch (error) {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    }
    return;
  }
  if (command.action === "workspace_action_response") {
    try {
      respondWorkspaceAction(command);
    } catch (error) {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    }
    return;
  }
  if (command.action === "background_task_control") {
    if (sessions.has(command.conversationId)) {
      void controlBackgroundTask(command);
      return;
    }
  }
  if (command.action === "compact_session") {
    void compactSessionCommand(command);
    return;
  }
  commandQueue = commandQueue
    .then(() => handleCommand(command))
    .catch((error) => {
      console.error("MilkSU Pi Sidecar command failed", error);
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

async function disposeAllSessions() {
  approvalBroker.cancelAll("Sidecar stopped");
  compactionRuns.clear();
  compactionRequestIds.clear();
  suppressedQueueUpdates.clear();
  sessionTurnContracts.clear();
  await Promise.all(
    [...sessions.values()].map(session => disposeAgentSession(session)),
  );
  sessions.clear();
  backgroundTaskControllers.clear();
  promptQueues.clear();
  abortedSessions.clear();
}

let shutdownPromise;

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = disposeAllSessions()
    .catch(error => {
      console.error("MilkSU Pi Sidecar shutdown failed", error);
    })
    .finally(() => {
      input.close();
      process.exit(0);
    });
  return shutdownPromise;
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
