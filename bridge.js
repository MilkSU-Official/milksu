import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createInterface } from "node:readline";

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);

const sessions = new Map();
const promptQueues = new Map();
const input = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();

function emit(conversationId, type, data = {}) {
  process.stdout.write(`${JSON.stringify({ type, id: conversationId ?? null, ...data })}\n`);
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

function configureRelayModel(session, provider, model) {
  if (!relayEnabled) return { provider, model };

  const source = session.modelRegistry.find(provider, model);
  session.modelRegistry.registerProvider("milksu-relay", {
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

async function setSessionModel(conversationId, session, provider, model) {
  if (!provider || !model) return;

  const desired = session.modelRegistry.find(provider, model);
  if (!desired) {
    throw new Error(`Model not found: ${provider}/${model}`);
  }
  await session.setModel(desired);
  emit(conversationId, "model_selected", { provider, model });
}

function subscribeSession(conversationId, session) {
  let assistantTextStreamed = false;

  session.subscribe((event) => {
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
      if (content || assistantTextStreamed) {
        emit(conversationId, "message_done", {
          reason: event.message.stopReason ?? "stop",
          content,
        });
      }
      assistantTextStreamed = false;
      return;
    }

    if (event.type === "tool_execution_start") {
      emit(conversationId, "tool_call_start", { toolName: event.toolName });
      return;
    }

    if (event.type === "tool_execution_end") {
      emit(conversationId, "tool_call_end", {
        toolName: event.toolName,
        content: extractToolResultContent(event.result),
        isError: event.isError,
      });
    }
  });
}

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const existing = sessions.get(conversationId);
  if (existing) existing.dispose();

  const { session } = await createAgentSession({
    cwd: process.cwd(),
    sessionManager: SessionManager.inMemory(),
  });
  subscribeSession(conversationId, session);

  const effectiveModel = configureRelayModel(session, command.provider, command.model);
  await setSessionModel(
    conversationId,
    session,
    effectiveModel.provider,
    effectiveModel.model,
  );

  sessions.set(conversationId, session);
  promptQueues.set(conversationId, Promise.resolve());
  emit(conversationId, "ready");
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const session = sessions.get(conversationId);
  if (!session) throw new Error(`Session not found: ${conversationId}`);

  const previous = promptQueues.get(conversationId) ?? Promise.resolve();
  const next = previous.then(() => session.prompt(command.prompt ?? ""));
  promptQueues.set(conversationId, next.catch(() => undefined));
  await next;
}

function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  sessions.get(conversationId)?.dispose();
  sessions.delete(conversationId);
  promptQueues.delete(conversationId);
  emit(conversationId, "session_destroyed");
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      await createSession(command);
      break;
    case "send_message":
      await sendMessage(command);
      break;
    case "destroy_session":
      destroySession(command);
      break;
    default:
      throw new Error(`Unknown action: ${command.action}`);
  }
}

input.on("line", (line) => {
  if (!line.trim()) return;
  commandQueue = commandQueue
    .then(() => handleCommand(JSON.parse(line)))
    .catch((error) => {
      let conversationId = null;
      try {
        conversationId = JSON.parse(line).conversationId ?? null;
      } catch {
        // The error event below is enough for malformed input.
      }
      emit(conversationId, "error", { error: String(error) });
    });
});

function disposeAllSessions() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  promptQueues.clear();
}

function shutdown() {
  disposeAllSessions();
  input.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
