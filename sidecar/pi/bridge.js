import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import piSubagentsExtension from "pi-subagents";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { readFile, rm, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  codingAskToolName,
  formatAskSelection,
  formatAskToolInput,
  normalizeAskOptions,
} from "./bridge-ask.js";
import { contextWindowOverride, registeredContextWindow, registeredMaxTokens, knownMaxTokens } from "./known-context-window.cjs";
import { resolveMaxOutput, contextUsageWindowPayload } from "./context-window-payload.js";
import {
  createMcpAdapter,
  listPiBackgroundTaskMetas,
  piBackgroundTasksExtension,
  piGoalExtension,
  piLspExtension,
  readPiBackgroundTaskLog,
  spawnPiBackgroundTask,
  stopPiBackgroundTask,
} from "./reviewed-ts/extensions.js";
import { dropSendAfterAbort } from "./bridge-abort.js";
import {
  applyUserMemorySnapshot,
  isCompanionRelay,
  lastAssistantText,
  tracksUserMemory,
  withUserMemoryMessages,
} from "./user-memory.js";
import { enqueueConversationPrompt } from "./bridge-conversation-prompt.js";
import {
  createToolRepeatGuard,
  toolBudgetPrompt,
  toolBudgetToolName,
} from "./bridge-tool-repeat.js";
import {
  loadSessionPolicy,
  normalizeCodingProductAction,
} from "./bridge-policy.js";
import { createApprovalBroker } from "./bridge-approval.js";
import {
  codingMcpOperationRequiresApproval,
  subagentCallRequiresApproval,
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
  codingBrowserMcpServerName,
  codingBrowserSelectionChanged,
  computerUseSelectionChanged,
  ensureMcpMetadataCache,
  loadCodingMcpConfig,
  writeCodingBrowserDescriptor,
  mcpSelectionChanged,
  pluginMcpSessionRequiresReload,
  projectMcpServersFromSelection,
  userMcpSelectionChanged,
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
import { isComputerUseMcpToolName } from "./bridge-computer-use-routing.js";
import { disposeAgentSession } from "./bridge-session-lifecycle.js";
import { answerDecisionQuery } from "../decision/query.js";
import {
  forkFromMessage,
  lastForkPoint,
  messageText,
  navigateFromUserMessage,
  rewindLastExploration,
} from "./bridge-session-tree.js";
import { createCTFTruncationContinuationExtension } from "./bridge-ctf-continuation.js";
import { createReasoningOnlyRecoveryExtension } from "./bridge-reasoning-recovery.js";
import {
  armAutoCompactionDeadline,
  clearAutoCompactionDeadline,
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
} from "./bridge-collaboration.js";
import { readAsyncSubagentSnapshot } from "./pi-subagents-status.js";
import { terminateConversationSubagents } from "./pi-subagents-stop.js";
import {
  authorizeImageGenToolCall,
  codingImageGenToolName,
  imageGenIsConfigured,
} from "./bridge-imagegen.js";
import {
  resolveWorkflowSessionRole,
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  createWorkspaceActionBroker,
  formatCodingWorkspaceInput,
  queueWorkspaceCompaction,
} from "./bridge-workspace.js";
import { composeMilkSUWorkflowSystemPrompt } from "./bridge-workflow-prompt.js";
import { createEnvExtension } from "./bridge-env.js";
import { createComputerUseDriverExtension } from "./bridge-computer-use-driver.js";
import { createComputerUseToolExtension } from "./bridge-computer-use-tool.js";
import { resolveCodingSkillPaths, reviewedCodingSkillPaths } from "./bridge-skills.js";
import { createToolResultBoundExtension } from "./bridge-tool-result-bound.js";
import { createHangGuardExtension } from "./bridge-hang-guard.js";
import {
  createSubagentYieldExtension,
  formatSubagentToolInput,
  projectSubagentRosterEnd,
  projectSubagentRosterStart,
  projectSubagentToolResult,
} from "./bridge-subagent-yield.js";
import {
  followUpSession,
  projectSteeringQueue,
  relaySession,
  removeQueuedMessage,
  steerSession,
} from "./bridge-steering.js";
import {
  commandForTool,
  destructiveDeleteApproval,
  destructiveDeleteDecision,
  destructiveJustification,
  issueDestructiveDeleteCredential,
  recursiveDeleteTargets,
} from "./bridge-destructive-delete.js";
import piWebResearchExtension from "./bridge-web-research.js";
import currentProviderRuntime from "./current-provider-runtime.cjs";
import {
  apiKeyEnvFor,
  forgetSessionProviders,
  publicProvider,
  rememberSessionProviders,
} from "./pi-subagent-model-registry.cjs";
import {
  createModelSourceRouteProvider,
  modelSourceFailureMessage,
  normalizeModelSourceOrder,
  selectModelSources,
} from "./model-source-routing.js";
import {
  normalizeThinkingProfile,
  withModelThinkingProfile,
  withProviderThinkingProfile,
} from "./bridge-thinking.js";
import { projectAssistantMessageEnd } from "./bridge-message-view.js";
import {
  projectAssistantUsage,
  projectToolModelUsage,
} from "./bridge-usage-view.js";
import { assistantFailureText } from "./bridge-model-failure.js";
import {
  createThinkingRepetitionGuard,
  THINKING_REPEAT_NOTICE,
} from "./bridge-thinking-repetition.js";
import { projectSessionContextComposition } from "./bridge-context-composition.js";
import { withTokenFluxModelCompat } from "./tokenflux-model-compat.js";

const {
  currentProviderDefinition,
  isCustomRelayProvider,
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
let userMemories = [];
let userMemoryRevision = -1;
const sessionPolicies = new Map();
const sessionPolicyControllers = new Map();
const backgroundTaskControllers = new Map();
// 思考复读护栏（reasoning 那一层，工具护栏管不到）。
const thinkingRepetition = createThinkingRepetitionGuard();
const promptQueues = new Map();
const compactionRuns = new Map();
const compactionRequestIds = new Map();
const autoCompactionDeadlines = new Map();
const suppressedQueueUpdates = new Set();
const sessionTurnContracts = new Map();
const reasoningOnlyRecovered = new Map();
const reasoningOnlyPreviousTools = new Map();
const sessionModelSources = new Map();
const sessionConfiguredProviders = new Map();
const abortedSessions = new Set();
const sessionSubagentTasks = new Map();
const sessionCreateCommands = new Map();
function ignorePipeError(stream, label) {
  stream?.on("error", error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`MilkSU sidecar ${label} error: ${message}\n`);
  });
}

ignorePipeError(process.stdin, "stdin");
ignorePipeError(process.stdout, "stdout");
const input = createInterface({ input: process.stdin });
input.on("error", error => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`MilkSU sidecar input error: ${message}\n`);
});
let commandQueue = Promise.resolve();
let steeringCommandQueue = Promise.resolve();
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarResourceDirectory = existsSync(join(bridgeDirectory, "skills"))
  ? bridgeDirectory
  : resolve(bridgeDirectory, "..", "..");
const approvalRequiredCodingTools = new Set(["bash", "edit", "write"]);
// Streaming text is coalesced into ~60ms batches: one desktop event per batch instead
// of one per token. Any other event flushes the pending text first, so ordering holds.
const TEXT_DELTA_FLUSH_MS = 60;
const pendingTextDeltas = new Map();
let textDeltaTimer = null;

function flushTextDeltas() {
  if (textDeltaTimer !== null) {
    clearTimeout(textDeltaTimer);
    textDeltaTimer = null;
  }
  if (!pendingTextDeltas.size) return;
  const batches = [...pendingTextDeltas.entries()];
  pendingTextDeltas.clear();
  for (const [id, delta] of batches) {
    emit(id, "text_delta", { delta });
  }
}

function queueTextDelta(conversationId, delta) {
  if (!delta) return;
  pendingTextDeltas.set(
    conversationId,
    `${pendingTextDeltas.get(conversationId) ?? ""}${delta}`,
  );
  if (textDeltaTimer !== null) return;
  textDeltaTimer = setTimeout(flushTextDeltas, TEXT_DELTA_FLUSH_MS);
}

function applyUserMemories(command) {
  const next = applyUserMemorySnapshot(
    { memories: userMemories, revision: userMemoryRevision },
    command?.userMemories,
    command?.memoryRevision,
  );
  if (!next.applied) return;
  userMemories = next.memories;
  userMemoryRevision = next.revision;
}

function noteUserMemory(conversationId, phase, extra = {}) {
  if (!tracksUserMemory(conversationId)) return;
  emit(conversationId, "user_memory_turn", { phase, ...extra });
}

function emit(conversationId, type, data = {}) {
  if (type !== "text_delta") flushTextDeltas();
  process.stdout.write(`${JSON.stringify({ type, id: conversationId ?? null, ...data })}\n`);
}

function applyWorkerModelOverride(worker) {
  const provider = String(worker?.provider ?? "").trim();
  const model = String(worker?.model ?? "").trim();
  if (!provider || !model) {
    delete process.env.MILKSU_WORKER_MODEL;
    delete process.env.MILKSU_WORKER_THINKING;
    return;
  }
  const source = String(worker?.source ?? "").trim();
  const spec = source === "account" ? `milksu-route/${model}` : `${provider}/${model}`;
  const thinking = worker?.thinking && typeof worker.thinking === "object"
    ? worker.thinking
    : {};
  const level = thinking.enabled && String(thinking.level ?? "").trim()
    ? String(thinking.level).trim()
    : "";
  process.env.MILKSU_WORKER_MODEL = spec;
  if (/^(off|minimal|low|medium|high|xhigh|max)$/.test(level)) {
    process.env.MILKSU_WORKER_THINKING = level;
  } else {
    delete process.env.MILKSU_WORKER_THINKING;
  }
}

function billedPromptTokensFor(conversationId) {
  const stored = sessionContextUsage.get(conversationId);
  return Math.max(0, Number(stored?.inputTokens ?? 0))
    + Math.max(0, Number(stored?.cacheReadTokens ?? 0));
}

function emitContextComposition(conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  const session = sessions.get(id);
  if (!session) return;
  try {
    const stored = sessionContextUsage.get(id);
    const windowTokens = session.model?.contextWindow ?? stored?.contextWindow;
    const composition = projectSessionContextComposition(session, {
      billedPromptTokens: billedPromptTokensFor(id),
      contextWindow: windowTokens,
    });
    if (!composition) return;
    // The usage panel needs the real input budget, not the whole window: a request
    // must also leave room for the model's answer. Same source as the compaction
    // threshold, and omitted entirely when unknown so the UI keeps its old shape.
    const maxOutput = resolveMaxOutput({
      // session.model is often empty for a milksu-route session, so also ask the
      // per-conversation model source the usage events already rely on.
      modelIds: [
        session.model?.id,
        session.model?.modelId,
        session.model?.name,
        sessionModelSources.get(id),
      ],
      sessionMaxTokens: session.model?.maxTokens,
      lookupMaxTokens: knownMaxTokens,
    });
    emit(id, "context_composition", {
      contextComposition: { ...composition, ...contextUsageWindowPayload(windowTokens, maxOutput) },
    });
  } catch (error) {
    console.error("MilkSU could not project context composition", error);
  }
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

const subagentPollers = new Map();

function emitSubagentTasks(conversationId, tasks) {
  const next = Array.isArray(tasks) ? tasks : [];
  if (next.length) sessionSubagentTasks.set(conversationId, next);
  else sessionSubagentTasks.delete(conversationId);
  emit(conversationId, "subagent_tasks", {
    subagentTasks: next.map(task => ({
      id: task.id,
      role: task.role,
      status: task.status,
      toolCallId: task.toolCallId,
      durationMs: task.durationMs,
      exitCode: task.exitCode,
      yield: task.yield,
      summary: task.summary,
      transcript: task.transcript,
    })),
  });
}

function stopSubagentPoll(conversationId) {
  const timer = subagentPollers.get(conversationId);
  if (timer) clearInterval(timer);
  subagentPollers.delete(conversationId);
}

async function haltConversationSubagents(conversationId) {
  const tasks = sessionSubagentTasks.get(conversationId) ?? [];
  const workspace = sessionPolicies.get(conversationId)?.workspace;
  const outcomes = await terminateConversationSubagents(tasks, workspace);
  const skipped = outcomes.some(outcome => outcome.action === "skipped");
  if (!skipped) stopSubagentPoll(conversationId);
  const byId = new Map(outcomes.map(outcome => [outcome.id, outcome.action]));
  let changed = false;
  const next = tasks.map((task) => {
    const action = byId.get(task.id);
    if (!action || action === "skipped") return task;
    if (task.status !== "running" && task.status !== "start") return task;
    changed = true;
    if (action === "absent") {
      const snapshot = readAsyncSubagentSnapshot(task.asyncDir, workspace);
      return {
        ...task,
        status: snapshot?.status === "succeeded" ? "succeeded" : "failed",
        summary: snapshot?.summary || task.summary,
        transcript: snapshot?.transcript || task.transcript,
      };
    }
    return { ...task, status: "failed" };
  });
  if (changed) emitSubagentTasks(conversationId, next);
}

function subagentStillLive(tasks) {
  return tasks.some(task => (
    task.asyncDir
    && (task.status === "running" || task.status === "start")
  ));
}

function refreshSubagentTasks(conversationId) {
  const current = sessionSubagentTasks.get(conversationId) ?? [];
  if (!current.length) {
    stopSubagentPoll(conversationId);
    return;
  }
  const workspace = sessionPolicies.get(conversationId)?.workspace;
  let changed = false;
  const next = current.map((task) => {
    if (!task.asyncDir || (task.status !== "running" && task.status !== "start")) {
      return task;
    }
    const snapshot = readAsyncSubagentSnapshot(task.asyncDir, workspace);
    if (!snapshot) return task;
    if (
      snapshot.status !== task.status
      || snapshot.summary !== task.summary
      || snapshot.transcript !== task.transcript
    ) {
      changed = true;
    }
    return {
      ...task,
      status: snapshot.status,
      summary: snapshot.summary || task.summary,
      transcript: snapshot.transcript || task.transcript,
    };
  });
  if (!subagentStillLive(next)) stopSubagentPoll(conversationId);
  if (changed) emitSubagentTasks(conversationId, next);
}

function ensureSubagentPoll(conversationId) {
  if (subagentPollers.has(conversationId)) return;
  const timer = setInterval(() => refreshSubagentTasks(conversationId), 1000);
  timer.unref?.();
  subagentPollers.set(conversationId, timer);
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
  // Screenshots stay image blocks. The current model or provider decides
  // whether it can read them; MilkSU does not OCR because a catalog said
  // the model is text-only.
  void session;
  return undefined;
}

function truncate(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

function createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession, conversationId) {
  return (pi) => {
    let latestPlan = [];
    pi.registerTool({
      name: codingAskToolName,
      label: "MilkSU ask",
      description: "Show a tappable choice card with 2-6 options. Use when asking a multiple-choice question or when the user asks you to present options. Wait for the selected option; do not write the choices as a numbered or bulleted list.",
      parameters: Type.Object({
        question: Type.String({ minLength: 1, maxLength: 200 }),
        options: Type.Array(Type.Object({
          id: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
          label: Type.String({ minLength: 1, maxLength: 80 }),
          detail: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        }), { minItems: 2, maxItems: 6 }),
      }),
      async execute(_toolCallId, params) {
        const options = normalizeAskOptions(params.options);
        const question = String(params.question ?? "").trim();
        if (!question) throw new Error("milksu_ask needs a question");
        if (options.length < 2) throw new Error("milksu_ask needs at least two options");
        const picked = await approvalBroker.requestChoice({
          conversationId,
          question,
          options,
        });
        if (!picked) {
          return {
            content: [{ type: "text", text: formatAskSelection(null) }],
          };
        }
        return {
          content: [{
            type: "text",
            text: formatAskSelection(picked),
          }],
          details: { question, selected: picked },
        };
      },
    });
    pi.registerTool({
      name: "request_destructive_delete",
      label: "MilkSU destructive delete",
      description: "Ask the user before deleting something recursively. Fill in purpose (why this deletion is needed) and safety (what it is and whether it can be restored). A recursive delete from bash also pauses for the same confirmation; use this tool when you already know the path and the reason.",
      parameters: Type.Object({
        path: Type.String({ minLength: 1, maxLength: 4096 }),
        purpose: Type.String({ minLength: 1, maxLength: 2000 }),
        safety: Type.String({ minLength: 1, maxLength: 2000 }),
      }),
      async execute(_toolCallId, params) {
        const target = String(params.path ?? "").trim();
        const purpose = String(params.purpose ?? "").trim();
        const safety = String(params.safety ?? "").trim();
        if (!target || !purpose || !safety) {
          throw new Error("path, purpose and safety are all required");
        }
        const policy = await loadSessionPolicy(process.cwd(), "", {});
        const decision = await destructiveDeleteDecision({
          toolName: "bash",
          input: { command: `rm -rf ${JSON.stringify(target)}` },
          policy,
        });
        if (decision?.action === "block") {
          emit(conversationId, "destructive.blocked", { notice: decision.reason });
          throw new Error(decision.reason);
        }
        // The card judges a *delete*, so the approval always carries the delete in the shape
        // the guard uses (see destructiveDeleteApproval). Unmeasurable cases also arrive
        // as approval. If a later switch uses refuseUnmeasuredDelete, that block reason
        // is thrown here so the model can change the command.
        const approval = destructiveDeleteApproval({
          target,
          decision,
          chinese: policy?.uiLocale !== "en",
        });
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: approval.content,
          input: truncate(approval.input, 16000),
          justification: { purpose, safety },
        });
        if (!approved) {
          return { content: [{ type: "text", text: "MilkSU user denied this deletion." }] };
        }
        await rm(target, { recursive: true, force: true });
        return {
          content: [{ type: "text", text: `Deleted ${target}` }],
          details: { path: target, purpose, safety },
        };
      },
    });
    pi.registerTool({
      name: "milksu_progress",
      label: "MilkSU progress",
      description: "Publish or update a short execution plan (summary + up to 8 steps) when the task has more than one concrete step. Skip one-shot replies. Keep the in-progress step updated.",
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
      const policy = getPolicy?.();
      return {
        systemPrompt: composeMilkSUWorkflowSystemPrompt(event.systemPrompt, {
          sessionRole,
          policy,
        }),
      };
    });
  };
}

function createCodingPermissionExtension(
  conversationId,
  getPolicy,
  getTurnContract,
  registerController,
  getUserMemories,
) {
  return (pi) => {
    const repeatGuard = createToolRepeatGuard();
    registerController({
      setActiveTools: names => pi.setActiveTools(names),
    });
    pi.on("before_agent_start", () => {
      repeatGuard.reset();
    });
    pi.on("context", async (event) => {
      const contracted = filterCodingTurnContractMessages(
        event.messages,
        getTurnContract(),
      );
      const memories = tracksUserMemory(conversationId) && typeof getUserMemories === "function"
        ? getUserMemories()
        : [];
      const messages = withUserMemoryMessages(contracted, memories, {
        locale: getPolicy()?.uiLocale,
      });
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
        emit(conversationId, "destructive.blocked", { notice: deleteDecision.reason });
        return {
          block: true,
          reason: deleteDecision.reason,
        };
      }
      if (deleteDecision?.action === "approval") {
        const chinese = policy?.uiLocale !== "en";
        // A background task cannot show a card. Risky and unmeasurable deletes still
        // ask in the foreground. If a later switch uses refuseUnmeasuredDelete, the
        // block reason above is what the model sees.
        if (event.toolName === "bg_task") {
          const blockReason = chinese
            ? "后台任务无法弹出确认。请在前台执行这条删除，以便确认。"
            : "MilkSU refused this deletion: a background task cannot be approved "
              + "interactively. Run it in the foreground so it can be reviewed.";
          emit(conversationId, "destructive.blocked", { notice: blockReason });
          return {
            block: true,
            reason: blockReason,
          };
        }
        const justification = destructiveJustification(event.input);
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: deleteDecision.content,
          input: truncate(deleteDecision.input, 16000),
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
          return {
            block: true,
            reason: "MilkSU user denied broad recursive deletion",
          };
        }
        destructiveDeleteApproved = true;
        // The approval is spent here: it authorises exactly this command against exactly
        // these targets in this conversation, once. Re-running it needs a new review.
        const approvedCommand = commandForTool(event.toolName, event.input);
        issueDestructiveDeleteCredential({
          command: approvedCommand,
          conversationId,
          targets: recursiveDeleteTargets(approvedCommand),
        });
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
        authorizedByDraw: policy.imageDraw === true,
      });
      if (imageGenDecision) return imageGenDecision;
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
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        if (subagentCallRequiresApproval(
          subagentRequest.externalCli,
          policy.approvalPolicy,
        )) {
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
      const repeat = repeatGuard.inspect(event.toolName, event.input);
      if (repeat?.ask) {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: toolBudgetToolName,
          content: toolBudgetPrompt(repeat.count),
          input: String(repeat.count),
        });
        if (!approved) {
          return {
            block: true,
            terminate: true,
            reason: "本轮已停止。",
          };
        }
        return undefined;
      }
      if (repeat) return repeat;
      return undefined;
    });

    pi.on("before_agent_start", async (event) => {
      const uiLocale = getPolicy()?.uiLocale;
      const turnGuidance = codingTurnContractGuidance(getTurnContract(), uiLocale);
      if (!turnGuidance) return undefined;
      const heading = uiLocale === "en" ? "MilkSU per-turn contract" : "MilkSU 本回合合同";
      const result = {
        systemPrompt: `${event.systemPrompt}`
          + `\n\n${heading}:\n${turnGuidance}`,
      };
      if (turnGuidance) {
        result.message = {
          customType: codingTurnContractMessageType,
          content: codingTurnContractContext(getTurnContract(), uiLocale),
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
  if (toolName === codingAskToolName) {
    const question = String(args.question ?? "").trim();
    const options = normalizeAskOptions(args.options);
    return formatAskToolInput(question, options);
  }
  if (toolName === codingCollaborationToolName) {
    return formatSubagentToolInput(args);
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
  if (["edit", "write"].includes(toolName) && path) {
    if (toolName === "write" && typeof args.content === "string") {
      const lines = args.content.length ? args.content.split("\n").length : 0;
      return lines ? `${path} +${lines}` : path;
    }
    if (toolName === "edit" && Array.isArray(args.edits)) {
      let add = 0;
      let del = 0;
      for (const edit of args.edits) {
        const oldText = String(edit?.oldText ?? "");
        const newText = String(edit?.newText ?? "");
        if (oldText) del += oldText.split("\n").length;
        if (newText) add += newText.split("\n").length;
      }
      if (add || del) return `${path} +${add} -${del}`;
    }
    return path;
  }
  if (toolName === "grep" && typeof args.pattern === "string") {
    return `${args.pattern}${path ? ` · ${path}` : ""}`;
  }
  if (["find", "ls"].includes(toolName) && path) return path;
  return truncate(JSON.stringify(args, null, 2), 4000);
}

function registerAccountModel(session, provider, model, thinking) {
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
    models: [withModelThinkingProfile({
      ...source,
      id: accountModelID,
      name: source?.name ?? accountModelID,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: registeredContextWindow(
        accountModelID,
        source?.contextWindow,
        contextWindowOverride("tokenflux", accountModelID),
      ),
      maxTokens: registeredMaxTokens(accountModelID, source?.maxTokens),
    }, thinking)],
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

function childProviderSecrets(provider, turnProvider, envName) {
  if (!String(envName ?? "").startsWith("MILKSU_SUBAGENT_KEY_")) return {};
  const key = String(turnProvider?.key ?? "");
  if (!key || String(turnProvider?.id ?? "").trim() !== String(provider ?? "").trim()) return {};
  return { [envName]: key };
}

function rememberChildModelRegistry({
  conversationId,
  provider,
  model,
  thinking,
  turnProvider,
  definition,
  account,
  sources,
  effectiveProvider,
}) {
  const providers = [];
  const secrets = {};
  if (definition) {
    const envName = apiKeyEnvFor(provider, process.env, turnProvider);
    Object.assign(secrets, childProviderSecrets(provider, turnProvider, envName));
    const shaped = withProviderThinkingProfile(definition, model, thinking);
    const published = publicProvider(provider, shaped, envName);
    if (published) providers.push(published);
  }
  if (account?.model) {
    const published = publicProvider("milksu-account", {
      name: "MilkSU 账户分配模型",
      baseUrl: relayUrl,
      api: account.model.api || "openai-completions",
      models: [withModelThinkingProfile({
        id: account.id,
        name: account.model.name || account.id,
        reasoning: account.model.reasoning,
        thinkingLevelMap: account.model.thinkingLevelMap,
        input: account.model.input,
        cost: account.model.cost,
        contextWindow: account.model.contextWindow,
        maxTokens: account.model.maxTokens,
        compat: account.model.compat,
      }, thinking)],
    }, "MILKSU_RELAY_KEY");
    if (published) providers.push(published);
  }
  // milksu-route is an in-process stream. The child keeps that provider id
  // and the first source's transport, so the inherited model string resolves.
  // It does not replay the parent's live source failover.
  if (effectiveProvider === "milksu-route" && sources?.[0]?.model) {
    const source = sources[0].model;
    const sourceEnv = apiKeyEnvFor(source.provider, process.env, turnProvider);
    const baseUrl = source.baseUrl || (source.provider === "milksu-account" ? relayUrl : definition?.baseUrl);
    const published = baseUrl ? publicProvider("milksu-route", {
      name: "MilkSU 模型来源",
      baseUrl,
      api: source.api || definition?.api || "openai-completions",
      models: [{
        id: model,
        name: source.name || model,
        reasoning: source.reasoning,
        thinkingLevelMap: source.thinkingLevelMap,
        input: source.input,
        cost: source.cost,
        contextWindow: source.contextWindow,
        maxTokens: source.maxTokens,
        compat: source.compat,
      }],
    }, sourceEnv || apiKeyEnvFor(provider, process.env, turnProvider)) : undefined;
    if (published) providers.push(published);
  }
  rememberSessionProviders(conversationId, providers, secrets);
}

function configureRuntimeModel(
  session,
  provider,
  model,
  conversationId,
  sourceOrder,
  thinking,
  turnProvider,
  locale,
) {
  sessionConfiguredProviders.set(conversationId, String(provider ?? "").trim());
  // The conversation's own relay rides with the turn: this process may have been spawned for a
  // different one, and without the definition the chosen provider cannot resolve at all.
  const definition = currentProviderDefinition(provider, model, process.env, turnProvider);
  if (definition) {
    // Personal TokenFlux keys may be single-model (bare id) or composite
    // (prefix/model). Official providers keep their native ids unchanged.
    session.modelRuntime.registerProvider(
      provider,
      withProviderThinkingProfile(
        provider === "tokenflux" ? withTokenFluxModelCompat(definition) : definition,
        model,
        thinking,
      ),
    );
  }
  const personalModel = session.modelRuntime.getModel(provider, model);
  const account = relayEnabled
    ? registerAccountModel(session, provider, model, thinking)
    : { id: "", model: undefined, unavailable: false };
  const available = new Map([
    ["account", account.model],
    ["personal", personalModel && session.modelRuntime.hasConfiguredAuth(provider)
      ? personalModel
      : undefined],
  ]);
  const requestedOrder = normalizeCommandModelSourceOrder(sourceOrder);
  // A relay the user configured is never served by the account source, and an unreachable chosen
  // source is a failure instead of a substitution: the incident showed the picker saying
  // custom-relay-deepseek/deepseek-flash while the engine answered from milksu-account with a
  // different model id. The global default model is never used to stand in for a conversation's
  // own choice either.
  const customRelay = isCustomRelayProvider(provider, process.env, turnProvider);
  const selection = selectModelSources({
    requestedOrder,
    accountModel: account.model,
    personalModel: available.get("personal"),
    customRelay,
  });
  if (selection.failure) {
    const english = String(locale ?? "").toLowerCase().startsWith("en");
    const detail = account.unavailable && requestedOrder.includes("account")
      ? (english
        ? `The account allocation does not cover ${account.id}.`
        : `账户分配模型不支持 ${account.id}。`)
      : "";
    const message = modelSourceFailureMessage({
      provider,
      model,
      requestedOrder,
      // The source this turn was meant to use, so an account failure is never reported as personal
      // just because both appear in the order.
      source: selection.failure.intendedSource,
      locale,
      detail,
    });
    emit(conversationId, "model_source_unavailable", {
      provider,
      model,
      requestedOrder,
      reason: selection.failure.reason,
      message,
      notice: message,
    });
    throw new Error(message);
  }
  const sources = selection.sources;
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
    rememberChildModelRegistry({
      conversationId,
      provider,
      model,
      thinking,
      turnProvider,
      definition,
      account,
      sources,
      effectiveProvider: sources[0].model.provider,
    });
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
  rememberChildModelRegistry({
    conversationId,
    provider,
    model,
    thinking,
    turnProvider,
    definition,
    account,
    sources,
    effectiveProvider: "milksu-route",
  });
  return { provider: "milksu-route", model };
}

async function setSessionModel(conversationId, session, provider, model, thinking) {
  if (!provider || !model) return;

  const desired = session.modelRuntime.getModel(provider, model);
  if (!desired) {
    throw new Error(`Model not found: ${provider}/${model}`);
  }
  await session.setModel(desired);
  const profile = normalizeThinkingProfile(thinking);
  session.setThinkingLevel(profile.enabled ? profile.level : "off");
  emit(conversationId, "model_selected", { provider, model });
  emit(conversationId, "thinking_level_selected", {
    enabled: profile.enabled,
    levels: profile.levels,
    level: session.thinkingLevel,
  });
}

function subscribeSession(
  conversationId,
  session,
  maxToolEventOutputBytes,
  usageModule,
) {
  let assistantTextStreamed = false;
  let thinkingStreamed = false;
  const thinkingStartedAt = new Map();
  const toolStartedAt = new Map();

  session.subscribe((event) => {
    if (
      event.type === "compaction_start"
      || event.type === "compaction_end"
    ) {
      const requestId = event.reason === "manual"
        ? compactionRequestIds.get(conversationId)
        : undefined;
      if (event.type === "compaction_start" && event.reason !== "manual") {
        armAutoCompactionDeadline(autoCompactionDeadlines, conversationId, () => {
          try {
            session.abortCompaction?.();
          } catch {
            // Pi may have settled between the deadline and this cancellation.
          }
        });
      } else {
        clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
      }
      const projected = projectCompactionEvent(event, requestId);
      if (event.type === "compaction_end" && requestId) {
        compactionRequestIds.delete(conversationId);
      }
      if (
        event.type === "compaction_end"
        && !event.aborted
        && event.result
      ) {
        recordSessionContextUsage(conversationId, {
          inputTokens: Number(event.result.estimatedTokensAfter ?? 0),
          cacheReadTokens: 0,
        }, session.model?.contextWindow);
      }
      if (projected) {
        emit(conversationId, projected.type, projected.data);
      }
      emitContextComposition(conversationId);
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
      if (update.type === "thinking_start") {
        thinkingStreamed = true;
        if (!thinkingStartedAt.has(conversationId)) {
          thinkingStartedAt.set(conversationId, Date.now());
        }
        thinkingRepetition.reset(conversationId);
        emit(conversationId, "thinking_start", {});
      } else if (update.type === "thinking_delta") {
        thinkingStreamed = true;
        emit(conversationId, "thinking_delta", { delta: update.delta ?? "" });

        // 思考复读：连续 N 行一模一样时**先报给决策层复核**（引擎侧 gateGuardAlarm），
        // 由它区分真卡住与合法重复（表格、日志、进度行），复核通过才到读者眼前。
        // 事件名用 guard.alarm（引擎透传名单里有此名），载荷成对双语，前端按界面语言选一句。
        const repeat = thinkingRepetition.push(conversationId, update.delta ?? "");
        if (repeat) {
          emit(conversationId, "guard.alarm", {
            toolName: "",
            reason: `thinking repeated ${repeat.run} lines: ${repeat.line}`,
            repeatLine: repeat.line,
            sample: repeat.sample,
            notice: THINKING_REPEAT_NOTICE.notice,
            noticeEnglish: THINKING_REPEAT_NOTICE.noticeEnglish,
          });
        }
      } else if (update.type === "thinking_end") {
        thinkingStreamed = true;
        const startedAt = thinkingStartedAt.get(conversationId);
        thinkingStartedAt.delete(conversationId);
        emit(conversationId, "thinking_done", {
          content: update.content ?? "",
          durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
        });
      } else if (update.type === "text_delta") {
        assistantTextStreamed = true;
        queueTextDelta(conversationId, String(update.delta ?? ""));
      }
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      for (const projected of projectAssistantMessageEnd(event.message, {
        textStreamed: assistantTextStreamed,
        thinkingStreamed,
      })) {
        emit(conversationId, projected.type, projected.data);
      }
      // 模型调用失败（如 429）时 pi 会给出 stopReason:"error" + errorMessage —— 以前这里只取 usage
      // ⇒ 失败被整条丢掉 ⇒ 引擎收不到、界面也收不到 ⇒ 读者只能对着空回合（真事：tokenflux 回 429）。
      const failure = assistantFailureText(event.message);
      if (failure) {
        emit(conversationId, "error", { error: failure });
        // 先把自己标成“已中止”，再中止：否则中止引发的异常会走下面那条笼统错误回调，
        // 读者会看到**两条**错误（一条具体、一条笼统）——一条就够。
        abortedSessions.add(conversationId);
        // 光报告不够：pi 会把失败当一步继续跑 ⇒ 同一轮反复重试、还烧额度（真事）。
        void session.abort().catch(() => undefined);
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
        emitContextComposition(conversationId);
      }
      assistantTextStreamed = false;
      thinkingStreamed = false;
      thinkingStartedAt.delete(conversationId);
      return;
    }

    if (event.type === "tool_execution_start") {
      toolStartedAt.set(event.toolCallId, Date.now());
      if (event.toolName === codingCollaborationToolName) {
        const policy = sessionPolicies.get(conversationId);
        emitSubagentTasks(conversationId, [
          ...(sessionSubagentTasks.get(conversationId) ?? []),
          ...projectSubagentRosterStart(event.args, {
            toolCallId: event.toolCallId,
            workspace: policy?.workspace,
            worktrees: policy?.codingCollaboration?.worktrees,
          }),
        ]);
      }
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
      if (event.toolName === codingCollaborationToolName) {
        const policy = sessionPolicies.get(conversationId);
        const current = sessionSubagentTasks.get(conversationId) ?? [];
        const owned = current.filter(task => task.toolCallId === event.toolCallId);
        const others = current.filter(task => task.toolCallId !== event.toolCallId);
        const wrapped = projectSubagentToolResult({
          ...event.result,
          toolName: event.toolName,
          input: event.args ?? event.input,
          details: event.result?.details,
          content: event.result?.content,
        }, {
          workspace: policy?.workspace,
          collaboration: policy?.codingCollaboration,
          worktrees: policy?.codingCollaboration?.worktrees,
        });
        const projected = projectSubagentRosterEnd(owned, wrapped, {
          toolCallId: event.toolCallId,
          durationMs: startedAt === undefined
            ? undefined
            : Math.max(0, Date.now() - startedAt),
          isError: event.isError,
        });
        emitSubagentTasks(conversationId, [
          ...others,
          ...projected,
        ]);
        if (subagentStillLive(sessionSubagentTasks.get(conversationId) ?? [])) {
          ensureSubagentPoll(conversationId);
        }
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
        emitContextComposition(conversationId);
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

async function loadProjectInstructions(cwd, uiLocale) {
  try {
    const content = await readFile(join(cwd, "AGENTS.md"), "utf8");
    const path = join(cwd, "AGENTS.md");
    const prefix = uiLocale === "en"
      ? `Project instructions from ${path}:`
      : `来自 ${path} 的项目说明：`;
    return `${prefix}\n\n${truncate(content, 64000)}`;
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
    createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession, conversationId),
    createReasoningOnlyRecoveryExtension({
      isAborted: () => abortedSessions.has(conversationId),
      wasRecovered: () => reasoningOnlyRecovered.get(conversationId) === true,
      markRecovered: () => reasoningOnlyRecovered.set(conversationId, true),
      applyNoTools: () => {
        const session = sessions.get(conversationId);
        const tools = typeof session?.getActiveToolNames === "function"
          ? session.getActiveToolNames()
          : [];
        reasoningOnlyPreviousTools.set(conversationId, tools);
        sessionTurnContracts.set(conversationId, {
          toolAccess: "none",
          reason: "text_projection",
        });
        sessionPolicyControllers.get(conversationId)?.setActiveTools([]);
      },
      restoreTools: () => {
        const previous = reasoningOnlyPreviousTools.get(conversationId);
        sessionTurnContracts.delete(conversationId);
        if (previous) {
          sessionPolicyControllers.get(conversationId)?.setActiveTools(previous);
        }
        reasoningOnlyPreviousTools.delete(conversationId);
      },
      getUiLocale: () => sessionPolicies.get(conversationId)?.uiLocale,
    }),
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
        () => userMemories,
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
      createEnvExtension(
        conversationId,
        sessionRole,
        getPolicy,
        request => workspaceActionBroker.request(request),
      ),
      createComputerUseDriverExtension(
        conversationId,
        getPolicy,
        request => workspaceActionBroker.request(request),
      ),
      createComputerUseToolExtension(getPolicy),
      piSubagentsExtension,
      createSubagentYieldExtension(() => {
        const policy = getPolicy?.();
        return {
          workspace: policy?.workspace || cwd,
          collaboration: policy?.codingCollaboration,
          worktrees: policy?.codingCollaboration?.worktrees,
        };
      }),
  );
  if (mcpConfig) {
    extensionFactories.push(createMcpAdapter({ config: mcpConfig }));
  }
  // Bash safety: Pi treats the bash timeout as optional, so one call can hold a turn
  // open indefinitely. Give every call a default bound and explain the ones that hit it.
  extensionFactories.push(createHangGuardExtension());
  // Last: Pi tool_result middleware. Every tool, including MCP, is clipped to
  // Pi's 50KB/2000-line contract before the result enters model context.
  extensionFactories.push(createToolResultBoundExtension());
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

function reviewedCodingResourceRoots(
  sessionRole = "",
  disabledSkills = [],
  extraSkillPaths = [],
) {
  void sessionRole;
  const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  return [
    ...resolveCodingSkillPaths(
      sidecarResourceDirectory,
      sessionRole,
      disabledSkills,
      extraSkillPaths,
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
  const extraSkillPaths = Array.isArray(command.userSkillPaths)
    ? command.userSkillPaths
    : [];
  const selectedMcp = await loadCodingMcpConfig(
    cwd,
    command.mcpServers,
    command.mcpConfigDigest,
    command.codingBrowser,
    command.computerUse,
    browserUse,
    securityTools,
    command.userMcpServers,
    command.recoveryPurpose !== "background-tasks",
    {
      conversationId: command.conversationId,
      reserveCodingBrowser: command.executionMode === "go"
        && command.approvalPolicy !== "read-only"
        && command.recoveryPurpose !== "background-tasks",
    },
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
    imageGenConfigured: imageGenIsConfigured(),
    imageDraw: command.imageDraw === true,
  });
  const effectiveSessionRole = resolveWorkflowSessionRole(
    command.sessionRole,
    policy.ctf,
  );
  const disabledSkills = Array.isArray(command.disabledSkills)
    ? command.disabledSkills
    : [];
  const codingSkillPaths = resolveCodingSkillPaths(
    sidecarResourceDirectory,
    effectiveSessionRole,
    disabledSkills,
    extraSkillPaths,
  );
  const codingResourceRoots = reviewedCodingResourceRoots(
    effectiveSessionRole,
    disabledSkills,
    extraSkillPaths,
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
      imageGenConfigured: imageGenIsConfigured(),
      imageDraw: command.imageDraw === true,
      readOnlyResourceRoots: codingResourceRoots,
    });
  }
  policy.imageDraw = command.imageDraw === true;
  policy.skillNames = codingSkillPaths.map(path => basename(path));
  policy.userMcpServers = command.userMcpServers && typeof command.userMcpServers === "object"
    ? command.userMcpServers
    : {};
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

function configureSubagentRuntime() {
  const packagedRoot = join(bridgeDirectory, "node_modules", "pi-subagents");
  const developmentRoot = join(sidecarResourceDirectory, "node_modules", "pi-subagents");
  const root = existsSync(join(packagedRoot, "package.json"))
    ? packagedRoot
    : developmentRoot;
  if (!existsSync(join(root, "package.json"))) {
    throw new Error(`MilkSU subagent package is unavailable: ${root}`);
  }
  const guard = join(bridgeDirectory, "pi-subagents-spawn.cjs");
  if (!existsSync(guard)) {
    throw new Error(`MilkSU subagent spawn guard is unavailable: ${guard}`);
  }
  process.env.MILKSU_PI_SUBAGENTS_ROOT = root;
  process.env.MILKSU_PI_SUBAGENT_SPAWN_GUARD = guard;
  process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY = "1";
  delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
}

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  applyWorkerModelOverride(command.workerModel);

  const existing = sessions.get(conversationId);
  if (existing) {
    // Re-enable on every reuse. A persisted Pi settings file can leave
    // compaction off; Coding / CTF / CVE / lab sessions must never run without it.
    if (typeof existing.setAutoCompactionEnabled === "function") {
      existing.setAutoCompactionEnabled(true);
    }
    sessionCreateCommands.set(conversationId, command);
    return existing;
  }

  const cwd = process.cwd();
  const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
  const projectInstructions = await loadProjectInstructions(
    cwd,
    command.locale === "en" ? "en" : "zh",
  );
  const {
    policy: sessionPolicy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig,
    securityTools,
  } = await loadRuntimeSessionPolicy(cwd, command);
  applyCodingResourcePolicy();
  configureSubagentRuntime();
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
        ...sessionPolicy.activeTools,
        codingCollaborationToolName,
        "computer_use",
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
    // Pi owns auto-compaction. Never leave it off for Coding, CTF, CVE, or lab.
    if (typeof session.setAutoCompactionEnabled === "function") {
      session.setAutoCompactionEnabled(true);
    }
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
      command.thinking,
      command.customProvider,
      command.locale,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
      command.thinking,
    );

    sessions.set(conversationId, session);
    sessionCreateCommands.set(conversationId, command);
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
    emitContextComposition(conversationId);
    emitBackgroundTasks(conversationId);
    emitGoalState(conversationId, session);
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
  applyUserMemories(command);
  applyWorkerModelOverride(command.workerModel);
  // abort_session is handled immediately. send_message setup stays on the
  // stdin command queue; the prompt itself is per-conversation so another
  // session in this workspace can start without waiting for this turn.
  if (dropSendAfterAbort(abortedSessions, sessions, conversationId)) {
    emit(conversationId, "turn_settled");
    return;
  }
  reasoningOnlyRecovered.delete(conversationId);

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
      || userMcpSelectionChanged(previousPolicy.userMcpServers, command.userMcpServers)
      || pluginMcpSessionRequiresReload(
        previousPolicy.mcpServers,
        command.recoveryPurpose,
      )
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
      || previousPolicy.codingCollaborationToolScopeStale === true
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
          resolveCodingSkillPaths(
            sidecarResourceDirectory,
            "",
            command.disabledSkills,
            command.userSkillPaths,
          ).map(path => basename(path)),
        )
    )
  ) {
    await haltConversationSubagents(conversationId);
    await disposeAgentSession(existing, "reload");
    sessions.delete(conversationId);
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    sessionModelSources.delete(conversationId);
    sessionConfiguredProviders.delete(conversationId);
    forgetSessionProviders(conversationId);
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
    if (typeof session.setAutoCompactionEnabled === "function") {
      session.setAutoCompactionEnabled(true);
    }
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
      command.thinking,
      command.customProvider,
      command.locale,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
      command.thinking,
    );
    emit(conversationId, "policy_updated", {
      tools: session.getActiveToolNames(),
      executionMode: sessionPolicy.executionMode,
      approvalPolicy: sessionPolicy.approvalPolicy,
      capabilities: sessionPolicy.capabilities,
    });
    emitContextComposition(conversationId);
  }

  const rememberTurn = tracksUserMemory(conversationId) && !isCompanionRelay(command.prompt);
  enqueueConversationPrompt(promptQueues, conversationId, async () => {
    if (rememberTurn) noteUserMemory(conversationId, "begin");
    let settled = false;
    try {
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
    if (command.branchFromUserOccurrence !== undefined) {
      try {
        await session.abort();
      } catch {
        // Restarting from an earlier user message should not fail because the
        // previous turn was already idle.
      }
      await navigateFromUserMessage(session, Number(command.branchFromUserOccurrence));
    }
    await compactIfContextNearLimit(conversationId, session);
    const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    const prepared = await preparePromptAttachments(
      command.attachments,
      attachmentRoot,
      { uiLocale: command.locale === "en" ? "en" : "zh" },
    );
    const contract = normalizeCodingTurnContract(command.turnPolicy);
    const prompt = `${command.prompt ?? ""}${prepared.context}`;
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
    await compactIfContextNearLimit(conversationId, session);
    if (abortedSessions.has(conversationId)) return;
    settled = true;
    if (rememberTurn) {
      noteUserMemory(conversationId, "finish", {
        userText: String(command.prompt ?? ""),
        assistantText: lastAssistantText(session),
      });
    }
    } finally {
      if (rememberTurn && !settled) noteUserMemory(conversationId, "finish", { aborted: true });
    }
  }, (error) => {
    if (abortedSessions.delete(conversationId)) return;
    emit(conversationId, "error", { error: describeError(error) });
  });
}

async function abortSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  abortedSessions.add(conversationId);
  approvalBroker.cancelConversation(conversationId, "turn aborted");
  workspaceActionBroker.cancelConversation(conversationId, "turn aborted");
  pendingWorkspaceCompaction.delete(conversationId);
  const session = sessions.get(conversationId);
  const halted = haltConversationSubagents(conversationId);
  if (!session) {
    await halted;
    emit(conversationId, "turn_settled");
    return;
  }
  // session.abort() only interrupts the agent loop. A compaction is a separate
  // Pi controller, so without this the stop button cannot end a compaction the
  // user is waiting on. Pi emits its own aborted compaction_end in response.
  clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
  try {
    session.abortCompaction?.();
  } catch {
    // Nothing was compacting, or Pi already settled it.
  }
  await halted;
  await session.abort();
  if (tracksUserMemory(conversationId)) {
    noteUserMemory(conversationId, "finish", { aborted: true });
  }
  // Do not synthesize empty message_done (it became a blank assistant bubble).
  // If Pi already emitted agent_settled, a second turn_settled is harmless in
  // the UI (finishRun is idempotent). If abort raced past agent_settled, this
  // closes the desktop run clock without inventing assistant text.
  emit(conversationId, "turn_settled");
}

async function forkSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId) ?? await createSession(command);
    const forked = forkFromMessage(
      session,
      command.role === "assistant" ? "assistant" : "user",
      Number(command.occurrence ?? 0),
    );
    emit(conversationId, "session_forked", {
      requestId,
      forkedSessionId: forked.sessionId,
      path: forked.path,
    });
  } catch (error) {
    emit(conversationId || null, "session_forked", {
      requestId,
      error: describeError(error),
    });
  }
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
  }
  // Cancel manual and Pi-initiated compaction alike; either one holds an open
  // summarization request that disposal would otherwise wait on.
  try {
    session?.abortCompaction?.();
  } catch {
    // Disposal below still terminates the session.
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
  clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
  sessionTurnContracts.delete(conversationId);
  reasoningOnlyRecovered.delete(conversationId);
  reasoningOnlyPreviousTools.delete(conversationId);
  await haltConversationSubagents(conversationId);
  await disposeAgentSession(session);
  sessions.delete(conversationId);
  sessionPolicies.delete(conversationId);
  sessionPolicyControllers.delete(conversationId);
  sessionModelSources.delete(conversationId);
  sessionConfiguredProviders.delete(conversationId);
  forgetSessionProviders(conversationId);
  sessionSubagentTasks.delete(conversationId);
  backgroundTaskControllers.delete(conversationId);
  promptQueues.delete(conversationId);
  abortedSessions.delete(conversationId);
  sessionCreateCommands.delete(conversationId);
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
    choice: command.choice,
  });
}

async function attachCodingBrowserDescriptor(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId || command.codingBrowser == null) return;
  const attached = await writeCodingBrowserDescriptor(
    conversationId,
    command.codingBrowser,
  );
  if (!attached) return;
  const policy = sessionPolicies.get(conversationId);
  if (!policy) return;
  policy.codingBrowser = attached.browser;
  if (!Array.isArray(policy.mcpServers)) policy.mcpServers = [];
  if (!policy.mcpServers.includes(codingBrowserMcpServerName)) {
    policy.mcpServers.push(codingBrowserMcpServerName);
  }
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

async function compactIfContextNearLimit(conversationId, session) {
  if (!session) return;
  if (typeof session.setAutoCompactionEnabled === "function") {
    session.setAutoCompactionEnabled(true);
  }
  if (session.isCompacting) return;
  const stored = sessionContextUsage.get(conversationId);
  // 阈值按模型算：拿得到 maxOutput 才传；拿不到 ⇒ 传无效值 ⇒ 自动保持 0.80（不回归）。
  const windowMaxOutput = resolveMaxOutput({
    // Same fallback as the context_composition payload: a milksu-route session
    // often has no session.model, but the per-conversation model source is set.
    modelIds: [
      session.model?.id,
      session.model?.modelId,
      session.model?.name,
      sessionModelSources.get(conversationId),
    ],
    sessionMaxTokens: session.model?.maxTokens,
    lookupMaxTokens: knownMaxTokens,
  });
  const snapshot = contextUsageSnapshot(
    stored,
    session.model?.contextWindow || stored?.contextWindow,
    { maxOutput: windowMaxOutput },
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
    emitContextComposition(conversationId);
  } catch (error) {
    emit(conversationId, "compaction_end", {
      reason: "auto",
      aborted: /cancelled|timed out|aborted/i.test(describeError(error)),
      error: describeError(error),
    });
  }
}

async function rewindSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    const result = await rewindLastExploration(session);
    emit(conversationId, "session_rewound", {
      requestId,
      keptEntryId: result.keptEntryId,
    });
  } catch (error) {
    emit(conversationId || null, "session_rewound", {
      requestId,
      error: describeError(error),
    });
  }
}

async function handoffSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    const parentCommand = sessionCreateCommands.get(conversationId);
    if (!parentCommand) {
      throw new Error("Wait for the first assistant response before handing off");
    }
    const point = lastForkPoint(session);
    if (!point) {
      throw new Error("Nothing to hand off");
    }
    if (typeof session.abort === "function") {
      await session.abort();
    }
    const forked = forkFromMessage(session, point.role, point.occurrence);
    const forkedSession = await createSession({
      ...parentCommand,
      conversationId: forked.sessionId,
      requestId,
    });
    const compaction = await compactSession(forkedSession);
    emit(conversationId, "session_handoff", {
      requestId,
      forkedSessionId: forked.sessionId,
      compaction: {
        tokensBefore: compaction?.tokensBefore,
        estimatedTokensAfter: compaction?.estimatedTokensAfter,
        summary: compaction?.summary || "",
      },
    });
  } catch (error) {
    emit(conversationId || null, "session_handoff", {
      requestId,
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
    if (!sessionPolicies.get(conversationId)) {
      throw new Error(`Coding session is not ready: ${conversationId}`);
    }
    compactionRequestIds.set(conversationId, requestId);
    const run = (async () => {
      try {
        const result = await compactSession(session);
        recordSessionContextUsage(conversationId, {
          inputTokens: Number(result?.estimatedTokensAfter ?? 0),
          cacheReadTokens: 0,
        }, session.model?.contextWindow);
        emitContextComposition(conversationId);
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
        policy.executionMode !== "go"
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

async function handleDecisionQuery(command) {
  const conversationId = String(command?.conversationId ?? "").trim();
  const target = conversationId ? sessions.get(conversationId) : null;
  if (!target?.model || typeof target?.modelRuntime?.completeSimple !== "function") {
    emit(conversationId || null, "decision_answer", {
      id: String(command?.id ?? "").trim(),
      error: "session model is not ready",
    });
    return;
  }
  await answerDecisionQuery(command, {
    emitEvent: (type, data) => emit(conversationId || null, type, data),
    complete: context => target.modelRuntime.completeSimple(target.model, context, { reasoning: "low" }),
    readText: messageText,
  });
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      await createSession(command);
      break;
    case "decision_query":
      // 决策层主模型兜底：后端问这条会话的主模型一个轻量问题，不另开
      // 内核、不在当轮顺口识别，答案原样回给后端解析。
      void handleDecisionQuery(command);
      break;
    case "send_message":
      await sendMessage(command);
      break;
    case "update_user_memory":
      applyUserMemories(command);
      break;
    case "steer_message":
      await steerSession(sessions, command);
      break;
    case "followup_message":
      await followUpSession(sessions, command);
      break;
    case "relay_message":
      await relaySession(sessions, command);
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
    case "fork_session":
      await forkSessionCommand(command);
      break;
    case "rewind_session":
      await rewindSessionCommand(command);
      break;
    case "handoff_session":
      await handoffSessionCommand(command);
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
    void attachCodingBrowserDescriptor(command)
      .catch((error) => {
        console.error("MilkSU could not attach Coding Browser MCP", error);
      })
      .finally(() => {
        try {
          respondWorkspaceAction(command);
        } catch (error) {
          emit(command.conversationId ?? null, "error", { error: describeError(error) });
        }
      });
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
  if (command.action === "rewind_session") {
    void rewindSessionCommand(command);
    return;
  }
  if (command.action === "handoff_session") {
    void handoffSessionCommand(command);
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
  reasoningOnlyRecovered.clear();
  reasoningOnlyPreviousTools.clear();
  await Promise.all(
    [...sessionSubagentTasks.keys()].map(conversationId => haltConversationSubagents(conversationId)),
  );
  await Promise.all(
    [...sessions.values()].map(session => disposeAgentSession(session)),
  );
  for (const conversationId of subagentPollers.keys()) stopSubagentPoll(conversationId);
  sessions.clear();
  sessionCreateCommands.clear();
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
