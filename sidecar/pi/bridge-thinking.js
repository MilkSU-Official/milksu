export const MODEL_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function normalizeThinkingProfile(value) {
  if (!value?.enabled) return { enabled: false, levels: [], level: "off" };
  const selected = new Set(
    (Array.isArray(value.levels) ? value.levels : [])
      .map(level => String(level ?? "").trim().toLowerCase())
      .filter(level => MODEL_THINKING_LEVELS.includes(level)),
  );
  const levels = MODEL_THINKING_LEVELS.filter(level => selected.has(level));
  if (levels.length === 0) return { enabled: false, levels: [], level: "off" };
  const requested = String(value.level ?? "").trim().toLowerCase();
  return {
    enabled: true,
    levels,
    level: levels.includes(requested) ? requested : levels[0],
  };
}

export function withModelThinkingProfile(model, value) {
  if (!model) return model;
  const profile = normalizeThinkingProfile(value);
  if (!profile.enabled) {
    return {
      ...model,
      reasoning: false,
      thinkingLevelMap: undefined,
      compat: {
        ...(model.compat ?? {}),
        supportsReasoningEffort: false,
      },
    };
  }
  const thinkingLevelMap = Object.fromEntries(MODEL_THINKING_LEVELS.map(level => [
    level,
    profile.levels.includes(level) ? (level === "off" ? "none" : level) : null,
  ]));
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap,
    compat: {
      ...(model.compat ?? {}),
      supportsReasoningEffort: true,
    },
  };
}

export function withProviderThinkingProfile(definition, model, value) {
  if (!definition) return definition;
  return {
    ...definition,
    models: (definition.models ?? []).map(item => (
      item.id === model ? withModelThinkingProfile(item, value) : item
    )),
  };
}
