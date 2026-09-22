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

test('worker source keeps health and Connect path prefix', () => {
  const src = readFileSync(join(root, 'src/worker.ts'), 'utf8')
  assert.match(src, /\/health/)
  assert.match(src, /milksu\.cloud\.v1\.CloudSessionService/)
  assert.match(src, /MigrateCopy/)
  assert.match(src, /owner_token_hash/)
  assert.match(src, /getSandbox/)
  assert.match(src, /export \{ Sandbox \}/)
  assert.match(src, /application\/connect\+json/)
  assert.match(src, /FLAG_END_STREAM/)
  assert.match(src, /session\.snapshot/)
})
