import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import test from 'node:test'
import {
  archiveCompanionFile,
  deleteCompanionArchive,
  findCompanionSessionFile,
  listCompanionArchives,
  readTranscriptPage,
} from './jsonl.ts'

async function writeCompanionJsonl(dir: string, lines: string[]): Promise<string> {
  const sessionDir = join(dir, 'sessions')
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  const path = join(sessionDir, '2026-01-01T00-00-00-000Z_companion.jsonl')
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 })
  return path
}

test('transcript reads tail, walks cursors, and archives in a temp directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-companion-jsonl-'))
  const lines = [
    '{"type":"session","id":"companion","timestamp":"2026-01-01T00:00:00Z"}',
    '{"type":"message","id":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"one"}]}}',
    '{"type":"message","id":"a2","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"two"}]}}',
    '{"type":"message","id":"a3","timestamp":"2026-01-01T00:00:03Z","message":{"role":"user","content":[{"type":"text","text":"three"}]}}',
    '{"type":"message","id":"a4","timestamp":"2026-01-01T00:00:04Z","message":{"role":"assistant","content":[{"type":"text","text":"four"}]}}',
  ]
  const path = await writeCompanionJsonl(dir, lines)
  const found = await findCompanionSessionFile(dir)
  assert.equal(found, path)

  const tail = await readTranscriptPage(path, 2, null, true)
  assert.equal(tail.entries.length, 2)
  assert.equal(tail.entries[0]?.id, 'a3')
  assert.equal(tail.entries[1]?.id, 'a4')
  assert.ok(tail.prevCursor)

  const older = await readTranscriptPage(path, 2, tail.prevCursor, true)
  assert.equal(older.entries.length, 2)
  assert.equal(older.entries[0]?.id, 'a1')
  assert.equal(older.entries[1]?.id, 'a2')
  assert.ok(older.nextCursor)

  const newer = await readTranscriptPage(path, 2, older.nextCursor, false)
  assert.equal(newer.entries[0]?.id, 'a3')

  const archived = await archiveCompanionFile(dir, path)
  assert.ok(archived.name.endsWith('.jsonl'))
  assert.equal(archived.exportable, true)
  const listed = await listCompanionArchives(dir)
  assert.equal(listed.length, 1)
  await deleteCompanionArchive(dir, archived.name)
  const after = await listCompanionArchives(dir)
  assert.equal(after.length, 0)
  await assert.rejects(() => deleteCompanionArchive(dir, '../escape.jsonl'), /invalid companion archive name/)
})

test('transcript keeps assistant errors and skips session rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-companion-jsonl-err-'))
  const lines = [
    '{"type":"session","id":"companion","timestamp":"2026-01-01T00:00:00Z"}',
    '{"type":"model_change","id":"m1","timestamp":"2026-01-01T00:00:00Z","provider":"tokenflux"}',
    '{"type":"message","id":"u1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}',
    '{"type":"message","id":"a1","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"403: group does not support the model"}}',
  ]
  const path = await writeCompanionJsonl(dir, lines)
  const page = await readTranscriptPage(path, 10, null, true)
  assert.equal(page.entries.some((entry) => entry.id === 'm1'), false)
  const assistant = page.entries.find((entry) => entry.id === 'a1')
  assert.ok(assistant)
  assert.equal(assistant.error, '403: group does not support the model')
})
