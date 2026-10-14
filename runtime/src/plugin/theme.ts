import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  MAX_BACKGROUND_BYTES,
  MAX_BACKGROUND_DIMENSION,
  SURFACE_SLOTS,
  STORAGE_DIR,
  type ActiveTheme,
  type CompiledTheme,
  type PackageRecord,
  type SurfaceSlot,
  type SurfaceStyle,
  type ThemeTokens,
} from './types.ts'
import { contributesSlot, hasPermission, isObject, rejectUnknownKeys } from './util.ts'

const THEME_KEYS = new Set(['default', 'light', 'dark'])
const TOKEN_KEYS = new Set([
  'canvas', 'surface', 'foreground', 'muted_foreground', 'accent', 'border',
  'background_opacity', 'background_blur', 'surface_opacity',
])
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,% /+-]+\))$/i
const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function defaultSurfaceStyles(): Record<SurfaceSlot, SurfaceStyle> {
  const result = {} as Record<SurfaceSlot, SurfaceStyle>
  for (const slot of SURFACE_SLOTS) result[slot] = { mode: 'inherit' }
  return result
}

export function validSurfaceSlot(slot: string): slot is SurfaceSlot {
  return SURFACE_SLOTS.includes(slot as SurfaceSlot)
}

export async function readThemeTokens(path: string): Promise<CompiledTheme> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isObject(raw)) throw new Error('decode compiled theme tokens: must be an object')
  rejectUnknownKeys(raw, THEME_KEYS, 'compiled theme')
  const value: CompiledTheme = {
    default: decodeTokens(raw.default, 'default'),
    light: decodeTokens(raw.light, 'light'),
    dark: decodeTokens(raw.dark, 'dark'),
  }
  for (const [variant, tokens] of Object.entries(value) as [string, ThemeTokens][]) {
    try {
      validateThemeTokens(tokens)
    } catch (error) {
      throw new Error(`${variant} theme: ${error instanceof Error ? error.message : error}`)
    }
  }
  return value
}

function decodeTokens(raw: unknown, label: string): ThemeTokens {
  if (raw === undefined) return {}
  if (!isObject(raw)) throw new Error(`decode compiled theme tokens: ${label}`)
  rejectUnknownKeys(raw, TOKEN_KEYS, `${label} theme`)
  return {
    canvas: raw.canvas ? String(raw.canvas) : undefined,
    surface: raw.surface ? String(raw.surface) : undefined,
    foreground: raw.foreground ? String(raw.foreground) : undefined,
    muted_foreground: raw.muted_foreground ? String(raw.muted_foreground) : undefined,
    accent: raw.accent ? String(raw.accent) : undefined,
    border: raw.border ? String(raw.border) : undefined,
    background_opacity: typeof raw.background_opacity === 'number' ? raw.background_opacity : undefined,
    background_blur: typeof raw.background_blur === 'number' ? raw.background_blur : undefined,
    surface_opacity: typeof raw.surface_opacity === 'number' ? raw.surface_opacity : undefined,
  }
}

export function validateThemeTokens(value: ThemeTokens): void {
  for (const [name, color] of Object.entries({
    canvas: value.canvas, surface: value.surface, foreground: value.foreground,
    muted_foreground: value.muted_foreground, accent: value.accent, border: value.border,
  })) {
    if (color && (color.length > 64 || !SAFE_COLOR.test(color))) {
      throw new Error(`compiled theme token ${name} is not a safe literal color`)
    }
  }
  const opacity = value.background_opacity ?? 0
  const blur = value.background_blur ?? 0
  if (opacity < 0 || opacity > 0.6) throw new Error('background_opacity must be between 0 and 0.6')
  if (blur < 0 || blur > 24) throw new Error('background_blur must be between 0 and 24')
  if (value.surface_opacity && (value.surface_opacity < 0.55 || value.surface_opacity > 1)) {
    throw new Error('surface_opacity must be between 0.55 and 1')
  }
}

export function pluginStorageDirectory(dataDirectory: string, id: string): string {
  return join(dataDirectory, 'services', 'plugins', STORAGE_DIR, id)
}

export function inspectBackground(payload: Buffer): { mime: string; extension: string; width: number; height: number } {
  if (payload.length > MAX_BACKGROUND_BYTES) throw new Error('background image is too large')
  let mime = ''
  let extension = ''
  let width = 0
  let height = 0
  if (payload.length >= 24 && payload[0] === 0x89 && payload.toString('ascii', 1, 4) === 'PNG') {
    if (payload.toString('ascii', 12, 16) !== 'IHDR') throw new Error('background image header is invalid')
    width = payload.readUInt32BE(16)
    height = payload.readUInt32BE(20)
    mime = 'image/png'
    extension = '.png'
  } else if (payload.length >= 3 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff) {
    const jpeg = jpegDimensions(payload)
    width = jpeg.width
    height = jpeg.height
    mime = 'image/jpeg'
    extension = '.jpg'
  } else {
    const webp = webPDimensions(payload)
    width = webp.width
    height = webp.height
    mime = 'image/webp'
    extension = '.webp'
  }
  if (width < 1 || height < 1 || width > MAX_BACKGROUND_DIMENSION || height > MAX_BACKGROUND_DIMENSION) {
    throw new Error(`background dimensions must be between 1 and ${MAX_BACKGROUND_DIMENSION} pixels`)
  }
  return { mime, extension, width, height }
}

function jpegDimensions(payload: Buffer): { width: number; height: number } {
  let offset = 2
  while (offset + 9 < payload.length) {
    if (payload[offset] !== 0xff) throw new Error('background image header is invalid')
    const marker = payload[offset + 1]!
    const size = payload.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: payload.readUInt16BE(offset + 5), width: payload.readUInt16BE(offset + 7) }
    }
    offset += 2 + size
  }
  throw new Error('background image header is invalid')
}

function webPDimensions(payload: Buffer): { width: number; height: number } {
  if (payload.length < 30 || payload.toString('ascii', 0, 4) !== 'RIFF' || payload.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('background must be PNG, JPEG or WebP')
  }
  const chunk = payload.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: 1 + payload[24]! + (payload[25]! << 8) + (payload[26]! << 16),
      height: 1 + payload[27]! + (payload[28]! << 8) + (payload[29]! << 16),
    }
  }
  if (chunk === 'VP8L') {
    if (payload[20] !== 0x2f) throw new Error('invalid lossless WebP')
    return {
      width: 1 + payload[21]! + ((payload[22]! & 0x3f) << 8),
      height: 1 + (payload[22]! >> 6) + (payload[23]! << 2) + ((payload[24]! & 0x0f) << 10),
    }
  }
  if (chunk === 'VP8 ') {
    if (payload[23] !== 0x9d || payload[24] !== 0x01 || payload[25] !== 0x2a) throw new Error('invalid lossy WebP')
    return {
      width: payload.readUInt16LE(26) & 0x3fff,
      height: payload.readUInt16LE(28) & 0x3fff,
    }
  }
  throw new Error('unsupported WebP chunk')
}

export function normalizeSurfaceStyle(value: SurfaceStyle): SurfaceStyle {
  const mode = value.mode || 'inherit'
  const imageOpacity = value.image_opacity ?? 0
  const blur = value.blur ?? 0
  if (imageOpacity < 0 || imageOpacity > 0.6 || blur < 0 || blur > 24) {
    throw new Error('image opacity must be 0..0.6 and blur must be 0..24')
  }
  for (const [name, mask] of [['light', value.light_mask], ['dark', value.dark_mask]] as const) {
    const opacity = mask?.opacity ?? 0
    if (opacity < 0 || opacity > 1 || (mask?.color && !HEX_COLOR.test(mask.color))) {
      throw new Error(`${name} mask must use a literal hex color and opacity 0..1`)
    }
  }
  if (mode === 'inherit') return { mode: 'inherit' }
  if (mode === 'solid') {
    const allowed: Record<string, string> = {
      original: '',
      paper: '#f4f1e8',
      graphite: '#252525',
      black: '#000000',
      cyan: '#008ccf',
      gold: '#f5c842',
      gray: '#6b7280',
      custom: value.custom_color ?? '',
    }
    const color = allowed[value.solid ?? '']
    if (color === undefined) throw new Error('solid surface preset is invalid')
    if (value.solid === 'original') return { mode: 'inherit' }
    if (!HEX_COLOR.test(color)) throw new Error('custom surface color must be a literal #RRGGBB color')
    const { foreground, ratio } = contrastingForeground(color)
    if (ratio < 4.5) throw new Error('surface color cannot provide 4.5:1 text contrast')
    return { ...value, mode, custom_color: color, foreground, asset_id: undefined, asset_url: undefined }
  }
  if (mode === 'image') {
    if (!value.asset_id || basename(value.asset_id) !== value.asset_id) {
      throw new Error('image surface requires a managed asset handle')
    }
    return {
      ...value,
      mode,
      light_mask: value.light_mask?.color ? value.light_mask : { color: '#ffffff', opacity: 0.12 },
      dark_mask: value.dark_mask?.color ? value.dark_mask : { color: '#000000', opacity: 0.22 },
    }
  }
  throw new Error(`unsupported surface mode "${mode}"`)
}

function contrastingForeground(color: string): { foreground: string; ratio: number } {
  const value = Number.parseInt(color.slice(1), 16)
  const component = (shift: number): number => {
    const channel = ((value >> shift) & 0xff) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * component(16) + 0.7152 * component(8) + 0.0722 * component(0)
  const black = (luminance + 0.05) / 0.05
  const white = 1.05 / (luminance + 0.05)
  return white >= black ? { foreground: '#ffffff', ratio: white } : { foreground: '#000000', ratio: black }
}

export async function validateManagedSurfaceAsset(dataDirectory: string, id: string, slot: SurfaceSlot, assetID: string): Promise<void> {
  const legacyBackground = slot === 'content-wallpaper' && assetID.startsWith('background-')
  if (!assetID || basename(assetID) !== assetID || (!assetID.startsWith(`${slot}-`) && !legacyBackground)) {
    throw new Error('managed plugin surface asset handle is invalid')
  }
  const path = join(pluginStorageDirectory(dataDirectory, id), assetID)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_BACKGROUND_BYTES) {
    throw new Error('managed plugin surface asset is unavailable')
  }
  inspectBackground(await readFile(path))
}

export function emptyActiveTheme(): ActiveTheme {
  return { tokens: {}, surfaces: defaultSurfaceStyles() }
}

export async function buildActiveTheme(
  dataDirectory: string,
  record: PackageRecord,
  skin: { configured?: boolean; opacity?: number; surfaces?: Partial<Record<SurfaceSlot, SurfaceStyle>> },
): Promise<ActiveTheme> {
  const active: ActiveTheme = {
    plugin_id: record.manifest.id,
    tokens: record.theme.default,
    light_tokens: record.theme.light,
    dark_tokens: record.theme.dark,
    surfaces: defaultSurfaceStyles(),
  }
  if (skin.configured) active.background_opacity = skin.opacity ?? 0
  for (const slot of SURFACE_SLOTS) {
    const style = skin.surfaces?.[slot]
    if (!style) continue
    const normalized = normalizeSurfaceStyle(style)
    if (normalized.mode === 'image') {
      await validateManagedSurfaceAsset(dataDirectory, record.manifest.id, slot, normalized.asset_id ?? '')
      normalized.asset_url = `milksu://app/__plugin-assets/${record.manifest.id}/${slot}/${normalized.asset_id}`
    }
    active.surfaces![slot] = normalized
  }
  return active
}

export async function writeManagedAsset(directory: string, slot: SurfaceSlot, payload: Buffer, extension: string): Promise<{ assetId: string; created: boolean }> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const digest = createHash('sha256').update(payload).digest('hex').slice(0, 16)
  const destination = join(directory, `${slot}-${digest}${extension}`)
  try {
    const existing = await lstat(destination)
    if (existing.isSymbolicLink() || !existing.isFile() || existing.size !== payload.length) {
      throw new Error('managed background destination is invalid')
    }
    const current = await readFile(destination)
    if (!current.equals(payload)) throw new Error('managed background digest collision')
    return { assetId: basename(destination), created: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = join(directory, `.background-${process.pid}-${Date.now()}`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(payload)
    await handle.sync()
    await handle.close()
    await chmod(temporary, 0o600)
    await rename(temporary, destination)
    await chmod(destination, 0o600)
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
  return { assetId: basename(destination), created: true }
}

export function assertBackgroundPermission(record: PackageRecord): void {
  if (!hasPermission(record.manifest.permissions, 'ui.background') || !contributesSlot(record.manifest.contributes?.slots, 'app.background')) {
    throw new Error('plugin is not granted the app.background slot')
  }
}
