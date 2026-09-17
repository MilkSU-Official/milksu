export const unknownCommandErrorPrefix = "Unknown command";
export const commandsUnavailableError = "Commands are unavailable";
export const planModeUnavailableError = "Plan mode is unavailable";
export const goalUnavailableError = "Goal is unavailable";
export const inboxUnavailableError = "Inbox is unavailable";
export const jobsUnavailableError = "Jobs are unavailable";

export function parseSlashLine(line) {
  const raw = String(line ?? "");
  const match = /^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw.trim());
  if (!match) return undefined;
  return {
    name: match[1].toLowerCase(),
    rawInput: match[2] ?? "",
    line: `/${match[1].toLowerCase()}${match[2] == null || match[2] === "" ? "" : ` ${match[2]}`}`,
  };
}

export function projectCommandDescriptors(commands) {
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((command) => {
    const name = String(command?.name ?? "").trim().toLowerCase();
    if (!name) return [];
    return [{
      name,
      description: String(command?.description ?? "").trim(),
      hint: String(command?.input?.hint ?? "").trim(),
      attachments: Boolean(command?.input?.attachments),
    }];
  });
}

export function listHostCommands(commands, agent) {
  if (!commands || typeof commands.list !== "function") {
    throw new Error(commandsUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  return projectCommandDescriptors(commands.list(agent));
}

export async function executeHostCommand(commands, agent, line, signal) {
  const parsed = parseSlashLine(line);
  if (!parsed) throw new Error("Command line is required");
  if (!commands || typeof commands.execute !== "function") {
    throw new Error(commandsUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  const execution = await commands.execute(
    agent,
    parsed.line,
    [],
    signal ?? AbortSignal.timeout(120_000),
  );
  if (execution == null) {
    throw new Error(`${unknownCommandErrorPrefix}: /${parsed.name}`);
  }
  const result = execution.result ?? {};
  return {
    executed: true,
    name: parsed.name,
    commandId: String(execution.commandId ?? ""),
    kind: result.kind === "error" ? "error" : "success",
    text: String(result.text ?? "").trim(),
  };
}

export function getHostPlanMode(planMode, agent) {
  if (!planMode || typeof planMode.get !== "function") {
    throw new Error(planModeUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  const state = planMode.get(agent) ?? {};
  return {
    active: Boolean(state.active),
    pending: state.pending === undefined ? undefined : Boolean(state.pending),
  };
}

export function setHostPlanMode(planMode, agent, active) {
  if (!planMode || typeof planMode.set !== "function") {
    throw new Error(planModeUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  const status = planMode.set(agent, active === true);
  const next = getHostPlanMode(planMode, agent);
  return { status, ...next };
}

export function projectHostGoal(view) {
  if (!view) return null;
  const id = String(view.id ?? "").trim();
  const text = String(view.objective ?? view.text ?? "").trim();
  if (!id || !text) return null;
  const phase = String(view.phase ?? "").trim();
  const status = phase === "paused" || phase === "blocked" || phase === "complete"
    ? phase
    : "active";
  return {
    id,
    text,
    status,
    revision: Number(view.revision ?? 0),
    startedAt: Number(view.createdAt ?? 0),
    updatedAt: Number(view.updatedAt ?? 0),
    iteration: Number(view.roundsStarted ?? 0),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    automaticModelTurns: 0,
    queuedCount: 0,
  };
}

export function getHostGoal(goals, agent) {
  if (!goals || typeof goals.get !== "function") {
    throw new Error(goalUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  return { goal: projectHostGoal(goals.get(agent)) };
}

export function mutateHostGoal(goals, agent, action, objective) {
  if (!goals) throw new Error(goalUnavailableError);
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  const current = typeof goals.get === "function" ? goals.get(agent) : undefined;
  if (action === "create") {
    const text = String(objective ?? "").trim();
    if (!text) throw new Error("Goal text is required");
    if (typeof goals.create !== "function") throw new Error(goalUnavailableError);
    return { goal: projectHostGoal(goals.create(agent, { objective: text })) };
  }
  if (!current) throw new Error("No current goal");
  const ref = { id: current.id, revision: current.revision };
  if (action === "pause") {
    if (typeof goals.pause !== "function") throw new Error(goalUnavailableError);
    return { goal: projectHostGoal(goals.pause(agent, ref)) };
  }
  if (action === "resume") {
    if (typeof goals.resume !== "function") throw new Error(goalUnavailableError);
    return { goal: projectHostGoal(goals.resume(agent, ref)) };
  }
  if (action === "clear") {
    if (typeof goals.clear !== "function") throw new Error(goalUnavailableError);
    goals.clear(agent, ref);
    return { goal: null };
  }
  throw new Error(`Unknown goal action: ${action}`);
}

export function projectInboxMessage(message) {
  const text = Array.isArray(message?.content)
    ? message.content.map((block) => String(block?.text ?? "")).join("")
    : String(message?.text ?? message?.content ?? "");
  const id = String(message?.id ?? message?.messageId ?? "").trim();
  return {
    id,
    text: text.trim(),
  };
}

export function listHostInbox(agent) {
  const inbox = agent?.inbox;
  if (!inbox) throw new Error(inboxUnavailableError);
  return {
    nextTurn: (inbox.nextTurn ?? []).map(projectInboxMessage),
    nextStep: (inbox.nextStep ?? []).map(projectInboxMessage),
  };
}

export function appendHostInbox(agent, text) {
  const inbox = agent?.inbox;
  if (!inbox || typeof inbox.append !== "function") {
    throw new Error(inboxUnavailableError);
  }
  const prompt = String(text ?? "").trim();
  if (!prompt) throw new Error("prompt is required");
  inbox.append("next-turn", {
    content: [{ type: "text", text: prompt }],
    source: { kind: "user" },
  });
  return listHostInbox(agent);
}

export function removeHostInbox(agent, messageId, expected) {
  const inbox = agent?.inbox;
  if (!inbox) throw new Error(inboxUnavailableError);
  const listed = listHostInbox(agent);
  const targetId = String(messageId ?? "").trim();
  const expectedText = String(expected ?? "").trim();
  const match = [...listed.nextTurn, ...listed.nextStep].find((item) => (
    (targetId && item.id === targetId)
    || (expectedText && item.text === expectedText)
  ));
  if (!match?.id || typeof inbox.remove !== "function") {
    throw new Error("Queued message was not found");
  }
  inbox.remove(match.id);
  return listHostInbox(agent);
}

export function replaceHostInbox(agent, messageId, text) {
  const inbox = agent?.inbox;
  if (!inbox || typeof inbox.replace !== "function") {
    throw new Error(inboxUnavailableError);
  }
  const prompt = String(text ?? "").trim();
  if (!prompt) throw new Error("prompt is required");
  const id = String(messageId ?? "").trim();
  if (!id) throw new Error("messageId is required");
  const replaced = inbox.replace(id, {
    content: [{ type: "text", text: prompt }],
    source: { kind: "user" },
  });
  if (!replaced) throw new Error("Queued message was not found");
  return listHostInbox(agent);
}

export function projectHostJob(job) {
  const id = String(job?.id ?? "").trim();
  if (!id) return null;
  const status = String(job?.status ?? "").trim();
  return {
    id,
    kind: String(job?.kind ?? "").trim() || "job",
    label: String(job?.label ?? id).trim(),
    status: status === "stopping" || status === "completed" || status === "killed" || status === "failed"
      ? status
      : "running",
    detail: String(job?.detail ?? "").trim(),
    startedAt: Number(job?.startedAt ?? 0),
  };
}

export function listHostJobs(jobs, agent) {
  if (!jobs || typeof jobs.list !== "function") {
    throw new Error(jobsUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  return {
    jobs: jobs.list(agent).map(projectHostJob).filter(Boolean),
  };
}

export function killHostJob(jobs, agent, jobId) {
  if (!jobs || typeof jobs.kill !== "function") {
    throw new Error(jobsUnavailableError);
  }
  if (!agent) throw new Error("DeepSeek Harness session is not ready");
  const id = String(jobId ?? "").trim();
  if (!id) throw new Error("jobId is required");
  const status = jobs.kill(id, agent);
  return { killed: status !== "already-finished", status, ...listHostJobs(jobs, agent) };
}

export function contentBlocksText(blocks) {
  if (typeof blocks === "string") return blocks.trim();
  if (!Array.isArray(blocks)) return "";
  return blocks.flatMap((block) => {
    if (typeof block === "string") return [block];
    if (block?.type === "text") return [String(block.text ?? "")];
    return [];
  }).join("").trim();
}

export function sessionSurfaceText(session) {
  const events = typeof session?.snapshotEvents === "function"
    ? session.snapshotEvents()
    : [];
  const parts = [];
  for (const event of events) {
    const type = String(event?.type ?? "");
    const data = event?.data ?? {};
    const text = type === "user/message"
      ? contentBlocksText(data.content ?? data.message?.content)
      : type === "assistant/message"
        ? contentBlocksText(data.message?.content ?? data.content)
        : "";
    if (!text) continue;
    parts.push(`${type === "user/message" ? "User" : "Assistant"}: ${text}`);
  }
  return parts.join("\n\n").trim();
}

export function projectCompactResult(result, session) {
  const surfaceText = sessionSurfaceText(session);
  if (result == null) {
    return {
      compacted: false,
      tokensBefore: 0,
      estimatedTokensAfter: 0,
      summary: "",
      surfaceText,
    };
  }
  return {
    compacted: true,
    tokensBefore: Number(result.shadowedTokenCount ?? result.tokensBefore ?? 0),
    estimatedTokensAfter: Number(result.estimatedTokensAfter ?? result.tokensAfter ?? 0),
    summary: contentBlocksText(result.summary),
    summarySeq: result.summarySeq,
    surfaceText,
  };
}

export function seedHandoffContext(agent, text) {
  const prompt = String(text ?? "").trim();
  if (!prompt) return { seeded: false };
  if (!agent?.session || typeof agent.session.append !== "function") {
    throw new Error("DeepSeek Harness session cannot receive handoff context");
  }
  agent.session.append("user/message", {
    id: `handoff_${Date.now()}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "milksu-dsh-host", form: "recall" },
  }, { surfaceOp: "append" });
  return { seeded: true };
}

export function isExitPlanModeTool(toolCall) {
  const text = JSON.stringify(toolCall ?? "").toLowerCase();
  return /exit_plan_mode|"plan-review"|plan review/.test(text);
}

export function projectUserQuestionAsk(questions) {
  const items = Array.isArray(questions) ? questions : [];
  const first = items[0] ?? {};
  const options = (first.options ?? []).map((option, index) => ({
    id: String(option?.label ?? option?.id ?? index),
    label: String(option?.label ?? option?.id ?? index),
    detail: String(option?.description ?? "").trim(),
  })).filter(option => option.label);
  return {
    question: String(first.question ?? first.header ?? "").trim() || "Continue?",
    detail: String(first.detail ?? "").trim(),
    options,
    intent: first.intent ?? null,
  };
}

export function mapAskChoiceToUserQuestionAnswer(questions, choice, approved) {
  const items = Array.isArray(questions) ? questions : [];
  const first = items[0] ?? {};
  const options = first.options ?? [];
  const approveLabel = String(first.intent?.approve ?? options[0]?.label ?? "");
  const selectedLabel = approved === false
    ? String(options.find(option => option.label !== approveLabel)?.label ?? "")
    : String(choice || approveLabel);
  return {
    answers: [{
      id: String(first.id ?? "plan-review"),
      selected: selectedLabel ? [selectedLabel] : [],
    }],
  };
}
