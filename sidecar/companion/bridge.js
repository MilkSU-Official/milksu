import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
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
import { assistantVisibleText, reviewCompanionDraft, rewriteLastAssistantReply } from "./reply-review.js";
import {
  applySemanticMemorySnapshot,
  createMemoryExtractController,
  extractCompanionMemories,
} from "./memory-extract.js";
import {
  companionAssistantTurnError,
  repairCompanionToolHistory,
  stampCompanionAbortedTurn,
} from "./turn-error.js";
import {
  classifyCompanionIntent,
  companionIntentLine,
  prepareCompanionPrompt,
} from "./attachments.js";
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
let turnAborted = false;
let boardSnapshot = { sessions: [], todos: [] };
let semanticMemories = [];
let semanticMemoryRevision = -1;
let episodicRecalls = [];
let persona = "";
let memorySearchEnabled = true;
let replyStyle = "markdown";
let turnIntentLine = "";
const memoryExtract = createMemoryExtractController({
  extract: job => runMemoryExtract(job),
  // One quiet-period timer. clearTimeout drops a wait that has not fired.
  // The controller drops a callback that already reached the queue when a
  // newer wait, a new turn, or an in-flight extract supersedes it.
  setTimer: (fn, ms) => setTimeout(() => {
    promptQueue = promptQueue.then(() => fn());
  }, ms),
  clearTimer: handle => clearTimeout(handle),
});
let heldReply = "";
let captureReply = false;
let turnGate = null;

/** Same as main Pi: host replies and abort must not wait behind session.prompt. */
export function companionCommandRunsImmediately(action) {
  return action === "companion_host_response" || action === "abort" || action === "shutdown";
}

export function companionSessionFileMatches(name, sessionId = COMPANION_SESSION_ID) {
  const file = String(name ?? "").trim();
  const id = String(sessionId ?? "").trim() || COMPANION_SESSION_ID;
  return file === `${id}.jsonl` || file.endsWith(`_${id}.jsonl`);
}

export function pickLatestCompanionSessionName(names, sessionId = COMPANION_SESSION_ID) {
  return (Array.isArray(names) ? names : [])
    .filter(name => companionSessionFileMatches(name, sessionId))
    .sort()
    .at(-1) || "";
}

export function serializeCompanionSessionFile(header, entries) {
  const rows = [header, ...(Array.isArray(entries) ? entries : [])].filter(Boolean);
  if (!rows.length) return "";
  return `${rows.map(row => JSON.stringify(row)).join("\n")}\n`;
}

export function isCompanionAbortError(error) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /turn aborted|abort(?:ed)?|cancel(?:led|ed)|interrupted/i.test(text);
}

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

function findCompanionSessionPath(sessionDir) {
  if (!sessionDir || !existsSync(sessionDir)) return "";
  try {
    const name = pickLatestCompanionSessionName(readdirSync(sessionDir));
    return name ? join(sessionDir, name) : "";
  } catch {
    return "";
  }
}

async function openCompanionSessionManager(cwd, agentDir) {
  const sessionDir = join(agentDir, "sessions");
  const existing = (await SessionManager.list(cwd, sessionDir))
    .find(value => value.id === COMPANION_SESSION_ID);
  if (existing) {
    return SessionManager.open(existing.path, sessionDir, cwd);
  }
  // list() filters custom sessionDir by cwd. A previous sidecar cwd miss
  // must not create a second empty companion jsonl and hide the first user line.
  const onDisk = findCompanionSessionPath(sessionDir);
  if (onDisk) {
    return SessionManager.open(onDisk, sessionDir, cwd);
  }
  return SessionManager.create(cwd, sessionDir, { id: COMPANION_SESSION_ID });
}

function flushCompanionSessionFile() {
  const manager = session?.sessionManager;
  if (!manager || typeof manager.getSessionFile !== "function") return "";
  const path = manager.getSessionFile();
  const header = typeof manager.getHeader === "function" ? manager.getHeader() : null;
  const entries = typeof manager.getEntries === "function" ? manager.getEntries() : [];
  const body = serializeCompanionSessionFile(header, entries);
  if (!path || !body) return "";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  // Pi's _persist skips writing until an assistant row, then creates with "wx".
  // Mark flushed so later appends do not try to exclusively create this file.
  manager.flushed = true;
  return path;
}

function dropCompanionSession() {
  subscribed = false;
  turnAborted = false;
  promptQueue = Promise.resolve();
  session = null;
}

async function createCompanionSession(command) {
  const livePath = session?.sessionManager?.getSessionFile?.();
  const fileMissing = Boolean(session) && (!livePath || !existsSync(livePath));
  if (session && (command?.reset || fileMissing)) {
    try {
      await session.abort?.();
    } catch {
      // Reset after archive / missing jsonl; the next create opens a new file.
    }
    dropCompanionSession();
  }
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
        getSystemPrompt: () => companionSystemPrompt(uiLocale, replyStyle),
        getIntentLine: () => turnIntentLine,
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
  // Same as Coding: Pi owns auto-compaction. Cancelling it left the companion
  // with a hand-cut window instead of Pi's transcript. See extension.js.
  if (typeof session.setAutoCompactionEnabled === "function") {
    session.setAutoCompactionEnabled(true);
  }
  await applyCompanionModel(command);
  flushCompanionSessionFile();
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
  // Model switch must not re-read a broken orphan tool transcript — repair first.
  repairCompanionSessionHistory("companion tool interrupted before model switch");
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
        const delta = String(update.delta ?? "");
        if (captureReply) heldReply += delta;
        // Chat style shows the opening line while the turn is still running.
        // Markdown keeps the draft until the review pass.
        if (captureReply && replyStyle !== "chat") return;
        emit("text_delta", { delta });
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
      const content = formatCompanionToolResult(event.result).slice(0, 400);
      emit("tool_call_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content,
        durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
        isError: event.isError,
      });
      return;
    }
    if (event.type === "agent_end") {
      if (turnAborted) {
        captureReply = false;
        heldReply = "";
        repairCompanionSessionHistory("companion tool interrupted by abort");
        persistCompanionAbortedTurn();
        flushCompanionSessionFile();
        emit("turn_settled", { aborted: true });
        openReplyCapture();
      } else {
        const error = companionAssistantTurnError(session.messages);
        if (error) emit("error", { error });
        // The visible reply waits for the review pass in sendPrompt.
        openReplyCapture();
      }
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
    ?? args.action
    ?? args.id
    ?? "",
  ).trim();
  if (!detail) return name;
  return `${name} ${detail.slice(0, 120)}`;
}

function companionToolEventText(text) {
  const value = String(text ?? "").trim();
  if (!value || /\[object Object\]/i.test(value)) return "";
  // Host tools return JSON.stringify(result) for the model. That dump must
  // stay in toolResult content, never in phone process rows or events.
  if (/companion_float_enabled|tokenflux\.dev\/v1/i.test(value) && /[{[]/.test(value)) {
    return "";
  }
  if (/^[{\[]/.test(value)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return "";
    } catch {
      if (/"settings"\s*:|"ok"\s*:\s*true|"relay"\s*:/.test(value)) return "";
    }
  }
  return value;
}

/** Pi tool results use content blocks; never String(array) → [object Object]. */
export function formatCompanionToolResult(result) {
  if (typeof result === "string") return companionToolEventText(result);
  if (!result || typeof result !== "object") return "";
  if (typeof result.content === "string") return companionToolEventText(result.content);
  if (Array.isArray(result.content)) {
    return companionToolEventText(result.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim());
  }
  if (typeof result.details === "string") return companionToolEventText(result.details);
  if (typeof result.text === "string") return companionToolEventText(result.text);
  return "";
}

/**
 * Fill dangling toolCalls with synthetic error toolResults and persist them.
 * Abort / host timeout can leave Pi mid-batch without toolResults; main chat
 * recovers by continuing, companion used to hard-fail into 「开新对话」.
 */
function persistCompanionMessages(extra) {
  if (!session || !Array.isArray(extra) || !extra.length) return;
  const agent = session.agent;
  if (agent?.state && Array.isArray(agent.state.messages)) {
    agent.state.messages = [...agent.state.messages, ...extra];
  }
  const append = session.sessionManager?.appendMessage?.bind(session.sessionManager);
  if (typeof append === "function") {
    for (const message of extra) append(message);
  }
  flushCompanionSessionFile();
}

function repairCompanionSessionHistory(reason = "companion tool interrupted") {
  if (!session) return 0;
  const current = Array.isArray(session.messages) ? session.messages : [];
  const { repaired, repairedCount } = repairCompanionToolHistory(current, reason);
  if (!repairedCount) return 0;
  persistCompanionMessages(repaired);
  return repairedCount;
}

function persistCompanionAbortedTurn() {
  if (!session) return;
  const current = Array.isArray(session.messages) ? session.messages : [];
  const { messages, appended } = stampCompanionAbortedTurn(current);
  if (appended.length) {
    session.messages = messages;
    persistCompanionMessages(appended);
  }
}

async function abortCompanionTurn() {
  turnAborted = true;
  ensureHostBroker().cancelAll("turn aborted");
  try {
    await session?.abort?.();
  } catch {
    // Abort races are fine; repair below is what keeps the transcript usable.
  }
  repairCompanionSessionHistory("companion tool interrupted by abort");
  persistCompanionAbortedTurn();
  flushCompanionSessionFile();
  emit("turn_settled", { aborted: true });
}

function applyReplyStyle(command) {
  const value = String(command?.replyStyle ?? "").trim();
  if (value === "chat" || value === "markdown") replyStyle = value;
}

function armReplyCapture() {
  heldReply = "";
  captureReply = true;
  let resolve = () => {};
  const done = new Promise((resolveDone) => {
    resolve = resolveDone;
  });
  const gate = { done, resolve, opened: false };
  turnGate = gate;
  return gate;
}

function openReplyCapture() {
  const gate = turnGate;
  if (!gate || gate.opened) return;
  gate.opened = true;
  gate.resolve();
}

async function retrieveCompanionTurnMemory(prompt) {
  if (!memorySearchEnabled) {
    episodicRecalls = [];
    return;
  }
  // searchCompanionIndex defaults to 8 hits and caps at 50. Do not pass another limit.
  // Skip this companion session so Obelisk does not paste the live transcript back in.
  const found = await queryCompanionMemory(
    { action: "search", query: prompt, excludeSessionId: COMPANION_SESSION_ID },
    { memorySearchEnabled },
  );
  episodicRecalls = Array.isArray(found?.results) ? found.results : [];
}

async function completeCompanionReview(context) {
  const model = session?.model;
  const runtime = session?.modelRuntime;
  if (!model || typeof runtime?.completeSimple !== "function") {
    throw new Error("companion model is not ready");
  }
  try {
    return await runtime.completeSimple(model, context, { reasoning: "low" });
  } catch {
    return runtime.completeSimple(model, context);
  }
}

function applySemanticMemories(memories, revision) {
  const next = applySemanticMemorySnapshot(
    { memories: semanticMemories, revision: semanticMemoryRevision },
    memories,
    revision,
  );
  semanticMemories = next.memories;
  semanticMemoryRevision = next.revision;
}

function applyMemoryExtract(command) {
  if (command?.memoryExtract == null && command?.memoryExtractIdleMinutes == null) return;
  memoryExtract.configure({
    mode: command.memoryExtract,
    idleMinutes: command.memoryExtractIdleMinutes,
  });
}

function memoryExtractIsStale(job) {
  return typeof job?.stale === "function" && job.stale();
}

async function runMemoryExtract(job) {
  if (memoryExtractIsStale(job)) return { committed: false };
  const stretch = Array.isArray(job?.stretch) ? job.stretch : [];
  const userText = stretch.map(item => String(item?.user ?? "").trim()).filter(Boolean).join("\n");
  if (!userText) return { committed: true };
  const assistantText = stretch.map(item => String(item?.assistant ?? "").trim()).filter(Boolean).join("\n");
  const items = await extractCompanionMemories({
    userText,
    assistantText,
    memories: semanticMemories,
    locale: uiLocale,
    maxItems: job?.maxItems,
    complete: completeCompanionReview,
  });
  if (memoryExtractIsStale(job)) return { committed: false };
  if (!items.length) return { committed: true };
  const result = await requestHost("memory", {
    action: "commit",
    userText,
    items,
  });
  applySemanticMemories(result?.approved, result?.revision);
  return { committed: true };
}

async function publishReviewedReply(userText) {
  const draft = heldReply;
  heldReply = "";
  captureReply = false;
  if (turnAborted || !String(draft).trim()) return "";
  const reviewed = await reviewCompanionDraft({
    draft,
    userText,
    locale: uiLocale,
    replyStyle,
    complete: completeCompanionReview,
  });
  if (turnAborted) return "";
  rewriteLastAssistantReply([
    session?.messages,
    session?.agent?.state?.messages,
    session?.sessionManager?.getEntries?.(),
  ], reviewed);
  if (replyStyle !== "chat") emit("text_delta", { delta: reviewed });
  return reviewed;
}

async function sendPrompt(command) {
  if (!session) throw new Error("companion session is not ready");
  turnAborted = false;
  repairCompanionSessionHistory("companion tool interrupted before next turn");
  const prepared = await prepareCompanionPrompt(command);
  if (!prepared.prompt) {
    throw new Error("companion prompt is required");
  }
  // So the phone UI can show the user bubble immediately when Send comes from
  // Desktop RPC / product-loop (not only the in-phone optimistic path).
  const locale = command?.locale === "en" ? "en" : "zh";
  const intent = command?.hostNotice === true
    ? null
    : (command?.intent?.bucket
      ? command.intent
      : await classifyCompanionIntent(prepared.prompt, {
        locale,
        complete: context => completeCompanionReview(context),
        readText: assistantVisibleText,
      }));
  turnIntentLine = intent?.bucket ? companionIntentLine(intent, locale) : "";
  if (intent?.bucket) {
    const source = intent.source === "model" ? "model" : "jev";
    emit("intent.recorded", {
      bucket: intent.bucket,
      source,
      text: turnIntentLine,
    });
    persistCompanionMessages([{
      role: "custom",
      customType: "companion.intent",
      content: [{ type: "text", text: turnIntentLine }],
      display: false,
      details: { bucket: intent.bucket, source, text: turnIntentLine },
      timestamp: new Date().toISOString(),
    }]);
  }
  if (command?.hostNotice !== true) {
    emit("user_message", {
      text: prepared.prompt,
      hasAttachments: prepared.images.length > 0,
    });
  }
  // Do not await session.prompt on the stdin command queue. Main Coding Pi
  // detaches the prompt so workspace_action_response and abort_session can
  // run while the agent loop is in flight. Companion host replies / abort
  // used to sit behind this await and every host tool deadlocked until
  // timeout — that aborted the loop mid-turn.
  promptQueue = promptQueue.then(async () => {
    const gate = armReplyCapture();
    memoryExtract.beginTurn();
    try {
      await retrieveCompanionTurnMemory(prepared.prompt);
      const pending = session.prompt(prepared.prompt, {
        expandPromptTemplates: false,
        ...(prepared.images.length ? { images: prepared.images } : {}),
      });
      // Pi SessionManager does not write jsonl until an assistant row. Flush
      // the user line immediately so StopCompanion / recover still has it.
      queueMicrotask(() => {
        flushCompanionSessionFile();
      });
      try {
        await pending;
      } finally {
        turnIntentLine = "";
        openReplyCapture();
      }
      await gate.done;
      if (turnAborted) {
        await memoryExtract.finishTurn({ aborted: true });
        return;
      }
      const assistantText = await publishReviewedReply(prepared.prompt);
      flushCompanionSessionFile();
      emit("turn_settled", {});
      await memoryExtract.finishTurn({
        userText: prepared.prompt,
        assistantText,
        aborted: turnAborted,
      });
    } catch (error) {
      turnIntentLine = "";
      openReplyCapture();
      captureReply = false;
      heldReply = "";
      flushCompanionSessionFile();
      if (turnAborted || isCompanionAbortError(error)) {
        repairCompanionSessionHistory("companion tool interrupted by abort");
        persistCompanionAbortedTurn();
        flushCompanionSessionFile();
        await memoryExtract.finishTurn({ aborted: true });
        return;
      }
      emit("error", { error: error instanceof Error ? error.message : String(error) });
      emit("turn_settled", {});
      await memoryExtract.finishTurn({ aborted: true });
    }
  });
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
      applyReplyStyle(command);
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      applyMemoryExtract(command);
      await createCompanionSession(command);
      if (!subscribed) {
        subscribeCompanion();
        subscribed = true;
      }
      return;
    case "send_message":
      applyCompanionLocale(command);
      applyReplyStyle(command);
      await createCompanionSession(command);
      if (!subscribed) {
        subscribeCompanion();
        subscribed = true;
      }
      if (command.boardSnapshot) boardSnapshot = command.boardSnapshot;
      if (Array.isArray(command.semanticMemories)) {
        applySemanticMemories(command.semanticMemories, command.memoryRevision);
      }
      if (Array.isArray(command.episodicRecalls)) episodicRecalls = command.episodicRecalls;
      if (typeof command.persona === "string") persona = command.persona;
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      applyMemoryExtract(command);
      await sendPrompt(command);
      return;
    case "note_turn":
      if (command.phase === "begin") {
        memoryExtract.beginTurn();
        return;
      }
      {
        const job = {
          userText: command.userText,
          assistantText: command.assistantText,
          aborted: command.aborted === true,
        };
        promptQueue = promptQueue.then(async () => {
          try {
            await memoryExtract.finishTurn(job);
          } finally {
            if (memorySearchEnabled) scheduleCompanionIndexRefresh();
          }
        });
      }
      return;
    case "refresh_index":
      if (memorySearchEnabled) scheduleCompanionIndexRefresh();
      return;
    case "update_context":
      applyCompanionLocale(command);
      applyReplyStyle(command);
      if (command.boardSnapshot) boardSnapshot = command.boardSnapshot;
      if (Array.isArray(command.semanticMemories)) {
        applySemanticMemories(command.semanticMemories, command.memoryRevision);
      }
      if (Array.isArray(command.episodicRecalls)) episodicRecalls = command.episodicRecalls;
      if (typeof command.persona === "string") persona = command.persona;
      if (command.memorySearchEnabled === false) memorySearchEnabled = false;
      if (command.memorySearchEnabled === true) memorySearchEnabled = true;
      applyMemoryExtract(command);
      emit("context_updated", {});
      return;
    case "companion_host_response":
      resolveHost(command);
      return;
    case "abort":
      await abortCompanionTurn();
      return;
    case "host_notice":
      try {
        await createCompanionSession(command);
        if (!subscribed) {
          subscribeCompanion();
          subscribed = true;
        }
        await sendPrompt({ ...command, hostNotice: true });
      } catch (error) {
        emit("error", { error: error instanceof Error ? error.message : String(error) });
        emit("turn_settled", {});
      }
      return;
    case "shutdown":
      flushCompanionSessionFile();
      ensureHostBroker().cancelAll("companion sidecar stopped");
      process.exit(0);
      return;
    default:
      throw new Error(`unknown companion action: ${command.action}`);
  }
}

function dispatchCompanionLine(line) {
  if (!String(line ?? "").trim()) return Promise.resolve();
  let command;
  try {
    command = JSON.parse(line);
  } catch (error) {
    emit("error", { error: error instanceof Error ? error.message : String(error) });
    return Promise.resolve();
  }
  // Immediate path mirrors main Pi abort_session / workspace_action_response.
  if (command.action === "companion_host_response") {
    try {
      resolveHost(command);
    } catch {
      // Broker ignores unknown / late host ids.
    }
    return Promise.resolve();
  }
  if (command.action === "abort") {
    return abortCompanionTurn().catch((error) => {
      emit("error", { error: error instanceof Error ? error.message : String(error) });
    });
  }
  if (command.action === "shutdown") {
    flushCompanionSessionFile();
    ensureHostBroker().cancelAll("companion sidecar stopped");
    process.exit(0);
    return Promise.resolve();
  }
  return null;
}

const isCompanionBridgeMain = process.env.MILKSU_COMPANION_BRIDGE_MAIN === "1"
  || (
    Boolean(process.argv[1])
    && resolvePath(fileURLToPath(import.meta.url)) === resolvePath(process.argv[1])
  );

if (isCompanionBridgeMain) {
  const input = createInterface({ input: process.stdin });
  let commandQueue = Promise.resolve();
  input.on("line", (line) => {
    const immediate = dispatchCompanionLine(line);
    if (immediate) return;
    commandQueue = commandQueue.then(async () => {
      const command = JSON.parse(line);
      try {
        await handleCommand(command);
      } catch (error) {
        if (turnAborted || isCompanionAbortError(error)) return;
        emit("error", { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  emit("hello", { role: "companion" });
}