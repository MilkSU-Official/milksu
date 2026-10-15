import { createStore, useStore } from '@/lib/reactStore'
import { FACTORY_DEFAULT_KERNEL, normalizeAgentKernel, type AgentKernel } from '@/lib/agentKernel'

export type AcpAgentKind = 'acp' | 'codex' | 'claude-code'

export interface AcpAgentConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface NamedAcpAgent {
  id: string
  name: string
  kind?: AcpAgentKind
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export const ACP_AGENT_KINDS: readonly AcpAgentKind[] = ['codex', 'claude-code', 'acp']

const providerEnvName = /^(?:.*_(?:API_KEY|SECRET|TOKEN|PASSWORD)|API_KEY|TOKENFLUX_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|MILKSU_CUSTOM_PROVIDER_KEY|MILKSU_RELAY_KEY)$/i

export function parseAcpAgentArgs(value: unknown): string[] {
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

export function formatAcpAgentArgs(args?: readonly string[]): string {
  return (args ?? []).join(' ')
}

export function parseAcpAgentEnv(value: unknown): Record<string, string> | undefined {
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

export function formatAcpAgentEnv(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function normalizeAcpAgentKind(value: unknown): AcpAgentKind {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'codex') return 'codex'
  if (raw === 'claude-code' || raw === 'claude_code' || raw === 'claudecode') return 'claude-code'
  return 'acp'
}

export function acpAgentKindLabel(kind: AcpAgentKind): string {
  if (kind === 'codex') return 'Codex'
  if (kind === 'claude-code') return 'Claude Code'
  return 'ACP'
}

export function acpAgentPreset(kind: AcpAgentKind): { name: string; command: string; args: string[] } {
  if (kind === 'codex') {
    return { name: 'Codex', command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'] }
  }
  if (kind === 'claude-code') {
    return { name: 'Claude Code', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] }
  }
  return { name: 'ACP', command: '', args: ['--stdio'] }
}

export function uniqueAcpAgentName(desired: string, existing: readonly { name?: string }[]): string {
  const base = desired.trim() || 'ACP'
  const taken = new Set(existing.map(item => String(item.name ?? '').trim().toLowerCase()).filter(Boolean))
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; index < 1000; index += 1) {
    const next = `${base} ${index}`
    if (!taken.has(next.toLowerCase())) return next
  }
  return `${base} ${Date.now()}`
}

export function createNamedAcpAgent(input: {
  kind: AcpAgentKind
  name?: string
  existing?: readonly NamedAcpAgent[]
}): NamedAcpAgent {
  const preset = acpAgentPreset(input.kind)
  const name = uniqueAcpAgentName(input.name?.trim() || preset.name, input.existing ?? [])
  const args = preset.args
  return {
    id: `agt_${crypto.randomUUID()}`,
    name,
    kind: input.kind,
    ...(preset.command ? { command: preset.command } : {}),
    ...(args.length ? { args } : {}),
  }
}

export function normalizeAcpAgent(value: unknown): AcpAgentConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const command = String(source.command ?? '').trim()
  if (!command) return undefined
  const args = parseAcpAgentArgs(source.args)
  const env = parseAcpAgentEnv(source.env)
  return {
    command,
    ...(args.length ? { args } : {}),
    ...(env ? { env } : {}),
  }
}

export function normalizeNamedAcpAgent(value: unknown): NamedAcpAgent | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const id = String(source.id ?? '').trim()
  const name = String(source.name ?? '').trim()
  if (!id || id.length > 80 || !name || name.length > 80) return undefined
  const command = String(source.command ?? '').trim()
  const args = parseAcpAgentArgs(source.args)
  const env = parseAcpAgentEnv(source.env)
  return {
    id,
    name,
    kind: normalizeAcpAgentKind(source.kind),
    ...(command ? { command } : {}),
    ...(args.length ? { args } : {}),
    ...(env ? { env } : {}),
  }
}

export function normalizeAcpAgents(value: unknown): NamedAcpAgent[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const agents: NamedAcpAgent[] = []
  for (const item of value) {
    const agent = normalizeNamedAcpAgent(item)
    if (!agent || seen.has(agent.id)) continue
    seen.add(agent.id)
    agents.push(agent)
  }
  return agents.slice(0, 32)
}

export function acpAgentConfigured(value?: { command?: string } | null): boolean {
  return Boolean(String(value?.command ?? '').trim())
}

export function derivedAcpAgent(
  agents: readonly NamedAcpAgent[],
  defaultId?: string,
): AcpAgentConfig | undefined {
  const requested = String(defaultId ?? '').trim()
  const selected = (requested ? agents.find(agent => agent.id === requested) : undefined)
    ?? agents.find(agent => acpAgentConfigured(agent))
  return normalizeAcpAgent(selected)
}

export function migrateAcpAgents(value: {
  acp_agents?: unknown
  acp_agent?: unknown
  acp_guest?: unknown
  default_acp_agent_id?: unknown
}): { agents: NamedAcpAgent[]; defaultId: string } {
  let agents = normalizeAcpAgents(value.acp_agents)
  const legacy = normalizeAcpAgent(value.acp_agent ?? value.acp_guest)
  if (!agents.length && legacy) {
    agents = [{
      id: 'agt_legacy',
      name: 'Agent',
      kind: 'acp',
      command: legacy.command,
      ...(legacy.args?.length ? { args: legacy.args } : {}),
      ...(legacy.env ? { env: legacy.env } : {}),
    }]
  }
  const requested = String(value.default_acp_agent_id ?? '').trim()
  const defaultId = agents.some(agent => agent.id === requested)
    ? requested
    : (agents.find(agent => acpAgentConfigured(agent))?.id ?? agents[0]?.id ?? '')
  return { agents, defaultId }
}

export function selectableAgentKernel(
  value: unknown,
  guest?: AcpAgentConfig | null,
  agents?: readonly NamedAcpAgent[],
): AgentKernel {
  const kernel = normalizeAgentKernel(value)
  if (kernel !== 'dsh') return kernel
  if (agents?.some(agent => acpAgentConfigured(agent))) return 'dsh'
  if (acpAgentConfigured(guest)) return 'dsh'
  return FACTORY_DEFAULT_KERNEL
}

export function resolveNamedAcpAgent(
  agents: readonly NamedAcpAgent[],
  agentId?: string,
): NamedAcpAgent | undefined {
  const requested = String(agentId ?? '').trim()
  if (requested) {
    const match = agents.find(agent => agent.id === requested)
    if (match) return match
  }
  return agents.find(agent => acpAgentConfigured(agent))
}

const acpAgentStore = createStore({
  agents: [] as NamedAcpAgent[],
  defaultId: '',
  focusId: '',
})

export function installAcpAgents(agents: readonly NamedAcpAgent[], defaultId?: string) {
  const current = acpAgentStore.getState()
  acpAgentStore.setState({
    agents: [...agents],
    defaultId: String(defaultId ?? '').trim(),
    focusId: current.focusId,
  })
}

export function focusAcpAgent(id: string) {
  acpAgentStore.setState({ focusId: String(id ?? '').trim() })
}

export function peekAcpAgentFocus(): string {
  return String(acpAgentStore.getState().focusId ?? '').trim()
}

export function consumeAcpAgentFocus(): string {
  const id = peekAcpAgentFocus()
  if (id) acpAgentStore.setState({ focusId: '' })
  return id
}

export function installAcpAgent(value: unknown) {
  const config = normalizeAcpAgent(value)
  if (!config) {
    if (!acpAgentStore.getState().agents.length) {
      acpAgentStore.setState({ agents: [], defaultId: '' })
    }
    return
  }
  const current = acpAgentStore.getState()
  if (current.agents.length) return
  installAcpAgents([{
    id: 'agt_legacy',
    name: 'Agent',
    kind: 'acp',
    ...config,
  }], 'agt_legacy')
}

export function useAcpAgents(): NamedAcpAgent[] {
  return useStore(acpAgentStore).agents
}

export function useAcpAgentConfigured(): boolean {
  return useStore(acpAgentStore).agents.some(agent => acpAgentConfigured(agent))
}

export function acpAgentRuntimeLabel(
  _t: (zh: string, en: string) => string,
): string {
  return 'Agent'
}

export function acpAgentUnavailableReason(
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
