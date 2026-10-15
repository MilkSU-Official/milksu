import assert from 'node:assert/strict'
import test from 'node:test'
import { DarwinKeychainSecretStore } from './keychain.ts'

test('DarwinKeychainSecretStore.available reflects the native addon', async () => {
  const store = new DarwinKeychainSecretStore()
  assert.equal(typeof store.available(), 'boolean')
  if (store.available()) return
  await assert.rejects(() => store.get('provider:test'), /unavailable/)
})
