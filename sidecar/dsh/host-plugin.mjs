import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dshPresetForApprovalPolicy } from "./permission.js";
import {
  interruptAllHostSubagents,
  interruptHostSubagent,
  listHostSubagents,
} from "./host-subagents.js";
import {
  appendHostInbox,
  executeHostCommand,
  getHostGoal,
  getHostPlanMode,
  killHostJob,
  listHostCommands,
  listHostInbox,
  listHostJobs,
  mapAskChoiceToUserQuestionAnswer,
  mutateHostGoal,
  projectCompactResult,
  projectUserQuestionAsk,
  removeHostInbox,
  replaceHostInbox,
  seedHandoffContext,
  setHostPlanMode,
} from "./host-primitives.js";

export const name = "milksu-dsh-host";
// Process-lifetime IPC. Do not inject agents/compaction: those services recycle
// with sessions, Cordis unloads this fiber, and ctx.effect / ctx.on then throw
// "cannot create effect on inactive context" into ACP as Internal error.
// optionalInject is not a Cordis API. Read services in dispatch via ctx.get().

// Cordis FiberState.UNLOADING. effect() throws INACTIVE_EFFECT in this state
// even while uid is still set (required inject lost, fiber unloading).
const fiberStateUnloading = 5;

export function isInactiveEffectError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cannot create effect on inactive context/i.test(message);
}

export function hostContextAcceptsEffect(ctx) {
  if (!ctx) return false;
  const fiber = ctx.fiber;
  if (fiber) {
    if (fiber.uid === null) return false;
    if (fiber.state === fiberStateUnloading) return false;
  }
  return typeof ctx.effect === "function";
}

export function followupHostAgent(agent, text) {
  const prompt = String(text ?? "").trim();
  if (!prompt) throw new Error("prompt is required");
  if (!agent || typeof agent.followup !== "function") {
    throw new Error("DeepSeek Harness followup is unavailable");
  }
  // DSH Agent.followup queues a next-turn user message and wakes the driver.
  // Do not wait for ACP session/prompt: that call settles only after whenIdle,
  // which includes continuable children and would block the parent composer.
  agent.followup({
    content: [{ type: "text", text: prompt }],
    source: { kind: "user" },
  });
}

export function hostService(ctx, name) {
  if (!ctx || !name) return undefined;
  if (typeof ctx.get === "function") {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }
  return ctx[name];
}

function registerOwnedEffect(ctx, execute) {
  if (!hostContextAcceptsEffect(ctx)) return;
  try {
    ctx.effect(execute);
  } catch (error) {
    if (!isInactiveEffectError(error)) throw error;
  }
}

function registerOwnedListener(ctx, name, listener) {
  if (typeof ctx?.on !== "function") return;
  if (ctx.fiber && !hostContextAcceptsEffect(ctx)) return;
  try {
    ctx.on(name, listener);
  } catch (error) {
    if (!isInactiveEffectError(error)) throw error;
  }
}

export function apply(ctx) {
  const path = String(process.env.MILKSU_DSH_HOST_IPC ?? "").trim();
  if (!path) return;

  try {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  } catch {
    // Named pipes have no parent directory.
  }

  const watchers = new Set();
  const pendingUserQuestions = new Map();

  function notifyWatchers(method, payload) {
    const line = `${JSON.stringify({ method, params: payload })}\n`;
    for (const socket of watchers) {
      try {
        socket.write(line);
      } catch {
        watchers.delete(socket);
      }
    }
  }

  registerOwnedListener(ctx, "user-questions/request", (request, next) => {
    const ask = projectUserQuestionAsk(request?.questions);
    if (!ask.options.length) {
      return typeof next === "function" ? next() : undefined;
    }
    const id = `uq_${Date.now()}_${pendingUserQuestions.size}`;
    const sessionId = String(request?.agent?.id ?? "").trim();
    const settled = new Promise((resolve, reject) => {
      pendingUserQuestions.set(id, { request, resolve, reject });
    });
    notifyWatchers("user_question", {
      id,
      sessionId,
      question: ask.question,
      detail: ask.detail,
      options: ask.options,
    });
    return settled;
  });

  registerOwnedListener(ctx, "subagent/start", (info, parent) => {
    notifyWatchers("subagent_event", {
      phase: "start",
      childId: String(info?.id ?? ""),
      parentId: String(parent?.id ?? ""),
      runId: String(info?.runId ?? ""),
    });
  });
  registerOwnedListener(ctx, "subagent/end", (info, parent) => {
    notifyWatchers("subagent_event", {
      phase: "end",
      childId: String(info?.id ?? ""),
      parentId: String(parent?.id ?? ""),
      runId: String(info?.runId ?? ""),
      stopReason: info?.stopReason,
    });
  });

  const server = createServer(socket => {
    socket.on("error", () => {});
    let buffer = "";
    socket.on("close", () => watchers.delete(socket));
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        void handleLine(ctx, socket, watchers, pendingUserQuestions, line);
      }
    });
  });

  server.on("error", () => {});
  registerOwnedEffect(ctx, () => {
    server.listen(path);
    return () => {
      server.close();
    };
  });
}

async function handleLine(ctx, socket, watchers, pendingUserQuestions, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const result = await dispatch(ctx, watchers, socket, message, pendingUserQuestions);
    try {
      socket.write(`${JSON.stringify({ id: message.id, result })}\n`);
    } catch {
      // Client already closed the named pipe.
    }
  } catch (error) {
    try {
      socket.write(`${JSON.stringify({
        id: message.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      })}\n`);
    } catch {
      // Client already closed the named pipe.
    }
  }
}

export async function dispatch(ctx, watchers, socket, message, pendingUserQuestions = new Map()) {
  if (message.method === "watch") {
    watchers.add(socket);
    return { watching: true };
  }
  if (message.method === "answer_user_question") {
    const id = String(message.params?.id ?? "").trim();
    const pending = pendingUserQuestions.get(id);
    if (!pending) throw new Error("User question is no longer pending");
    pendingUserQuestions.delete(id);
    pending.resolve(mapAskChoiceToUserQuestionAnswer(
      pending.request?.questions,
      message.params?.choice,
      message.params?.approved,
    ));
    return { answered: true };
  }
  const sessionId = String(message.params?.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  const subagents = hostService(ctx, "subagents");
  const agents = hostService(ctx, "agents");
  if (message.method === "list_subagents") {
    return { subagentTasks: await listHostSubagents(subagents, sessionId) };
  }
  if (message.method === "interrupt_subagent") {
    await interruptHostSubagent(
      subagents,
      agents,
      sessionId,
      message.params?.subagentId,
    );
    return { interrupted: true };
  }
  if (message.method === "interrupt_all_subagents") {
    const ids = await interruptAllHostSubagents(subagents, agents, sessionId);
    return { interrupted: ids };
  }
  const agent = typeof agents?.get === "function" ? agents.get(sessionId) : undefined;
  if (!agent) throw new Error(`DeepSeek Harness session not found: ${sessionId}`);
  if (message.method === "set_approval") {
    const policy = String(message.params?.policy ?? "").trim();
    const presets = hostService(ctx, "permissionPresets");
    const preset = dshPresetForApprovalPolicy(policy);
    if (presets && typeof presets.set === "function") {
      await presets.set(agent, preset);
    }
    return { preset };
  }
  if (message.method === "followup") {
    followupHostAgent(agent, message.params?.prompt);
    return { queued: true };
  }
  if (message.method === "list_commands") {
    return { commands: listHostCommands(hostService(ctx, "commands"), agent) };
  }
  if (message.method === "execute_command") {
    return executeHostCommand(
      hostService(ctx, "commands"),
      agent,
      message.params?.line,
    );
  }
  if (message.method === "get_plan") {
    return getHostPlanMode(hostService(ctx, "planMode"), agent);
  }
  if (message.method === "set_plan") {
    return setHostPlanMode(hostService(ctx, "planMode"), agent, message.params?.active === true);
  }
  if (message.method === "get_goal") {
    return getHostGoal(hostService(ctx, "goals"), agent);
  }
  if (message.method === "control_goal") {
    return mutateHostGoal(
      hostService(ctx, "goals"),
      agent,
      String(message.params?.action ?? "").trim(),
      message.params?.objective,
    );
  }
  if (message.method === "inbox_list") {
    return listHostInbox(agent);
  }
  if (message.method === "inbox_append") {
    return appendHostInbox(agent, message.params?.prompt);
  }
  if (message.method === "inbox_remove") {
    return removeHostInbox(agent, message.params?.messageId, message.params?.expected);
  }
  if (message.method === "inbox_replace") {
    return replaceHostInbox(agent, message.params?.messageId, message.params?.prompt);
  }
  if (message.method === "list_jobs") {
    return listHostJobs(hostService(ctx, "jobs"), agent);
  }
  if (message.method === "kill_job") {
    return killHostJob(hostService(ctx, "jobs"), agent, message.params?.jobId);
  }
  if (message.method === "seed_context") {
    return seedHandoffContext(agent, message.params?.text);
  }
  if (message.method !== "compact") {
    throw new Error(`Unknown MilkSU host method: ${message.method}`);
  }
  const compaction = hostService(ctx, "compaction");
  if (!compaction || typeof compaction.compactNow !== "function") {
    throw new Error("DeepSeek Harness compaction is unavailable");
  }
  const result = await compaction.compactNow(agent, AbortSignal.timeout(120_000));
  return projectCompactResult(result, agent.session);
}
