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
      const result = { systemPrompt: composed.text };
      if (!line) return result;
      result.message = {
        customType: "companion.intent",
        content: line,
        display: false,
        details: { scope: "current-turn" },
      };
      return result;
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
