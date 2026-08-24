import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtimeDirectory = dirname(fileURLToPath(import.meta.url))
const worker = join(runtimeDirectory, 'worker.mjs')
const loader = join(runtimeDirectory, 'deny-loader.mjs')

async function runPlugin(source, request) {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-plugin-runtime-'))
  const entry = join(directory, 'plugin.mjs')
  await writeFile(entry, source, { mode: 0o600 })
  const arguments_ = [
    '--permission',
    // Node implements --experimental-loader in an internal worker thread.
    // Plugin modules still cannot import node:worker_threads through the guard.
    '--allow-worker',
    '--max-old-space-size=64',
    '--disable-proto=throw',
    `--experimental-loader=${pathToFileURL(loader).href}`,
    `--allow-fs-read=${loader}`,
    `--allow-fs-read=${worker}`,
    `--allow-fs-read=${entry}`,
    worker,
    entry,
  ]
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, arguments_, {
        cwd: directory,
        env: {
          MILKSU_PLUGIN_ID: request.pluginId,
          MILKSU_PLUGIN_WORKER_URL: pathToFileURL(worker).href,
          MILKSU_PLUGIN_ENTRY_URL: pathToFileURL(entry).href,
          NO_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.once('error', rejectPromise)
      child.once('close', code => resolvePromise({ code, stdout, stderr }))
      child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('runs a self-contained plugin with the production permission arguments', async () => {
  const result = await runPlugin(`
    export default {
      call_tool(name, input) {
        milksu.storage.set('last_input', input)
        return {
          name,
          input,
          pluginId: process.env.MILKSU_PLUGIN_ID,
          secret: process.env.PATH,
          fetchType: typeof fetch,
          builtinType: typeof process.getBuiltinModule,
          killType: typeof process.kill,
          abortType: typeof process.abort,
        }
      },
    }
  `, {
    abi: 'call_tool',
    name: 'inspect',
    input: { value: 42 },
    pluginId: 'dev.runtime-test',
    storageEnabled: true,
    storage: {},
  })
  assert.equal(result.code, 0, result.stderr)
  const response = JSON.parse(result.stdout)
  assert.deepEqual(response, {
    value: {
      name: 'inspect',
      input: { value: 42 },
      pluginId: 'dev.runtime-test',
      fetchType: 'undefined',
      builtinType: 'undefined',
      killType: 'undefined',
      abortType: 'undefined',
    },
    storageWrites: { last_input: { value: 42 } },
  })
})

test('module guard rejects imports from a plugin bundle', async () => {
  const result = await runPlugin(`
    import { readFile } from 'node:fs/promises'
    export default { async call_tool() { return readFile('secret.txt', 'utf8') } }
  `, {
    abi: 'call_tool',
    name: 'read',
    input: {},
    pluginId: 'dev.runtime-test',
    storageEnabled: false,
    storage: {},
  })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /plugin bundle must be self-contained; import denied/u)
  assert.equal(result.stdout, '')
})

test('storage permission is enforced inside the worker', async () => {
  const result = await runPlugin(`
    export default { call_ui() { return milksu.storage.get('private') } }
  `, {
    abi: 'call_ui',
    name: 'get',
    input: {},
    pluginId: 'dev.runtime-test',
    storageEnabled: false,
    storage: { private: 'must-not-be-readable' },
  })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /plugin\.storage permission is required/u)
  assert.equal(result.stdout, '')
})

test('a plugin cannot signal the host process', async () => {
  const result = await runPlugin(`
    export default {
      call_tool() {
        process.kill(process.ppid, 0)
        return 'unexpected'
      },
    }
  `, {
    abi: 'call_tool',
    name: 'signal',
    input: {},
    pluginId: 'dev.runtime-test',
    storageEnabled: false,
    storage: {},
  })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /process\.kill is not a function/u)
  assert.equal(result.stdout, '')
})
