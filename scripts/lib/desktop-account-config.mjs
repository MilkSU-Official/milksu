function cleanHTTPS(value, label) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`)
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${label} must be a credential-free HTTPS URL`)
  }
  return parsed.toString().replace(/\/$/u, '')
}

export function desktopAccountConfigFromEnvironment(environment = process.env) {
  const apiUrl = cleanHTTPS(
    environment.MILKSU_ACCOUNT_API_URL || 'https://accounts.milksu.org',
    'MILKSU_ACCOUNT_API_URL',
  )
  return { apiUrl }
}
