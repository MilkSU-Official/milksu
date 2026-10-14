import { lstat, readFile } from 'node:fs/promises'
import { LEGACY_STATE_SCHEMA, MAX_STATE_BYTES, STATE_SCHEMA, type SurfaceSlot, type SurfaceStyle } from './types.ts'
import { atomicWriteJson, cloneJson, isObject, rejectUnknownKeys } from './util.ts'

const STATE_KEYS = new Set(['schema', 'enabled', 'external', 'skin', 'storage', 'storage_versions'])
const SKIN_KEYS = new Set(['background_file', 'opacity', 'blur', 'configured', 'surfaces'])

export type SkinState = {
  background_file?: string
  opacity?: number
  blur?: number
  configured?: boolean
  surfaces?: Partial<Record<SurfaceSlot, SurfaceStyle>>
}

export type PersistedState = {
  schema: string
  enabled: Record<string, boolean>
  external: Record<string, boolean>
  skin: Record<string, SkinState>
  storage: Record<string, Record<string, unknown>>
  storage_versions: Record<string, number>
}

export function defaultState(): PersistedState {
  return {
    schema: STATE_SCHEMA,
    enabled: {},
    external: {},
    skin: {},
    storage: {},
    storage_versions: {},
  }
}

export async function readState(path: string): Promise<PersistedState> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultState()
    throw error
  }
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('plugin state must be a regular, non-symlink file')
  }
  if (info.size > MAX_STATE_BYTES) {
    throw new Error(`plugin state is larger than ${MAX_STATE_BYTES} bytes`)
  }
  const raw = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`decode plugin state: ${error instanceof Error ? error.message : error}`)
  }
  if (!isObject(parsed)) throw new Error('decode plugin state: must be an object')
  rejectUnknownKeys(parsed, STATE_KEYS, 'plugin state')
  const schema = String(parsed.schema ?? '')
  if (schema !== STATE_SCHEMA && schema !== LEGACY_STATE_SCHEMA) {
    throw new Error(`unsupported plugin state schema "${schema}"`)
  }
  const state: PersistedState = {
    schema: STATE_SCHEMA,
    enabled: isObject(parsed.enabled) ? parsed.enabled as Record<string, boolean> : {},
    external: isObject(parsed.external) ? parsed.external as Record<string, boolean> : {},
    skin: {},
    storage: isObject(parsed.storage) ? parsed.storage as Record<string, Record<string, unknown>> : {},
    storage_versions: isObject(parsed.storage_versions) ? parsed.storage_versions as Record<string, number> : {},
  }
  if (isObject(parsed.skin)) {
    for (const [id, rawSkin] of Object.entries(parsed.skin)) {
      if (!isObject(rawSkin)) continue
      rejectUnknownKeys(rawSkin, SKIN_KEYS, 'skin')
      const skin: SkinState = {
        background_file: rawSkin.background_file ? String(rawSkin.background_file) : undefined,
        opacity: typeof rawSkin.opacity === 'number' ? rawSkin.opacity : undefined,
        blur: typeof rawSkin.blur === 'number' ? rawSkin.blur : undefined,
        configured: Boolean(rawSkin.configured),
        surfaces: isObject(rawSkin.surfaces) ? rawSkin.surfaces as SkinState['surfaces'] : {},
      }
      if (schema === LEGACY_STATE_SCHEMA && (skin.background_file || skin.configured)) {
        const style: SurfaceStyle = {
          mode: 'solid',
          solid: 'original',
          image_opacity: skin.opacity,
          blur: skin.blur,
          light_mask: { color: '#ffffff', opacity: 0.12 },
          dark_mask: { color: '#000000', opacity: 0.22 },
        }
        if (skin.background_file) {
          style.mode = 'image'
          style.asset_id = skin.background_file
        }
        skin.surfaces = { 'content-wallpaper': style }
      }
      if (!skin.surfaces) skin.surfaces = {}
      state.skin[id] = skin
    }
  }
  return state
}

export async function writeState(path: string, state: PersistedState): Promise<void> {
  const payload = `${JSON.stringify(state, null, 2)}\n`
  if (Buffer.byteLength(payload) > MAX_STATE_BYTES) {
    throw new Error(`plugin state is larger than ${MAX_STATE_BYTES} bytes`)
  }
  await atomicWriteJson(path, state, MAX_STATE_BYTES)
}

export function clonePersistedState(value: PersistedState): PersistedState {
  const clone = cloneJson(value)
  clone.enabled ??= {}
  clone.external ??= {}
  clone.skin ??= {}
  clone.storage ??= {}
  clone.storage_versions ??= {}
  return clone
}
