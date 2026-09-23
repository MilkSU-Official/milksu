import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('proto declares CloudSessionService and desktop-aligned event comment', () => {
  const proto = readFileSync(join(root, 'proto/cloud_session.proto'), 'utf8')
  assert.match(proto, /service CloudSessionService/)
  assert.match(proto, /assistant\.delta/)
  assert.match(proto, /MigrateCopy/)
  assert.match(proto, /UpsertCredential/)
})

test('buf.gen.yaml pins Connect remote plugins for es/swift/kotlin', () => {
  const gen = readFileSync(join(root, 'buf.gen.yaml'), 'utf8')
  assert.match(gen, /buf\.build\/bufbuild\/es/)
  assert.match(gen, /buf\.build\/connectrpc\/es/)
  assert.match(gen, /buf\.build\/connectrpc\/swift/)
  assert.match(gen, /buf\.build\/connectrpc\/kotlin/)
  assert.match(gen, /gen\/es/)
  assert.match(gen, /gen\/swift/)
  assert.match(gen, /gen\/kotlin/)
})

test('worker source keeps health and Connect path prefix', () => {
  const src = readFileSync(join(root, 'src/worker.ts'), 'utf8')
  assert.match(src, /\/health/)
  assert.match(src, /milksu\.cloud\.v1\.CloudSessionService/)
  assert.match(src, /MigrateCopy/)
  assert.match(src, /owner_token_hash/)
  assert.match(src, /accountOwnerFromPayload|assertAccount/)
  assert.match(src, /D1 not bound/)
  assert.match(src, /getSandbox/)
  assert.match(src, /application\/connect\+json/)
  assert.match(src, /FLAG_END_STREAM/)
  assert.match(src, /session\.snapshot/)
  assert.match(src, /execStream|parseSSEStream|turn-runner/)
  assert.match(src, /ENCRYPT|encryptCredentialSecret|CREDENTIAL_KEK/)
  assert.match(src, /session-store|loadSession|d1LoadSession/)
  assert.match(src, /SUBSCRIBE_WINDOW_MS/)
  assert.match(src, /assistant\.thinking_delta/)
  assert.match(src, /turn\.settled/)
  assert.match(src, /after_event_id/)
  const entry = readFileSync(join(root, 'src/index.ts'), 'utf8')
  assert.match(entry, /export \{ Sandbox \}/)
  assert.match(entry, /from '\.\/worker\.ts'/)
})
