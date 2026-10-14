export function originTarget(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('browser URL must be an http(s) URL without embedded credentials')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('browser URL must be an http(s) URL without embedded credentials')
  }
  const scheme = parsed.protocol.replace(/:$/u, '')
  const hostname = parsed.hostname.toLowerCase()
  const host = hostname.includes(':') ? `[${hostname}]` : hostname
  const port = parsed.port
  const authority = port ? `${host}:${port}` : host
  return `${scheme}://${authority}`
}

export function loopbackEndpointPort(raw: string): number {
  let parsed: URL
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('Chromium host returned an invalid private CDP endpoint')
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '' && parsed.pathname !== '/')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Chromium host returned an invalid private CDP endpoint')
  }
  const port = Number.parseInt(parsed.port, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Chromium host returned an invalid private CDP port')
  }
  return port
}

export function normalizeCodingConversationId(value: string): string {
  const id = String(value ?? '').trim()
  if (!id || id.length > 160) throw new Error('Coding conversation id is required')
  for (const character of id) {
    if (
      (character >= 'a' && character <= 'z')
      || (character >= 'A' && character <= 'Z')
      || (character >= '0' && character <= '9')
      || '._:-'.includes(character)
    ) {
      continue
    }
    throw new Error('Coding conversation id contains unsupported characters')
  }
  return id
}
