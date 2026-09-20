// Per-conversation prompt queue. Same-workspace sessions share one sidecar
// process, but each conversation must be able to prompt without waiting on
// another conversation's turn. The stdin command queue still serializes
// session create / policy reload; only the long session.prompt() is detached.

export function enqueueConversationPrompt(queues, conversationId, run, onError) {
  if (!queues || typeof queues.get !== "function" || typeof queues.set !== "function") {
    throw new Error("conversation prompt queue is required");
  }
  const id = String(conversationId ?? "").trim();
  if (!id) throw new Error("conversationId is required");
  if (typeof run !== "function") throw new Error("conversation prompt run is required");

  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(run);
  const tracked = next.catch((error) => {
    if (typeof onError === "function") onError(error);
  });
  queues.set(id, tracked);
  return tracked;
}
