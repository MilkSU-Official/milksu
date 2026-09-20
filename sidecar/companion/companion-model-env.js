export function companionProviderEnvironment(command, environment = process.env) {
  const source = String(command?.source ?? "").trim();
  const relayKey = String(environment.MILKSU_RELAY_KEY ?? "").trim();
  const relayUrl = String(environment.MILKSU_RELAY_URL ?? "").trim() || "https://tokenflux.dev/v1";
  const personal = String(environment.TOKENFLUX_API_KEY ?? "").trim();
  if (source === "personal" && personal) return environment;
  if (relayKey && (source === "account" || source === "" || !personal)) {
    return {
      ...environment,
      TOKENFLUX_API_KEY: relayKey,
      TOKENFLUX_BASE_URL: relayUrl,
    };
  }
  return environment;
}
