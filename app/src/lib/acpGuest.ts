import { createStore, useStore } from '@/lib/reactStore'
import { FACTORY_DEFAULT_KERNEL, normalizeAgentKernel, type AgentKernel } from '@/lib/agentKernel'

export interface AcpGuestConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

const providerEnvName = /^(?:.*_(?:API_KEY|SECRET|TOKEN|PASSWORD)|API_KEY|TOKENFLUX_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|MILKSU_CUSTOM_PROVIDER_KEY|MILKSU_RELAY_KEY)$/i

export function parseAcpGuestArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean)
  }
  const raw = String(value ?? '').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item ?? '').trim()).filter(Boolean)
      }
    } catch {
      // Fall through to whitespace split, same as MILKSU_DSH_ACP_ARGS.
    }
  }
  return raw.split(/\s+/).filter(Boolean)
}

export function formatAcpGuestArgs(args?: readonly string[]): string {
  return (args ?? []).join(' ')
}

export function parseAcpGuestEnv(value: unknown): Record<string, string> | undefined {
  const entries: Array<[string, string]> = []
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      entries.push([key, String(raw ?? '')])
    }
  } else {
    for (const line of String(value ?? '').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const cut = trimmed.indexOf('=')
      if (cut <= 0) continue
      entries.push([trimmed.slice(0, cut), trimmed.slice(cut + 1)])
    }
  }
  const env: Record<string, string> = {}
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey ?? '').trim()
    if (!key || providerEnvName.test(key)) continue
    env[key] = String(rawValue ?? '')
  }
  return Object.keys(env).length ? env : undefined
}

export function formatAcpGuestEnv(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function normalizeAcpGuest(value: unknown): AcpGuestConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const command = String(source.command ?? '').trim()
  if (!command) return undefined
  const args = parseAcpGuestArgs(source.args)
  const env = parseAcpGuestEnv(source.env)
  return {
    command,
    ...(args.length ? { args } : {}),
    ...(env ? { env } : {}),
  }
}

export function acpGuestConfigured(value?: AcpGuestConfig | null): boolean {
  return Boolean(String(value?.command ?? '').trim())
}

export function selectableAgentKernel(
  value: unknown,
  guest?: AcpGuestConfig | null,
): AgentKernel {
  const kernel = normalizeAgentKernel(value)
  if (kernel === 'dsh' && !acpGuestConfigured(guest)) return FACTORY_DEFAULT_KERNEL
  return kernel
}

const acpGuestStore = createStore({ current: undefined as AcpGuestConfig | undefined })

export function installAcpGuest(value: unknown) {
  acpGuestStore.setState({ current: normalizeAcpGuest(value) })
}

export function useAcpGuestConfigured(): boolean {
  return acpGuestConfigured(useStore(acpGuestStore).current)
}

export function acpGuestRuntimeLabel(
  _t: (zh: string, en: string) => string,
): string {
  return 'Agent'
}

export function acpGuestUnavailableReason(
  id: 'ask' | 'durable-research' | 'milksu-workspace',
  t: (zh: string, en: string) => string,
): string {
  if (id === 'ask') {
    return t('ACP 没有 Ask 卡。', 'ACP has no Ask card.')
  }
  if (id === 'durable-research') {
    return t('这个 Agent 没有 durable 研究。', 'This agent does not have durable research.')
  }
  return t('ACP 没有 typed milksu_workspace。', 'ACP has no typed milksu_workspace.')
}
