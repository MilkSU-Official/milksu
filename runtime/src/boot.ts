import { generateTraceId, normalizeTraceId } from './trace.ts'

function resolveHomeRoot(env: Record<string, string | undefined> = process.env): string {
  const explicit = String(env.MILKSU_HOME ?? '').trim()
    || String(env.MILKSU_APPDATA_DIR ?? '').trim()
  if (explicit) return explicit
  const home = String(env.HOME ?? env.USERPROFILE ?? '').trim()
  return home ? `${home}/.milksu` : ''
}

export function logRuntimeBootStub(env: Record<string, string | undefined> = process.env): void {
  const home = resolveHomeRoot(env)
  const bootTrace = normalizeTraceId(env.MILKSU_TRACE_ID) || generateTraceId()
  console.error(`[${bootTrace}] runtime boot stub loaded home=${home || '(unset)'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  logRuntimeBootStub()
}
