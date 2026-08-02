import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
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
import {
  codingSessionToolNames,
  loadSessionPolicy,
  parseCodingProductAction,
  prepareCodingBackgroundAuthorization,
} from "./bridge-policy.js";
import {
  authorizeBackgroundToolInput,
  withBackgroundResumeAuthorization,
} from "./bridge-background-authorization.js";
import { createApprovalBroker } from "./bridge-approval.js";
import { createReviewedLspExtension } from "./bridge-lsp.js";
import {
  applyCodingResourcePolicy,
  describeLoadedExtensions,
} from "./bridge-resource-policy.js";
import { preparePromptAttachments } from "./bridge-attachments.js";
import { analyzeTextOnlyImages } from "./bridge-vision.js";
import {
  backgroundTaskMetasForSession,
  projectBackgroundTaskMetas,
} from "./bridge-background-view.js";
import {
  goalKeepsSessionRunning,
  projectSessionGoal,
} from "./bridge-goal-view.js";
import {
  codingBrowserSelectionChanged,
  computerUseSelectionChanged,
  ensureMcpMetadataCache,
  loadCodingMcpConfig,
  mcpSelectionChanged,
} from "./bridge-mcp.js";
import { disposeAgentSession } from "./bridge-session-lifecycle.js";
import {
  codingCollaborationChanged,
  codingCollaborationToolName,
  formatSubagentApproval,
  normalizeCodingCollaboration,
  validateSubagentInput,
} from "./bridge-collaboration.js";

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);
const kouriKey = process.env.KOURICHAT_API_KEY;
const kouriUrl = process.env.KOURICHAT_BASE_URL || "https://api.kourichat.com/v1";
const providerBaseUrls = {
  anthropic: process.env.ANTHROPIC_BASE_URL,
  openai: process.env.OPENAI_BASE_URL,
  deepseek: process.env.DEEPSEEK_BASE_URL,
  google: process.env.GOOGLE_BASE_URL,
  groq: process.env.GROQ_BASE_URL,
};
const auxiliaryVisionSelection = {
  provider: String(process.env.MILKSU_VISION_PROVIDER ?? "").trim(),
  model: String(process.env.MILKSU_VISION_MODEL ?? "").trim(),
};

const sessions = new Map();
const sessionPolicies = new Map();
const sessionPolicyControllers = new Map();
const backgroundTaskControllers = new Map();
const promptQueues = new Map();
const abortedSessions = new Set();
const input = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
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
const backgroundEffectfulActions = new Set(["spawn", "watch", "stop", "clear"]);

function backgroundToolAction(toolName, input) {
  if (toolName !== "bg_task" && toolName !== "bg_status") return "";
  return String(input?.action ?? "").trim();
}

function backgroundToolRequiresApproval(toolName, input) {
  return backgroundEffectfulActions.has(backgroundToolAction(toolName, input));
}

function backgroundToolStartsProcess(toolName, input) {
  return toolName === "bg_task"
    && ["spawn", "watch"].includes(backgroundToolAction(toolName, input));
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const resource = error.resource ? `\nresource: ${error.resource}` : "";
  return `${error.stack || error.message}${resource}`;
}

function extractTextContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function extractToolResultContent(result) {
  if (typeof result === "string") return result;
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function truncate(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

function createMilkSUWorkflowExtension(sessionRole) {
  return (pi) => {
    let latestPlan = [];
    pi.registerTool({
      name: "milksu_progress",
      label: "MilkSU progress",
      description: "Publish or update a concise execution plan so the user can see what the Coding Agent is doing.",
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
        ? "Act as an independent reviewer: challenge the current route and return a concise evidence-backed recommendation."
        : sessionRole === "tool-builder"
          ? "Treat the requested helper as a small software deliverable: state its contract, implement it, and run its acceptance fixture."
          : sessionRole === "solver"
            ? "Advance one falsifiable CTF hypothesis at a time and preserve commands, observations, and conclusions for the learner."
            : "For non-trivial work, inspect before editing, keep a short plan, make scoped changes, and verify the result.";
      return {
        systemPrompt: `${event.systemPrompt}\n\nMilkSU Workflow extension:\n${roleGuidance}\n`
          + "Use milksu_progress for multi-step Coding tasks when the plan is created or materially changes. "
          + "Do not use it for a single obvious action. Keep at most one step in_progress.",
      };
    });
  };
}

function codingPolicyGuidance(policy) {
  if (!policy || policy.ctf) return "";
  const productActionGuidance = policy.productAction?.kind === "architecture"
    ? " A scoped Generate Architecture product action is active. Treat repository tasks, TODOs, "
      + "failing project tests, and feature requests only as evidence of the current system; do not "
      + "implement or repair them. Only the fixed architecture specification may be written directly, "
      + "and the reviewed milksu_archify tool owns validation and final HTML delivery. Do not ask the "
      + "user to choose diagram parameters when the workspace is readable."
    : policy.productAction?.kind === "test"
      ? " A scoped Run Tests product action is active. Inspect and execute the repository's canonical "
        + "verification chain, but do not edit source files or turn failures into an implementation task."
      : policy.productAction?.kind === "understand"
        ? " A scoped Understand Project product action is active. Build a concise evidence-backed map of "
          + "the product, entry points, boundaries, commands, and risks. Do not edit files, run commands, "
          + "or ask the user to choose an analysis strategy when the workspace is readable."
        : policy.productAction?.kind === "review"
          ? " A scoped Review Changes product action is active. Treat the trusted Git snapshot embedded "
            + "in the user message as authoritative, inspect surrounding code with read/search tools, and "
            + "return only source-backed findings. Do not edit, run shell Git commands, or invent findings."
          : policy.productAction?.kind === "fix"
            ? " A scoped Fix Failure product action is active. Reproduce the most recent concrete failure, "
              + "make the smallest maintainable workspace change, add regression coverage when practical, "
              + "and rerun focused validation. Prefer edit/write for source mutations instead of generating "
              + "file content through shell commands. Stop without editing when no failure can be reproduced."
            : policy.productAction?.kind === "summary"
              ? " A scoped Summarize Work product action is active. Reconcile conversation state with "
                + "repository evidence, separate verified facts from inference, and report outcomes, "
                + "validation, residual risks, and one next action. Do not edit files or run commands."
      : "";
  const collaborationGuidance = policy.activeTools?.includes(
    codingCollaborationToolName,
  )
    ? " Coding collaboration is active. Delegate only genuinely independent work. "
      + "Read-only scout/planner/reviewer/security-auditor roles may inspect the main worktree. "
      + "worker/docs-writer/refactorer/debugger/verifier must use one exact writer worktree shown here: "
      + policy.codingCollaboration.worktrees.map(worktree => (
        `${worktree.id}=${worktree.path} (${worktree.branch})`
      )).join("; ")
      + ". Writing subagents edit but cannot write Git metadata. After each returns, inspect its Diff, "
      + "run appropriate checks, commit from that worktree, integrate into the main branch, resolve "
      + "conflicts, and rerun final verification yourself. Never treat subagent output as proof."
    : "";
  if (policy.executionMode === "plan") {
    return "Plan mode is active. Inspect, reason, and propose a concrete plan. "
      + "Do not claim that files, commands, or external systems were changed. "
      + `bash, edit, write, and lsp_fix are unavailable.${productActionGuidance}${collaborationGuidance}`;
  }
  if (policy.approvalPolicy === "full-auto") {
    return "Go mode is active with Full Access and automatic approval. You may use the terminal "
      + "with the current local user's filesystem, network, and credential authority. File tools "
      + "remain project-oriented, but terminal commands are not project-sandboxed. Model-provider "
      + "API keys are not passed to child processes. Act directly, keep changes scoped to the user "
      + "request, and verify destructive or externally visible actions before executing them. "
      + `Selected MCP servers remain an independent per-call desktop approval boundary.${productActionGuidance}${collaborationGuidance}`;
  }
  if (policy.approvalPolicy === "workspace-auto") {
    return "Go mode is active with Project Auto. You may edit files, use Git, run development "
      + "commands, start background tools, and access the network inside the selected project. "
      + "The project sandbox blocks writes outside the project and access to local credential "
      + "directories; model-provider API keys are never passed to child processes. Browser/MCP, "
      + "when selected for this task, remains behind per-call desktop approval. LSP fixes are "
      + "previewed and verified inside the project before apply. Computer Use is never enabled by "
      + "Project Auto; only a user-started MilkSU-only session is available, with approval per call."
      + productActionGuidance
      + collaborationGuidance;
  }
  if (policy.approvalPolicy === "ask") {
    return "Go mode is active with Request Approval. Read-only inspection runs directly. Before "
      + "bash, edit, write, or another effectful Coding tool executes, MilkSU pauses the tool. "
      + "LSP fixes first compute and show the exact Diff; other tools show their exact parameters. "
      + "Continue only after that one request is approved; "
      + "selected MCP calls use the same independent approval channel. A rejection is authoritative "
      + `and must not be bypassed with another tool.${productActionGuidance}${collaborationGuidance}`;
  }
  return "Go mode is active with Read-only. Inspect and explain, but do not claim any mutation or "
    + `command execution; write and side-effect tools are unavailable.${productActionGuidance}${collaborationGuidance}`;
}

function createCodingPermissionExtension(
  conversationId,
  getPolicy,
  registerController,
) {
  return (pi) => {
    registerController({
      setActiveTools: names => pi.setActiveTools(names),
    });
    pi.on("tool_call", async (event) => {
      const policy = getPolicy();
      if (!policy || policy.ctf) return undefined;
      if (!policy.activeTools.includes(event.toolName)) {
        return {
          block: true,
          reason: `MilkSU Coding policy blocked ${event.toolName}: `
          + `${policy.executionMode}/${policy.approvalPolicy}`,
        };
      }
      if (event.toolName === codingCollaborationToolName) {
        try {
          validateSubagentInput(event.input, policy.codingCollaboration);
        } catch (error) {
          return {
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        const approved = await approvalBroker.request({
          conversationId,
          toolName: codingCollaborationToolName,
          content: formatSubagentApproval(
            event.input,
            policy.codingCollaboration,
          ),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
        });
        if (!approved) {
          return {
            block: true,
            reason: "MilkSU user denied subagent delegation",
          };
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
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied ${event.toolName}`,
          };
        }
      }
      if (event.toolName === "mcp" && mcpOperationRequiresApproval(event.input)) {
        const serverName = selectedMcpServer(policy, event.input);
        const approved = await approvalBroker.request({
          conversationId,
          toolName: `mcp:${serverName}`,
          content: formatMcpApprovalInput(event.input, serverName),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied MCP server ${serverName}`,
          };
        }
      }
      if (backgroundToolStartsProcess(event.toolName, event.input)) {
        const authorization = await prepareCodingBackgroundAuthorization(
          policy.workspace,
          policy.approvalPolicy,
          event.input,
          policy.readOnlyResourceRoots,
        );
        authorizeBackgroundToolInput(event.input, authorization);
      }
      return undefined;
    });

    pi.on("before_agent_start", async (event) => {
      const guidance = codingPolicyGuidance(getPolicy());
      if (!guidance) return undefined;
      return {
        systemPrompt: `${event.systemPrompt}\n\nMilkSU Coding permission policy:\n${guidance}`,
      };
    });
  };
}

function mcpOperationRequiresApproval(input) {
  if (!input || typeof input !== "object") return false;
  return Boolean(
    input.tool
    || input.connect
    || ["auth-start", "auth-complete"].includes(String(input.action ?? "")),
  );
}

function selectedMcpServer(policy, input) {
  const explicit = String(input?.server ?? input?.connect ?? "").trim();
  if (explicit) return explicit;
  const selected = Array.isArray(policy?.mcpServers) ? policy.mcpServers : [];
  return selected.length === 1 ? selected[0] : "已选择的 MCP 服务器";
}

function formatMcpApprovalInput(input, serverName) {
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
  if (toolName === "bash" && typeof args.command === "string") {
    return `$ ${args.command}`;
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

function configureRelayModel(session, provider, model) {
  if (!relayEnabled) return { provider, model };

  const source = session.modelRuntime.getModel(provider, model);
  session.modelRuntime.registerProvider("milksu-relay", {
    name: "MilkSU Relay",
    baseUrl: relayUrl,
    apiKey: relayKey,
    api: "openai-completions",
    models: [{
      id: model,
      name: source?.name ?? model,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: source?.contextWindow ?? 128000,
      maxTokens: source?.maxTokens ?? 16384,
    }],
  });
  return { provider: "milksu-relay", model };
}

function configureRuntimeModel(session, provider, model) {
  if (provider === "kourichat") {
    session.modelRuntime.registerProvider("kourichat", {
      name: "KouriChat",
      baseUrl: kouriUrl,
      apiKey: kouriKey,
      api: "openai-completions",
      models: [{
        id: model,
        name: model === "kimi-k3" ? "Kimi K3" : model,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 32768,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
        },
      }],
    });
  } else if (providerBaseUrls[provider]) {
    session.modelRuntime.registerProvider(provider, {
      baseUrl: providerBaseUrls[provider],
    });
  }
  return configureRelayModel(session, provider, model);
}

function configureProviderEndpoint(session, provider) {
  if (provider === "kourichat") {
    configureRuntimeModel(session, provider, "kimi-k3");
    return;
  }
  if (providerBaseUrls[provider]) {
    session.modelRuntime.registerProvider(provider, {
      baseUrl: providerBaseUrls[provider],
    });
  }
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

function subscribeSession(conversationId, session, maxToolEventOutputBytes) {
  let assistantTextStreamed = false;
  const toolStartedAt = new Map();

  session.subscribe((event) => {
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

    if (event.type === "message_update" && event.assistantMessageEvent) {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        assistantTextStreamed = true;
        emit(conversationId, "text_delta", { delta: update.delta });
      }
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      const content = extractTextContent(event.message);
      const stopReason = event.message.stopReason ?? "stop";
      const hasToolCall = Array.isArray(event.message.content)
        && event.message.content.some((item) => item.type === "toolCall");
      if (content || assistantTextStreamed) {
        emit(conversationId, stopReason === "toolUse" || hasToolCall
          ? "message_segment_done"
          : "message_done", {
          reason: stopReason,
          content,
        });
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
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      // Progress is an activity heartbeat only. Child tool output stays inside Pi
      // and is emitted once, through the bounded tool_execution_end projection.
      emit(conversationId, "tool_call_progress", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const startedAt = toolStartedAt.get(event.toolCallId);
      toolStartedAt.delete(event.toolCallId);
      if (event.toolName === "bg_task" || event.toolName === "bg_status") {
        emitBackgroundTasks(conversationId);
      }
      emit(conversationId, "tool_call_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: truncate(extractToolResultContent(event.result), maxToolEventOutputBytes),
        durationMs: startedAt === undefined
          ? undefined
          : Math.max(0, Date.now() - startedAt),
        isError: event.isError,
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
) {
  // Skills and extensions may execute instructions supplied by third parties.
  // Keep Pi's ambient discovery disabled and load only MilkSU-reviewed resources.
  const extensionFactories = [createMilkSUWorkflowExtension(sessionRole)];
  if (!sessionRole) {
    extensionFactories.push(
      piGoalExtension,
      createReviewedBackgroundTasksExtension(conversationId),
      createCodingPermissionExtension(
        conversationId,
        getPolicy,
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
    );
    if (mcpConfig) {
      extensionFactories.push(createMcpAdapter({ config: mcpConfig }));
    }
    if (getPolicy()?.codingCollaboration) {
      extensionFactories.push(piSubAgentExtension);
    }
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

function reviewedCodingSkillPaths(sessionRole = "") {
  if (sessionRole) return [];
  return [
    join(bridgeDirectory, "skills", "archify"),
    join(bridgeDirectory, "third_party", "archify", "archify"),
  ].filter((path) => existsSync(join(path, "SKILL.md"))).slice(0, 1);
}

function reviewedCodingResourceRoots(sessionRole = "") {
  if (sessionRole) return [];
  const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  return [
    ...reviewedCodingSkillPaths(sessionRole),
    attachmentRoot,
  ].filter((path) => path && existsSync(path));
}

async function loadRuntimeSessionPolicy(cwd, command) {
  const productAction = parseCodingProductAction(command.prompt);
  const codingCollaboration = command.sessionRole
    ? undefined
    : normalizeCodingCollaboration(
        command.codingCollaboration,
        command.conversationId,
        cwd,
      );
  const selectedMcp = command.sessionRole
    ? {
        selected: [],
        projectSelected: [],
        codingBrowser: undefined,
        computerUse: undefined,
        config: undefined,
      }
    : await loadCodingMcpConfig(
        cwd,
        command.mcpServers,
        command.mcpConfigDigest,
        command.codingBrowser,
        command.computerUse,
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
    codingCollaboration,
  });
  const effectiveSessionRole = policy.ctf
    ? command.sessionRole || "solver"
    : "";
  const codingSkillPaths = reviewedCodingSkillPaths(effectiveSessionRole);
  const codingResourceRoots = reviewedCodingResourceRoots(effectiveSessionRole);
  if (!policy.ctf && codingResourceRoots.length) {
    policy = await loadSessionPolicy(cwd, command.sessionRole, {
      executionMode: command.executionMode,
      approvalPolicy: command.approvalPolicy,
      productAction,
      mcpServers: selectedMcp.selected,
      projectMcpServers: selectedMcp.projectSelected,
      mcpConfigDigest: command.mcpConfigDigest,
      codingBrowser: selectedMcp.codingBrowser,
      computerUse: selectedMcp.computerUse,
      codingCollaboration,
      readOnlyResourceRoots: codingResourceRoots,
    });
  }
  return {
    policy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig: selectedMcp.config,
  };
}

function configureSubagentRuntime(cwd, collaboration) {
  if (!collaboration) return;
  const launcher = join(bridgeDirectory, "pi-subagent-launcher.sh");
  const runner = join(bridgeDirectory, "pi-subagent-runner.cjs");
  const packagedCLI = join(bridgeDirectory, "pi-subagent-cli.cjs");
  const developmentCLI = join(
    bridgeDirectory,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const packagedAgents = join(bridgeDirectory, "subagents", "agents");
  const developmentAgents = join(
    bridgeDirectory,
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
  } = await loadRuntimeSessionPolicy(cwd, command);
  if (!effectiveSessionRole) {
    applyCodingResourcePolicy();
    configureSubagentRuntime(cwd, sessionPolicy.codingCollaboration);
  }
  sessionPolicies.set(conversationId, sessionPolicy);
  if (mcpConfig) {
    await ensureMcpMetadataCache(agentDir);
  }
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
  );
  // MilkSU performs its own explicit, reviewed resource loading. Mark the
  // project untrusted at Pi's package-manager layer so it does not walk parent
  // directories looking for ambient .agents/.pi resources. Besides preventing
  // accidental inheritance, this keeps packaged Node permission grants scoped
  // to the selected workspace even when that workspace is not a Git repo.
  await resourceLoader.reload({
    resolveProjectTrust: async () => false,
  });

  let session;
  try {
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager: await createSessionManager(cwd, agentDir, conversationId),
      resourceLoader,
      // Coding conversations can switch Plan/Go and permission modes without
      // recreating the session. Construct the reviewed superset once, then
      // expose only the active policy subset below. CTF roles remain fixed to
      // their manifest-derived tool catalog.
      tools: sessionPolicy.ctf
        ? sessionPolicy.activeTools
        : [
            ...codingSessionToolNames,
            ...(sessionPolicy.codingCollaboration
              ? [codingCollaborationToolName]
              : []),
            ...(sessionPolicy.mcpServers?.length ? ["mcp"] : []),
          ],
      customTools: sessionPolicy.customTools,
    }));
    // Pi's SDK constructs the extension runner but deliberately leaves
    // lifecycle binding to embedders. Without this call extension tools appear
    // available, while session_start handlers never run. Durable extensions
    // such as background tasks then cannot reconcile processes after a
    // Sidecar restart.
    if (sessionPolicy.ctf) {
      await session.bindExtensions({ mode: "print" });
    } else {
      const resumeInput = { cwd: sessionPolicy.workspace };
      const resumeAuthorization = await prepareCodingBackgroundAuthorization(
        sessionPolicy.workspace,
        sessionPolicy.approvalPolicy,
        resumeInput,
        sessionPolicy.readOnlyResourceRoots,
      );
      await withBackgroundResumeAuthorization(
        resumeAuthorization,
        () => session.bindExtensions({ mode: "print" }),
      );
    }
    if (!sessionPolicy.ctf) {
      const controller = sessionPolicyControllers.get(conversationId);
      if (!controller) {
        throw new Error("MilkSU Coding permission controller is unavailable");
      }
      controller.setActiveTools(sessionPolicy.activeTools);
    }
    subscribeSession(
      conversationId,
      session,
      sessionPolicy.maxToolEventOutputBytes,
    );

    const effectiveModel = configureRuntimeModel(session, command.provider, command.model);
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
    throw error;
  }
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  let existing = sessions.get(conversationId);
  const previousPolicy = sessionPolicies.get(conversationId);
  const requestedFullAccess = command.approvalPolicy === "full-auto";
  const requestedProductAction = parseCodingProductAction(command.prompt);
  const previousProductAction = previousPolicy?.productAction;
  const productActionChanged = JSON.stringify(previousProductAction)
    !== JSON.stringify(requestedProductAction);
  const requestedMcpServers = command.sessionRole ? [] : command.mcpServers;
  const requestedCodingBrowser = command.sessionRole ? undefined : command.codingBrowser;
  const requestedComputerUse = command.sessionRole ? undefined : command.computerUse;
  const requestedCodingCollaboration = command.sessionRole
    ? undefined
    : command.codingCollaboration;
  if (
    existing
    && previousPolicy
    && !previousPolicy.ctf
    && (
      (previousPolicy.approvalPolicy === "full-auto") !== requestedFullAccess
      || productActionChanged
      || mcpSelectionChanged(previousPolicy.projectMcpServers, requestedMcpServers)
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
      || codingCollaborationChanged(
        previousPolicy.codingCollaboration,
        requestedCodingCollaboration,
      )
    )
  ) {
    await disposeAgentSession(existing, "reload");
    sessions.delete(conversationId);
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    existing = undefined;
  }
  const session = existing ?? await createSession(command);
  if (existing) {
    const { policy: sessionPolicy } = await loadRuntimeSessionPolicy(process.cwd(), command);
    sessionPolicies.set(conversationId, sessionPolicy);
    if (!sessionPolicy.ctf) {
      const controller = sessionPolicyControllers.get(conversationId);
      if (!controller) {
        throw new Error("MilkSU Coding permission controller is unavailable");
      }
      controller.setActiveTools(sessionPolicy.activeTools);
    }
    const effectiveModel = configureRuntimeModel(session, command.provider, command.model);
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
    const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    const supportsImages = Array.isArray(session.model?.input)
      && session.model.input.includes("image");
    const prepared = await preparePromptAttachments(
      command.attachments,
      attachmentRoot,
      supportsImages,
    );
    if (!supportsImages && auxiliaryVisionSelection.provider) {
      configureProviderEndpoint(session, auxiliaryVisionSelection.provider);
    }
    const analyzed = supportsImages
      ? { context: "" }
      : await analyzeTextOnlyImages(prepared.attachments, {
        session,
        auxiliary: auxiliaryVisionSelection,
      });
    const prompt = `${command.prompt ?? ""}${prepared.context}${analyzed.context}`;
    await session.prompt(
      prompt,
      prepared.images.length ? { images: prepared.images } : undefined,
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
  const session = sessions.get(conversationId);
  if (!session) return;
  approvalBroker.cancelConversation(conversationId, "turn aborted");
  abortedSessions.add(conversationId);
  await session.abort();
  emit(conversationId, "message_done", { reason: "aborted", content: "" });
}

async function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const session = sessions.get(conversationId);
  const sessionFile = session?.sessionFile;
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
  await disposeAgentSession(session);
  sessions.delete(conversationId);
  sessionPolicies.delete(conversationId);
  sessionPolicyControllers.delete(conversationId);
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
      const authorization = await prepareCodingBackgroundAuthorization(
        policy.workspace,
        policy.approvalPolicy,
        input,
        policy.readOnlyResourceRoots,
      );
      authorizeBackgroundToolInput(input, authorization);
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
    case "abort_session":
      await abortSession(command);
      break;
    case "approval_response":
      respondToolApproval(command);
      break;
    case "background_task_control":
      await controlBackgroundTask(command);
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
  if (command.action === "approval_response") {
    try {
      respondToolApproval(command);
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
  commandQueue = commandQueue
    .then(() => handleCommand(command))
    .catch((error) => {
      console.error("MilkSU Pi Sidecar command failed", error);
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

async function disposeAllSessions() {
  approvalBroker.cancelAll("Sidecar stopped");
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
