import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateAcpAgents, resolveAcpAgent, type PublicSettings } from './settings.ts'
import { sidecarWorkspaceKey } from './sidecar.ts'

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
