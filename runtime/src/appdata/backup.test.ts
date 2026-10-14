import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { BACKUP_SCHEMA, exportBackup, validateBackup } from './backup.ts'
import { readZipFile } from './zip.ts'

async function writeFixture(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, contents, { mode: 0o600 })
}

function createBackupDatabase(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(`
      CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO proof(id, value) VALUES (1, 'verified');
    `)
  } finally {
    db.close()
  }
}

test('exportBackup writes a manifest and keeps credentials out of the zip', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-backup-root-'))
  await writeFixture(
    join(root, 'config', 'settings.json'),
    '{"locale":"zh","providers":{"legacy":{"api_key":"legacy-provider-secret","has_api_key":true}}}\n',
  )
  await writeFixture(
    join(root, 'data-layout.json'),
    '{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T00:00:00Z"}\n',
  )
  await writeFixture(join(root, 'data', 'stores', 'conversations', 'one.json'), '{"id":"one"}\n')
  await writeFixture(join(root, 'config', 'credentials.db'), 'provider-secret')
  await writeFixture(join(root, 'workspaces', 'browser', 'bridge-pairing.json'), 'bridge-secret')
  await writeFixture(join(root, 'data', 'agent', 'home', 'pi', 'auth.json'), 'pi-secret')
  await writeFixture(join(root, 'data', 'agent', 'home', 'pi', 'sessions', 'session.jsonl'), 'resume')
  await mkdir(join(root, 'data', 'runtime'), { recursive: true, mode: 0o700 })
  createBackupDatabase(join(root, 'data', 'runtime', 'events.sqlite3'))

  const destination = join(await mkdtemp(join(tmpdir(), 'milksu-backup-out-')), 'MilkSU-backup.zip')
  const exported = await exportBackup(root, destination)
  assert.equal(exported.credentialsIncluded, false)
  assert.equal(exported.fileCount, 5)
  assert.ok(exported.bytes > 0)

  const validation = await validateBackup(destination)
  assert.equal(validation.valid, true)
  assert.equal(validation.schema, BACKUP_SCHEMA)
  assert.equal(validation.credentialsIncluded, false)
  assert.equal(validation.fileCount, exported.fileCount)

  const archive = await readZipFile(destination)
  const names = archive.map((entry) => entry.name).sort()
  for (const required of [
    'data/data-layout.json',
    'data/config/settings.json',
    'data/data/stores/conversations/one.json',
    'data/data/runtime/events.sqlite3',
    'data/data/agent/home/pi/sessions/session.jsonl',
    'manifest.json',
  ]) {
    assert.ok(names.includes(required), `backup is missing ${required}: ${names.join(', ')}`)
  }
  const joined = names.join('\n')
  for (const forbidden of ['credentials.db', 'bridge-pairing.json', 'auth.json']) {
    assert.equal(joined.includes(forbidden), false, `backup leaked ${forbidden}`)
  }

  const manifest = JSON.parse(archive.find((entry) => entry.name === 'manifest.json')!.data.toString('utf8')) as {
    schema: string
    credentialsIncluded: boolean
    files: Array<{ path: string }>
    excluded: string[]
  }
  assert.equal(manifest.schema, BACKUP_SCHEMA)
  assert.equal(manifest.credentialsIncluded, false)
  assert.equal(manifest.files.length, 5)
  assert.ok(manifest.excluded.some((item) => item.includes('API Key')))

  const settings = archive.find((entry) => entry.name === 'data/config/settings.json')!.data.toString('utf8')
  assert.equal(settings.includes('legacy-provider-secret'), false)
  assert.equal(settings.includes('"api_key"'), false)

  const extracted = join(await mkdtemp(join(tmpdir(), 'milksu-backup-db-')), 'events.sqlite3')
  await writeFile(extracted, archive.find((entry) => entry.name === 'data/data/runtime/events.sqlite3')!.data)
  const db = new DatabaseSync(extracted, { readOnly: true })
  try {
    const row = db.prepare('SELECT value FROM proof WHERE id = 1').get() as { value: string }
    assert.equal(row.value, 'verified')
  } finally {
    db.close()
  }
})

test('exportBackup rejects a destination inside the data directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-backup-inside-'))
  await writeFixture(join(root, 'config', 'settings.json'), '{}\n')
  await assert.rejects(
    () => exportBackup(root, join(root, 'backup.zip')),
    /outside/,
  )
})

test('exportBackup includes research artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-backup-research-'))
  await mkdir(join(root, 'data', 'domain', 'research'), { recursive: true, mode: 0o700 })
  createBackupDatabase(join(root, 'data', 'domain', 'research', 'research.sqlite3'))
  const digest = 'a'.repeat(64)
  const artifact = 'persisted source extract'
  await writeFixture(join(root, 'data', 'domain', 'research', 'artifacts', 'research_run_1', digest), artifact)
  const destination = join(await mkdtemp(join(tmpdir(), 'milksu-backup-research-out-')), 'research-backup.zip')
  const exported = await exportBackup(root, destination)
  assert.equal(exported.fileCount, 2)
  await validateBackup(destination)
  const names = (await readZipFile(destination)).map((entry) => entry.name)
  assert.ok(names.includes('data/data/domain/research/research.sqlite3'))
  assert.ok(names.includes(`data/data/domain/research/artifacts/research_run_1/${digest}`))
  const copy = (await readZipFile(destination)).find((entry) => entry.name.endsWith(digest))
  assert.equal(copy?.data.toString('utf8'), artifact)
})
