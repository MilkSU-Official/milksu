import { resolve } from 'node:path'
import {
  createPluginTemplate,
  generatePublisherKey,
  packPlugin,
  testPluginSource,
  verifyPluginPackage,
} from './plugin/author.ts'
import { DEVELOPMENT_HOST_VERSION } from './plugin/types.ts'

type FlagKind = 'string' | 'repeat'

function parseFlags(args: string[], spec: Record<string, FlagKind>): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {}
  for (const [name, kind] of Object.entries(spec)) {
    values[name] = kind === 'repeat' ? [] : ''
  }
  let index = 0
  while (index < args.length) {
    const raw = args[index]!
    if (!raw.startsWith('-')) {
      throw new Error(`flag provided but not defined: ${raw}`)
    }
    const trimmed = raw.replace(/^--?/, '')
    const eq = trimmed.indexOf('=')
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq)
    if (!(name in spec)) throw new Error(`flag provided but not defined: -${name}`)
    const value = eq === -1 ? args[index + 1] : trimmed.slice(eq + 1)
    if (value === undefined) throw new Error(`flag needs an argument: -${name}`)
    if (eq === -1) index += 1
    if (spec[name] === 'repeat') (values[name] as string[]).push(value)
    else values[name] = value
    index += 1
  }
  return values
}

function printJSON(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function keygenCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args, { publisher: 'string', out: 'string' })
  const output = String(flags.out ?? '')
  if (!output.trim()) {
    throw new Error('keygen requires --out; private key bytes are never printed')
  }
  printJSON(await generatePublisherKey(String(flags.publisher ?? ''), output))
}

async function packCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args, { source: 'string', out: 'string', key: 'repeat' })
  printJSON(await packPlugin(String(flags.source ?? ''), String(flags.out ?? ''), flags.key as string[]))
}

async function verifyCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args, { package: 'string', 'host-version': 'string' })
  const host = String(flags['host-version'] || DEVELOPMENT_HOST_VERSION)
  printJSON(await verifyPluginPackage(String(flags.package ?? ''), host))
}

async function testCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args, {
    source: 'string',
    node: 'string',
    worker: 'string',
    'host-version': 'string',
  })
  printJSON(await testPluginSource(String(flags.source ?? ''), {
    hostVersion: String(flags['host-version'] || DEVELOPMENT_HOST_VERSION),
    nodeExecutable: String(flags.node ?? ''),
    typeScriptWorker: String(flags.worker || 'sidecar/plugin-runtime/worker.mjs'),
  }))
}

async function createCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args, {
    runtime: 'string',
    id: 'string',
    name: 'string',
    publisher: 'string',
    'key-id': 'string',
    out: 'string',
  })
  printJSON(await createPluginTemplate({
    runtime: String(flags.runtime || 'lua'),
    id: String(flags.id ?? ''),
    name: String(flags.name ?? ''),
    publisher: String(flags.publisher ?? ''),
    keyId: String(flags['key-id'] ?? ''),
    out: String(flags.out ?? ''),
  }))
}

export async function run(arguments_: string[]): Promise<void> {
  if (arguments_.length === 0) {
    throw new Error('usage: milksu-pluginctl <create|keygen|pack|verify|test> [options]')
  }
  switch (arguments_[0]) {
    case 'create':
      await createCommand(arguments_.slice(1))
      return
    case 'keygen':
      await keygenCommand(arguments_.slice(1))
      return
    case 'pack':
      await packCommand(arguments_.slice(1))
      return
    case 'verify':
      await verifyCommand(arguments_.slice(1))
      return
    case 'test':
      await testCommand(arguments_.slice(1))
      return
    default:
      throw new Error(`unknown plugin author command "${arguments_[0]}"`)
  }
}

function isPluginctlEntry(): boolean {
  const argv1 = process.argv[1] ? resolve(process.argv[1]) : ''
  if (!argv1) return false
  const base = argv1.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'pluginctl.ts' || base === 'pluginctl.cjs' || base === 'pluginctl.js'
}

export async function main(): Promise<void> {
  await run(process.argv.slice(2))
}

if (isPluginctlEntry()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  })
}
