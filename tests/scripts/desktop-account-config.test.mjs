import assert from 'node:assert/strict'
import test from 'node:test'

import { desktopAccountConfigFromEnvironment } from '../../scripts/lib/desktop-account-config.mjs'

test('omits account config when no deployment is configured', () => {
  assert.equal(desktopAccountConfigFromEnvironment({}), null)
})

test('seals only complete HTTPS account deployment coordinates', () => {
  assert.deepEqual(desktopAccountConfigFromEnvironment({
    MILKSU_SUPABASE_URL: 'https://example.supabase.co/',
    MILKSU_ACCOUNT_API_URL: 'https://account.example.test/',
    MILKSU_SUPABASE_ANON_KEY: 'public-anon-key',
  }), {
    supabaseUrl: 'https://example.supabase.co',
    apiUrl: 'https://account.example.test',
    supabaseAnonKey: 'public-anon-key',
  })
})

test('rejects partial or insecure account deployment coordinates', () => {
  assert.throws(() => desktopAccountConfigFromEnvironment({
    MILKSU_SUPABASE_URL: 'https://example.supabase.co',
  }), /requires Supabase URL/u)
  assert.throws(() => desktopAccountConfigFromEnvironment({
    MILKSU_SUPABASE_URL: 'http://example.supabase.co',
    MILKSU_ACCOUNT_API_URL: 'https://account.example.test',
    MILKSU_SUPABASE_ANON_KEY: 'public-anon-key',
  }), /HTTPS URL/u)
})
