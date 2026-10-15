import { readFile } from 'node:fs/promises'
import {
  lua,
  lauxlib,
  lualib,
  to_luastring,
  to_jsstring,
} from 'fengari'
import { decodeRuntimeResult, validateRuntimeResult } from './runtime.ts'
import {
  LEGACY_API_VERSION,
  MAX_ENTRY_BYTES,
  MAX_RUNTIME_RESULT_BYTES,
  MAX_STORAGE_VALUE_BYTES,
  PLUGIN_CALL_TIMEOUT_MS,
  type RuntimeInvocation,
  type RuntimeResult,
} from './types.ts'
import { securePackageFile, trim } from './util.ts'

const STORAGE_KEY = /^[a-z][a-z0-9_.-]{0,63}$/
const LIFECYCLE = new Set(['activate', 'deactivate', 'initialize', 'dispose'])

type LuaState = ReturnType<typeof lauxlib.luaL_newstate>

const SAFE_LIBRARIES: Array<{ name: string; open: (L: LuaState) => number }> = [
  { name: '_G', open: lualib.luaopen_base },
  { name: 'string', open: lualib.luaopen_string },
  { name: 'table', open: lualib.luaopen_table },
  { name: 'math', open: lualib.luaopen_math },
]

export async function invokeLua(
  directory: string,
  entry: string,
  request: RuntimeInvocation,
): Promise<RuntimeResult> {
  if (!trim(directory) || !trim(entry)) {
    throw new Error('Lua plugin directory and entry are required')
  }
  const path = await securePackageFile(directory, entry, MAX_ENTRY_BYTES)
  const deadline = Date.now() + PLUGIN_CALL_TIMEOUT_MS
  const L = lauxlib.luaL_newstate()
  if (!L) throw new Error('failed to create Lua state')
  const storageWrites: Record<string, unknown> = {}
  try {
    installTimeoutHook(L, deadline)
    for (const library of SAFE_LIBRARIES) {
      try {
        lauxlib.luaL_requiref(L, to_luastring(library.name), library.open, 1)
        lua.lua_pop(L, 1)
      } catch (error) {
        throw new Error(`open safe Lua library ${library.name}: ${messageOf(error)}`)
      }
    }
    for (const global of ['dofile', 'loadfile', 'load', 'loadstring', 'require', 'module', 'collectgarbage', 'print']) {
      lua.lua_pushnil(L)
      lua.lua_setglobal(L, to_luastring(global))
    }
    installStorage(L, request, storageWrites)
    let payload: Buffer
    try {
      payload = await readFile(path)
    } catch (error) {
      throw new Error(`read Lua plugin: ${messageOf(error)}`)
    }
    const chunkName = to_luastring(`@${request.pluginId}/${entry}`)
    const compiled = lauxlib.luaL_loadbuffer(L, payload, payload.length, chunkName)
    if (compiled !== lua.LUA_OK) {
      throw new Error(`compile Lua plugin: ${takeLuaMessage(L)}`)
    }
    pcall(L, 0, 0, deadline, 'load Lua plugin')
    lua.lua_getglobal(L, to_luastring('plugin'))
    if (lua.lua_type(L, -1) !== lua.LUA_TTABLE) {
      throw new Error('Lua entry must define global table plugin')
    }
    const pluginIndex = lua.lua_absindex(L, -1)
    const context = JSON.stringify({
      pluginId: request.pluginId,
      pluginVersion: request.pluginVersion,
      apiVersion: request.apiVersion,
      hostVersion: request.hostVersion,
      capabilities: request.capabilities,
      permissions: request.permissions,
      source: request.source,
    })
    const initialize = request.apiVersion === LEGACY_API_VERSION ? 'activate' : 'initialize'
    const dispose = request.apiVersion === LEGACY_API_VERSION ? 'deactivate' : 'dispose'
    callLuaABI(L, pluginIndex, initialize, deadline, context)
    let raw = 'null'
    let abiError: Error | undefined
    try {
      switch (request.abi) {
        case 'call_tool':
        case 'call_ui':
          raw = callLuaABI(L, pluginIndex, request.abi, deadline, request.name ?? '', JSON.stringify(request.input ?? null))
          break
        case 'health_check':
          raw = 'null'
          break
        case 'migrate_storage':
          raw = callLuaABI(L, pluginIndex, 'migrate', deadline, JSON.stringify(request.input ?? null))
          break
        default:
          throw new Error(`unsupported plugin ABI "${request.abi}"`)
      }
    } catch (error) {
      abiError = error instanceof Error ? error : new Error(String(error))
    }
    let disposeError: Error | undefined
    try {
      callLuaABI(L, pluginIndex, dispose, deadline)
    } catch (error) {
      disposeError = error instanceof Error ? error : new Error(String(error))
    }
    if (abiError) throw abiError
    if (disposeError) throw disposeError
    if (Buffer.byteLength(raw) > MAX_RUNTIME_RESULT_BYTES) {
      throw new Error('plugin returned an invalid or oversized JSON value')
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('plugin returned an invalid or oversized JSON value')
    }
    const result = decodeRuntimeResult({ value, storageWrites })
    validateRuntimeResult(result, request.storageEnabled)
    return result
  } finally {
    lua.lua_close(L)
  }
}

function installTimeoutHook(L: LuaState, deadline: number): void {
  // fengari has no context deadline; a count/line hook aborts after PLUGIN_CALL_TIMEOUT_MS.
  lua.lua_sethook(L, (hookL: LuaState) => {
    if (Date.now() > deadline) {
      lauxlib.luaL_error(hookL, to_luastring('Lua plugin timed out'))
    }
  }, lua.LUA_MASKCOUNT | lua.LUA_MASKLINE, 1000)
}

function installStorage(L: LuaState, request: RuntimeInvocation, writes: Record<string, unknown>): void {
  lua.lua_newtable(L)
  lua.lua_pushjsfunction(L, (state: LuaState) => {
    if (!request.storageEnabled) {
      return lauxlib.luaL_error(state, to_luastring('plugin.storage permission is required'))
    }
    const key = to_jsstring(lauxlib.luaL_checkstring(state, 1))
    const storage = request.storage ?? {}
    if (!Object.hasOwn(storage, key)) {
      lua.lua_pushnil(state)
      return 1
    }
    lua.lua_pushstring(state, to_luastring(JSON.stringify(storage[key])))
    return 1
  })
  lua.lua_setfield(L, -2, to_luastring('get'))
  lua.lua_pushjsfunction(L, (state: LuaState) => {
    if (!request.storageEnabled) {
      return lauxlib.luaL_error(state, to_luastring('plugin.storage permission is required'))
    }
    const key = to_jsstring(lauxlib.luaL_checkstring(state, 1))
    const value = to_jsstring(lauxlib.luaL_checkstring(state, 2))
    if (!STORAGE_KEY.test(key) || Buffer.byteLength(value) > MAX_STORAGE_VALUE_BYTES) {
      return lauxlib.luaL_error(state, to_luastring('invalid plugin storage write'))
    }
    try {
      writes[key] = JSON.parse(value)
    } catch {
      return lauxlib.luaL_error(state, to_luastring('invalid plugin storage write'))
    }
    return 0
  })
  lua.lua_setfield(L, -2, to_luastring('set'))
  lua.lua_setglobal(L, to_luastring('milksu'))
}

function callLuaABI(L: LuaState, pluginIndex: number, name: string, deadline: number, ...arguments_: string[]): string {
  lua.lua_getfield(L, pluginIndex, to_luastring(name))
  if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
    lua.lua_pop(L, 1)
    if (LIFECYCLE.has(name)) return 'null'
    throw new Error(`Lua plugin does not implement ${name}`)
  }
  for (const argument of arguments_) {
    lua.lua_pushstring(L, to_luastring(argument))
  }
  pcall(L, arguments_.length, 1, deadline, `Lua plugin ${name} failed`)
  if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
    lua.lua_pop(L, 1)
    return 'null'
  }
  if (lua.lua_type(L, -1) !== lua.LUA_TSTRING) {
    lua.lua_pop(L, 1)
    throw new Error(`Lua plugin ${name} must return a JSON string`)
  }
  const text = lua.lua_tojsstring(L, -1)
  lua.lua_pop(L, 1)
  return text ?? 'null'
}

function pcall(L: LuaState, nargs: number, nresults: number, deadline: number, label: string): void {
  assertNotTimedOut(deadline)
  let status: number
  try {
    status = lua.lua_pcall(L, nargs, nresults, 0)
  } catch (error) {
    if (Date.now() > deadline || isTimeoutMessage(error)) {
      throw new Error('Lua plugin timed out')
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
  if (Date.now() > deadline) {
    if (status !== lua.LUA_OK) lua.lua_pop(L, 1)
    throw new Error('Lua plugin timed out')
  }
  if (status !== lua.LUA_OK) {
    const detail = takeLuaMessage(L)
    if (detail.includes('Lua plugin timed out')) throw new Error('Lua plugin timed out')
    throw new Error(`${label}: ${detail}`)
  }
}

function takeLuaMessage(L: LuaState): string {
  if (lua.lua_type(L, -1) === lua.LUA_TSTRING) {
    const text = lua.lua_tojsstring(L, -1) ?? 'unknown error'
    lua.lua_pop(L, 1)
    return text
  }
  lauxlib.luaL_tolstring(L, -1)
  const text = lua.lua_tojsstring(L, -1) ?? 'unknown error'
  lua.lua_pop(L, 2)
  return text
}

function assertNotTimedOut(deadline: number): void {
  if (Date.now() > deadline) throw new Error('Lua plugin timed out')
}

function isTimeoutMessage(error: unknown): boolean {
  return messageOf(error).includes('Lua plugin timed out')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
