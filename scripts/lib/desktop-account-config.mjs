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
  const supabaseUrl = cleanHTTPS(environment.MILKSU_SUPABASE_URL, 'MILKSU_SUPABASE_URL')
  const apiUrl = cleanHTTPS(environment.MILKSU_ACCOUNT_API_URL, 'MILKSU_ACCOUNT_API_URL')
  const supabaseAnonKey = String(environment.MILKSU_SUPABASE_ANON_KEY ?? '').trim()
  const configured = [supabaseUrl, apiUrl, supabaseAnonKey].filter(Boolean).length
  if (configured === 0) return null
  if (configured !== 3) {
    throw new Error('desktop account packaging requires Supabase URL, account API URL, and public anon key together')
  }
  if (supabaseAnonKey.length > 4096 || /[\u0000\r\n]/u.test(supabaseAnonKey)) {
    throw new Error('MILKSU_SUPABASE_ANON_KEY is invalid')
  }
  return { supabaseUrl, apiUrl, supabaseAnonKey }
}
