import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { invokeLua } from './lua.ts'
import { HOST_CAPABILITIES, type RuntimeInvocation } from './types.ts'

async function writeLua(source: string): Promise<{ directory: string; entry: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-lua-'))
  const entry = 'main.lua'
  await writeFile(join(directory, entry), source, { mode: 0o600 })
  return { directory, entry }
}

function invocation(overrides: Partial<RuntimeInvocation> = {}): RuntimeInvocation {
  return {
    abi: 'health_check',
    name: 'test',
    input: {},
    pluginId: 'test.lua',
    pluginVersion: '1.0.0',
    apiVersion: 'milksu.plugin/v1',
    hostVersion: '26.823.1',
    capabilities: [...HOST_CAPABILITIES],
    permissions: [],
    source: 'official',
    storageEnabled: false,
    storage: {},
    ...overrides,
  }
}

test('lua health_check on initialize/dispose plugin', async () => {
  const { directory, entry } = await writeLua(`
plugin = {}
function plugin.initialize(_context)
  return "null"
end
function plugin.dispose()
  return "null"
end
`)
  const result = await invokeLua(directory, entry, invocation({ abi: 'health_check' }))
  assert.equal(result.value, null)
})

test('lua call_ui returns JSON string parsed as value', async () => {
  const { directory, entry } = await writeLua(`
plugin = {}
function plugin.call_ui(action, input_json)
  return '{"action":"' .. action .. '","input":' .. input_json .. '}'
end
`)
  const result = await invokeLua(directory, entry, invocation({
    abi: 'call_ui',
    name: 'ping',
    input: { n: 1 },
  }))
  assert.deepEqual(result.value, { action: 'ping', input: { n: 1 } })
})

test('lua dofile and require are unavailable', async () => {
  const { directory, entry } = await writeLua(`
plugin = {}
function plugin.call_ui(_name, _input)
  return '{' ..
    '"dofile":"' .. type(dofile) .. '",' ..
    '"require":"' .. type(require) .. '",' ..
    '"load":"' .. type(load) .. '",' ..
    '"loadfile":"' .. type(loadfile) .. '",' ..
    '"print":"' .. type(print) .. '",' ..
    '"os":"' .. type(os) .. '",' ..
    '"sqrt":' .. tostring(math.sqrt(9)) .. '}'
end
`)
  const result = await invokeLua(directory, entry, invocation({ abi: 'call_ui', name: 'probe' }))
  assert.deepEqual(result.value, {
    dofile: 'nil',
    require: 'nil',
    load: 'nil',
    loadfile: 'nil',
    print: 'nil',
    os: 'nil',
    sqrt: 3,
  })
})

test('lua storage get/set with permission', async () => {
  const { directory, entry } = await writeLua(`
plugin = {}
function plugin.call_ui(_name, _input)
  milksu.set("theme.mode", '"dark"')
  return milksu.get("color")
end
`)
  const result = await invokeLua(directory, entry, invocation({
    abi: 'call_ui',
    name: 'save',
    storageEnabled: true,
    permissions: ['plugin.storage'],
    storage: { color: 'blue' },
  }))
  assert.equal(result.value, 'blue')
  assert.deepEqual(result.storageWrites, { 'theme.mode': 'dark' })
})

test('lua storage rejects without permission', async () => {
  const { directory, entry } = await writeLua(`
plugin = {}
function plugin.call_ui(_name, _input)
  return milksu.get("secret")
end
`)
  await assert.rejects(
    () => invokeLua(directory, entry, invocation({ abi: 'call_ui', name: 'read' })),
    /plugin\.storage permission is required/,
  )
  const write = await writeLua(`
plugin = {}
function plugin.call_ui(_name, _input)
  milksu.set("theme.mode", '"dark"')
  return "null"
end
`)
  await assert.rejects(
    () => invokeLua(write.directory, write.entry, invocation({ abi: 'call_ui', name: 'write' })),
    /plugin\.storage permission is required/,
  )
})

test('lua missing plugin table errors', async () => {
  const { directory, entry } = await writeLua('x = 1\n')
  await assert.rejects(
    () => invokeLua(directory, entry, invocation()),
    /Lua entry must define global table plugin/,
  )
})
