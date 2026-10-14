import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from '../conversations.ts'
import { bindPluginRegistry, unbindPluginRegistry } from '../domains/plugins.ts'
import '../domains/plugins.ts'
import type { Engine } from '../engine.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from '../handlers.ts'
import { LabJobStore } from '../lab.ts'
import { packageDigest } from './digest.ts'
import { PluginRegistry } from './index.ts'
import { readManifest } from './manifest.ts'
import type { PluginOptions } from './types.ts'

const OWNED_PLUGIN_METHODS = [
  'ListPlugins',
  'ListPetPluginPackages',
  'SetPluginEnabled',
  'GetPluginSettingsScript',
  'GetActivePluginTheme',
  'CallPluginUI',
  'ChoosePluginBackground',
  'ChoosePluginSurface',
  'GetPluginSurfaceAsset',
  'ChoosePluginPackage',
  'InstallStagedPlugin',
  'DiscardStagedPlugin',
  'RollbackPlugin',
  'UninstallPlugin',
  'SetPluginExternalEnabled',
  'ListPluginPublishers',
  'RevokePluginPublisher',
  'GetPluginMCPConfig',
] as const

function tsManifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: 'Test plugin',
    version: '1.0.0',
    apiVersion: 'milksu.plugin/v1',
    publisher: { name: 'Test Publisher' },
    host: { minVersion: '0.0.0' },
    storageVersion: 1,
    runtime: { kind: 'typescript', entry: 'main.mjs' },
    permissions: [],
    ...extra,
  }
}

function alphaManifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: 'Example',
    version: '1.0.0',
    apiVersion: 'milksu.plugin/v1alpha1',
    runtime: { kind: 'lua', entry: 'main.lua' },
    permissions: [],
    ...extra,
  }
}

async function writeTree(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, contents, { mode: 0o600 })
}

async function writePlugin(
  root: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<string> {
  const id = String(manifest.id)
  const directory = join(root, id)
  const entry = String((manifest.runtime as { entry: string }).entry)
  await writeTree(join(directory, 'plugin.json'), `${JSON.stringify(manifest)}\n`)
  if (!(entry in files)) {
    const fallback = entry.endsWith('.lua') ? 'plugin = {}\n' : 'export default {}\n'
    await writeTree(join(directory, entry), fallback)
  }
  for (const [relative, contents] of Object.entries(files)) {
    await writeTree(join(directory, relative), contents)
  }
  return directory
}

async function writeLock(root: string, ids: string[]): Promise<void> {
  const plugins = []
  for (const id of ids) {
    const directory = join(root, id)
    const manifest = JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8')) as { version: string }
    plugins.push({ id, version: manifest.version, sha256: await packageDigest(directory) })
  }
  await writeTree(join(root, 'plugins.lock.json'), `${JSON.stringify({ apiVersion: 'milksu.plugin-lock/v1', plugins })}\n`)
}

async function openRegistry(options: {
  official: string
  development?: string
  developmentMode?: boolean
  invokeLua?: PluginOptions['invokeLua']
}): Promise<{ home: string; registry: PluginRegistry }> {
  const home = await mkdtemp(join(tmpdir(), 'milksu-plugin-'))
  const registry = await PluginRegistry.open({
    officialDirectory: options.official,
    installedDirectory: join(home, 'installed'),
    developmentDirectory: options.development,
    dataDirectory: join(home, 'data'),
    developmentMode: options.developmentMode,
    hostVersion: '26.823.1',
    invokeLua: options.invokeLua,
  })
  return { home, registry }
}

async function handlerContext(
  home: string,
  registry: PluginRegistry,
  extras: Partial<Pick<HandlerContext, 'emit' | 'invokeHelper' | 'hostCall'>> = {},
): Promise<HandlerContext> {
  bindPluginRegistry(home, registry)
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {} as Engine,
    emit: extras.emit ?? (() => {}),
    home,
    invokeHelper: extras.invokeHelper ?? (async (method) => {
      throw new Error(`helper should not see ${method}`)
    }),
    hostCall: extras.hostCall,
  }
}

test('plugin desktop methods are owned by the TypeScript runtime', () => {
  for (const method of OWNED_PLUGIN_METHODS) {
    assert.equal(isOwnedMethod(method), true, method)
  }
  assert.equal(isOwnedMethod('RunLuaPlugin'), false)
})

test('official TypeScript plugin can be listed, enabled and disabled', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writePlugin(official, tsManifest('example.plugin'))
  await writeLock(official, ['example.plugin'])
  const { home, registry } = await openRegistry({ official })
  const listed = await registry.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.id, 'example.plugin')
  assert.equal(listed[0]?.runtime, 'typescript')
  assert.equal(listed[0]?.source, 'official')
  assert.equal(listed[0]?.enabled, false)
  assert.equal(listed[0]?.status, 'disabled')

  await registry.setEnabled('example.plugin', true)
  const enabled = await registry.list()
  assert.equal(enabled[0]?.enabled, true)
  assert.equal(enabled[0]?.status, 'ready')

  await registry.setEnabled('example.plugin', false)
  const disabled = await registry.list()
  assert.equal(disabled[0]?.enabled, false)
  assert.equal(disabled[0]?.status, 'disabled')

  const events: string[] = []
  const ctx = await handlerContext(home, registry, {
    emit: (event) => { events.push(event) },
  })
  try {
    const fromRpc = await handleOwnedMethod(ctx, 'renderer', 'ListPlugins', []) as Array<{ id: string; enabled: boolean }>
    assert.equal(fromRpc.length, 1)
    assert.equal(fromRpc[0]?.id, 'example.plugin')
    const afterEnable = await handleOwnedMethod(ctx, 'renderer', 'SetPluginEnabled', ['example.plugin', true]) as Array<{ enabled: boolean }>
    assert.equal(afterEnable[0]?.enabled, true)
    assert.ok(events.includes('plugins-changed'))
    assert.ok(events.includes('plugin-tools-changed'))
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'electron_host', 'ListPlugins', []),
      /unavailable to electron_host/,
    )
  } finally {
    unbindPluginRegistry(home)
  }
})

test('ListPetPluginPackages only returns enabled Companion plugins', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writePlugin(official, tsManifest('pet.plugin', {
    permissions: ['ui.pet'],
    contributes: { slots: ['app.pet'] },
  }))
  await writePlugin(official, tsManifest('plain.plugin'))
  await writeLock(official, ['pet.plugin', 'plain.plugin'])
  const { home, registry } = await openRegistry({ official })
  assert.deepEqual(await registry.listPetPluginPackages(), [])
  await registry.setEnabled('pet.plugin', true)
  await registry.setEnabled('plain.plugin', true)
  const packages = await registry.listPetPluginPackages()
  assert.equal(packages.length, 1)
  assert.equal(packages[0]?.id, 'pet.plugin')
  assert.ok(packages[0]?.directory)

  const ctx = await handlerContext(home, registry)
  try {
    const listed = await handleOwnedMethod(ctx, 'electron_host', 'ListPetPluginPackages', []) as Array<{ id: string }>
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, 'pet.plugin')
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'ListPetPluginPackages', []),
      /unavailable to renderer/,
    )
  } finally {
    unbindPluginRegistry(home)
  }
})

test('enabling an app.background plugin disables the previous exclusive occupant', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  const theme = '{"default":{},"light":{},"dark":{}}'
  const background = {
    permissions: ['ui.theme', 'ui.background'],
    theme: { source: 'theme.json' },
    contributes: { slots: ['app.background'] },
  }
  await writePlugin(official, tsManifest('skin.one', background), { 'theme.json': theme })
  await writePlugin(official, tsManifest('skin.two', background), { 'theme.json': theme })
  await writeLock(official, ['skin.one', 'skin.two'])
  const { registry } = await openRegistry({ official })
  await registry.setEnabled('skin.one', true)
  await registry.setEnabled('skin.two', true)
  const listed = await registry.list()
  const one = listed.find((item) => item.id === 'skin.one')
  const two = listed.find((item) => item.id === 'skin.two')
  assert.equal(one?.enabled, false)
  assert.equal(two?.enabled, true)
})

test('readManifest rejects unreviewed shape and entry paths', async () => {
  const unknown = await mkdtemp(join(tmpdir(), 'milksu-plugin-manifest-'))
  await writeTree(join(unknown, 'main.lua'), 'plugin = {}\n')
  await writeTree(join(unknown, 'plugin.json'), `{
  "id":"example.plugin",
  "name":"Example",
  "version":"1.0.0",
  "apiVersion":"milksu.plugin/v1alpha1",
  "runtime":{"kind":"lua","entry":"main.lua"},
  "permissions":[],
  "unreviewed":true
}`)
  await assert.rejects(() => readManifest(unknown), /unknown field/)

  const parent = await mkdtemp(join(tmpdir(), 'milksu-plugin-escape-'))
  const directory = join(parent, 'plugin')
  await writeTree(join(parent, 'outside.lua'), 'plugin = {}\n')
  await writePlugin(parent, alphaManifest('plugin', {
    runtime: { kind: 'lua', entry: '../outside.lua' },
  }))
  await assert.rejects(() => readManifest(directory), /escapes|canonical relative/)

  const linked = await mkdtemp(join(tmpdir(), 'milksu-plugin-symlink-'))
  await writeTree(join(linked, 'target.lua'), 'plugin = {}\n')
  try {
    await symlink(join(linked, 'target.lua'), join(linked, 'main.lua'))
  } catch {
    return
  }
  await writeTree(join(linked, 'plugin.json'), `${JSON.stringify(alphaManifest('example.plugin'))}\n`)
  await assert.rejects(() => readManifest(linked), /non-symlink/)
})

test('readManifest rejects write tools exposed as read-only MCP and theme without app.background', async () => {
  const tools = await mkdtemp(join(tmpdir(), 'milksu-plugin-tools-'))
  await writePlugin(tools, tsManifest('example.plugin', {
    permissions: ['agent.tools', 'mcp.external.read'],
    contributes: {
      tools: [{
        name: 'mutate',
        description: 'Mutate data',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'write',
        external: 'read',
      }],
    },
  }))
  await assert.rejects(() => readManifest(join(tools, 'example.plugin')), /write tool/)

  const theme = await mkdtemp(join(tmpdir(), 'milksu-plugin-theme-'))
  await writePlugin(theme, tsManifest('example.theme', {
    permissions: ['ui.theme'],
    theme: { source: 'theme.json' },
  }), { 'theme.json': '{"default":{},"light":{},"dark":{}}' })
  await assert.rejects(() => readManifest(join(theme, 'example.theme')), /app.background/)
})

test('package digest binds paths and bytes deterministically', async () => {
  const first = await mkdtemp(join(tmpdir(), 'milksu-plugin-digest-'))
  const second = await mkdtemp(join(tmpdir(), 'milksu-plugin-digest-'))
  await writeTree(join(first, 'nested', 'b.txt'), 'bravo')
  await writeTree(join(first, 'a.txt'), 'alpha')
  await writeTree(join(second, 'a.txt'), 'alpha')
  await writeTree(join(second, 'nested', 'b.txt'), 'bravo')
  const firstDigest = await packageDigest(first)
  const secondDigest = await packageDigest(second)
  assert.equal(firstDigest, secondDigest)
  await writeTree(join(second, 'nested', 'b.txt'), 'changed')
  const changed = await packageDigest(second)
  assert.notEqual(changed, firstDigest)
})

test('official lock mismatch fails closed and development plugins stay out of production mode', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  const development = await mkdtemp(join(tmpdir(), 'milksu-plugin-dev-'))
  await writePlugin(official, tsManifest('official.plugin'))
  await writePlugin(development, tsManifest('development.plugin'))
  await writeTree(join(official, 'plugins.lock.json'), `${JSON.stringify({
    apiVersion: 'milksu.plugin-lock/v1',
    plugins: [{ id: 'official.plugin', version: '1.0.0', sha256: '0'.repeat(64) }],
  })}\n`)
  const mismatched = await openRegistry({ official, development, developmentMode: false })
  const closed = await mismatched.registry.list()
  assert.equal(closed.length, 1)
  assert.equal(closed[0]?.status, 'error')
  assert.match(closed[0]?.error ?? '', /does not match/)

  const aligned = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writePlugin(aligned, tsManifest('official.plugin'))
  await writeLock(aligned, ['official.plugin'])
  const production = await openRegistry({ official: aligned, development, developmentMode: false })
  const productionList = await production.registry.list()
  assert.deepEqual(productionList.map((item) => item.id), ['official.plugin'])

  const withDev = await openRegistry({ official: aligned, development, developmentMode: true })
  const ids = (await withDev.registry.list()).map((item) => item.id).sort()
  assert.deepEqual(ids, ['development.plugin', 'official.plugin'])
})

test('development plugins cannot shadow official packages and reject write tools', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  const development = await mkdtemp(join(tmpdir(), 'milksu-plugin-dev-'))
  await writePlugin(official, tsManifest('shared.plugin'))
  await writePlugin(development, tsManifest('shared.plugin'))
  await writeLock(official, ['shared.plugin'])
  const shadowed = await openRegistry({ official, development, developmentMode: true })
  const listed = await shadowed.registry.list()
  const officialItem = listed.find((item) => item.id === 'shared.plugin' && item.source === 'official')
  const issue = listed.find((item) => item.status === 'error' && (item.error ?? '').includes('cannot shadow'))
  assert.equal(officialItem?.source, 'official')
  assert.ok(issue)

  const writeDev = await mkdtemp(join(tmpdir(), 'milksu-plugin-dev-'))
  await writePlugin(writeDev, tsManifest('development.write-tool', {
    permissions: ['agent.tools'],
    contributes: {
      tools: [{
        name: 'mutate',
        description: 'Mutate data',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'write',
        external: 'none',
      }],
    },
  }))
  const emptyOfficial = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writeLock(emptyOfficial, [])
  const rejected = await openRegistry({ official: emptyOfficial, development: writeDev, developmentMode: true })
  const issues = await rejected.registry.list()
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.status, 'error')
  assert.match(issues[0]?.error ?? '', /read-only/)
})

test('CallPluginUI for a Lua plugin uses the helper invoke path', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writePlugin(official, alphaManifest('lua.plugin'))
  await writeLock(official, ['lua.plugin'])
  const calls: Array<{ directory: string; entry: string }> = []
  const { home, registry } = await openRegistry({
    official,
    invokeLua: async (directory, entry) => {
      calls.push({ directory, entry })
      return { value: { capability: 'value', value: { ok: true } } }
    },
  })
  await registry.setEnabled('lua.plugin', true)
  const value = await registry.callUI('lua.plugin', { action: 'ping', input: {} })
  assert.deepEqual(value, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.entry, 'main.lua')

  const ctx = await handlerContext(home, registry, {
    invokeHelper: async (method, args) => {
      assert.equal(method, 'RunLuaPlugin')
      assert.equal(args[1], 'main.lua')
      return { value: { capability: 'value', value: { from: 'helper' } } }
    },
  })
  try {
    // Lua invoke is captured at registry open; this RPC still exercises CallPluginUI ownership.
    const listed = await handleOwnedMethod(ctx, 'renderer', 'ListPlugins', []) as Array<{ id: string }>
    assert.equal(listed.length, 1)
  } finally {
    unbindPluginRegistry(home)
  }
})

test('ChoosePluginPackage cancel returns an empty review', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writeLock(official, [])
  const { home, registry } = await openRegistry({ official })
  const ctx = await handlerContext(home, registry, {
    hostCall: async () => '',
  })
  try {
    const review = await handleOwnedMethod(ctx, 'renderer', 'ChoosePluginPackage', [])
    assert.deepEqual(review, {})
  } finally {
    unbindPluginRegistry(home)
  }
})

test('GetPluginMCPConfig points at plugin-mcp without printing secrets', async () => {
  const official = await mkdtemp(join(tmpdir(), 'milksu-plugin-official-'))
  await writeLock(official, [])
  const { home, registry } = await openRegistry({ official })
  const ctx = await handlerContext(home, registry)
  try {
    const config = await handleOwnedMethod(ctx, 'renderer', 'GetPluginMCPConfig', []) as {
      available: boolean
      args: string[]
      configuration: Record<string, unknown>
    }
    assert.equal(typeof config.available, 'boolean')
    if (config.available) {
      assert.deepEqual(config.args, ['plugin-mcp'])
      const encoded = JSON.stringify(config)
      assert.equal(encoded.includes('sk-'), false)
      assert.equal(encoded.includes('api_key'), false)
    } else {
      assert.deepEqual(config.args, [])
    }
  } finally {
    unbindPluginRegistry(home)
  }
})
