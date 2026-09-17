import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createAcpClient } from "./acp-client.js";
import { resolveDshLaunch } from "./launch.js";
import {
  dshSessionMcpServers,
  milksuComputerUseMcpServer,
  milksuPlaywrightMcpServer,
  milksuProductMcpServer,
  resolveComputerUseProxyScript,
  resolvePlaywrightLazyMcpScript,
  resolvePlaywrightMcpCli,
  resolveProductMcpScript,
} from "./mcp-servers.js";
import {
  dshAcpHostPatchYaml,
  resolveDshPackageDir,
  dshAcpModelOptionValue,
  dshModelDeclaresImageInput,
  dshReasoningOptionValue,
  dshRouteModel,
} from "./session-config.js";
import { syncDshSkillCatalog } from "./skill-catalog.js";
import { createProductIpc } from "./product-ipc.js";
import { dshProductIpc } from "../hostpath.js";
import {
  dshNormalizeApprovalPolicy,
  dshPermissionResult,
  dshShouldAutoAllowPermission,
} from "./permission.js";
import { writeCodingBrowserDescriptor } from "../pi/bridge-mcp.js";
import {
  askOtherChoiceId,
  codingAskToolName,
  encodeAskOtherChoice,
  resolveAskChoice,
} from "../pi/bridge-ask.js";
import { createWorkspaceActionBroker } from "../pi/bridge-workspace.js";
import { acpImagePromptsEnabled, buildDshPromptBlocks } from "./prompt-blocks.js";
import {
  applyDshSubagentToolUpdate,
  mergeHostSubagentSnapshot,
  settleSubagentTask,
} from "./subagent-projection.js";
import { parseSlashLine } from "./host-primitives.js";
import {
  logReasoningOnlyFinal,
  reasoningOnlyRecoveryPrompt,
  shouldRecoverReasoningOnlyTurn,
} from "../pi/bridge-reasoning-recovery.js";

const sessions = new Map();
const pendingAsks = new Map();
const pendingUserQuestions = new Map();
const sessionCommandQueues = new Map();
const sessionSubagentTasks = new Map();
const sessionJobs = new Map();
let acp;
let acpImagePrompts = false;
let productIpc;
let hostIpcPath = "";
let hostWatch = null;
const workspaceBroker = createWorkspaceActionBroker(emit);

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

function configuredIpcPath(envKey, fallbackId) {
  const configured = String(process.env[envKey] ?? "").trim();
  if (configured) return configured;
  return dshProductIpc(fallbackId);
}

async function ensureProductIpc() {
  if (productIpc) return productIpc;
  const path = configuredIpcPath("MILKSU_DSH_IPC", `bridge-${process.pid}`);
  try {
    unlinkSync(path);
  } catch {
    // First listen.
  }
  productIpc = createProductIpc(path, async message => {
    const method = String(message.method ?? "");
    const params = message.params ?? {};
    if (method === "ask") {
      return requestAsk(params);
    }
    if (method === "workspace") {
      return workspaceBroker.request({
        conversationId: params.conversationId,
        action: params.action,
        input: params.input,
      });
    }
    throw new Error(`Unknown MilkSU product method: ${method}`);
  });
  await productIpc.listen();
  return productIpc;
}

function requestAsk({ conversationId, question, options }) {
  const requestId = `dsh_ask_${crypto.randomUUID()}`;
  return new Promise(resolve => {
    pendingAsks.set(requestId, { conversationId, options, resolve });
    emit(conversationId, "approval_requested", {
      requestId,
      toolName: codingAskToolName,
      content: question,
      input: JSON.stringify({ options }),
    });
  });
}

function sessionMcpServers(conversationId, command = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const computerUse = command.computerUse && typeof command.computerUse === "object"
    ? command.computerUse
    : {};
  return dshSessionMcpServers([
    milksuProductMcpServer({
      conversationId,
      ipcPath: productIpc?.path,
      scriptPath: resolveProductMcpScript(here),
    }),
    milksuPlaywrightMcpServer({
      conversationId,
      scriptPath: resolvePlaywrightLazyMcpScript(here),
      cliPath: resolvePlaywrightMcpCli(here),
      cdpEndpoint: command.codingBrowser?.cdpEndpoint
        || command.codingBrowser?.CDPEndpoint
        || "",
    }),
    milksuComputerUseMcpServer({
      conversationId,
      scriptPath: resolveComputerUseProxyScript(here),
      socketPath: computerUse.socketPath,
      sessionId: computerUse.sessionId,
      targetName: computerUse.targetName,
      targetBundleId: computerUse.targetBundleId,
      targetWindowId: computerUse.targetWindowId,
      targetPid: computerUse.targetPid,
    }),
  ]);
}

async function applySessionOptions(record, command, configOptions) {
  if (!acp || !record) return configOptions;
  let options = Array.isArray(configOptions) ? configOptions : [];
  const modelValue = dshAcpModelOptionValue(options, command?.model);
  if (modelValue) {
    const updated = await acp.request("session/set_config_option", {
      sessionId: record.acpSessionId,
      configId: "model",
      value: modelValue,
    });
    options = Array.isArray(updated?.configOptions) ? updated.configOptions : options;
  }
  const effort = dshReasoningOptionValue(options, command?.thinking);
  if (effort) {
    const updated = await acp.request("session/set_config_option", {
      sessionId: record.acpSessionId,
      configId: "reasoning_effort",
      value: effort,
    });
    options = Array.isArray(updated?.configOptions) ? updated.configOptions : options;
  }
  record.model = dshRouteModel(command?.model);
  record.imageCapable = dshModelDeclaresImageInput(record.model);
  record.configOptions = options;
  return options;
}

function writeHostPatch() {
  const here = dirname(fileURLToPath(import.meta.url));
  const plugin = join(here, "host-plugin.mjs");
  const home = String(process.env.DSH_HOME ?? "").trim();
  if (!home || !existsSync(plugin)) return "";
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const patchPath = join(home, "milksu-host.cordis.yml");
  writeFileSync(
    patchPath,
    dshAcpHostPatchYaml(plugin, {
      computerUse: resolveDshPackageDir(here, "@deepseek-ai/dsh-computer-use"),
      autoReview: resolveDshPackageDir(here, "@deepseek-ai/dsh-experimental-auto-review"),
      protocol: String(process.env.MILKSU_DSH_LLM_PROTOCOL ?? "").trim(),
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return patchPath;
}

function callHost(method, params) {
  if (!hostIpcPath) {
    return Promise.reject(new Error("DeepSeek Harness host IPC is not configured"));
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(hostIpcPath);
    const id = Date.now();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("DeepSeek Harness host IPC timed out"));
    }, 130_000);
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== id) continue;
        clearTimeout(timer);
        socket.end();
        if (message.error) {
          reject(new Error(message.error.message || "DeepSeek Harness host failed"));
          return;
        }
        resolve(message.result);
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

async function ensureAcp(cwd) {
  if (acp) return acp;
  await ensureProductIpc();
  hostIpcPath = configuredIpcPath("MILKSU_DSH_HOST_IPC", `host-${process.pid}`);
  try {
    unlinkSync(hostIpcPath);
  } catch {
    // First listen.
  }
  const launch = resolveDshLaunch({
    here: dirname(fileURLToPath(import.meta.url)),
    execPath: process.execPath,
    env: process.env,
  });
  const args = [...launch.args];
  const patchPath = writeHostPatch();
  if (patchPath && !args.includes("--patch")) {
    args.push("--patch", patchPath);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const nodePaths = [
    join(here, "node_modules"),
    join(here, "..", "..", "node_modules"),
  ].filter(existsSync);
  const dshHome = String(process.env.DSH_HOME ?? "").trim();
  const bundledSkills = dshHome ? join(dshHome, "skills") : "";
  acp = createAcpClient({
    command: launch.command,
    args,
    cwd,
    env: {
      ...process.env,
      MILKSU_DSH_HOST_IPC: hostIpcPath,
      ...(bundledSkills ? { DSH_BUNDLED_SKILL_DIR: bundledSkills } : {}),
      NODE_PATH: [...nodePaths, process.env.NODE_PATH].filter(Boolean).join(delimiter),
    },
    onFailure(message) {
      emit(null, "error", { error: message });
    },
  });
  acp.onMessage(message => {
    void handleAcpNotification(message);
  });
  const initialized = await acp.request("initialize", {
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
  acpImagePrompts = acpImagePromptsEnabled(initialized);
  return acp;
}

function sessionRecord(conversationId) {
  return sessions.get(conversationId);
}

function emitSubagentTasks(conversationId, tasks) {
  const next = Array.isArray(tasks) ? tasks : [];
  if (next.length) sessionSubagentTasks.set(conversationId, next);
  else sessionSubagentTasks.delete(conversationId);
  emit(conversationId, "subagent_tasks", { subagentTasks: next });
}

function subagentRosterChanged(current, next) {
  return current.length !== next.length
    || next.some((task, index) => (
      task.id !== current[index]?.id
      || task.status !== current[index]?.status
      || task.role !== current[index]?.role
    ));
}

function replaceSubagentTasks(conversationId, tasks) {
  const current = sessionSubagentTasks.get(conversationId) ?? [];
  const next = Array.isArray(tasks) ? tasks : [];
  if (!subagentRosterChanged(current, next)) return;
  emitSubagentTasks(conversationId, next);
}

function settleHostSubagent(conversationId, childId, stopReason) {
  const status = stopReason === "error"
    || stopReason === "cancelled"
    || stopReason === "aborted"
    || stopReason === "interrupted"
    ? "failed"
    : "succeeded";
  replaceSubagentTasks(
    conversationId,
    settleSubagentTask(sessionSubagentTasks.get(conversationId) ?? [], childId, status),
  );
}

function projectSubagentUpdate(conversationId, update) {
  const current = sessionSubagentTasks.get(conversationId) ?? [];
  replaceSubagentTasks(conversationId, applyDshSubagentToolUpdate(current, update));
}

async function refreshHostSubagents(conversationId) {
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId || !hostIpcPath) return;
  try {
    const result = await callHost("list_subagents", { sessionId: record.acpSessionId });
    if (!Array.isArray(result?.subagentTasks)) return;
    replaceSubagentTasks(
      conversationId,
      mergeHostSubagentSnapshot(
        sessionSubagentTasks.get(conversationId) ?? [],
        result.subagentTasks,
      ),
    );
  } catch {
    // Host plugin may not have ctx.subagents in this process.
  }
}

async function interruptHostSubagents(record, subagentId) {
  if (!record?.acpSessionId) return;
  if (subagentId === "*") {
    await callHost("interrupt_all_subagents", { sessionId: record.acpSessionId });
    return;
  }
  await callHost("interrupt_subagent", {
    sessionId: record.acpSessionId,
    subagentId,
  });
}

function conversationIdForSession(sessionId) {
  const acpSessionId = String(sessionId ?? "").trim();
  if (!acpSessionId) return "";
  return [...sessions.entries()].find(([, record]) => record.acpSessionId === acpSessionId)?.[0] ?? "";
}

function emitInboxQueue(conversationId, inbox) {
  const followUp = (inbox?.nextTurn ?? []).map(item => String(item?.text ?? "").trim()).filter(Boolean);
  emit(conversationId, "queue_update", { steering: [], followUp });
}

function emitPlanMode(conversationId, plan) {
  emit(conversationId, "plan_updated", {
    planMode: {
      active: Boolean(plan?.active),
      pending: plan?.pending === undefined ? undefined : Boolean(plan.pending),
    },
  });
}

function emitHostGoal(conversationId, goal) {
  emit(conversationId, "goal_state", { goal: goal ?? null });
}

function emitHostJobs(conversationId, jobs) {
  const next = Array.isArray(jobs) ? jobs : [];
  if (next.length) sessionJobs.set(conversationId, next);
  else sessionJobs.delete(conversationId);
  emit(conversationId, "dsh_jobs", { jobs: next });
}

async function refreshHostJobs(conversationId) {
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId || !hostIpcPath) return;
  try {
    const result = await callHost("list_jobs", { sessionId: record.acpSessionId });
    emitHostJobs(conversationId, result?.jobs ?? []);
  } catch {
    // Jobs service may be absent in this process.
  }
}

async function refreshHostPlan(conversationId) {
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId) return;
  try {
    emitPlanMode(conversationId, await callHost("get_plan", { sessionId: record.acpSessionId }));
  } catch {
    // Plan mode service may be absent.
  }
}

async function refreshHostGoal(conversationId) {
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId) return;
  try {
    const result = await callHost("get_goal", { sessionId: record.acpSessionId });
    emitHostGoal(conversationId, result?.goal ?? null);
  } catch {
    // Goal service may be absent.
  }
}

async function presentHostUserQuestion(params) {
  const conversationId = conversationIdForSession(params?.sessionId);
  if (!conversationId) return;
  const options = Array.isArray(params?.options) ? params.options : [];
  if (options.length < 2) return;
  const question = [params?.question, params?.detail].filter(Boolean).join("\n\n");
  pendingUserQuestions.set(String(params?.id ?? ""), true);
  try {
    const picked = await requestAsk({
      conversationId,
      question,
      options,
    });
    await callHost("answer_user_question", {
      id: params?.id,
      choice: picked?.label ?? picked?.id,
      approved: Boolean(picked),
    });
  } catch (error) {
    try {
      await callHost("answer_user_question", {
        id: params?.id,
        approved: false,
      });
    } catch {
      // The review already timed out or the fiber unloaded.
    }
    emit(conversationId, "error", { error: describeError(error) });
  } finally {
    pendingUserQuestions.delete(String(params?.id ?? ""));
  }
}

function emitCommandOutcome(conversationId, requestId, result, error) {
  emit(conversationId, "dsh_command", {
    requestId,
    command: result,
    error: error ? describeError(error) : undefined,
  });
}

async function listSessionCommands(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const result = await callHost("list_commands", { sessionId: record.acpSessionId });
    emit(conversationId, "dsh_commands", {
      requestId,
      commands: result?.commands ?? [],
    });
  } catch (error) {
    emit(conversationId, "dsh_commands", {
      requestId,
      commands: [],
      error: describeError(error),
    });
  }
}

async function executeSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const result = await callHost("execute_command", {
      sessionId: record.acpSessionId,
      line: command.line,
    });
    emitCommandOutcome(conversationId, requestId, result);
    if (result?.name === "plan") await refreshHostPlan(conversationId);
    if (result?.name === "goal") await refreshHostGoal(conversationId);
    if (result?.kind === "error") {
      emit(conversationId, "error", { error: result.text || "Command failed" });
    }
  } catch (error) {
    emitCommandOutcome(conversationId, requestId, undefined, error);
    emit(conversationId, "error", { error: describeError(error) });
  }
}

async function setSessionPlanMode(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const result = await callHost("set_plan", {
      sessionId: record.acpSessionId,
      active: command.active === true,
    });
    emitPlanMode(conversationId, result);
    emit(conversationId, "dsh_command", {
      requestId,
      command: { name: "plan", ...result },
      planMode: {
        active: Boolean(result?.active),
        pending: result?.pending,
      },
    });
  } catch (error) {
    emit(conversationId, "error", { error: describeError(error) });
    emit(conversationId, "dsh_command", { requestId, error: describeError(error) });
  }
}

async function controlSessionGoal(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const result = await callHost("control_goal", {
      sessionId: record.acpSessionId,
      action: command.goalAction,
      objective: command.objective,
    });
    emitHostGoal(conversationId, result?.goal ?? null);
    emit(conversationId, "dsh_command", { requestId, command: result });
  } catch (error) {
    emit(conversationId, "error", { error: describeError(error) });
    emit(conversationId, "dsh_command", { requestId, error: describeError(error) });
  }
}

async function queueParent(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const prompt = String(command.prompt ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  if (!prompt) throw new Error("prompt is required");
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
  const inbox = await callHost("inbox_append", { sessionId: record.acpSessionId, prompt });
  emitInboxQueue(conversationId, inbox);
}

async function removeQueuedParent(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const inbox = await callHost("inbox_remove", {
      sessionId: record.acpSessionId,
      expected: command.expected,
    });
    emitInboxQueue(conversationId, inbox);
    emit(conversationId, "queued_message_removed", { requestId });
  } catch (error) {
    emit(conversationId, "queued_message_removed", { requestId, error: describeError(error) });
  }
}

async function killSessionJob(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const record = sessionRecord(conversationId);
  try {
    if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
    const result = await callHost("kill_job", {
      sessionId: record.acpSessionId,
      jobId: command.jobId,
    });
    emitHostJobs(conversationId, result?.jobs ?? []);
    emit(conversationId, "dsh_job_killed", { requestId, jobId: command.jobId });
  } catch (error) {
    emit(conversationId, "dsh_job_killed", {
      requestId,
      error: describeError(error),
    });
  }
}

function startHostWatch() {
  if (hostWatch || !hostIpcPath) return;
  const socket = createConnection(hostIpcPath);
  hostWatch = socket;
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.method === "user_question") {
        void presentHostUserQuestion(message.params);
        continue;
      }
      if (message.method !== "subagent_event") continue;
      const childId = String(message.params?.childId ?? "").trim();
      const phase = String(message.params?.phase ?? "");
      const stopReason = String(message.params?.stopReason ?? "");
      for (const conversationId of sessions.keys()) {
        if (phase === "end" && childId) {
          settleHostSubagent(conversationId, childId, stopReason);
        }
        void refreshHostSubagents(conversationId).then(() => {
          if (phase === "end" && childId) {
            settleHostSubagent(conversationId, childId, stopReason);
          }
        });
        void refreshHostJobs(conversationId);
      }
    }
  });
  socket.on("error", () => {
    if (hostWatch === socket) hostWatch = null;
  });
  socket.on("close", () => {
    if (hostWatch === socket) hostWatch = null;
  });
  socket.write(`${JSON.stringify({ id: "watch", method: "watch", params: {} })}\n`);
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
      const toolCall = message.params?.toolCall ?? {};
      if (dshShouldAutoAllowPermission(record.approvalPolicy, toolCall)) {
        acp.respond(message.id, dshPermissionResult(true));
        emit(conversationId, "approval_resolved", {
          requestId,
          approved: true,
          reason: "auto-allow",
        });
        return;
      }
      record.pendingPermission = { jsonrpcId: message.id, requestId };
      emit(conversationId, "approval_requested", {
        requestId,
        toolName: String(toolCall.title || toolCall.kind || "tool"),
        input: JSON.stringify(toolCall),
      });
    }
  }
}

function finishThinking(conversationId) {
  const record = sessions.get(conversationId);
  if (!record?.thinkingOpen) return;
  const started = Number(record.thinkingStartedAt ?? Date.now());
  record.thinkingOpen = false;
  emit(conversationId, "thinking_done", {
    content: String(record.thinkingText ?? ""),
    durationMs: Math.max(0, Date.now() - started),
  });
}

function projectSessionUpdate(conversationId, update) {
  const kind = String(update?.sessionUpdate ?? update?.session_update ?? "");
  if (kind === "agent_message_chunk" || kind === "agent_message_delta") {
    const text = update?.content?.text ?? update?.text ?? "";
    if (text) {
      finishThinking(conversationId);
      const record = sessions.get(conversationId);
      if (record) record.sawVisibleText = true;
      emit(conversationId, "text_delta", { delta: text });
    }
    return;
  }
  if (kind === "agent_thought_chunk") {
    const text = update?.content?.text ?? update?.text ?? "";
    if (!text) return;
    const record = sessions.get(conversationId);
    if (record && !record.thinkingOpen) {
      record.thinkingOpen = true;
      record.thinkingStartedAt = Date.now();
      record.thinkingText = "";
      emit(conversationId, "thinking_start");
    }
    if (record) record.thinkingText = `${record.thinkingText ?? ""}${text}`;
    emit(conversationId, "thinking_delta", { delta: text });
    return;
  }
  if (kind === "tool_call") {
    finishThinking(conversationId);
    emit(conversationId, "tool_call_start", {
      toolName: String(update?.title || update?.kind || "tool"),
      toolCallId: String(update?.toolCallId || update?.tool_call_id || ""),
    });
    projectSubagentUpdate(conversationId, update);
    return;
  }
  if (kind === "tool_call_update") {
    const status = String(update?.status ?? "");
    projectSubagentUpdate(conversationId, update);
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
  const cwdRaw = String(command.cwd || command.workspacePath || process.cwd());
  const cwd = isAbsolute(cwdRaw) ? cwdRaw : resolve(cwdRaw);
  syncDshSkillCatalog({
    disabledSkills: command.disabledSkills,
    extraSkillPaths: command.userSkillPaths,
  });
  await attachCodingBrowserDescriptor(command);
  const client = await ensureAcp(cwd);
  const mcpServers = sessionMcpServers(conversationId, command);
  const resumeId = String(command.resumeSessionId || command.acpSessionId || "").trim();
  let created;
  let resumed = false;
  if (resumeId) {
    try {
      created = await client.request("session/resume", {
        sessionId: resumeId,
        cwd,
        mcpServers,
      });
      resumed = true;
    } catch {
      created = null;
    }
  }
  if (!resumed) {
    created = await client.request("session/new", {
      cwd,
      mcpServers,
    });
  }
  const acpSessionId = String(
    resumed ? resumeId : (created?.sessionId || created?.session_id || conversationId),
  );
  const record = {
    acpSessionId,
    cwd,
    createCommand: command,
    approvalPolicy: dshNormalizeApprovalPolicy(command.approvalPolicy),
    aborted: false,
    thinkingOpen: false,
    thinkingText: "",
    thinkingStartedAt: 0,
    sawVisibleText: false,
    reasoningOnlyRecovered: false,
    model: "",
    imageCapable: false,
  };
  sessions.set(conversationId, record);
  try {
    await applySessionOptions(record, command, created?.configOptions);
  } catch (error) {
    emit(conversationId, "error", { error: describeError(error) });
  }
  try {
    await callHost("set_approval", {
      sessionId: acpSessionId,
      policy: record.approvalPolicy,
    });
  } catch {
    // ACP profile may not expose permissionPresets; workspace-auto still
    // answers session/request_permission in the MilkSU client.
  }
  emit(conversationId, "ready", { resumed });
  startHostWatch();
  void refreshHostPlan(conversationId);
  void refreshHostGoal(conversationId);
  void refreshHostJobs(conversationId);
}

async function sendMessage(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  if (!sessions.has(conversationId)) {
    await createSession(command);
  } else {
    await attachCodingBrowserDescriptor(command);
  }
  const record = sessionRecord(conversationId);
  if (command.approvalPolicy) {
    record.approvalPolicy = dshNormalizeApprovalPolicy(command.approvalPolicy);
  }
  const client = await ensureAcp(record.cwd);
  if (command.model && dshRouteModel(command.model) !== record.model) {
    try {
      await applySessionOptions(record, command, record.configOptions);
    } catch {
      // Catalog discovery lives on the session; a missing option keeps the current route.
    }
  }
  const rawPrompt = String(command.prompt ?? "").trim();
  const slash = parseSlashLine(rawPrompt);
  if (slash) {
    await executeSessionCommand({
      conversationId,
      requestId: command.requestId,
      line: slash.line,
    });
    return;
  }
  emit(conversationId, "turn_started");
  record.sawVisibleText = false;
  record.reasoningOnlyRecovered = false;
  const prompt = await buildDshPromptBlocks(command, {
    imagePrompts: acpImagePrompts && record.imageCapable,
  });
  try {
    await client.request("session/prompt", {
      sessionId: record.acpSessionId,
      prompt,
    });
  } catch (error) {
    if (record.aborted) {
      finishThinking(conversationId);
      return;
    }
    throw error;
  }
  if (record.aborted) {
    finishThinking(conversationId);
    return;
  }
  if (
    shouldRecoverReasoningOnlyTurn({
      stopReason: "stop",
      text: record.sawVisibleText ? "yes" : "",
      thinking: record.thinkingText,
      hasToolCall: false,
    })
    && !record.reasoningOnlyRecovered
  ) {
    record.reasoningOnlyRecovered = true;
    logReasoningOnlyFinal({
      kernel: "dsh",
      stopReason: "stop",
      reasoningChars: String(record.thinkingText ?? "").length,
      contentChars: 0,
      toolCallCount: 0,
    });
    try {
      await client.request("session/prompt", {
        sessionId: record.acpSessionId,
        prompt: [{ type: "text", text: reasoningOnlyRecoveryPrompt() }],
      });
    } catch (error) {
      if (!record.aborted) throw error;
    }
  }
  if (record.aborted) {
    finishThinking(conversationId);
    return;
  }
  finishThinking(conversationId);
  emit(conversationId, "message_done");
  emit(conversationId, "turn_settled");
  void refreshHostSubagents(conversationId);
}

async function abortSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const subagentId = String(command.subagentId ?? "").trim();
  const record = sessionRecord(conversationId);
  if (subagentId) {
    try {
      await interruptHostSubagents(record, subagentId);
      await refreshHostSubagents(conversationId);
    } catch (error) {
      emit(conversationId || null, "error", { error: describeError(error) });
    }
    return;
  }
  if (record) record.aborted = true;
  finishThinking(conversationId);
  if (record) {
    try {
      await interruptHostSubagents(record, "*");
    } catch {
      // Native children stay listed until the host catalog refreshes.
    }
    try {
      const listed = await callHost("list_jobs", { sessionId: record.acpSessionId });
      for (const job of listed?.jobs ?? []) {
        if (job?.id && (job.status === "running" || job.status === "stopping")) {
          await callHost("kill_job", { sessionId: record.acpSessionId, jobId: job.id });
        }
      }
      await refreshHostJobs(conversationId);
    } catch {
      // Jobs stay listed until the host catalog refreshes.
    }
  }
  if (record && acp) {
    try {
      acp.notify("session/cancel", { sessionId: record.acpSessionId });
    } catch {
      // DSH ACP registers session/cancel as a notification, not a request.
    }
  }
  emit(conversationId || null, "turn_settled", { aborted: true });
}

async function compactSession(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  emit(conversationId, "compaction_start", { requestId });
  const record = sessionRecord(conversationId);
  try {
    if (!acp || !record) {
      throw new Error("DeepSeek Harness session is not running");
    }
    const result = await callHost("compact", { sessionId: record.acpSessionId });
    emit(conversationId, "compaction_end", {
      requestId,
      compaction: {
        tokensBefore: Number(result?.tokensBefore ?? 0),
        estimatedTokensAfter: Number(result?.estimatedTokensAfter ?? result?.tokensAfter ?? 0),
      },
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
  sessionSubagentTasks.delete(conversationId);
  sessionJobs.delete(conversationId);
  emit(conversationId || null, "session_destroyed");
}

async function respondApproval(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  const ask = pendingAsks.get(requestId);
  if (ask) {
    pendingAsks.delete(requestId);
    const option = resolveAskChoice(ask.options, command.choice, command.approved);
    emit(conversationId, "approval_resolved", {
      requestId,
      toolName: codingAskToolName,
      approved: Boolean(option),
      reason: option ? "choice selected" : "dismissed by user",
      choice: option?.id === askOtherChoiceId
        ? encodeAskOtherChoice(option.label)
        : option?.id,
    });
    ask.resolve(option);
    return;
  }
  const record = sessionRecord(conversationId);
  if (!record?.pendingPermission || !acp) return;
  acp.respond(
    record.pendingPermission.jsonrpcId,
    dshPermissionResult(Boolean(command.approved)),
  );
  emit(conversationId, "approval_resolved", {
    requestId: record.pendingPermission.requestId,
    approved: Boolean(command.approved),
  });
  record.pendingPermission = null;
}

async function attachCodingBrowserDescriptor(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId || command.codingBrowser == null) return;
  await writeCodingBrowserDescriptor(conversationId, command.codingBrowser);
}

async function respondWorkspaceAction(command) {
  try {
    await attachCodingBrowserDescriptor(command);
  } catch (error) {
    emit(command.conversationId ?? null, "error", { error: describeError(error) });
  }
  workspaceBroker.respond({
    requestId: command.requestId,
    ok: command.ok !== false && !command.error,
    result: command.result,
    error: command.error,
  });
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

async function followupParent(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const prompt = String(command.prompt ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  if (!prompt) throw new Error("prompt is required");
  const record = sessionRecord(conversationId);
  if (!record?.acpSessionId) throw new Error("DeepSeek Harness session is not ready");
  await callHost("followup", { sessionId: record.acpSessionId, prompt });
}

function enqueueSessionCommand(conversationId, work) {
  const key = String(conversationId ?? "").trim() || "_";
  const previous = sessionCommandQueues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  sessionCommandQueues.set(key, next);
  return next;
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
    case "workspace_action_response":
      await respondWorkspaceAction(command);
      break;
    case "steer_message":
      await followupParent(command);
      break;
    case "queue_message":
      await queueParent(command);
      break;
    case "list_commands":
      await listSessionCommands(command);
      break;
    case "execute_command":
      await executeSessionCommand(command);
      break;
    case "set_plan_mode":
      await setSessionPlanMode(command);
      break;
    case "control_goal":
      await controlSessionGoal(command);
      break;
    case "kill_job":
      await killSessionJob(command);
      break;
    case "remove_queued_message":
      await removeQueuedParent(command);
      break;
    case "background_task_control":
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
  if (command.action === "steer_message") {
    void followupParent(command).catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  if (command.action === "queue_message") {
    void queueParent(command).catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  if (command.action === "approval_response") {
    void respondApproval(command);
    return;
  }
  if (command.action === "workspace_action_response") {
    void respondWorkspaceAction(command).catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  enqueueSessionCommand(command.conversationId, () => handleCommand(command))
    .catch(error => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

export { handleCommand, emit, sessions, enqueueSessionCommand };
