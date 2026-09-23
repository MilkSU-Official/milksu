/**
 * Local Worker integration tests (no Cloudflare account required).
 *
 * Exercises Connect-JSON against the Worker fetch handler with an in-memory
 * session store and a stub /v1/account. Run:
 *
 *   cd cloud/agent && npm test
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryClear, memoryGet } from './session-store.ts'
import { hashOwnerSubject } from './account-owner.ts'
import worker from './worker.ts'

const ACCOUNT_BASE = 'https://accounts.test.milksu'

function accountFetch(login = 'hunter', id) {
  return async (input) => {
    const url = String(input)
    if (url === `${ACCOUNT_BASE}/v1/account`) {
      return new Response(JSON.stringify({
        account: id
          ? { id, githubLogin: login, displayName: login }
          : { githubLogin: login, displayName: login },
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
}

async function call(method, body, token, env = {}) {
  const request = new Request(
    `https://agent.test/milksu.cloud.v1.CloudSessionService/${method}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  )
  const res = await worker.fetch(request, {
    ACCOUNT_API_URL: ACCOUNT_BASE,
    ...env,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

test.beforeEach(() => {
  memoryClear()
})

test('ownership survives access-token rotation for the same github login', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter')
  try {
    const created = await call('CreateSession', { title: 't1', kernel: 'pi' }, 'token-A')
    assert.equal(created.status, 200)
    const sessionId = String(created.json.id)
    assert.ok(sessionId)

    const listed = await call('ListSessions', {}, 'token-B-rotated')
    assert.equal(listed.status, 200)
    const sessions = listed.json.sessions
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].id, sessionId)

    const expectedOwner = await hashOwnerSubject('github:hunter')
    assert.equal(memoryGet(sessionId)?.owner_token_hash, expectedOwner)
  } finally {
    globalThis.fetch = previous
  }
})

test('different accounts cannot read each other sessions', async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = accountFetch('alice')
    const created = await call('CreateSession', { title: 'alice' }, 'tok-alice')
    const sessionId = String(created.json.id)

    globalThis.fetch = accountFetch('bob')
    const get = await call('GetSession', { session_id: sessionId }, 'tok-bob')
    assert.equal(get.status, 404)
  } finally {
    globalThis.fetch = previous
  }
})

test('MigrateCopy leaves migrating status until Finalize', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter')
  try {
    const copied = await call('MigrateCopy', {
      transcript_json: '[{"role":"user","content":"hi"}]',
      title: 'from-local',
    }, 'tok')
    assert.equal(copied.status, 200)
    assert.equal(copied.json.ok, true)
    const targetId = String(copied.json.target_session_id)
    assert.equal(memoryGet(targetId)?.status, 'migrating')

    const finalized = await call('MigrateFinalize', { target_session_id: targetId }, 'tok')
    assert.equal(finalized.status, 200)
    assert.equal(finalized.json.ok, true)
    assert.equal(memoryGet(targetId)?.status, 'ready')
  } finally {
    globalThis.fetch = previous
  }
})

test('UpsertCredential refuses without D1 even when KEK is set', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter')
  try {
    const res = await call(
      'UpsertCredential',
      { label: 'relay', base_url: 'https://example', api_key: 'sk-secret' },
      'tok',
      { CREDENTIAL_KEK: 'test-kek-material' },
    )
    assert.equal(res.status, 503)
    assert.match(String(res.json.message || ''), /D1 not bound/)
    assert.equal(res.json.id, undefined)
  } finally {
    globalThis.fetch = previous
  }
})

test('UpsertCredential refuses without CREDENTIAL_KEK', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter')
  try {
    const res = await call(
      'UpsertCredential',
      { api_key: 'sk-secret' },
      'tok',
    )
    assert.equal(res.status, 503)
    assert.match(String(res.json.message || ''), /CREDENTIAL_KEK/)
  } finally {
    globalThis.fetch = previous
  }
})

test('account.id subject is preferred over githubLogin', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter', 'acct_99')
  try {
    const created = await call('CreateSession', { title: 'id-owner' }, 'tok')
    const sessionId = String(created.json.id)
    const expected = await hashOwnerSubject('id:acct_99')
    assert.equal(memoryGet(sessionId)?.owner_token_hash, expected)
  } finally {
    globalThis.fetch = previous
  }
})

test('SendTurn persists transcript and GetSession returns it', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = accountFetch('hunter')
  try {
    const created = await call('CreateSession', { title: '' }, 'tok')
    const sessionId = String(created.json.id)
    const turn = await call('SendTurn', { session_id: sessionId, text: 'hello cloud' }, 'tok')
    assert.equal(turn.status, 200)
    assert.ok(turn.json.turn_id)

    const got = await call('GetSession', { session_id: sessionId }, 'tok')
    assert.equal(got.status, 200)
    assert.equal(got.json.title, 'hello cloud')
    const transcript = JSON.parse(String(got.json.transcript_json || '[]'))
    assert.equal(transcript.length, 2)
    assert.equal(transcript[0].role, 'user')
    assert.equal(transcript[0].content, 'hello cloud')
    assert.equal(transcript[1].role, 'assistant')
    assert.match(String(transcript[1].content), /Sandbox|沙箱/)
    // ListSessions stays lean (no transcript_json).
    const listed = await call('ListSessions', {}, 'tok')
    assert.equal(listed.json.sessions[0].transcript_json, undefined)
  } finally {
    globalThis.fetch = previous
  }
})
