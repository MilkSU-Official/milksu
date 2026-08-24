import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const MAX_INPUT_BYTES = 1024 * 1024

function fail(message) {
  process.stderr.write(`${String(message).slice(0, 4096)}\n`)
  process.exitCode = 1
}

function hardenRuntime() {
  for (const key of ['fetch', 'WebSocket', 'EventSource']) {
    try { Object.defineProperty(globalThis, key, { value: undefined, configurable: false }) } catch {}
  }
  for (const key of [
    'binding',
    'dlopen',
    'getBuiltinModule',
    'kill',
    'abort',
    '_kill',
    'reallyExit',
  ]) {
    try { Object.defineProperty(process, key, { value: undefined, configurable: false }) } catch {}
  }
  for (const key of Object.keys(process.env)) {
    if (key !== 'MILKSU_PLUGIN_ID' && key !== 'NO_COLOR') delete process.env[key]
  }
}

async function main() {
  const writeResult = process.stdout.write.bind(process.stdout)
  const entry = process.argv[2]
  if (!entry) throw new Error('compiled plugin entry is required')
  const lineReader = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let input = ''
  for await (const line of lineReader) {
    if (input) throw new Error('plugin worker accepts exactly one request')
    input = line
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('plugin request is too large')
  }
  if (!input) throw new Error('plugin request is required')
  const request = JSON.parse(input)
  const writes = Object.create(null)
  const storage = Object.freeze({
    get(key) {
      if (!request.storageEnabled) throw new Error('plugin.storage permission is required')
      const value = request.storage?.[String(key)]
      return value === undefined ? undefined : structuredClone(value)
    },
    set(key, value) {
      if (!request.storageEnabled) throw new Error('plugin.storage permission is required')
      const normalized = String(key)
      if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(normalized)) throw new Error('invalid plugin storage key')
      const encoded = JSON.stringify(value)
      if (Buffer.byteLength(encoded) > 64 * 1024) throw new Error('plugin storage value is too large')
      writes[normalized] = JSON.parse(encoded)
    },
  })
  hardenRuntime()
  try { Object.defineProperty(process.stdout, 'write', { value: () => { throw new Error('plugin stdout is reserved') } }) } catch {}
  Object.defineProperty(globalThis, 'milksu', {
    value: Object.freeze({ storage }), configurable: false, writable: false,
  })
  const module = await import(pathToFileURL(entry).href)
  const plugin = module.default ?? module.plugin ?? module
  if (!plugin || typeof plugin !== 'object') throw new Error('TypeScript bundle must export a plugin object')
  const context = Object.freeze({
    pluginId: request.pluginId,
    pluginVersion: request.pluginVersion,
    apiVersion: request.apiVersion,
    hostVersion: request.hostVersion,
    capabilities: Object.freeze([...(request.capabilities ?? [])]),
    permissions: Object.freeze([...(request.permissions ?? [])]),
    source: request.source,
  })
  const initialize = request.apiVersion === 'milksu.plugin/v1alpha1' ? plugin.activate : plugin.initialize
  const dispose = request.apiVersion === 'milksu.plugin/v1alpha1' ? plugin.deactivate : plugin.dispose
  if (typeof initialize === 'function') await initialize.call(plugin, context)
  let value
  try {
    if (request.abi === 'health_check') {
      value = null
    } else if (request.abi === 'migrate_storage') {
      if (typeof plugin.migrate !== 'function') throw new Error('plugin does not implement migrate')
      value = await plugin.migrate(request.input ?? {})
    } else if (request.abi === 'call_tool') {
      if (typeof plugin.call_tool !== 'function') throw new Error('plugin does not implement call_tool')
      value = await plugin.call_tool(request.name, request.input ?? {})
    } else if (request.abi === 'call_ui') {
      if (typeof plugin.call_ui !== 'function') throw new Error('plugin does not implement call_ui')
      value = await plugin.call_ui(request.name, request.input ?? {})
    } else {
      throw new Error(`unsupported plugin ABI ${String(request.abi)}`)
    }
  } finally {
    if (typeof dispose === 'function') await dispose.call(plugin)
  }
  writeResult(`${JSON.stringify({ value: value ?? null, storageWrites: writes })}\n`)
}

main().catch(error => fail(error?.stack || error))
