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
import piLspExtension from "@narumitw/pi-lsp/src/index.ts";
import { loadSessionPolicy } from "./bridge-policy.js";

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

const sessions = new Map();
const promptQueues = new Map();
const abortedSessions = new Set();
const input = createInterface({ input: process.stdin });
let commandQueue = Promise.resolve();
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));

function emit(conversationId, type, data = {}) {
  process.stdout.write(`${JSON.stringify({ type, id: conversationId ?? null, ...data })}\n`);
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

function formatToolInput(toolName, args) {
  if (!args || typeof args !== "object") return "";
  if (toolName === "bash" && typeof args.command === "string") {
    return `$ ${args.command}`;
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

function configureRuntimeModel(session, provider, model) {
  if (provider === "kourichat") {
    session.modelRegistry.registerProvider("kourichat", {
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
    session.modelRegistry.registerProvider(provider, {
      baseUrl: providerBaseUrls[provider],
    });
  }
  return configureRelayModel(session, provider, model);
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

function subscribeSession(conversationId, session, maxToolEventOutputBytes) {
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
      emit(conversationId, "tool_call_start", {
        toolName: event.toolName,
        content: formatToolInput(event.toolName, event.args),
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      emit(conversationId, "tool_call_end", {
        toolName: event.toolName,
        content: truncate(extractToolResultContent(event.result), maxToolEventOutputBytes),
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

function createMilkSUResourceLoader(cwd, agentDir, systemPrompt, sessionRole) {
  // Skills and extensions may execute instructions supplied by third parties.
  // Keep Pi's ambient discovery disabled and load only MilkSU-reviewed resources.
  const codingSkillPaths = sessionRole
    ? []
    : [
        join(bridgeDirectory, "skills", "archify"),
        join(bridgeDirectory, "third_party", "archify", "archify"),
      ].filter((path) => existsSync(join(path, "SKILL.md"))).slice(0, 1);
  const extensionFactories = [createMilkSUWorkflowExtension(sessionRole)];
  if (!sessionRole) extensionFactories.push(piLspExtension);
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

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const existing = sessions.get(conversationId);
  if (existing) return existing;

  const cwd = process.cwd();
  const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
  const projectInstructions = await loadProjectInstructions(cwd);
  const sessionPolicy = await loadSessionPolicy(cwd, command.sessionRole);
  const effectiveSessionRole = sessionPolicy.ctf
    ? command.sessionRole || "solver"
    : "";
  const resourceLoader = createMilkSUResourceLoader(
    cwd,
    agentDir,
    projectInstructions,
    effectiveSessionRole,
  );
  await resourceLoader.reload();

  let session;
  try {
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager: await createSessionManager(cwd, agentDir, conversationId),
      resourceLoader,
      tools: sessionPolicy.activeTools,
      customTools: sessionPolicy.customTools,
    }));
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
    emit(conversationId, "ready", {
      workspace: cwd,
      tools: session.getActiveToolNames(),
      extensions: [
        "milksu-workflow",
        ...(effectiveSessionRole ? [] : ["pi-lsp"]),
      ],
      skills: resourceLoader.getSkills().skills.map((skill) => skill.name),
      resumed: session.messages.length > 0,
    });
    return session;
  } catch (error) {
    session?.dispose();
    throw error;
  }
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const existing = sessions.get(conversationId);
  const session = existing ?? await createSession(command);
  if (existing) {
    const effectiveModel = configureRuntimeModel(session, command.provider, command.model);
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
    );
  }

  const previous = promptQueues.get(conversationId) ?? Promise.resolve();
  const next = previous.then(() => session.prompt(command.prompt ?? ""));
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
  abortedSessions.add(conversationId);
  await session.abort();
  emit(conversationId, "message_done", { reason: "aborted", content: "" });
}

async function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const session = sessions.get(conversationId);
  const sessionFile = session?.sessionFile;
  session?.dispose();
  sessions.delete(conversationId);
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
  commandQueue = commandQueue
    .then(() => handleCommand(command))
    .catch((error) => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

function disposeAllSessions() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  promptQueues.clear();
  abortedSessions.clear();
}

function shutdown() {
  disposeAllSessions();
  input.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
