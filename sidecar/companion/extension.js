import {
  assembleCompanionMessages,
  composeSystemPrompt,
  handleSessionBeforeCompact,
} from "./context-assembly.js";

export const COMPANION_SESSION_ID = "companion";

export function createCompanionExtension({
  getBoardSnapshot,
  getSemanticMemories,
  getEpisodicRecalls,
  getPersona,
  getSystemPrompt,
} = {}) {
  return (pi) => {
    pi.on("session_before_compact", () => handleSessionBeforeCompact());

    pi.on("before_agent_start", () => {
      const composed = composeSystemPrompt({
        base: typeof getSystemPrompt === "function" ? getSystemPrompt() : "",
        persona: typeof getPersona === "function" ? getPersona() : "",
      });
      return { systemPrompt: composed.text };
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
