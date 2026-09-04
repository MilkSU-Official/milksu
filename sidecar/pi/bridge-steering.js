const maximumSteeringCharacters = 16000;

function normalizedSteeringMessage(value) {
  const message = String(value ?? "").trim();
  if (!message) throw new Error("steering message is required");
  if ([...message].length > maximumSteeringCharacters) {
    throw new Error(`steering message exceeds ${maximumSteeringCharacters} characters`);
  }
  return message;
}

function normalizedQueueName(value) {
  const queue = String(value ?? "").trim();
  if (queue !== "steering" && queue !== "followUp") {
    throw new Error(`unsupported queued message type: ${queue || "empty"}`);
  }
  return queue;
}

function normalizedQueueIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("queued message index must be a non-negative integer");
  }
  return index;
}

async function restoreQueue(session, queue) {
  for (const message of queue.steering) {
    await session.steer(message);
  }
  for (const message of queue.followUp) {
    await session.followUp(message);
  }
}

function sessionFlag(session, name) {
  const value = session?.[name];
  if (typeof value === "function") return value.call(session) === true;
  return value === true;
}

function sessionHasRunningBash(session) {
  return sessionFlag(session, "isBashRunning");
}

function sessionPendingToolCount(session) {
  const state = session?.state ?? session?.agent?.state;
  const pending = state?.pendingToolCalls;
  if (pending && typeof pending.size === "number") return pending.size;
  if (Array.isArray(pending)) return pending.length;
  return 0;
}

function sessionHasRunningTools(session) {
  return sessionHasRunningBash(session) || sessionPendingToolCount(session) > 0;
}

function isAssistantStreaming(session) {
  if (sessionFlag(session, "isIdle")) return false;
  return sessionFlag(session, "isStreaming");
}

export function shouldAbortAssistantStream(session) {
  // Pi's isStreaming is the whole agent run, including tool execution.
  // Abort only while the assistant is streaming text, not mid-edit/write/bash.
  return isAssistantStreaming(session) && !sessionHasRunningTools(session);
}

function abortAssistantStream(session) {
  // Abort only the in-flight assistant stream. This is not abort_session:
  // it must not settle the desktop turn or dispose the Pi session.
  // Prefer agent.abort() so we do not start AgentSession.abort()'s
  // waitForIdle(), which includes the steered continuation.
  if (typeof session.agent?.abort === "function") {
    session.agent.abort();
    return;
  }
  if (typeof session.abort === "function") {
    const pending = session.abort();
    if (pending && typeof pending.then === "function") {
      pending.catch(() => undefined);
    }
  }
}

export async function steerSession(sessions, command) {
  const conversationId = String(command?.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  const session = sessions.get(conversationId);
  if (!session) throw new Error(`PI session not found: ${conversationId}`);
  const message = normalizedSteeringMessage(command?.prompt);

  // Automatic argument-gate on streaming edit/write/bash parameters is
  // intentionally not implemented (loop-mid-turn-steer.md optional 3a).
  //
  // Mid-turn Codex path: queue steer first, then abort the assistant text
  // stream when no uninterruptible bash is running. Pi's loop exits on abort
  // without draining; _handlePostAgentRun continues this turn only if the
  // steer is already queued. abort() does not clear that queue and is not
  // abort_session. Do not call prompt() (that would open a parallel user
  // turn). If bash is running, only steer and let the tool finish.
  await session.steer(message);
  if (shouldAbortAssistantStream(session)) {
    try {
      abortAssistantStream(session);
    } catch {
      // Stream abort is best-effort; the steer is already on this turn.
    }
  }
}

export async function removeQueuedMessage(sessions, command) {
  const conversationId = String(command?.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  const session = sessions.get(conversationId);
  if (!session) throw new Error(`PI session not found: ${conversationId}`);

  const queueName = normalizedQueueName(command?.queue);
  const index = normalizedQueueIndex(command?.index);
  const expected = normalizedSteeringMessage(command?.expected);

  // Pi owns both queues. Its public API only exposes an atomic clear of the
  // pending messages, so MilkSU removes one item by clearing and rebuilding
  // the two queues through the matching public steer/followUp methods. The
  // expected text protects against deleting a different message after the
  // active Agent has consumed or reordered the queue.
  const cleared = session.clearQueue();
  const original = {
    steering: [...cleared.steering],
    followUp: [...cleared.followUp],
  };
  const selected = original[queueName][index];
  if (selected !== expected) {
    await restoreQueue(session, original);
    throw new Error("queued message changed before it could be removed");
  }

  const updated = {
    steering: original.steering.filter((_message, itemIndex) => (
      queueName !== "steering" || itemIndex !== index
    )),
    followUp: original.followUp.filter((_message, itemIndex) => (
      queueName !== "followUp" || itemIndex !== index
    )),
  };
  try {
    await restoreQueue(session, updated);
  } catch (error) {
    // Do not leave a partially rebuilt queue behind if an upstream hook or
    // template rejects restoration. Best-effort restore the exact original
    // queue, then surface the failure so the renderer keeps its current item.
    session.clearQueue();
    try {
      await restoreQueue(session, original);
    } catch {
      // The primary restoration error remains the actionable failure.
    }
    throw error;
  }
  return updated;
}

export function projectSteeringQueue(event, limit = 8) {
  const normalize = values => (Array.isArray(values) ? values : [])
    .map(value => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(value => [...value].slice(0, maximumSteeringCharacters).join(""));
  return {
    steering: normalize(event?.steering),
    followUp: normalize(event?.followUp),
  };
}
