import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SettingsStore } from './config/settings-store.ts'
import { ConversationStore } from './conversations.ts'
import './domains/resources.ts'
import type { Engine } from './engine.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import {
  AgentResourceStore,
  CATALOG_SCHEMA,
  CodingToolsService,
  MemorySecretKeeper,
  SettingsSecretKeeper,
} from './agentresources/index.ts'

async function tempData(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-agentresources-'))
}

async function openStore(data?: string, secrets = new MemorySecretKeeper(), factory = ''): Promise<{
  data: string
  store: AgentResourceStore
  secrets: MemorySecretKeeper
}> {
  const directory = data ?? await tempData()
  const store = await AgentResourceStore.open(directory, secrets, factory)
  return { data: directory, store, secrets: secrets as MemorySecretKeeper }
}

async function writeSkill(root: string, name: string, body: string, extra?: Record<string, string>): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, 'SKILL.md'), body, { mode: 0o600 })
  for (const [relative, content] of Object.entries(extra ?? {})) {
    const path = join(dir, relative)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, content, { mode: 0o600 })
  }
  return dir
}

async function handlerContext(store: AgentResourceStore, home: string, hostCall?: HandlerContext['hostCall']): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {} as Engine,
    emit: () => {},
    home,
    hostCall,
    agentResources: store,
  }
}

test('user MCP keeps secrets out of catalog.json and snapshots', async () => {
  const { data, store } = await openStore()
  const snapshot = await store.upsertMCPServer({
    name: 'github',
    enabled: true,
    transport: 'command',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'ghp_must-not-cross-ui' },
  })
  assert.equal(snapshot.mcpServers.length, 1)
  assert.equal(snapshot.mcpServers[0]?.name, 'github')
  assert.equal(snapshot.mcpServers[0]?.enabled, true)
  assert.equal(snapshot.mcpServers[0]?.transport, 'command')
  assert.equal(snapshot.mcpServers[0]?.command, 'npx')
  assert.equal(snapshot.mcpServers[0]?.scope, 'user')
  assert.equal(snapshot.mcpServers[0]?.reviewReady, true)
  assert.deepEqual(snapshot.mcpServers[0]?.envNames, ['GITHUB_TOKEN'])
  assert.equal(JSON.stringify(snapshot).includes('ghp_must-not-cross-ui'), false)

  const catalog = await readFile(join(data, 'agent', 'resources', 'catalog.json'), 'utf8')
  assert.match(catalog, /milksu-agent-resources\/v1/)
  assert.equal(catalog.includes('ghp_must-not-cross-ui'), false)
  assert.match(catalog, /GITHUB_TOKEN/)
  assert.equal(catalog.includes('"env"'), false)

  const runtime = await store.runtime()
  assert.equal(runtime.mcpServers.github?.command, 'npx')
  const env = runtime.mcpServers.github?.env as Record<string, string>
  assert.equal(env.GITHUB_TOKEN, 'ghp_must-not-cross-ui')
})

test('reserved MCP names are rejected', async () => {
  const { store } = await openStore()
  await assert.rejects(
    () => store.upsertMCPServer({ name: 'milksu-playwright', transport: 'command', command: 'npx' }),
    /reserved/,
  )
  await assert.rejects(
    () => store.upsertMCPServer({ name: 'milksu-custom', transport: 'command', command: 'npx' }),
    /reserved/,
  )
})

test('import skill copies SKILL.md and scripts, not unlisted files', async () => {
  const sourceRoot = await tempData()
  const source = await writeSkill(
    sourceRoot,
    'demo',
    '---\nname: demo-review\ndescription: Review a local change\n---\n\n# Demo\n',
    { 'scripts/check.sh': '#!/bin/sh\n', 'notes.txt': 'ignore' },
  )
  const { store } = await openStore()
  const snapshot = await store.importSkill(source)
  assert.equal(snapshot.skills.length, 1)
  assert.equal(snapshot.skills[0]?.name, 'demo-review')
  assert.equal(snapshot.skills[0]?.description, 'Review a local change')
  assert.equal(snapshot.skills[0]?.enabled, true)
  assert.equal(snapshot.skills[0]?.origin, 'user')

  const runtime = await store.runtime()
  assert.equal(runtime.skillPaths.length, 1)
  const copied = runtime.skillPaths[0] ?? ''
  await readFile(join(copied, 'SKILL.md'))
  await readFile(join(copied, 'scripts', 'check.sh'))
  await assert.rejects(() => readFile(join(copied, 'notes.txt')))
})

test('import skill preserves slash-only frontmatter', async () => {
  const sourceRoot = await tempData()
  const source = await writeSkill(
    sourceRoot,
    'release-helper',
    '---\nname: release-helper\ndescription: Use when publishing MilkSU.\ndisable-model-invocation: true\n---\n\n# Body stays on disk\n',
  )
  const { store } = await openStore()
  const snapshot = await store.importSkill(source)
  assert.equal(snapshot.skills[0]?.slashOnly, true)
  const runtime = await store.runtime()
  const copied = await readFile(join(runtime.skillPaths[0] ?? '', 'SKILL.md'), 'utf8')
  assert.match(copied, /disable-model-invocation: true/)
  assert.match(copied, /# Body stays on disk/)
})

test('import MCP JSON keeps secrets out of snapshots and catalog.json', async () => {
  const { data, store } = await openStore()
  const snapshot = await store.importMCPJSON(`{
    "mcpServers": {
      "GitHub Docs": {
        "url": "https://example.test/mcp",
        "headers": { "Authorization": "Bearer secret-token" }
      },
      "local_tools": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": { "MEMORY_PATH": "/var/secret/memory" }
      }
    }
  }`)
  assert.equal(snapshot.mcpServers.length, 2)
  const rendered = JSON.stringify(snapshot)
  assert.equal(rendered.includes('secret-token'), false)
  assert.equal(rendered.includes('/var/secret/memory'), false)
  const catalog = await readFile(join(data, 'agent', 'resources', 'catalog.json'), 'utf8')
  assert.equal(catalog.includes('secret-token'), false)
  assert.equal(catalog.includes('/var/secret/memory'), false)
  const runtime = await store.runtime()
  assert.equal(Object.keys(runtime.mcpServers).length, 2)
})

test('disabled user MCP stays out of runtime', async () => {
  const { store } = await openStore()
  await store.upsertMCPServer({
    name: 'docs',
    enabled: true,
    transport: 'url',
    url: 'https://example.test/mcp',
  })
  await store.setMCPServerEnabled('docs', false)
  const runtime = await store.runtime()
  assert.deepEqual(runtime.mcpServers, {})
})

test('catalog load drops leftover secret fields from json', async () => {
  const data = await tempData()
  const root = join(data, 'agent', 'resources')
  await mkdir(root, { recursive: true, mode: 0o700 })
  await writeFile(join(root, 'catalog.json'), `${JSON.stringify({
    schema: CATALOG_SCHEMA,
    mcpServers: {
      github: {
        enabled: true,
        transport: 'command',
        command: 'npx',
        env: { GITHUB_TOKEN: 'ghp_leaked' },
        envNames: ['GITHUB_TOKEN'],
      },
    },
    skills: {},
    builtinMCP: {},
  }, null, 2)}\n`)
  const { store } = await openStore(data)
  const snapshot = await store.setMCPServerEnabled('github', true)
  assert.equal(JSON.stringify(snapshot).includes('ghp_leaked'), false)
  const catalog = await readFile(join(root, 'catalog.json'), 'utf8')
  assert.equal(catalog.includes('ghp_leaked'), false)
  assert.equal(catalog.includes('"env"'), false)
})

test('builtin skill overlay hides factory and restore returns factory body', async () => {
  const data = await tempData()
  const factory = await tempData()
  await writeSkill(
    factory,
    'product-design',
    '---\nname: product-design\ndescription: Factory when-to-use\n---\n\n# Factory\n',
  )
  const { store } = await openStore(data, new MemorySecretKeeper(), factory)
  const factoryDoc = await store.getBuiltinSkillDocument('product-design')
  assert.equal(factoryDoc.customized, false)
  assert.match(factoryDoc.document, /# Factory/)

  await store.setBuiltinSkillDocument(
    'product-design',
    '---\nname: product-design\ndescription: User when-to-use\n---\n\n# Overlay\n',
  )
  const overlay = await store.getBuiltinSkillDocument('product-design')
  assert.equal(overlay.customized, true)
  assert.match(overlay.document, /# Overlay/)
  const runtime = await store.runtime()
  assert.deepEqual(runtime.hideFactorySkills, ['product-design'])
  assert.equal(runtime.skillPaths.some((path) => path.includes('overlays')), true)

  await store.restoreBuiltinSkill('product-design')
  const restored = await store.getBuiltinSkillDocument('product-design')
  assert.equal(restored.customized, false)
  assert.match(restored.document, /# Factory/)
})

test('optional coding skills stay off until enabled', async () => {
  const factory = await tempData()
  await writeSkill(factory, 'ghidra-rpc', '---\nname: ghidra-rpc\ndescription: Use for binaries.\n---\n')
  await writeSkill(factory, 'jadx', '---\nname: jadx\ndescription: Use for APKs.\n---\n')
  await writeSkill(factory, 'reverse-engineer-anything', '---\nname: reverse-engineer-anything\ndescription: Use for shipped artifacts.\n---\n')
  const { store } = await openStore(await tempData(), new MemorySecretKeeper(), factory)
  assert.deepEqual(await store.optionalSkillPaths([]), [])
  const paths = await store.optionalSkillPaths(['jadx', 'ghidra-rpc', 'reverse-engineer-anything', 'product-design'])
  assert.equal(paths.length, 3)
  assert.equal(paths[0]?.includes('jadx'), true)
  assert.equal(paths[1]?.includes('ghidra-rpc'), true)
  assert.equal(paths[2]?.includes('reverse-engineer-anything'), true)
})

test('MCP secrets share the settings sqlite store', async () => {
  const home = await tempData()
  const settings = await SettingsStore.open({ home, platform: 'linux' })
  const store = await AgentResourceStore.open(
    join(home, 'data'),
    new SettingsSecretKeeper(settings.secretStore()),
  )
  await store.upsertMCPServer({
    name: 'github',
    transport: 'command',
    command: 'npx',
    env: { GITHUB_TOKEN: 'ghp_shared' },
  })
  const catalog = await readFile(join(home, 'data', 'agent', 'resources', 'catalog.json'), 'utf8')
  assert.equal(catalog.includes('ghp_shared'), false)
  const database = new DatabaseSync(join(home, 'config', 'credentials.db'))
  try {
    const row = database.prepare('SELECT secret FROM credentials WHERE account = ?').get(
      'mcp.user.github.env.GITHUB_TOKEN',
    ) as { secret?: string } | undefined
    assert.equal(row?.secret, 'ghp_shared')
  } finally {
    database.close()
  }
})

test('owned handlers list catalog, reject reserved names, and import skills via hostCall', async () => {
  const home = await tempData()
  const { store } = await openStore(join(home, 'data'))
  const sourceRoot = await tempData()
  const source = await writeSkill(
    sourceRoot,
    'imported',
    '---\nname: imported-review\ndescription: Review imported files\n---\n\n# Imported\n',
  )
  const ctx = await handlerContext(store, home, async () => source)
  assert.equal(isOwnedMethod('ListAgentResourceCatalog'), true)
  const listed = await handleOwnedMethod(ctx, 'renderer', 'ListAgentResourceCatalog', []) as {
    mcpServers: unknown[]
    builtinMCP: Array<{ name: string }>
  }
  assert.equal(Array.isArray(listed.mcpServers), true)
  assert.equal(listed.builtinMCP.some((item) => item.name === 'ida-pro'), true)

  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'UpsertUserMCPServer', [{
      name: 'milksu-playwright',
      transport: 'command',
      command: 'npx',
    }]),
    /reserved/,
  )

  const imported = await handleOwnedMethod(ctx, 'renderer', 'ImportUserSkill', []) as {
    skills: Array<{ name: string }>
  }
  assert.equal(imported.skills[0]?.name, 'imported-review')

  const cancelled = await handleOwnedMethod(
    { ...ctx, hostCall: async () => '' },
    'renderer',
    'ImportUserSkill',
    [],
  ) as { skills: Array<{ name: string }> }
  assert.equal(cancelled.skills[0]?.name, 'imported-review')
})

test('coding tools list uses the injected probe', async () => {
  const service = new CodingToolsService(await tempData(), undefined, {
    async lookPath(name) {
      if (name === 'jadx') return '/usr/bin/jadx'
      throw new Error(`not found: ${name}`)
    },
    async output() {
      return '1.5.0\n'
    },
  })
  const listed = await service.list()
  const jadx = listed.find((item) => item.name === 'jadx')
  assert.equal(jadx?.status, 'found')
  assert.equal(jadx?.version, '1.5.0')
})
