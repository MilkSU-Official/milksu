import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateAcpAgents, resolveAcpAgent, type PublicSettings } from './settings.ts'
import { buildSidecarEnvironment, isDshAgentCommand, sidecarWorkspaceKey } from './sidecar.ts'

test('migrateAcpAgents copies a single acp_agent into a named list', () => {
  const settings: PublicSettings = {
    acp_agent: { command: '/usr/bin/guest', args: ['--stdio'] },
  }
  const migrated = migrateAcpAgents(settings)
  assert.equal(migrated.agents[0]?.id, 'agt_legacy')
  assert.equal(migrated.agents[0]?.name, 'Agent')
  assert.equal(migrated.defaultId, 'agt_legacy')
  assert.deepEqual(migrated.derived, { command: '/usr/bin/guest', args: ['--stdio'] })
  assert.equal(settings.default_acp_agent_id, 'agt_legacy')
  assert.equal(settings.acp_agent, undefined)
  assert.deepEqual(settings.acp_agents?.[0]?.command, '/usr/bin/guest')
})

test('resolveAcpAgent picks the named agent over the derived default', () => {
  const settings: PublicSettings = {
    acp_agents: [
      { id: 'agt_a', name: 'A', command: '/bin/a' },
      { id: 'agt_b', name: 'B', command: '/bin/b', args: ['--stdio'] },
    ],
    default_acp_agent_id: 'agt_a',
    acp_agent: { command: '/bin/a' },
  }
  const named = resolveAcpAgent(settings, 'agt_b')
  assert.equal(named?.id, 'agt_b')
  assert.equal(named?.agent.command, '/bin/b')
  assert.deepEqual(named?.agent.args, ['--stdio'])
  assert.equal(resolveAcpAgent(settings)?.id, 'agt_a')
})

test('sidecarWorkspaceKey separates ACP agents in the same workspace', () => {
  const workspace = '/workspace/project'
  assert.equal(sidecarWorkspaceKey('pi', workspace), sidecarWorkspaceKey('pi', workspace, 'agt_a'))
  assert.notEqual(
    sidecarWorkspaceKey('dsh', workspace, 'agt_a'),
    sidecarWorkspaceKey('dsh', workspace, 'agt_b'),
  )
})

test('isDshAgentCommand only matches DeepSeek Harness, not Codex or Claude Code', () => {
  assert.equal(isDshAgentCommand('/usr/bin/dsh'), true)
  assert.equal(isDshAgentCommand('node_modules/@deepseek-ai/dsh/lib/bin.js'), true)
  assert.equal(isDshAgentCommand('/usr/local/bin/codex-acp', 'codex'), false)
  assert.equal(isDshAgentCommand('/usr/local/bin/claude-agent-acp', 'claude-code'), false)
  assert.equal(isDshAgentCommand('/usr/local/bin/npx', 'acp'), false)
})

test('ACP sidecar IPC paths differ by agent and do not use the runtime pid', () => {
  const home = '/tmp/milksu-home-unused'
  const workspace = '/tmp'
  const settings: PublicSettings = {
    acp_agents: [
      { id: 'agt_a', name: 'A', kind: 'codex', command: '/bin/codex-acp' },
      { id: 'agt_b', name: 'B', kind: 'claude-code', command: '/bin/claude-agent-acp' },
      { id: 'agt_dsh', name: 'DSH', kind: 'acp', command: '/usr/bin/dsh', args: ['--profile', 'acp'] },
    ],
    default_acp_agent_id: 'agt_a',
  }
  const first = buildSidecarEnvironment({
    home,
    workspace,
    kernel: 'dsh',
    settings,
    agentId: 'agt_a',
    traceId: 'trc_11111111-1111-4111-8111-111111111111',
    env: { PATH: '/usr/bin' },
  })
  const second = buildSidecarEnvironment({
    home,
    workspace,
    kernel: 'dsh',
    settings,
    agentId: 'agt_b',
    traceId: 'trc_11111111-1111-4111-8111-111111111111',
    env: { PATH: '/usr/bin' },
  })
  const dsh = buildSidecarEnvironment({
    home,
    workspace,
    kernel: 'dsh',
    settings,
    agentId: 'agt_dsh',
    traceId: 'trc_11111111-1111-4111-8111-111111111111',
    env: { PATH: '/usr/bin' },
  })
  assert.notEqual(first.MILKSU_DSH_IPC, second.MILKSU_DSH_IPC)
  assert.notEqual(first.MILKSU_DSH_HOST_IPC, second.MILKSU_DSH_HOST_IPC)
  assert.equal(first.MILKSU_DSH_IPC?.includes(String(process.pid)), false)
  assert.equal(first.DSH_HOME, undefined)
  assert.equal(first.MILKSU_ACP_APPLY_DSH_PATCH, undefined)
  assert.equal(first.MILKSU_DSH_ACP_ARGS, undefined)
  assert.equal(dsh.MILKSU_ACP_APPLY_DSH_PATCH, '1')
  assert.ok(dsh.DSH_HOME)
  assert.equal(dsh.MILKSU_DSH_ACP_ARGS, JSON.stringify(['--profile', 'acp']))
})
