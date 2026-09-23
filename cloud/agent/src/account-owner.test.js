import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountOwnerFromPayload,
  hashOwnerSubject,
  resolveAccountSubject,
} from './account-owner.ts'

test('resolveAccountSubject prefers account.id over githubLogin', () => {
  assert.equal(
    resolveAccountSubject({ account: { id: 'acct_1', githubLogin: 'hunter' } }),
    'id:acct_1',
  )
  assert.equal(
    resolveAccountSubject({ account: { githubLogin: 'hunter' } }),
    'github:hunter',
  )
  assert.equal(resolveAccountSubject({ account: {} }), null)
  assert.equal(resolveAccountSubject({}), null)
})

test('ownerKey is stable for the same subject and independent of access tokens', async () => {
  const a = await accountOwnerFromPayload({ account: { githubLogin: 'hunter' } })
  const b = await accountOwnerFromPayload({ account: { githubLogin: 'hunter' } })
  assert.ok(a)
  assert.ok(b)
  assert.equal(a.subject, 'github:hunter')
  assert.equal(a.ownerKey, b.ownerKey)
  assert.equal(a.ownerKey, await hashOwnerSubject('github:hunter'))
  assert.notEqual(a.ownerKey, await hashOwnerSubject('access-token-A'))
})
