const CREDENTIAL_REDACTION = '[credential redacted]'

function normalizeRedactedCredentialMarkers(value: string) {
  let normalized = value
  let previous = ''
  while (normalized !== previous) {
    previous = normalized
    normalized = normalized
      .replace(/\[credential redacted\](?:\s+redacted\])+/gi, CREDENTIAL_REDACTION)
      .replace(
        /((?:[?&](?:api[_-]?key|apikey|access_token|token|secret|key|x-api-key)=\[credential redacted\](?:[&#][^\s"'<>\]]*)?))(?:\s+redacted\])+/gi,
        '$1',
      )
  }
  return normalized
}

export function redactProviderCredentials(value: string) {
  const redacted = normalizeRedactedCredentialMarkers(value)
    .replace(
      /\b[A-Z][A-Z0-9_]*API_KEY\s*=\s*(?:\[credential redacted\]|[^\s"']+)/g,
      match => `${match.split('=')[0].trim()}=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /([?&])api[_-]?key=(?:\[credential redacted\]|[^&#\s"']+)/gi,
      `$1api_key=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /([?&])x-api-key=(?:\[credential redacted\]|[^&#\s"']+)/gi,
      `$1x-api-key=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /(^|[\s,;])api[_-]?key\s*[:=]\s*(?:\[credential redacted\]|[^\s"']+)/gi,
      `$1api_key=${CREDENTIAL_REDACTION}`,
    )
    .replace(
      /(^|[\s,;])x-api-key\s*[:=]\s*(?:\[credential redacted\]|[^\s"']+)/gi,
      `$1x-api-key=${CREDENTIAL_REDACTION}`,
    )
    .replace(/\bBearer\s+(?:\[credential redacted\]|[^\s"']+)/gi, `Bearer ${CREDENTIAL_REDACTION}`)
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, CREDENTIAL_REDACTION)
  return normalizeRedactedCredentialMarkers(redacted)
}
