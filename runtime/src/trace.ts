const TRACE_ID_PATTERN = /^trc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function generateTraceId(): string {
  return `trc_${crypto.randomUUID()}`
}

export function normalizeTraceId(value: unknown): string {
  const raw = String(value ?? '').trim()
  return TRACE_ID_PATTERN.test(raw) ? raw : ''
}
