import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createInterface } from "node:readline";
import { join } from "node:path";

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);
const sessions = new Map();
const input = createInterface({ input: process.stdin });

function emit(requestId, type, data = {}) {
  process.stdout.write(`${JSON.stringify({ requestId: requestId ?? null, type, ...data })}\n`);
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

async function setSessionModel(session, provider, model) {
  if (!provider || !model) throw new Error("provider and model are required");
  const desired = session.modelRegistry.find(provider, model);
  if (!desired) throw new Error(`Model not found: ${provider}/${model}`);
  await session.setModel(desired);
}

function makeActionTool({ name, actionName, label, description, parameters, mapInput }, selection) {
  return defineTool({
    name,
    label,
    description,
    promptSnippet: description,
    parameters,
    async execute(_toolCallId, params) {
      if (selection.value) throw new Error("Only one CTF action may be proposed per turn");
      selection.value = {
        capability: "ctf.core",
        name: actionName,
        input: mapInput(params),
        rationale: params.rationale,
      };
      return {
        content: [{ type: "text", text: "Typed CTF action proposal returned to MilkSU for policy validation." }],
        details: selection.value,
        terminate: true,
      };
    },
  });
}

function createTools(selection) {
  const rationale = Type.String({
    minLength: 1,
    maxLength: 2000,
    description: "Why this one action follows from the current evidence and what it should establish",
  });
  return [
    makeActionTool({
      name: "ctf_inspect_material",
      actionName: "ctf.inspect_material",
      label: "Inspect CTF material",
      description: "Inspect one user-admitted CTF material by its MilkSU artifact ID.",
      parameters: Type.Object({
        materialId: Type.String({ minLength: 1, maxLength: 256 }),
        rationale,
      }),
      mapInput: ({ materialId }) => ({ materialId }),
    }, selection),
    makeActionTool({
      name: "ctf_decode_hex",
      actionName: "ctf.decode_hex",
      label: "Decode hexadecimal artifact",
      description: "Decode one Job-owned MilkSU artifact as hexadecimal using a deterministic capability.",
      parameters: Type.Object({
        artifactId: Type.String({ minLength: 1, maxLength: 256 }),
        rationale,
      }),
      mapInput: ({ artifactId }) => ({ artifactId }),
    }, selection),
    makeActionTool({
      name: "ctf_submit_flag",
      actionName: "ctf.submit_flag",
      label: "Submit candidate flag",
      description: "Submit an evidence-supported candidate to MilkSU's independent local judge.",
      parameters: Type.Object({
        candidate: Type.String({ minLength: 1, maxLength: 512 }),
        explanation: Type.String({ minLength: 1, maxLength: 2000 }),
        rationale,
      }),
      mapInput: ({ candidate, explanation }) => ({ candidate, explanation }),
    }, selection),
  ];
}

async function createSession(command) {
  const attemptId = command.attemptId;
  if (!attemptId) throw new Error("attemptId is required");
  const existing = sessions.get(attemptId);
  if (existing) return existing;

  const cwd = process.cwd();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, ".milksu", "pi-security"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: command.rolePrompt,
  });
  await resourceLoader.reload();
  const selection = { value: null };
  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
    // Keep only the three custom CTF proposal tools. Pi's coding tools are not
    // registered into this session.
    noTools: "builtin",
    customTools: createTools(selection),
  });
  const effectiveModel = configureRelayModel(session, command.provider, command.model);
  await setSessionModel(session, effectiveModel.provider, effectiveModel.model);
  const value = { session, selection, queue: Promise.resolve() };
  sessions.set(attemptId, value);
  return value;
}

async function propose(command) {
  if (!command.requestId) throw new Error("requestId is required");
  const value = await createSession(command);
  const run = async () => {
    value.selection.value = null;
    await value.session.prompt(
      `ROLE_STATE (authoritative JSON from MilkSU):\n${JSON.stringify(command.roleState)}\n\nPropose exactly one action now by calling one available tool.`,
    );
    if (!value.selection.value) {
      throw new Error("Model completed without proposing a typed CTF action");
    }
    emit(command.requestId, "proposal", { action: value.selection.value });
  };
  const next = value.queue.then(run);
  value.queue = next.catch(() => undefined);
  await next;
}

async function abortAttempt(command) {
  const value = sessions.get(command.attemptId);
  if (value) await value.session.abort();
  if (command.requestId) emit(command.requestId, "aborted");
}

async function closeAttempt(command) {
  const value = sessions.get(command.attemptId);
  if (value) {
    await value.session.abort();
    value.session.dispose();
    sessions.delete(command.attemptId);
  }
  if (command.requestId) emit(command.requestId, "closed");
}

async function handleCommand(command) {
  switch (command.action) {
    case "protocol_info":
      emit(command.requestId, "protocol_info", {
        protocol: "milksu-security-engine/v1alpha1",
        capabilities: ["ctf.inspect_material", "ctf.decode_hex", "ctf.submit_flag"],
        inheritedTools: [],
      });
      break;
    case "propose":
      await propose(command);
      break;
    case "abort_attempt":
      await abortAttempt(command);
      break;
    case "close_attempt":
      await closeAttempt(command);
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
    emit(null, "error", { error: `Malformed JSON command: ${String(error)}` });
    return;
  }
  void handleCommand(command).catch((error) => {
    emit(command.requestId, "error", { error: String(error) });
  });
});

async function shutdown() {
  input.close();
  for (const value of sessions.values()) {
    try {
      await value.session.abort();
    } catch {
      // Process shutdown still disposes the in-memory session below.
    }
    value.session.dispose();
  }
  sessions.clear();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
