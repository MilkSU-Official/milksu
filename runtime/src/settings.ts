import { readFile } from 'node:fs/promises'
import { settingsPath } from './home.ts'

const PROVIDER_KEY_FIELDS = new Set([
  'api_key',
  'key',
  'remove_api_key',
  'remove_key',
])

export type AcpAgentConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export type NamedAcpAgent = AcpAgentConfig & {
  id?: string
  name?: string
  kind?: string
}

export type PublicSettings = {
  active_provider?: string
  active_model?: string
  default_kernel?: string
  acp_agent?: AcpAgentConfig | null
  acp_agents?: NamedAcpAgent[]
  default_acp_agent_id?: string
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

const ACP_AGENT_PROVIDER_ENV = /^(?:.*_(?:API_KEY|SECRET|TOKEN|PASSWORD)|API_KEY|TOKENFLUX_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|MILKSU_CUSTOM_PROVIDER_KEY|MILKSU_RELAY_KEY)$/i

function parseAcpAgentEnv(value: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value ?? {})) {
    const name = String(key ?? '').trim()
    if (!name || ACP_AGENT_PROVIDER_ENV.test(name)) continue
    env[name] = String(raw ?? '')
  }
  return env
}

export function normalizeAcpAgent(value: AcpAgentConfig | null | undefined): AcpAgentConfig | null {
  if (!value) return null
  const command = String(value.command ?? '').trim()
  if (!command) return null
  const args = (value.args ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)
  const env = parseAcpAgentEnv(value.env)
  const agent: AcpAgentConfig = { command }
  if (args.length) agent.args = args
  if (Object.keys(env).length) agent.env = env
  return agent
}

export function normalizeNamedAcpAgent(value: unknown): NamedAcpAgent | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = String(source.id ?? '').trim()
  const name = String(source.name ?? '').trim()
  if (!id || id.length > 80 || !name || name.length > 80) return null
  const command = String(source.command ?? '').trim()
  const args = Array.isArray(source.args)
    ? source.args.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
  const env = parseAcpAgentEnv(
    source.env && typeof source.env === 'object' && !Array.isArray(source.env)
      ? source.env as Record<string, string>
      : undefined,
  )
  const kindRaw = String(source.kind ?? '').trim().toLowerCase()
  const kind = kindRaw === 'codex' || kindRaw === 'claude-code' ? kindRaw : 'acp'
  const agent: NamedAcpAgent = { id, name, kind }
  if (command) agent.command = command
  if (args.length) agent.args = args
  if (Object.keys(env).length) agent.env = env
  return agent
}

export function normalizeAcpAgents(value: unknown): NamedAcpAgent[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const agents: NamedAcpAgent[] = []
  for (const item of value) {
    const agent = normalizeNamedAcpAgent(item)
    if (!agent?.id || seen.has(agent.id)) continue
    seen.add(agent.id)
    agents.push(agent)
  }
  return agents.slice(0, 32)
}

export function migrateAcpAgents(settings: PublicSettings): {
  agents: NamedAcpAgent[]
  defaultId: string
  derived: AcpAgentConfig | null
} {
  const extra = settings as PublicSettings & Record<string, unknown>
  const legacyRaw = extra.acp_guest ?? extra.AcpGuest
  if (extra.acp_agent == null && legacyRaw != null) {
    extra.acp_agent = legacyRaw as AcpAgentConfig
  }
  delete extra.acp_guest
  delete extra.AcpGuest
  let agents = normalizeAcpAgents(extra.acp_agents)
  const legacy = normalizeAcpAgent(extra.acp_agent)
  if (!agents.length && legacy?.command) {
    agents = [{
      id: 'agt_legacy',
      name: 'Agent',
      kind: 'acp',
      command: legacy.command,
      ...(legacy.args?.length ? { args: legacy.args } : {}),
      ...(legacy.env ? { env: legacy.env } : {}),
    }]
  }
  const requested = String(extra.default_acp_agent_id ?? '').trim()
  const defaultId = agents.some((agent) => agent.id === requested)
    ? requested
    : (agents.find((agent) => String(agent.command ?? '').trim())?.id ?? agents[0]?.id ?? '')
  extra.acp_agents = agents
  extra.default_acp_agent_id = defaultId || undefined
  delete extra.acp_agent
  const selected = (defaultId ? agents.find((agent) => agent.id === defaultId) : undefined)
    ?? agents.find((agent) => String(agent.command ?? '').trim())
  const derived = normalizeAcpAgent(selected)
  return { agents, defaultId, derived }
}

export function resolveAcpAgent(
  settings: PublicSettings | undefined,
  agentId?: string,
): { id: string; agent: AcpAgentConfig } | null {
  const agents = normalizeAcpAgents(settings?.acp_agents)
  const requested = String(agentId ?? settings?.default_acp_agent_id ?? '').trim()
  const named = (requested ? agents.find((item) => item.id === requested) : undefined)
    ?? agents.find((item) => String(item.command ?? '').trim())
  const derived = normalizeAcpAgent(named) ?? normalizeAcpAgent(settings?.acp_agent)
  if (!derived?.command) return null
  return { id: named?.id || 'default', agent: derived }
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
