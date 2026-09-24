import {
  assembleCompanionMessages,
  composeSystemPrompt,
} from "./context-assembly.js";

export const COMPANION_SESSION_ID = "companion";

export function createCompanionExtension({
  getBoardSnapshot,
  getSemanticMemories,
  getEpisodicRecalls,
  getPersona,
  getSystemPrompt,
  getIntentLine,
} = {}) {
  return (pi) => {
    // Pi 0.84.1 compacts this session itself. session_before_compact
    // { cancel: true } aborts that (agent-session.js compact / _runAutoCompaction).
    // Injected Obelisk memory is only on the provider-request clone, so it does
    // not require cancelling compaction. No concrete Pi bug still needs cancel.

    pi.on("before_agent_start", () => {
      const composed = composeSystemPrompt({
        base: typeof getSystemPrompt === "function" ? getSystemPrompt() : "",
        persona: typeof getPersona === "function" ? getPersona() : "",
      });
      const line = typeof getIntentLine === "function" ? String(getIntentLine() ?? "").trim() : "";
      // Keep the fold on the system prompt. A turn message is written into the
      // session the user reads, even when display is false.
      const text = line ? [composed.text, line].filter(Boolean).join("\n\n") : composed.text;
      return { systemPrompt: text };
    });

    pi.on("context", (event) => {
      const assembled = assembleCompanionMessages({
        semanticMemories: typeof getSemanticMemories === "function" ? getSemanticMemories() : [],
        recentMessages: event.messages,
        boardSnapshot: typeof getBoardSnapshot === "function"
          ? getBoardSnapshot()
          : { sessions: [], todos: [] },
        episodicRecalls: typeof getEpisodicRecalls === "function" ? getEpisodicRecalls() : [],
      });
      return { messages: assembled.messages };
    });
  };
}
