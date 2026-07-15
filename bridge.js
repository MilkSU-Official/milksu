import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createInterface } from "readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let cachedSkillTools = null;

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://api.ciyuanliudong.com/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);

async function loadSkillTools() {
  if (cachedSkillTools) return cachedSkillTools;
  try {
    const { discoverSkills } = await import("./src/skill-loader.ts");
    const skills = await discoverSkills(join(__dirname, "skills"));
    cachedSkillTools = skills.flatMap((s) => s.tools);
    emit(null, "skills_loaded", { count: cachedSkillTools.length, skills: skills.map((s) => s.manifest.name) });
  } catch (err) {
    emit(null, "error", { reason: "skill_load_failed", error: String(err) });
    cachedSkillTools = [];
  }
  return cachedSkillTools;
}

function formatSubagentResults(results) {
	if (results.length === 0) return "No sub-agent results were produced.";
	return results
		.map((result) => `Sub-agent ${result.subId + 1}:\n${result.content ?? "No result"}`)
		.join("\n\n");
}

function bindSkillTools(tools, conversationId, allowSubagents = true) {
	return tools.flatMap((tool) => {
		if (tool.name !== "spawn_subagents") return [tool];
		if (!allowSubagents) return [];

		return [{
			...tool,
			async execute(_toolCallId, params) {
				const results = await handleSpawnSubagents({
					conversationId,
					tasks: params.tasks,
				});
				return {
					content: [{ type: "text", text: formatSubagentResults(results) }],
					details: { results },
				};
			},
		}];
	});
}

const sessions = new Map();
const promptQueues = new Map();
const sessionSettings = new Map();
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

function handleAssistantEvent(conversationId, ae) {
  switch (ae.type) {
    case "text_delta":
      emit(conversationId, "text_delta", { delta: ae.delta });
      break;
    case "thinking_delta":
      emit(conversationId, "thinking_delta", { delta: ae.delta });
      break;
	}
}

function subscribeSession(conversationId, session) {
	let assistantTextStreamed = false;
  session.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent) {
			if (event.assistantMessageEvent.type === "text_delta") {
				assistantTextStreamed = true;
			}
          handleAssistantEvent(conversationId, event.assistantMessageEvent);
        }
        break;
		case "message_end":
			if (event.message?.role === "assistant") {
				const content = extractTextContent(event.message);
				if (content || assistantTextStreamed) {
					emit(conversationId, "message_done", {
						reason: event.message.stopReason ?? "stop",
						content,
					});
				}
				assistantTextStreamed = false;
			}
			break;
		case "tool_execution_start":
			if (event.toolName === "panel_update") {
				emit(conversationId, "panel_update", {
					set_fields: event.args?.set_fields ?? {},
					append_items: event.args?.append_items ?? {},
				});
			}
			if (event.toolName !== "spawn_subagents") {
				emit(conversationId, "tool_call_start", { toolName: event.toolName });
			}
			break;
		case "tool_execution_end":
			if (event.toolName !== "spawn_subagents") {
				emit(conversationId, "tool_call_end", {
					toolName: event.toolName,
					content: extractToolResultContent(event.result),
					isError: event.isError,
				});
			}
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
    sessionSettings.delete(conversationId);
  }

	const provider = command.provider;
	const model = command.model;

	try {
		const tools = bindSkillTools(await loadSkillTools(), conversationId);
		const { session } = await createAgentSession({
			cwd: process.cwd(),
			sessionManager: SessionManager.inMemory(),
			customTools: tools,
		});

		subscribeSession(conversationId, session);
		sessions.set(conversationId, session);
		promptQueues.set(conversationId, Promise.resolve());
		sessionSettings.set(conversationId, { provider, model });
		const effective = configureRelayModel(session, provider, model);
		await setSessionModel(conversationId, session, effective.provider, effective.model);
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
    sessionSettings.delete(conversationId);
  }
  emit(conversationId, "session_destroyed", {});
}

function cleanupSubagent(subConvId, session) {
  if (session) session.dispose();
  sessions.delete(subConvId);
  promptQueues.delete(subConvId);
  sessionSettings.delete(subConvId);
}

async function spawnSubagent(parentConversationId, index, task, provider, model) {
  const subConvId = `${parentConversationId}:sub:${index}`;

	return new Promise((resolve) => {
    let session = null;
    let settled = false;

    const settle = (content) => {
      if (settled) return;
      settled = true;
			cleanupSubagent(subConvId, session);
			resolve(content);
		};

		(async () => {
			const tools = bindSkillTools(await loadSkillTools(), subConvId, false);
			const created = await createAgentSession({
				cwd: process.cwd(),
				sessionManager: SessionManager.inMemory(),
				customTools: tools,
			});
      session = created.session;

      session.subscribe((event) => {
        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent?.type === "text_delta") {
              emit(parentConversationId, "subagent_delta", {
                subId: index,
                delta: event.assistantMessageEvent.delta,
              });
            }
            break;
					case "agent_end": {
						const finalMessage = [...event.messages]
							.reverse()
							.find((message) => message.role === "assistant");
						const content = extractTextContent(finalMessage);
						emit(parentConversationId, "subagent_done", { subId: index, content });
						settle(content);
						break;
					}
				}
			});

			const effective = configureRelayModel(session, provider, model);
			sessions.set(subConvId, session);
			promptQueues.set(subConvId, Promise.resolve());
			sessionSettings.set(subConvId, { provider, model });
			await setSessionModel(subConvId, session, effective.provider, effective.model);
			await session.prompt(task);
			if (!settled) {
				const finalMessage = [...session.messages]
					.reverse()
					.find((message) => message.role === "assistant");
				const content = extractTextContent(finalMessage);
				emit(parentConversationId, "subagent_done", { subId: index, content });
				settle(content);
			}
    })().catch((err) => {
      if (!settled) {
        emit(parentConversationId, "subagent_error", {
          subId: index,
          error: String(err),
        });
      }
      settle(null);
    });
  });
}

async function handleSpawnSubagents(command) {
  const { conversationId, tasks } = command;
  if (!conversationId || !Array.isArray(tasks)) {
    emit(conversationId, "error", {
      reason: "invalid_subagent_command",
      error: "conversationId and tasks[] required",
    });
    return [];
  }

	const cleanTasks = tasks.filter((task) => typeof task === "string" && task.trim().length > 0);
	if (cleanTasks.length === 0) {
    emit(conversationId, "error", {
      reason: "invalid_subagent_command",
      error: "tasks[] must include at least one task description",
    });
		return [];
	}
	if (cleanTasks.length > 8) {
		emit(conversationId, "error", {
			reason: "too_many_subagents",
			error: "At most 8 sub-agent tasks are allowed per call",
		});
		return [];
	}

  const parentSettings = sessionSettings.get(conversationId) ?? {};
  const provider = command.provider ?? parentSettings.provider;
  const model = command.model ?? parentSettings.model;
  const maxConcurrent = 4;

  emit(conversationId, "subagents_start", { count: cleanTasks.length });

  const results = [];
  for (let i = 0; i < cleanTasks.length; i += maxConcurrent) {
    const batch = cleanTasks.slice(i, i + maxConcurrent);
    const batchResults = await Promise.allSettled(
      batch.map((task, j) => spawnSubagent(conversationId, i + j, task, provider, model)),
    );
    results.push(...batchResults.map((result) => (result.status === "fulfilled" ? result.value : null)));
  }

	emit(conversationId, "subagents_done", {
		results: results.map((content, i) => ({ subId: i, content })),
	});
	return results.map((content, i) => ({ subId: i, content }));
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
      case "spawn_subagents":
        void handleSpawnSubagents(command);
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
	sessionSettings.clear();
	process.exit(0);
});

emit(null, "ready", {});
