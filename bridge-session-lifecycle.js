export async function disposeAgentSession(session, reason = "quit") {
  if (!session) return;
  try {
    await session.abort();
    if (session.hasExtensionHandlers("session_shutdown")) {
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason,
      });
    }
  } finally {
    session.dispose();
  }
}
