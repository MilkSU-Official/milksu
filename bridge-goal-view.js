const goalStatuses = new Set([
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete",
  "queued",
]);

function boundedText(value, limit) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, limit);
}

function nonNegativeInteger(value) {
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function optionalPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function projectGoalStateData(data) {
  if (!isRecord(data) || data.goal === null) return null;
  const goal = data.goal;
  if (!isRecord(goal)) return null;

  const id = boundedText(goal.id, 160);
  const text = boundedText(goal.text, 4000);
  const status = boundedText(goal.status, 32);
  if (!id || !text || !goalStatuses.has(status)) return null;

  return {
    id,
    text,
    status,
    startedAt: nonNegativeInteger(goal.startedAt),
    updatedAt: nonNegativeInteger(goal.updatedAt),
    iteration: nonNegativeInteger(goal.iteration),
    tokenBudget: optionalPositiveInteger(goal.tokenBudget),
    tokensUsed: nonNegativeInteger(goal.tokensUsed),
    timeUsedSeconds: nonNegativeInteger(goal.timeUsedSeconds),
    automaticModelTurns: nonNegativeInteger(goal.automaticModelTurns),
    queuedCount: Array.isArray(data.queue) ? Math.min(data.queue.length, 1000) : 0,
  };
}

export function projectSessionGoal(sessionManager) {
  const entries = sessionManager?.getBranch?.()
    ?? sessionManager?.getEntries?.()
    ?? [];
  if (!Array.isArray(entries)) return null;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.type === "custom"
      && entry.customType === "goal-state"
    ) {
      return projectGoalStateData(entry.data);
    }
  }
  return null;
}
