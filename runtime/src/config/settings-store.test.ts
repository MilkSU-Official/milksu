import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import '../domains/settings.ts'
import { handleOwnedMethod, type HandlerContext } from '../handlers.ts'
import { ConversationStore } from '../conversations.ts'
import { LabJobStore } from '../lab.ts'
import { DarwinKeychainSecretStore } from '../native/keychain.ts'
import { SettingsStore } from './settings-store.ts'
import { MemorySecretStore, SqliteSecretStore } from './secret-store.ts'
import { PRESET_DEEPSEEK_SERVICE_ID, TOKENFLUX_ACCOUNT_URL } from './settings-store.ts'

const FAKE_KEY = 'sk-test-settings-secret'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-settings-store-'))
}

async function handlerContext(home: string, store: SettingsStore): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {} as HandlerContext['engine'],
    emit: () => {},
    home,
    settings: store,
  }
}

test('Save keeps api_key out of settings.json and in sqlite; GetSettings strips it', async () => {
  const home = await tempHome()
  const store = await SettingsStore.open({ home, platform: 'linux' })
  const settings = store.get()
  settings.providers = settings.providers ?? {}
  settings.providers[PRESET_DEEPSEEK_SERVICE_ID] = {
    ...settings.providers[PRESET_DEEPSEEK_SERVICE_ID],
    api_key: FAKE_KEY,
    enabled: true,
  }
  await store.save(settings)

  const json = await readFile(join(home, 'config', 'settings.json'), 'utf8')
  assert.equal(json.includes(FAKE_KEY), false)
  assert.match(json, /"has_api_key": true/)

  const publicSettings = store.get()
  assert.equal(publicSettings.providers?.[PRESET_DEEPSEEK_SERVICE_ID]?.api_key, undefined)
  assert.equal(publicSettings.providers?.[PRESET_DEEPSEEK_SERVICE_ID]?.has_api_key, true)
  assert.equal(JSON.stringify(publicSettings).includes(FAKE_KEY), false)

  const db = new DatabaseSync(join(home, 'config', 'credentials.db'))
  try {
    const row = db.prepare('SELECT secret FROM credentials WHERE account = ?').get(
      `provider:${PRESET_DEEPSEEK_SERVICE_ID}`,
    ) as { secret?: string } | undefined
    assert.equal(Boolean(row && row.secret === FAKE_KEY), true)
  } finally {
    db.close()
  }

  const env = store.exportSidecarEnvironment()
  assert.ok(env.includes(`DEEPSEEK_API_KEY=${FAKE_KEY}`))
  assert.equal(env.some((entry) => entry.startsWith('HOME=') || entry.startsWith('PATH=')), false)
})

test('renderer cannot SetAccountModelCredential; electron_host can and json stays clean', async () => {
  const home = await tempHome()
  const store = await SettingsStore.open({
    home,
    secrets: new MemorySecretStore(),
    platform: 'linux',
  })
  const ctx = await handlerContext(home, store)

  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'SetAccountModelCredential', [
      TOKENFLUX_ACCOUNT_URL,
      FAKE_KEY,
    ]),
    /unavailable to renderer/,
  )

  const denied = store.get()
  assert.equal(denied.relay?.has_key, undefined)

  await handleOwnedMethod(ctx, 'electron_host', 'SetAccountModelCredential', [
    TOKENFLUX_ACCOUNT_URL,
    FAKE_KEY,
  ])
  const got = store.get()
  assert.equal(got.relay?.has_key, true)
  assert.equal(got.relay?.key, undefined)
  assert.equal(got.relay?.url, TOKENFLUX_ACCOUNT_URL)
  assert.equal(JSON.stringify(got).includes(FAKE_KEY), false)
  assert.equal(store.getResolved().relay?.key === FAKE_KEY, true)

  got.active_provider = 'tokenflux'
  got.active_model = 'x-ai/grok-4.6'
  await store.save(got)

  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'ExportSidecarEnvironment', []),
    /unavailable to renderer/,
  )
  const exported = await handleOwnedMethod(ctx, 'electron_host', 'ExportSidecarEnvironment', []) as string[]
  assert.equal(exported.includes(`MILKSU_RELAY_KEY=${FAKE_KEY}`), true)
  assert.equal(JSON.stringify(store.get()).includes(FAKE_KEY), false)
})

test('SaveSettingsCmd emits settings-changed with the public copy', async () => {
  const home = await tempHome()
  const store = await SettingsStore.open({
    home,
    secrets: new MemorySecretStore(),
    platform: 'linux',
  })
  const events: Array<{ name: string; payload: unknown }> = []
  const ctx = await handlerContext(home, store)
  ctx.emit = (name, payload) => { events.push({ name, payload }) }
  const next = store.get()
  next.acp_agent = { command: '/usr/bin/dsh', args: ['acp'] }
  await handleOwnedMethod(ctx, 'renderer', 'SaveSettingsCmd', [next])
  const changed = events.filter((item) => item.name === 'settings-changed')
  assert.equal(changed.length, 1)
  const payload = changed[0]?.payload as { acp_agent?: { command?: string } }
  assert.equal(payload.acp_agent?.command, '/usr/bin/dsh')
})

test('GetSettings handler returns public copy without keys', async () => {
  const home = await tempHome()
  const secrets = await SqliteSecretStore.open(join(home, 'config', 'credentials.db'))
  const store = await SettingsStore.open({ home, secrets, platform: 'linux' })
  const settings = store.get()
  settings.providers = settings.providers ?? {}
  settings.providers[PRESET_DEEPSEEK_SERVICE_ID] = {
    ...settings.providers[PRESET_DEEPSEEK_SERVICE_ID],
    api_key: FAKE_KEY,
    enabled: true,
  }
  await store.save(settings)

  const ctx = await handlerContext(home, store)
  const got = await handleOwnedMethod(ctx, 'renderer', 'GetSettings', []) as Record<string, unknown>
  const providers = got.providers as Record<string, Record<string, unknown>>
  assert.equal(providers[PRESET_DEEPSEEK_SERVICE_ID].api_key, undefined)
  assert.equal(providers[PRESET_DEEPSEEK_SERVICE_ID].has_api_key, true)
  assert.equal(JSON.stringify(got).includes(FAKE_KEY), false)
})

test('darwin credentials stay out of settings.json; sqlite when keychain addon is missing', async () => {
  const home = await tempHome()
  const account = `provider:${PRESET_DEEPSEEK_SERVICE_ID}`
  const keychain = new DarwinKeychainSecretStore(home)
  const store = await SettingsStore.open({ home, platform: 'darwin' })
  const settings = store.get()
  settings.providers = settings.providers ?? {}
  settings.providers[PRESET_DEEPSEEK_SERVICE_ID] = {
    ...settings.providers[PRESET_DEEPSEEK_SERVICE_ID],
    api_key: FAKE_KEY,
    enabled: true,
  }
  await store.save(settings)
  const json = await readFile(join(home, 'config', 'settings.json'), 'utf8')
  assert.equal(json.includes(FAKE_KEY), false)
  if (keychain.available()) {
    try {
      assert.equal(await keychain.get(account), FAKE_KEY)
    } finally {
      try { await keychain.delete(account) } catch { /* test cleanup */ }
    }
    return
  }
  const db = new DatabaseSync(join(home, 'config', 'credentials.db'))
  try {
    const row = db.prepare('SELECT secret FROM credentials WHERE account = ?').get(
      account,
    ) as { secret?: string } | undefined
    assert.equal(row?.secret, FAKE_KEY)
  } finally {
    db.close()
  }
})

test('settings load migrates acp_guest to acp_agent', async () => {
  const home = await tempHome()
  await mkdir(join(home, 'config'), { recursive: true, mode: 0o700 })
  await writeFile(join(home, 'config', 'settings.json'), `${JSON.stringify({
    active_provider: 'deepseek',
    active_model: 'deepseek-chat',
    acp_guest: { command: '/usr/bin/dsh', args: ['acp'] },
  })}\n`)
  const store = await SettingsStore.open({ home, platform: 'linux' })
  assert.equal(store.get().acp_agent?.command, '/usr/bin/dsh')
  assert.equal(store.get().acp_agents?.[0]?.id, 'agt_legacy')
  assert.equal(store.get().acp_agents?.[0]?.name, 'Agent')
  assert.equal(store.get().default_acp_agent_id, 'agt_legacy')
  assert.equal((store.get() as Record<string, unknown>).acp_guest, undefined)
  const json = await readFile(join(home, 'config', 'settings.json'), 'utf8')
  assert.equal(json.includes('"acp_agent"'), false)
  assert.match(json, /"acp_agents"/)
  assert.equal(json.includes('acp_guest'), false)
})
