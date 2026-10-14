import { RESEARCH_RUN_ID_PATTERN } from './types.ts'

const TEXT_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TEXT_QUERY_PATTERN = /([?&;])([^=&#;\s]+)=([^&#;\s]*)/gi
const TEXT_URL_AUTH_PATTERN = /(https?:\/\/[^/:?#\s]+:)[^@/?#\s]*@/gi
const TRAILING_URL_PUNCTUATION = '.,;:!?)]}'

export function sensitiveSourceQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_.]/g, '')
  for (const sensitive of [
    'apikey',
    'token',
    'secret',
    'password',
    'passwd',
    'auth',
    'credential',
    'signature',
    'accesskeyid',
  ]) {
    if (normalized.includes(sensitive)) return true
  }
  return normalized === 'key' || normalized.endsWith('key') || normalized === 'sig'
}

export function sanitizeSourceURL(value: string): string {
  const raw = String(value ?? '').trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('invalid research source URL')
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  if ((scheme !== 'http' && scheme !== 'https') || parsed.hostname === '') {
    throw new Error('research source URL must be absolute HTTP(S)')
  }
  const params = new URLSearchParams(parsed.search)
  for (const key of [...params.keys()]) {
    if (sensitiveSourceQueryKey(key)) params.delete(key)
  }
  const query = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    .join('&')
    .replace(/%20/g, '+')
  const path = parsed.pathname || ''
  return `${scheme}://${parsed.host}${path}${query ? `?${query}` : ''}`
}

export function sanitizeResearchText(value: string): string {
  return String(value ?? '').replace(TEXT_URL_PATTERN, (candidate) => {
    let end = candidate.length
    while (end > 0 && TRAILING_URL_PUNCTUATION.includes(candidate[end - 1]!)) end -= 1
    const urlText = candidate.slice(0, end)
    const suffix = candidate.slice(end)
    if (!urlText) return candidate
    try {
      return sanitizeSourceURL(urlText) + suffix
    } catch {
      const redactedQuery = urlText.replace(TEXT_QUERY_PATTERN, (parameter, delimiter, key, item) => {
        let decoded = key
        try {
          decoded = decodeURIComponent(key)
        } catch {
          decoded = key
        }
        if (!sensitiveSourceQueryKey(decoded)) return parameter
        return `${delimiter}${key}=[REDACTED]`
      })
      return redactedQuery.replace(TEXT_URL_AUTH_PATTERN, '$1[REDACTED]@') + suffix
    }
  })
}

export function validResearchRunId(value: string): boolean {
  return RESEARCH_RUN_ID_PATTERN.test(value)
}
