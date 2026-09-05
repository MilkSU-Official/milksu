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

export function lastExplorationTarget(session) {
  const users = messagesOnActiveBranch(session, "user");
  if (users.length < 2) return undefined;
  const previousUser = users[users.length - 2];
  const lastUser = users[users.length - 1];
  const branch = session?.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return previousUser;
  const previousIndex = branch.findIndex(entry => entry?.id === previousUser.id);
  const lastIndex = branch.findIndex(entry => entry?.id === lastUser.id);
  const window = branch.slice(
    Math.max(0, previousIndex),
    lastIndex >= 0 ? lastIndex : undefined,
  );
  const assistants = window.filter(entry => (
    entry?.type === "message" && entry.message?.role === "assistant"
  ));
  return assistants.at(-1) ?? previousUser;
}

export async function rewindLastExploration(session) {
  const target = lastExplorationTarget(session);
  if (!target) {
    throw new Error("Nothing to rewind");
  }
  if (typeof session?.navigateTree !== "function") {
    throw new Error("This session cannot rewind");
  }
  if (typeof session.abort === "function") {
    await session.abort();
  }
  await session.navigateTree(target.id);
  return { keptEntryId: target.id };
}

export function lastForkPoint(session) {
  const assistants = messagesOnActiveBranch(session, "assistant");
  if (assistants.length) {
    return { role: "assistant", occurrence: assistants.length - 1 };
  }
  const users = messagesOnActiveBranch(session, "user");
  if (users.length) {
    return { role: "user", occurrence: users.length - 1 };
  }
  return undefined;
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
