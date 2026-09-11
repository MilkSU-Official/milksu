import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createAcpClient } from "./acp-client.js";

const sessions = new Map();
let commandQueue = Promise.resolve();
let acp;

function emit(conversationId, type, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    id: conversationId ?? null,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  })}\n`);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function resolveDshCommand() {
  const configured = String(process.env.MILKSU_DSH_COMMAND ?? "").trim();
  if (configured) return configured;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "node_modules", ".bin", "dsh"),
    join(here, "node_modules", ".bin", "dsh"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "dsh";
}

async function ensureAcp(cwd) {
  if (acp) return acp;
  acp = createAcpClient({
    command: resolveDshCommand(),
    args: String(process.env.MILKSU_DSH_ACP_ARGS ?? "--profile acp").split(/\s+/).filter(Boolean),
    cwd,
    env: process.env,
  });
  acp.onMessage(message => {
    void handleAcpNotification(message);
  });
  await acp.request("initialize", {
    protocolVersion: 1,
    clientInfo: {
      name: "milksu",
      title: "MilkSU",
      version: process.env.npm_package_version || "0",
    },
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
    },
  });
  return acp;
}

function sessionRecord(conversationId) {
  return sessions.get(conversationId);
}

async function handleAcpNotification(message) {
  if (message.method === "session/update") {
    const sessionId = String(message.params?.sessionId ?? "");
    const conversationId = [...sessions.entries()]
      .find(([, record]) => record.acpSessionId === sessionId)?.[0];
    if (!conversationId) return;
    projectSessionUpdate(conversationId, message.params?.update);
    return;
  }
  if (message.method === "session/request_permission" && message.id != null) {
    const sessionId = String(message.params?.sessionId ?? "");
    const conversationId = [...sessions.entries()]
      .find(([, record]) => record.acpSessionId === sessionId)?.[0];
    const requestId = `dsh_perm_${message.id}`;
    if (conversationId) {
      const record = sessions.get(conversationId);
      record.pendingPermission = { jsonrpcId: message.id, requestId };
      emit(conversationId, "approval_requested", {
        requestId,
        toolName: String(message.params?.toolCall?.title || message.params?.toolCall?.kind || "tool"),
        input: JSON.stringify(message.params?.toolCall ?? {}),
        grantable: true,
      });
    }
  }
}

function projectSessionUpdate(conversationId, update) {
  const kind = String(update?.sessionUpdate ?? update?.session_update ?? "");
  if (kind === "agent_message_chunk" || kind === "agent_message_delta") {
    const text = update?.content?.text ?? update?.text ?? "";
    if (text) emit(conversationId, "text_delta", { delta: text });
    return;
  }
  if (kind === "agent_thought_chunk") {
    const text = update?.content?.text ?? update?.text ?? "";
    if (text) emit(conversationId, "thinking_delta", { delta: text });
    return;
  }
  if (kind === "tool_call") {
    emit(conversationId, "tool_call_start", {
      toolName: String(update?.title || update?.kind || "tool"),
      toolCallId: String(update?.toolCallId || update?.tool_call_id || ""),
    });
    return;
  }
  if (kind === "tool_call_update") {
    const status = String(update?.status ?? "");
    if (status === "completed" || status === "failed") {
      emit(conversationId, "tool_call_end", {
        toolCallId: String(update?.toolCallId || update?.tool_call_id || ""),
        isError: status === "failed",
        content: status === "failed" ? String(update?.content ?? "") : "",
      });
    }
    return;
  }
  if (kind === "usage_update" || kind === "usage") {
    emit(conversationId, "usage_recorded", {
      usage: {
        recordId: `dsh_${Date.now()}`,
        inputTokens: Number(update?.used ?? update?.inputTokens ?? 0),
        outputTokens: Number(update?.outputTokens ?? 0),
        totalTokens: Number(update?.totalTokens ?? update?.used ?? 0),
        success: true,
      },
    });
  }
}

async function createSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  const cwd = String(command.cwd || command.workspacePath || process.cwd());
  const client = await ensureAcp(cwd);
  const created = await client.request("session/new", {
    cwd,
    mcpServers: [],
  });
  const acpSessionId = String(created?.sessionId || created?.session_id || conversationId);
  sessions.set(conversationId, {
    acpSessionId,
    cwd,
    createCommand: command,
  });
  emit(conversationId, "ready", { resumed: false });
}

async function sendMessage(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  if (!sessions.has(conversationId)) {
    await createSession(command);
  }
  const record = sessionRecord(conversationId);
  const client = await ensureAcp(record.cwd);
  emit(conversationId, "turn_started");
  const prompt = String(command.prompt ?? "");
  await client.request("session/prompt", {
    sessionId: record.acpSessionId,
    prompt: [{ type: "text", text: prompt }],
  });
  emit(conversationId, "message_done");
  emit(conversationId, "turn_settled");
}

async function abortSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const record = sessionRecord(conversationId);
  if (!record || !acp) {
    emit(conversationId || null, "turn_settled", { aborted: true });
    return;
  }
  await acp.request("session/cancel", { sessionId: record.acpSessionId });
  emit(conversationId, "turn_settled", { aborted: true });
}

async function compactSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  emit(conversationId, "compaction_start", { requestId });
  const record = sessionRecord(conversationId);
  try {
    if (acp && record) {
      try {
        await acp.request("session/compact", { sessionId: record.acpSessionId });
      } catch {
        // ACP v1 has no compact method; auto-compact stays inside DSH.
      }
    }
    emit(conversationId, "compaction_end", {
      requestId,
      compaction: { tokensBefore: 0, estimatedTokensAfter: 0 },
    });
  } catch (error) {
    emit(conversationId, "compaction_end", {
      requestId,
      error: describeError(error),
    });
  }
}

async function destroySession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const record = sessionRecord(conversationId);
  if (acp && record) {
    try {
      await acp.request("session/close", { sessionId: record.acpSessionId });
    } catch {
      // Already gone.
    }
  }
  sessions.delete(conversationId);
  emit(conversationId || null, "session_destroyed");
}

async function respondApproval(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const record = sessionRecord(conversationId);
  if (!record?.pendingPermission || !acp) return;
  const optionId = command.approved ? "allow-once" : "reject";
  acp.respond(record.pendingPermission.jsonrpcId, {
    outcome: {
      outcome: command.approved ? "selected" : "cancelled",
      optionId,
    },
  });
  emit(conversationId, "approval_resolved", {
    requestId: record.pendingPermission.requestId,
    approved: Boolean(command.approved),
  });
  record.pendingPermission = null;
}

async function handoffSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  if (!record) throw new Error("Nothing to hand off");
  await compactSession({ conversationId, requestId: `${requestId}_compact` });
  const forkedSessionId = `dsh_${crypto.randomUUID()}`;
  await createSession({
    ...record.createCommand,
    conversationId: forkedSessionId,
  });
  emit(conversationId, "session_handoff", {
    requestId,
    forkedSessionId,
  });
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
    case "compact_session":
      await compactSession(command);
      break;
    case "destroy_session":
      await destroySession(command);
      break;
    case "approval_response":
      await respondApproval(command);
      break;
    case "handoff_session":
      await handoffSession(command);
      break;
    case "fork_session":
    case "rewind_session":
      emit(command.conversationId ?? null, command.action === "rewind_session" ? "session_rewound" : "session_forked", {
        requestId: command.requestId,
        error: "DeepSeek Harness does not support this session tree action",
      });
      break;
    case "steer_message":
    case "remove_queued_message":
    case "background_task_control":
    case "workspace_action_response":
      break;
    default:
      throw new Error(`Unknown action: ${command.action}`);
  }
}

const input = createInterface({ input: process.stdin });
input.on("line", line => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch (error) {
    emit(null, "error", { error: describeError(error) });
    return;
  }
  if (command.action === "abort_session") {
    void abortSession(command).catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  if (command.action === "approval_response") {
    void respondApproval(command);
    return;
  }
  commandQueue = commandQueue
    .then(() => handleCommand(command))
    .catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

export { handleCommand, emit, sessions };
