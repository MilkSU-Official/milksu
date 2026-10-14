const TRACE_ID_PATTERN = /^trc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeTraceId(value) {
  const raw = String(value ?? "").trim();
  return TRACE_ID_PATTERN.test(raw) ? raw : "";
}

export function resolveTraceId(command, env = process.env) {
  return normalizeTraceId(command?.traceId) || normalizeTraceId(env?.MILKSU_TRACE_ID);
}

export function formatTracePrefix(traceId) {
  const id = normalizeTraceId(traceId);
  return id ? `[${id}]` : "";
}

export function traceConsoleError(traceId, ...args) {
  const prefix = formatTracePrefix(traceId);
  if (prefix) console.error(prefix, ...args);
  else console.error(...args);
}

export function applyTraceEnv(env, traceId) {
  const next = { ...(env && typeof env === "object" ? env : {}) };
  const id = normalizeTraceId(traceId);
  if (id) next.MILKSU_TRACE_ID = id;
  return next;
}
