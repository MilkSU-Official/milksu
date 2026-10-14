const CREDENTIAL_PATTERN = /\b(?:sk[-_]|gsk_|aiza|nss_agent_)[a-z0-9._-]{8,}/gi
const BEARER_PATTERN = /(bearer\s+)[a-z0-9._~+/=-]{8,}/gi
const ASSIGNMENT_PATTERN = /\b(api[_ -]?key|key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi
const QUERY_PATTERN = /([?&](?:api[_-]?key|key|token|secret|password)=)[^&#\s]+/gi

export function sanitizeDiagnosticText(value: string): string {
  value = String(value ?? '').trim()
  if (!value) return ''
  value = value.replace(CREDENTIAL_PATTERN, '[REDACTED]')
  value = value.replace(BEARER_PATTERN, '$1[REDACTED]')
  value = value.replace(ASSIGNMENT_PATTERN, '$1=[REDACTED]')
  value = value.replace(QUERY_PATTERN, '$1[REDACTED]')
  const runes = [...value]
  if (runes.length > 4096) value = `${runes.slice(0, 4096).join('')}…`
  return value
}

export function cleanDiagnosticLabel(value: string, fallback: string): string {
  value = String(value ?? '').trim()
  if (!value) return fallback
  value = sanitizeDiagnosticText(value)
  value = [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return code >= 0x20 && code !== 0x7f
  }).join('')
  const runes = [...value]
  if (runes.length > 160) value = runes.slice(0, 160).join('')
  return value || fallback
}
