export function projectHostSubagentEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || entry.kind !== "child") return [];
    const id = String(entry.id ?? "").trim();
    if (!id) return [];
    const label = String(entry.label ?? "").trim() || id;
    return [{
      id,
      role: label.slice(0, 80),
      status: entry.activity === "running" ? "running" : "succeeded",
      toolCallId: id,
    }];
  });
}

export async function listHostSubagents(subagents, parentSessionId) {
  const parent = String(parentSessionId ?? "").trim();
  if (!parent || !subagents || typeof subagents.listChildren !== "function") {
    return [];
  }
  return projectHostSubagentEntries(await subagents.listChildren(parent));
}

export async function interruptHostSubagent(subagents, agents, parentSessionId, childId) {
  const parent = String(parentSessionId ?? "").trim();
  const child = String(childId ?? "").trim();
  if (!parent || !child) throw new Error("sessionId and subagentId are required");
  if (!subagents) throw new Error("Agent subagents are unavailable");
  if (typeof subagents.interruptByParent === "function") {
    subagents.interruptByParent(child, parent, "continuable");
  }
  const parentAgent = typeof agents?.get === "function" ? agents.get(parent) : null;
  if (parentAgent && typeof subagents.drainContinuableChildren === "function") {
    await subagents.drainContinuableChildren(parentAgent, [child]);
  }
}

export async function interruptAllHostSubagents(subagents, agents, parentSessionId) {
  const parent = String(parentSessionId ?? "").trim();
  const tasks = await listHostSubagents(subagents, parent);
  const ids = tasks.map((task) => task.id);
  const parentAgent = typeof agents?.get === "function" ? agents.get(parent) : null;
  if (parentAgent && typeof subagents.drainContinuableChildren === "function" && ids.length) {
    await subagents.drainContinuableChildren(parentAgent, ids);
  }
  for (const id of ids) {
    if (typeof subagents.interruptByParent === "function") {
      subagents.interruptByParent(id, parent, "continuable");
    }
  }
  return ids;
}
