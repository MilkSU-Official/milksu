import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MAX_ENTRY_BYTES,
  MAX_RUNTIME_RESULT_BYTES,
  MAX_STORAGE_VALUE_BYTES,
  PLUGIN_CALL_TIMEOUT_MS,
  type PackageRecord,
  type PluginOptions,
  type RuntimeInvocation,
  type RuntimeResult,
} from './types.ts'
import { isObject, securePackageFile, trim } from './util.ts'

const STORAGE_KEY = /^[a-z][a-z0-9_.-]{0,63}$/

export async function invokeRuntime(
  options: PluginOptions,
  record: PackageRecord,
  request: RuntimeInvocation,
): Promise<RuntimeResult> {
  if (record.manifest.runtime.kind === 'lua') {
    if (!options.invokeLua) throw new Error('Lua plugin runtime is unavailable')
    const raw = await options.invokeLua(record.directory, record.manifest.runtime.entry, request)
    const result = decodeRuntimeResult(raw)
    validateRuntimeResult(result, request.storageEnabled)
    return result
  }
  if (record.manifest.runtime.kind === 'typescript') {
    return invokeTypeScript(options, record, request)
  }
  throw new Error(`unsupported plugin runtime "${record.manifest.runtime.kind}"`)
}

async function invokeTypeScript(
  options: PluginOptions,
  record: PackageRecord,
  request: RuntimeInvocation,
): Promise<RuntimeResult> {
  const node = trim(options.nodeExecutable)
  const worker = trim(options.typeScriptWorker)
  if (!node || !worker) throw new Error('TypeScript plugin runtime is unavailable')
  const entry = await securePackageFile(record.directory, record.manifest.runtime.entry, MAX_ENTRY_BYTES)
  const workerPath = resolve(worker)
  const loader = resolve(dirname(workerPath), 'deny-loader.mjs')
  const loaderInfo = await lstat(loader)
  if (loaderInfo.isSymbolicLink() || !loaderInfo.isFile()) {
    throw new Error('TypeScript plugin module guard is unavailable')
  }
  const arguments_ = [
    '--permission',
    '--allow-worker',
    '--max-old-space-size=64',
    '--disable-proto=throw',
    `--experimental-loader=${pathToFileURL(loader).href}`,
    ...allowFsRead(loader, workerPath, entry, record.directory),
    workerPath,
    entry,
  ]
  const payload = `${JSON.stringify(request)}\n`
  const stdout = await runWorker(node, arguments_, record.directory, {
    MILKSU_PLUGIN_ID: record.manifest.id,
    MILKSU_PLUGIN_WORKER_URL: pathToFileURL(workerPath).href,
    MILKSU_PLUGIN_ENTRY_URL: pathToFileURL(entry).href,
    NO_COLOR: '1',
  }, payload)
  if (Buffer.byteLength(stdout) > MAX_RUNTIME_RESULT_BYTES || (stdout.match(/\n/g) ?? []).length > 1) {
    throw new Error('TypeScript plugin returned an invalid message stream')
  }
  const parsed = JSON.parse(stdout) as unknown
  const result = decodeRuntimeResult(parsed)
  validateRuntimeResult(result, request.storageEnabled)
  return result
}

function allowFsRead(...paths: string[]): string[] {
  const seen = new Set<string>()
  const arguments_: string[] = []
  const add = (path: string) => {
    const value = trim(path)
    if (!value || seen.has(value)) return
    seen.add(value)
    arguments_.push(`--allow-fs-read=${value}`)
  }
  for (const path of paths) {
    add(path)
    add(dirname(path))
  }
  return arguments_
}

function runWorker(
  node: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  stdin: string,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(node, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('TypeScript plugin timed out'))
    }, PLUGIN_CALL_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 16 << 10) stderr += chunk.slice(0, (16 << 10) - stderr.length)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      reject(new Error(`TypeScript plugin failed: ${trim(stderr) || `exit ${code}`}`))
    })
    child.stdin.end(stdin)
  })
}

export function decodeRuntimeResult(raw: unknown): RuntimeResult {
  if (!isObject(raw)) throw new Error('decode plugin result: must be an object')
  const allowed = new Set(['value', 'storageWrites'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error('decode plugin result: unknown field')
  }
  return {
    value: raw.value ?? null,
    storageWrites: isObject(raw.storageWrites) ? raw.storageWrites : undefined,
  }
}

export function validateRuntimeResult(result: RuntimeResult, storageEnabled: boolean): void {
  const encoded = JSON.stringify(result.value ?? null)
  if (Buffer.byteLength(encoded) > MAX_RUNTIME_RESULT_BYTES) {
    throw new Error('plugin returned an invalid or oversized JSON value')
  }
  const writes = result.storageWrites ?? {}
  const keys = Object.keys(writes)
  if (keys.length > 64) throw new Error('plugin attempted too many storage writes')
  if (keys.length > 0 && !storageEnabled) {
    throw new Error('plugin attempted storage access without plugin.storage permission')
  }
  for (const [key, value] of Object.entries(writes)) {
    if (!STORAGE_KEY.test(trim(key))) throw new Error(`plugin storage key "${key}" is invalid`)
    const encodedValue = JSON.stringify(value)
    if (Buffer.byteLength(encodedValue) > MAX_STORAGE_VALUE_BYTES) {
      throw new Error(`plugin storage value "${key}" is invalid or oversized`)
    }
  }
  if (storageEnabled) {
    const aggregate = JSON.stringify(writes)
    if (Buffer.byteLength(aggregate) > (256 << 10)) {
      throw new Error('plugin attempted oversized aggregate storage writes')
    }
  }
}

export function runtimeInvocation(
  record: PackageRecord,
  abi: string,
  name: string,
  input: unknown,
  hostVersion: string,
  storage: Record<string, unknown>,
): RuntimeInvocation {
  return {
    abi,
    name: name || undefined,
    input: input ?? {},
    pluginId: record.manifest.id,
    pluginVersion: record.manifest.version,
    apiVersion: record.manifest.apiVersion,
    hostVersion,
    capabilities: [
      'runtime.lua.v1',
      'runtime.typescript.v1',
      'ui.settings.v1',
      'theme.surfaces.v1',
      'theme.assets.v1',
      'agent.read-tools.v1',
      'mcp.external-read.v1',
      'storage.v1',
    ],
    permissions: [...record.manifest.permissions],
    source: record.source,
    storageEnabled: record.manifest.permissions.includes('plugin.storage'),
    storage,
  }
}
