// Abort can outrun send_message: abort_session is handled immediately, while
// send_message waits on the sidecar command queue and createSession.

export function dropSendAfterAbort(abortedSessions, sessions, conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) return false;
  return abortedSessions.delete(id) && !sessions?.get(id);
}
