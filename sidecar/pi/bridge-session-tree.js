import { SessionManager } from "@earendil-works/pi-coding-agent";

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("");
}

export function messagesOnActiveBranch(session, role) {
  const branch = session?.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return [];
  return branch.filter(entry => entry?.type === "message" && entry.message?.role === role);
}

export function findBranchMessage(session, role, occurrence = 0) {
  const matches = messagesOnActiveBranch(session, role);
  if (!matches.length) return undefined;
  const index = Number.isInteger(occurrence) && occurrence >= 0 ? occurrence : 0;
  return matches[index] ?? matches.at(-1);
}

export async function navigateFromUserMessage(session, occurrence) {
  if (typeof session?.navigateTree !== "function") return;
  const entry = findBranchMessage(session, "user", occurrence);
  if (!entry) return;
  await session.navigateTree(entry.id);
}

export function forkFromMessage(session, role, occurrence) {
  const manager = session?.sessionManager;
  const sessionFile = session?.sessionFile;
  if (!manager || !sessionFile) {
    throw new Error("Wait for the first assistant response before branching this chat");
  }
  const entry = findBranchMessage(session, role, occurrence);
  if (!entry) {
    throw new Error("That message is not on the current session branch");
  }
  const clone = SessionManager.open(sessionFile, manager.getSessionDir());
  const path = clone.createBranchedSession(entry.id);
  if (!path) {
    throw new Error("Failed to create a branched session");
  }
  return {
    sessionId: clone.getSessionId(),
    path,
    text: messageText(entry.message),
  };
}
