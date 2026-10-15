import { describe, expect, it } from 'vitest'
import {
  acpAgentConfigured,
  acpAgentUnavailableReason,
  consumeAcpAgentFocus,
  createNamedAcpAgent,
  derivedAcpAgent,
  focusAcpAgent,
  formatAcpAgentArgs,
  migrateAcpAgents,
  normalizeAcpAgent,
  parseAcpAgentArgs,
  parseAcpAgentEnv,
  peekAcpAgentFocus,
  selectableAgentKernel,
  uniqueAcpAgentName,
} from './acpAgent'

const t = (zh: string, en: string) => `${zh}/${en}`

describe('acpAgent', () => {
  it('requires a command before the Agent is selectable', () => {
    expect(normalizeAcpAgent({ command: '  ' })).toBeUndefined()
    expect(acpAgentConfigured(undefined)).toBe(false)
    expect(selectableAgentKernel('dsh')).toBe('pi')
    expect(selectableAgentKernel('acp', { command: '/usr/bin/guest' })).toBe('dsh')
  })

  it('parses space-separated and JSON args the same way as DSH ACP args', () => {
    expect(parseAcpAgentArgs('--profile acp')).toEqual(['--profile', 'acp'])
    expect(parseAcpAgentArgs('["--profile","acp"]')).toEqual(['--profile', 'acp'])
    expect(formatAcpAgentArgs(['--profile', 'acp'])).toBe('--profile acp')
  })

  it('drops provider-key env names before settings persist', () => {
    expect(parseAcpAgentEnv('PATH=/usr/bin\nTOKENFLUX_API_KEY=sk-test\nFOO=bar')).toEqual({
      PATH: '/usr/bin',
      FOO: 'bar',
    })
  })

  it('gives bilingual reasons for protocol gaps', () => {
    expect(acpAgentUnavailableReason('ask', t)).toContain('Ask')
    expect(acpAgentUnavailableReason('durable-research', t)).toContain('durable')
    expect(acpAgentUnavailableReason('milksu-workspace', t)).toContain('milksu_workspace')
  })

  it('migrates a single acp_agent into a named list', () => {
    const migrated = migrateAcpAgents({
      acp_agent: { command: '/usr/bin/guest', args: ['--stdio'] },
    })
    expect(migrated.agents).toEqual([{
      id: 'agt_legacy',
      name: 'Agent',
      kind: 'acp',
      command: '/usr/bin/guest',
      args: ['--stdio'],
    }])
    expect(migrated.defaultId).toBe('agt_legacy')
    expect(derivedAcpAgent(migrated.agents, migrated.defaultId)).toEqual({
      command: '/usr/bin/guest',
      args: ['--stdio'],
    })
  })

  it('keeps named agents that have no command yet', () => {
    const agent = createNamedAcpAgent({ kind: 'acp', name: 'ACP' })
    expect(agent.name).toBe('ACP')
    expect(agent.kind).toBe('acp')
    expect(agent.args).toEqual(['--stdio'])
    expect(acpAgentConfigured(agent)).toBe(false)
    expect(uniqueAcpAgentName('ACP', [agent])).toBe('ACP 2')
  })

  it('fills Codex and Claude Code presets with a typical ACP command', () => {
    const codex = createNamedAcpAgent({ kind: 'codex' })
    expect(codex.name).toBe('Codex')
    expect(codex.command).toBe('npx')
    expect(codex.args).toEqual(['-y', '@agentclientprotocol/codex-acp'])
    const claude = createNamedAcpAgent({ kind: 'claude-code' })
    expect(claude.name).toBe('Claude Code')
    expect(claude.command).toBe('npx')
    expect(claude.args).toEqual(['-y', '@agentclientprotocol/claude-agent-acp'])
  })

  it('holds a focus id until settings consumes it', () => {
    focusAcpAgent('agt_1')
    expect(peekAcpAgentFocus()).toBe('agt_1')
    expect(consumeAcpAgentFocus()).toBe('agt_1')
    expect(peekAcpAgentFocus()).toBe('')
  })
})
