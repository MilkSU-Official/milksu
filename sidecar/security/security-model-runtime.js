export function configureRelayModel(session, provider, model, relay = {}) {
  if (!relay.enabled) return { provider, model };

  const source = session.modelRuntime.getModel(provider, model);
  session.modelRuntime.registerProvider("milksu-relay", {
    name: "MilkSU Relay",
    baseUrl: relay.url,
    apiKey: relay.key,
    api: "openai-completions",
    models: [{
      id: model,
      name: source?.name ?? model,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: source?.contextWindow ?? 128000,
      maxTokens: source?.maxTokens ?? 16384,
    }],
  });
  return { provider: "milksu-relay", model };
}

export function configureRuntimeModel(
  session,
  provider,
  model,
  { currentProviderDefinition, relay } = {},
) {
  const definition = currentProviderDefinition?.(provider, model);
  if (definition) session.modelRuntime.registerProvider(provider, definition);
  return configureRelayModel(session, provider, model, relay);
}

export async function setSessionModel(session, provider, model) {
  if (!provider || !model) throw new Error("provider and model are required");
  const desired = session.modelRuntime.getModel(provider, model);
  if (!desired) throw new Error(`Model not found: ${provider}/${model}`);
  await session.setModel(desired);
}
