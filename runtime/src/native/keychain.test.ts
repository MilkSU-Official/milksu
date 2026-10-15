import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { DarwinKeychainSecretStore, KEYCHAIN_SERVICE, keychainServiceName } from './keychain.ts'

test('keychainServiceName keeps the product home on the default service', () => {
  const userHome = '/Users/nobody'
  assert.equal(keychainServiceName(join(userHome, '.milksu'), userHome), KEYCHAIN_SERVICE)
  const isolated = keychainServiceName('/tmp/milksu-test-home', userHome)
  assert.match(isolated, new RegExp(`^${KEYCHAIN_SERVICE}\\.[0-9a-f]{16}$`))
  assert.notEqual(isolated, KEYCHAIN_SERVICE)
})

test('DarwinKeychainSecretStore.available reflects the native addon', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-keychain-'))
  const store = new DarwinKeychainSecretStore(home)
  assert.equal(typeof store.available(), 'boolean')
  if (store.available()) {
    assert.equal(resolve(home) === resolve(join(homedir(), '.milksu')), false)
    return
  }
  await assert.rejects(() => store.get('provider:test'), /unavailable/)
})
