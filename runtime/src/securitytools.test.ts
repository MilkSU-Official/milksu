import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { CommandProbe } from './agentresources/codingtools.ts'
import {
  nodeMeetsReaEngines,
  parseNodeVersion,
  SecurityToolsService,
  TOOL_REA,
} from './securitytools/index.ts'

function settings(tools: Record<string, { enabled?: boolean }> = {}) {
  const security_tools = { ...tools }
  return {
    get() {
      return { security_tools }
    },
    async setSecurityToolEnabled(id: string, enabled: boolean) {
      security_tools[id] = { enabled }
    },
  }
}

class MissingProbe implements CommandProbe {
  async lookPath(name: string): Promise<string> {
    throw new Error(`not found: ${name}`)
  }
  async output(): Promise<string> {
    throw new Error('not found')
  }
}

class ReaProbe implements CommandProbe {
  nodeVersion: string
  nodePath: string
  npmPath: string

  constructor(nodeVersion: string, nodePath: string, npmPath = '') {
    this.nodeVersion = nodeVersion
    this.nodePath = nodePath
    this.npmPath = npmPath
  }

  async lookPath(name: string): Promise<string> {
    if (name === 'node' && this.nodePath) return this.nodePath
    if (name === 'npm' && this.npmPath) return this.npmPath
    throw new Error(`not found: ${name}`)
  }

  async output(command: string, args: string[]): Promise<string> {
    if (command === this.nodePath && args.length === 1 && args[0] === '--version') {
      return this.nodeVersion
    }
    throw new Error('not found')
  }
}

test('REA Node engines gate matches rea-agents package.json', () => {
  const cases: Array<[string, boolean]> = [
    ['v22.19.0', true],
    ['v22.18.9', false],
    ['v24.11.0', true],
    ['v24.10.4', false],
    ['v25.20.1', false],
    ['v26.0.0', true],
    ['v31.4.2', true],
  ]
  for (const [version, ok] of cases) {
    const parsed = parseNodeVersion(version)
    assert.ok(parsed, `failed to parse ${version}`)
    assert.equal(nodeMeetsReaEngines(parsed.major, parsed.minor), ok, version)
  }
})

test('REA detection states', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'milksu-rea-'))
  const entry = join(
    dataDirectory,
    'services',
    'security-tools',
    'rea',
    '6.1.0',
    'node_modules',
    'rea-agents',
    'scripts',
    'rea.mjs',
  )

  const missing = new SecurityToolsService(dataDirectory, settings(), undefined, new MissingProbe())
  const missingList = await missing.list()
  const missingRea = missingList.find((item) => item.id === TOOL_REA)
  assert.equal(missingRea?.status, 'missing_app')
  assert.equal(missingRea?.setupSupported, false)

  const oldNode = new SecurityToolsService(
    dataDirectory,
    settings(),
    undefined,
    new ReaProbe('v20.11.1', '/usr/bin/node'),
  )
  const oldList = await oldNode.list()
  const oldRea = oldList.find((item) => item.id === TOOL_REA)
  assert.equal(oldRea?.status, 'missing_app')
  assert.equal(oldRea?.setupSupported, false)

  await mkdir(dirname(entry), { recursive: true, mode: 0o700 })
  await writeFile(entry, 'fixture', { mode: 0o600 })
  const ready = new SecurityToolsService(
    dataDirectory,
    settings(),
    undefined,
    new ReaProbe('v24.11.0', '/usr/bin/node', '/usr/bin/npm'),
  )
  const readyTools = await ready.runtimeTools()
  const readyRea = readyTools.find((item) => item.id === TOOL_REA)
  assert.ok(readyRea)
  assert.equal(readyRea.command, '/usr/bin/node')
  assert.deepEqual(readyRea.args, [entry, 'mcp'])
  assert.equal(readyRea.version, '6.1.0')

  const fresh = await mkdtemp(join(tmpdir(), 'milksu-rea-setup-'))
  const needsSetup = new SecurityToolsService(
    fresh,
    settings(),
    undefined,
    new ReaProbe('v26.1.0', '/usr/bin/node', '/usr/bin/npm'),
  )
  const needsList = await needsSetup.list()
  const needsRea = needsList.find((item) => item.id === TOOL_REA)
  assert.equal(needsRea?.status, 'needs_setup')
  assert.equal(needsRea?.setupSupported, true)
  assert.equal(needsRea?.primaryAction, '准备 REA')
})

test('ready REA enters the runtime catalog and honors disable', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'milksu-rea-runtime-'))
  const entry = join(
    dataDirectory,
    'services',
    'security-tools',
    'rea',
    '6.1.0',
    'node_modules',
    'rea-agents',
    'scripts',
    'rea.mjs',
  )
  await mkdir(dirname(entry), { recursive: true, mode: 0o700 })
  await writeFile(entry, 'fixture', { mode: 0o600 })
  const prefs = settings()
  const service = new SecurityToolsService(
    dataDirectory,
    prefs,
    undefined,
    new ReaProbe('v22.19.1', '/usr/bin/node', '/usr/bin/npm'),
  )
  const runtimeTools = await service.runtimeTools()
  const rea = runtimeTools.find((item) => item.id === TOOL_REA)
  assert.ok(rea)
  assert.equal(rea.command, '/usr/bin/node')
  assert.equal(rea.args?.[1], 'mcp')
  await service.setEnabled(TOOL_REA, false)
  const disabled = await service.runtimeTools()
  assert.equal(disabled.some((item) => item.id === TOOL_REA), false)
})
