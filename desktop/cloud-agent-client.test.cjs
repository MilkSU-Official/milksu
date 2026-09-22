'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  ALLOWED_METHODS,
  CloudAgentClient,
  defaultCloudAgentBaseUrl,
} = require('./cloud-agent-client.cjs')

test('defaultCloudAgentBaseUrl rejects non-https and credentials', () => {
  assert.equal(defaultCloudAgentBaseUrl({}), 'https://agent.milksu.org')
  assert.equal(
    defaultCloudAgentBaseUrl({ MILKSU_CLOUD_AGENT_URL: 'https://agent.example.com/' }),
    'https://agent.example.com',
  )
  assert.equal(
    defaultCloudAgentBaseUrl({ MILKSU_CLOUD_AGENT_URL: 'http://insecure.example' }),
    'https://agent.milksu.org',
  )
  assert.equal(
    defaultCloudAgentBaseUrl({ MILKSU_CLOUD_AGENT_URL: 'https://user:pass@agent.example.com' }),
    'https://agent.milksu.org',
  )
})

test('CloudAgentClient posts Connect-JSON with Bearer from getAccessToken', async () => {
  const calls = []
  const client = new CloudAgentClient({
    baseUrl: 'https://agent.example',
    getAccessToken: async () => 'access-secret',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions: [] }),
      }
    },
  })
  const result = await client.call('ListSessions', {})
  assert.deepEqual(result, { sessions: [] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://agent.example/milksu.cloud.v1.CloudSessionService/ListSessions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer access-secret')
  assert.equal(calls[0].init.headers['connect-protocol-version'], '1')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
})

test('CloudAgentClient rejects unknown methods and missing token', async () => {
  const client = new CloudAgentClient({
    baseUrl: 'https://agent.example',
    getAccessToken: async () => '',
    fetchImpl: async () => {
      throw new Error('fetch should not run')
    },
  })
  await assert.rejects(() => client.call('NotAMethod', {}), /not allowed/)
  await assert.rejects(() => client.call('ListSessions', {}), /signed-in/)
})

test('ALLOWED_METHODS covers migrate and credential surface', () => {
  assert.ok(ALLOWED_METHODS.includes('MigrateCopy'))
  assert.ok(ALLOWED_METHODS.includes('MigrateFinalize'))
  assert.ok(ALLOWED_METHODS.includes('UpsertCredential'))
  assert.ok(!ALLOWED_METHODS.includes('Subscribe'))
})
