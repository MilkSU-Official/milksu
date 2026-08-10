import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import currentProviderRuntime from "../pi/current-provider-runtime.cjs";

const { currentProviderDefinition } = currentProviderRuntime;

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);
const sessions = new Map();
let input;

function emit(requestId, type, data = {}) {
  process.stdout.write(`${JSON.stringify({ requestId: requestId ?? null, type, ...data })}\n`);
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const resource = error.resource ? `\nresource: ${error.resource}` : "";
  return `${error.stack || error.message}${resource}`;
}

function findRuntimeModel(session, provider, model) {
  if (session?.modelRuntime?.getModel) {
    return session.modelRuntime.getModel(provider, model);
  }
  if (session?.modelRegistry?.find) {
    return session.modelRegistry.find(provider, model);
  }
  return undefined;
}

function registerRuntimeProvider(session, provider, definition) {
  if (!definition) return false;
  if (session?.modelRuntime?.registerProvider) {
    session.modelRuntime.registerProvider(provider, definition);
    return true;
  }
  if (session?.modelRegistry?.registerProvider) {
    session.modelRegistry.registerProvider(provider, definition);
    return true;
  }
  return false;
}

function configureRelayModel(session, provider, model) {
  if (!relayEnabled) return { provider, model };
  const source = findRuntimeModel(session, provider, model);
  const registered = registerRuntimeProvider(session, "milksu-relay", {
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
  if (!registered) return { provider, model };
  return { provider: "milksu-relay", model };
}

function configureRuntimeModel(session, provider, model) {
  const definition = currentProviderDefinition(provider, model);
  registerRuntimeProvider(session, provider, definition);
  return configureRelayModel(session, provider, model);
}

async function setSessionModel(session, provider, model) {
  if (!provider || !model) throw new Error("provider and model are required");
  const desired = findRuntimeModel(session, provider, model);
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

function createTools(selection, profile = {}) {
  const rationale = Type.String({
    minLength: 1,
    maxLength: 2000,
    description: "Why this one action follows from the current evidence and what it should establish",
  });
  const tools = [
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
      name: "ctf_decode_text",
      actionName: "ctf.decode_text",
      label: "Decode CTF text",
      description: "Deterministically decode a bounded text value as Base64, hexadecimal, binary, Morse, URL encoding, or an automatically detected chain. Use auto with maxLayers for nested encodings.",
      parameters: Type.Object({
        source: Type.String({ minLength: 1, maxLength: 65536 }),
        encoding: Type.Union([
          Type.Literal("auto"),
          Type.Literal("base64"),
          Type.Literal("hex"),
          Type.Literal("binary"),
          Type.Literal("morse"),
          Type.Literal("url"),
        ]),
        maxLayers: Type.Integer({ minimum: 1, maximum: 20 }),
        rationale,
      }),
      mapInput: ({ source, encoding, maxLayers }) => ({ source, encoding, maxLayers }),
    }, selection),
    makeActionTool({
      name: "ctf_coach_hint",
      actionName: "ctf.coach_hint",
      label: "Give a graded CTF hint",
      description: "Record one evidence-grounded hint and guiding question for the learner without revealing an unsupported final answer.",
      parameters: Type.Object({
        hint: Type.String({ minLength: 1, maxLength: 1800 }),
        concept: Type.String({ minLength: 1, maxLength: 160 }),
        question: Type.String({ minLength: 1, maxLength: 1000 }),
        level: Type.Integer({ minimum: 1, maximum: 3 }),
        rationale,
      }),
      mapInput: ({ hint, concept, question, level }) => ({ hint, concept, question, level }),
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
  if (profile.role === "ctf" && profile.collaborationMode === "coach") {
    return tools.filter((tool) => tool.name !== "ctf_submit_flag");
  }
  return tools;
}

async function createSession(command) {
  const attemptId = command.attemptId;
  if (!attemptId) throw new Error("attemptId is required");
  const existing = sessions.get(attemptId);
  if (existing) return existing;

  const cwd = process.cwd();
  const agentDir = join(cwd, ".milksu", "pi-security");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
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
    agentDir,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
    // Keep only MilkSU's typed CTF proposal tools. Pi's coding tools are not
    // registered into this session.
    noTools: "builtin",
    customTools: createTools(selection, {
      role: command.roleState?.role || "ctf",
      collaborationMode: command.roleState?.collaborationMode || "delegate",
    }),
  });
  const effectiveModel = configureRuntimeModel(session, command.provider, command.model);
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
        capabilities: ["ctf.inspect_material", "ctf.decode_hex", "ctf.decode_text", "ctf.coach_hint", "ctf.submit_flag"],
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

function startProtocol() {
  input = createInterface({ input: process.stdin });
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
      emit(command.requestId, "error", { error: describeError(error) });
    });
  });
}

async function shutdown() {
  if (input) input.close();
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startProtocol();
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

export {
  configureRuntimeModel,
  findRuntimeModel,
  registerRuntimeProvider,
  setSessionModel,
};
