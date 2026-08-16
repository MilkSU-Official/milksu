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

export async function steerSession(sessions, command) {
  const conversationId = String(command?.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  const session = sessions.get(conversationId);
  if (!session) throw new Error(`PI session not found: ${conversationId}`);
  const message = normalizedSteeringMessage(command?.prompt);

  // Pi owns streaming and queue semantics. Use its dedicated API instead of
  // prompt(..., { streamingBehavior: "steer" }): during the small window where
  // AgentSession has not yet projected isStreaming but the underlying agent is
  // already processing, prompt() falls through and is rejected as a concurrent
  // prompt. steer() queues directly after the active tool batch and before the
  // next model call.
  await session.steer(message);
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
