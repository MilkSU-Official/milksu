import assert from 'node:assert/strict'
import test from 'node:test'

import { desktopAccountConfigFromEnvironment } from '../../scripts/lib/desktop-account-config.mjs'

test('seals the production Cloudflare account origin by default', () => {
  assert.deepEqual(desktopAccountConfigFromEnvironment({}), {
    apiUrl: 'https://accounts.milksu.org',
  })
})

test('allows one credential-free HTTPS account origin override', () => {
  assert.deepEqual(desktopAccountConfigFromEnvironment({
    MILKSU_ACCOUNT_API_URL: 'https://account.example.test/',
  }), {
    apiUrl: 'https://account.example.test',
  })
})

test('rejects insecure or credential-bearing account origins', () => {
  assert.throws(() => desktopAccountConfigFromEnvironment({
    MILKSU_ACCOUNT_API_URL: 'http://account.example.test',
  }), /HTTPS URL/u)
  assert.throws(() => desktopAccountConfigFromEnvironment({
    MILKSU_ACCOUNT_API_URL: 'https://user:password@account.example.test',
  }), /credential-free/u)
})
