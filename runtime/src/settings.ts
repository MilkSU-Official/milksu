import { readFile } from 'node:fs/promises'
import { settingsPath } from './home.ts'

const PROVIDER_KEY_FIELDS = new Set([
  'api_key',
  'key',
  'remove_api_key',
  'remove_key',
])

export type AcpGuestConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export type PublicSettings = {
  active_provider?: string
  active_model?: string
  default_kernel?: string
  acp_guest?: AcpGuestConfig | null
  locale?: string | null
  disabled_skills?: string[]
  runtime_thinking_level?: string
  providers?: Record<string, Record<string, unknown>>
  model_routing?: {
    source_order?: string[]
    auto_fallback?: boolean
  }
  [key: string]: unknown
}

const ACP_GUEST_PROVIDER_ENV = /^(?:.*_(?:API_KEY|SECRET|TOKEN|PASSWORD)|API_KEY|TOKENFLUX_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|MILKSU_CUSTOM_PROVIDER_KEY|MILKSU_RELAY_KEY)$/i

export function normalizeAcpGuest(value: AcpGuestConfig | null | undefined): AcpGuestConfig | null {
  if (!value) return null
  const command = String(value.command ?? '').trim()
  if (!command) return null
  const args = (value.args ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value.env ?? {})) {
    const name = String(key ?? '').trim()
    if (!name || ACP_GUEST_PROVIDER_ENV.test(name)) continue
    env[name] = String(raw ?? '')
  }
  const guest: AcpGuestConfig = { command }
  if (args.length) guest.args = args
  if (Object.keys(env).length) guest.env = env
  return guest
}

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PROVIDER_KEY_FIELDS.has(key)) continue
    result[key] = stripSecrets(item)
  }
  return result
}

export function resolvedUserInterfaceLocale(settings: PublicSettings): string {
  return String(settings.locale ?? '').trim().toLowerCase() === 'en' ? 'en' : 'zh'
}

export function normalizeDefaultKernel(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'dsh':
    case 'acp':
    case 'deepseek':
    case 'deepseek-harness':
      return 'dsh'
    default:
      return 'pi'
  }
}

export async function readPublicSettings(home?: string): Promise<PublicSettings> {
  try {
    const raw = await readFile(settingsPath(home), 'utf8')
    const parsed = JSON.parse(raw) as PublicSettings
    return stripSecrets(parsed) as PublicSettings
  } catch {
    return {}
  }
}
