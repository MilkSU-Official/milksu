import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createCompanionExtension, COMPANION_SESSION_ID } from "./extension.js";
import { companionSessionToolNames, createCompanionTools } from "./tools.js";
import { createCompanionHostBroker } from "./host-broker.js";
import { queryCompanionMemory, scheduleCompanionIndexRefresh } from "./obelisk-index.js";
import { companionProviderEnvironment } from "./companion-model-env.js";
import { companionSystemPrompt } from "./system-prompt.js";
import {
  companionAssistantTurnError,
  companionToolHistoryBroken,
} from "./turn-error.js";
import { prepareCompanionPrompt } from "./attachments.js";
import { withTokenFluxModelCompat } from "../pi/tokenflux-model-compat.js";
import { createHangGuardExtension } from "../pi/bridge-hang-guard.js";
import { createToolResultBoundExtension } from "../pi/bridge-tool-result-bound.js";
import currentProviderRuntime from "../pi/current-provider-runtime.cjs";

const {
  currentProviderDefinition,
  isCustomRelayProvider,
} = currentProviderRuntime;

let uiLocale = "zh";

let hostBroker = null;
let session = null;
let subscribed = false;
let promptQueue = Promise.resolve();
let boardSnapshot = { sessions: [], todos: [] };
let semanticMemories = [];
let episodicRecalls = [];
let persona = "";
let memorySearchEnabled = true;

function emit(type, data = {}) {
  process.stdout.write(`${JSON.stringify({
    type,
    id: COMPANION_SESSION_ID,
    ...data,
  })}\n`);
}

function ensureHostBroker() {
  if (!hostBroker) {
    hostBroker = createCompanionHostBroker(emit);
  }
  return hostBroker;
}

function requestHost(action, input, options) {
  return ensureHostBroker().request(action, input, options);
}

function resolveHost(payload) {
  ensureHostBroker().respond(payload);
}

function companionAgentDir() {
  return process.env.MILKSU_COMPANION_AGENT_DIR
    || join(process.cwd(), ".milksu", "companion");
}

async function openCompanionSessionManager(cwd, agentDir) {
  const sessionDir = join(agentDir, "sessions");
  const existing = (await SessionManager.list(cwd, sessionDir))
    .find(value => value.id === COMPANION_SESSION_ID);
  if (existing) {
    return SessionManager.open(existing.path, sessionDir, cwd);
  }
  return SessionManager.create(cwd, sessionDir, { id: COMPANION_SESSION_ID });
}

async function createCompanionSession(command) {
  if (session) {
    if (command?.provider && command?.model) {
      await applyCompanionModel(command);
    }
    return session;
  }
  const agentDir = companionAgentDir();
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  const cwd = process.cwd();
  const tools = createCompanionTools(requestHost, {
    queryMemory: params => queryCompanionMemory(params, { memorySearchEnabled }),
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    extensionFactories: [
      createCompanionExtension({
        getBoardSnapshot: () => boardSnapshot,
        getSemanticMemories: () => semanticMemories,
        getEpisodicRecalls: () => episodicRecalls,
        getPersona: () => persona,
        getSystemPrompt: () => companionSystemPrompt(uiLocale),
      }),
      // Same Pi hardening as the main coding bridge: bash timeout bound + tool_result clip.
      createHangGuardExtension(),
      createToolResultBoundExtension(),
    ],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload({ resolveProjectTrust: async () => false });

  ({ session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager: await openCompanionSessionManager(cwd, agentDir),
    resourceLoader,
    tools: companionSessionToolNames(),
    customTools: tools,
  }));
  await session.bindExtensions({ mode: "print" });
  if (typeof session.setAutoCompactionEnabled === "function") {
    session.setAutoCompactionEnabled(false);
  }
  await applyCompanionModel(command);
  emit("ready", {
    workspace: cwd,
    tools: session.getActiveToolNames(),
    resumed: Array.isArray(session.messages) && session.messages.length > 0,
  });
  return session;
}

async function applyCompanionModel(command) {
  const provider = String(command?.provider ?? "").trim();
  const model = String(command?.model ?? "").trim();
  if (!provider || !model) {
    throw new Error("companion provider and model are required");
  }
  const definition = currentProviderDefinition(
    provider,
    model,
    companionProviderEnvironment(command),
    command?.customProvider,
  );
  if (definition) {
    const registered = provider === "tokenflux" || provider === "milksu-account"
      ? withTokenFluxModelCompat(definition)
      : definition;
    session.modelRuntime.registerProvider(provider, registered);
  }
  if (isCustomRelayProvider(provider, process.env, command?.customProvider)) {
    // Relay definition is already registered above when present.
  }
  const desired = session.modelRuntime.getModel(provider, model);
  if (!desired) {
    throw new Error(`companion model not found: ${provider}/${model}`);
  }
  const current = session.model;
  if (!current || current.provider !== desired.provider || current.id !== desired.id) {
    await session.setModel(desired);
  }
  const thinking = command?.thinking;
  if (thinking && typeof thinking === "object") {
    session.setThinkingLevel(thinking.enabled === false ? "off" : (thinking.level || "low"));
  }
  emit("model_selected", { provider, model });
}

function subscribeCompanion() {
  const thinkingStartedAt = new Map();
  const toolStartedAt = new Map();
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent) {
      const update = event.assistantMessageEvent;
      if (update.type === "thinking_start") {
        if (!thinkingStartedAt.has("live")) thinkingStartedAt.set("live", Date.now());
        emit("thinking_start", {});
      } else if (update.type === "thinking_delta") {
        emit("thinking_delta", { delta: update.delta ?? "" });
      } else if (update.type === "thinking_end") {
        const startedAt = thinkingStartedAt.get("live");
        thinkingStartedAt.delete("live");
        emit("thinking_done", {
          content: update.content ?? "",
          durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
        });
      } else if (update.type === "text_delta") {
        emit("text_delta", { delta: update.delta ?? "" });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      toolStartedAt.set(event.toolCallId, Date.now());
      emit("tool_call_start", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: formatCompanionToolInput(event.toolName, event.args),
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      emit("tool_call_progress", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const startedAt = toolStartedAt.get(event.toolCallId);
      toolStartedAt.delete(event.toolCallId);
      emit("tool_call_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: String(event.result?.content ?? event.result?.details ?? "").slice(0, 400),
        durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
        isError: event.isError,
      });
      return;
    }
    if (event.type === "agent_end") {
      const error = companionAssistantTurnError(session.messages);
      if (error) emit("error", { error });
      emit("turn_settled", {});
      if (memorySearchEnabled) scheduleCompanionIndexRefresh();
      return;
    }
    if (event.type === "compaction_start" || event.type === "compaction_end") {
      emit(event.type, { reason: event.reason ?? "" });
    }
  });
}

function formatCompanionToolInput(toolName, args) {
  const name = String(toolName ?? "").trim() || "tool";
  if (!args || typeof args !== "object") return name;
  const detail = String(
    args.path
    ?? args.file
    ?? args.command
    ?? args.query
    ?? args.pattern
    ?? args.id
    ?? "",
  ).trim();
  if (!detail) return name;
  return `${name} ${detail.slice(0, 120)}`;
}

async function sendPrompt(command) {
  if (!session) throw new Error("companion session is not ready");
  if (companionToolHistoryBroken(session.messages)) {
    throw new Error("tool history is broken");
  }
  const prepared = await prepareCompanionPrompt(command);
  if (!prepared.prompt) {
    throw new Error("companion prompt is required");
  }
  promptQueue = promptQueue.then(async () => {
    await session.prompt(prepared.prompt, {
      expandPromptTemplates: false,
      ...(prepared.images.length ? { images: prepared.images } : {}),
    });
  });
  await promptQueue;
}

function applyCompanionLocale(command) {
  if (command?.locale === "en" || command?.locale === "zh") {
    uiLocale = command.locale;
  }
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      applyCompanionLocale(command);
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      await createCompanionSession(command);
      if (!subscribed) {
        subscribeCompanion();
        subscribed = true;
      }
      return;
    case "send_message":
      applyCompanionLocale(command);
      await createCompanionSession(command);
      if (!subscribed) {
        subscribeCompanion();
        subscribed = true;
      }
      if (command.boardSnapshot) boardSnapshot = command.boardSnapshot;
      if (Array.isArray(command.semanticMemories)) semanticMemories = command.semanticMemories;
      if (Array.isArray(command.episodicRecalls)) episodicRecalls = command.episodicRecalls;
      if (typeof command.persona === "string") persona = command.persona;
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      await sendPrompt(command);
      return;
    case "update_context":
      applyCompanionLocale(command);
      if (command.boardSnapshot) boardSnapshot = command.boardSnapshot;
      if (Array.isArray(command.semanticMemories)) semanticMemories = command.semanticMemories;
      if (Array.isArray(command.episodicRecalls)) episodicRecalls = command.episodicRecalls;
      if (typeof command.persona === "string") persona = command.persona;
      emit("context_updated", {});
      return;
    case "companion_host_response":
      resolveHost(command);
      return;
    case "abort":
      // Mirror main-chat abort: cancel parked/in-flight host waits, then abort the agent loop.
      ensureHostBroker().cancelAll("turn aborted");
      session?.abort?.();
      emit("turn_settled", { aborted: true });
      return;
    case "shutdown":
      ensureHostBroker().cancelAll("companion sidecar stopped");
      process.exit(0);
      return;
    default:
      throw new Error(`unknown companion action: ${command.action}`);
  }
}

const input = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();
input.on("line", (line) => {
  commandQueue = commandQueue.then(async () => {
    const command = JSON.parse(line);
    try {
      await handleCommand(command);
    } catch (error) {
      emit("error", { error: error instanceof Error ? error.message : String(error) });
    }
  });
});

emit("hello", { role: "companion" });
