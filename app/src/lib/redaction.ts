const CREDENTIAL_REDACTION = '[credential redacted]'

export function redactProviderCredentials(value: string) {
  return value
    .replace(
      /\b[A-Z][A-Z0-9_]*API_KEY\s*=\s*[^\s"']+/g,
      match => `${match.split('=')[0].trim()}=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /([?&])api[_-]?key=([^&#\s"']+)/gi,
      `$1api_key=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /(^|[\s,;])api[_-]?key\s*[:=]\s*[^\s"']+/gi,
      `$1api_key=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /(^|[\s,;])x-api-key\s*[:=]\s*[^\s"']+/gi,
      `$1x-api-key=${CREDENTIAL_REDACTION}`,
    )
    .replace(/\bBearer\s+[^\s"']+/gi, `Bearer ${CREDENTIAL_REDACTION}`)
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, CREDENTIAL_REDACTION)
}
