import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createInterface } from "readline";

const sessions = new Map();
const promptQueues = new Map();
const rl = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();

function emit(conversationId, type, data = {}) {
  const line = JSON.stringify({ type, id: conversationId ?? null, ...data });
  process.stdout.write(line + "\n");
}

function extractTextContent(message) {
  if (!message?.content) return "";
  return message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

async function setSessionModel(conversationId, session, provider, model) {
  if (!provider || !model) return;

  const desired = session.modelRegistry.find(provider, model);
  if (!desired) {
    emit(conversationId, "error", {
      reason: "model_not_found",
      error: `Model not found: ${provider}/${model}`,
    });
    return;
  }

  const current = session.model;
  if (current && current.provider === provider && current.id === model) return;

  try {
    await session.setModel(desired);
  } catch (err) {
    emit(conversationId, "error", {
      reason: "model_switch_failed",
      error: String(err),
    });
  }
}

function subscribeSession(conversationId, session) {
  session.subscribe((event) => {
    switch (event.type) {
      case "text_delta":
        emit(conversationId, "text_delta", { delta: event.delta });
        break;
      case "thinking_delta":
        emit(conversationId, "thinking_delta", { delta: event.delta });
        break;
      case "toolcall_start":
        emit(conversationId, "tool_call_start", {
          toolName: event.partial?.content?.[event.contentIndex]?.toolName,
        });
        break;
      case "toolcall_end":
        if (event.toolCall?.toolName === "panel_update") {
          const input = event.toolCall?.toolInput ?? {};
          emit(conversationId, "panel_update", {
            set_fields: input.set_fields ?? {},
            append_items: input.append_items ?? {},
          });
        }
        emit(conversationId, "tool_call_end", {
          toolName: event.toolCall?.toolName,
          toolInput: event.toolCall?.toolInput,
        });
        break;
      case "done":
        emit(conversationId, "message_done", {
          reason: event.reason,
          content: extractTextContent(event.message),
        });
        break;
      case "error":
        emit(conversationId, "error", {
          reason: event.reason,
          error: String(event.error),
        });
        break;
    }
  });
}

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) {
    emit(null, "error", { reason: "missing_conversation_id", error: "conversationId is required" });
    return;
  }

  const existing = sessions.get(conversationId);
  if (existing) {
    existing.dispose();
    sessions.delete(conversationId);
    promptQueues.delete(conversationId);
  }

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      sessionManager: SessionManager.inMemory(),
    });

    subscribeSession(conversationId, session);
    sessions.set(conversationId, session);
    promptQueues.set(conversationId, Promise.resolve());
    await setSessionModel(conversationId, session, command.provider, command.model);
    emit(conversationId, "ready", {});
  } catch (err) {
    emit(conversationId, "error", { reason: "init_failed", error: String(err) });
  }
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) {
    emit(null, "error", { reason: "missing_conversation_id", error: "conversationId is required" });
    return;
  }

  const session = sessions.get(conversationId);
  if (!session) {
    emit(conversationId, "error", {
      reason: "no_session",
      error: `Session not found for conversation ${conversationId}`,
    });
    return;
  }

  const prompt = command.prompt ?? "";
  const previous = promptQueues.get(conversationId) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      if (sessions.get(conversationId) !== session) return;
      await session.prompt(prompt);
    })
    .catch((err) => {
      emit(conversationId, "error", {
        reason: "prompt_failed",
        error: String(err),
      });
    })
    .finally(() => {
      if (promptQueues.get(conversationId) === next) {
        promptQueues.set(conversationId, Promise.resolve());
      }
    });
  promptQueues.set(conversationId, next);
}

async function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) {
    emit(null, "error", { reason: "missing_conversation_id", error: "conversationId is required" });
    return;
  }

  const session = sessions.get(conversationId);
  if (session) {
    session.dispose();
    sessions.delete(conversationId);
    promptQueues.delete(conversationId);
  }
  emit(conversationId, "session_destroyed", {});
}

async function handleCommandLine(line) {
  let command;
  try {
    command = JSON.parse(line);
  } catch (err) {
    emit(null, "error", { reason: "parse_error", error: String(err) });
    return;
  }

  try {
    switch (command.action) {
      case "create_session":
        await createSession(command);
        break;
      case "send_message":
        await sendMessage(command);
        break;
      case "destroy_session":
        await destroySession(command);
        break;
      default:
        emit(command.conversationId ?? null, "error", {
          reason: "unknown_action",
          error: `Unknown bridge action: ${command.action}`,
        });
        break;
    }
  } catch (err) {
    emit(command.conversationId ?? null, "error", {
      reason: "command_failed",
      error: String(err),
    });
  }
}

rl.on("line", (line) => {
  commandQueue = commandQueue
    .then(() => handleCommandLine(line))
    .catch((err) => {
      emit(null, "error", { reason: "command_queue_failed", error: String(err) });
    });
});

rl.on("close", () => {
  for (const session of sessions.values()) {
    session.dispose();
  }
  sessions.clear();
  promptQueues.clear();
  process.exit(0);
});

emit(null, "ready", {});
