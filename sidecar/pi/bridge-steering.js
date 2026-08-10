const maximumSteeringCharacters = 16000;

function normalizedSteeringMessage(value) {
  const message = String(value ?? "").trim();
  if (!message) throw new Error("steering message is required");
  if ([...message].length > maximumSteeringCharacters) {
    throw new Error(`steering message exceeds ${maximumSteeringCharacters} characters`);
  }
  return message;
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
