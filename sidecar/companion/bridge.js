import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createCompanionExtension, COMPANION_SESSION_ID } from "./extension.js";
import { createCompanionTools } from "./tools.js";
import { queryCompanionMemory, scheduleCompanionIndexRefresh } from "./obelisk-index.js";
import { companionProviderEnvironment } from "./companion-model-env.js";
import { companionAssistantTurnError } from "./turn-error.js";
import { withTokenFluxModelCompat } from "../pi/tokenflux-model-compat.js";
import currentProviderRuntime from "../pi/current-provider-runtime.cjs";

const {
  currentProviderDefinition,
  isCustomRelayProvider,
} = currentProviderRuntime;

const DEFAULT_SYSTEM_PROMPT = [
  "You are the MilkSU companion.",
  "You coordinate and report across the user's Coding, CTF, CVE, and Lab conversations.",
  "Never invent a completion or run-state. Session run state comes only from companion_board.",
  "Use companion_board, companion_dispatch, and companion_memory.",
  "speak requires an explicit conversationId. For stop or steer, call companion_dispatch immediately; the host confirms with a button, not chat.",
].join(" ");

const pendingHost = new Map();
let hostRequestSeq = 0;
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

function requestHost(action, input, options = {}) {
  const requestId = `companion-host-${++hostRequestSeq}`;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
  return new Promise((resolve, reject) => {
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!pendingHost.has(requestId)) return;
        pendingHost.delete(requestId);
        reject(new Error("companion host request timed out"));
      }, timeoutMs);
    }
    pendingHost.set(requestId, {
      resolve: (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      },
    });
    emit("companion_host", { requestId, action, input });
  });
}

function resolveHost(payload) {
  const requestId = String(payload?.requestId ?? "");
  const pending = pendingHost.get(requestId);
  if (!pending) throw new Error(`unknown companion host request: ${requestId}`);
  pendingHost.delete(requestId);
  if (payload?.ok === false) {
    pending.reject(new Error(String(payload?.error || "companion host request failed")));
    return;
  }
  pending.resolve(payload?.result ?? {});
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
        getSystemPrompt: () => DEFAULT_SYSTEM_PROMPT,
      }),
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
    noTools: "all",
    tools: tools.map(tool => tool.name),
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
  await session.setModel(desired);
  const thinking = command?.thinking;
  if (thinking && typeof thinking === "object") {
    session.setThinkingLevel(thinking.enabled === false ? "off" : (thinking.level || "low"));
  }
  emit("model_selected", { provider, model });
}

function subscribeCompanion() {
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      emit("text_delta", { delta: event.assistantMessageEvent.delta ?? "" });
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

async function sendPrompt(prompt) {
  if (!session) throw new Error("companion session is not ready");
  promptQueue = promptQueue.then(async () => {
    await session.prompt(prompt);
  });
  await promptQueue;
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      await createCompanionSession(command);
      if (!subscribed) {
        subscribeCompanion();
        subscribed = true;
      }
      return;
    case "send_message":
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
      await sendPrompt(String(command.prompt ?? ""));
      return;
    case "update_context":
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
      session?.abort?.();
      emit("turn_settled", { aborted: true });
      return;
    case "shutdown":
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
