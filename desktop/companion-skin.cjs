'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const COMPANION_SKIN_API = 'milksu.companion-skin/v1'
const FACTORY_COMPANION_SKIN_ID = 'default'
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_FRAME_EDGE = 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SKIN_ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/
const FRAME_FILE_RE = /^[a-zA-Z0-9._-]+\.png$/

const REQUIRED_FRAMES = ['idle', 'talk', 'decide']
const OPTIONAL_FRAMES = ['think', 'complete']
const ALL_FRAMES = [...REQUIRED_FRAMES, ...OPTIONAL_FRAMES]

const DEFAULT_MARK = Object.freeze({ cx: 0.5, cy: 0.24, size: 0.26 })
const DEFAULT_OVERLAY = Object.freeze({
  think: 'spin',
  decide: 'bang',
  complete: 'bang',
})

class CompanionSkinError extends Error {
  constructor(code, zh, en) {
    super(zh)
    this.name = 'CompanionSkinError'
    this.code = code
    this.zh = zh
    this.en = en
  }
}

function skinError(code, zh, en) {
  return new CompanionSkinError(code, zh, en)
}

function localizeSkinError(error, locale = 'zh') {
  if (error instanceof CompanionSkinError) {
    return locale === 'en' ? error.en : error.zh
  }
  return locale === 'en' ? 'This skin package is invalid' : '这不是有效的看板娘皮肤'
}

function isFactoryCompanionSkinId(value) {
  return String(value ?? '').trim() === FACTORY_COMPANION_SKIN_ID
}

function importedCompanionSkinId(packageId) {
  return `imported:${packageId}`
}

function pluginCompanionSkinId(pluginId) {
  return `plugin:${pluginId}`
}

function parseCompanionSkinSelection(value) {
  const id = String(value ?? '').trim()
  if (!id || id === FACTORY_COMPANION_SKIN_ID) {
    return { id: FACTORY_COMPANION_SKIN_ID, source: 'factory' }
  }
  if (id.startsWith('imported:')) {
    const packageId = id.slice('imported:'.length)
    if (packageId && SKIN_ID_RE.test(packageId) && packageId !== FACTORY_COMPANION_SKIN_ID) {
      return { id, source: 'imported', packageId }
    }
  }
  if (id.startsWith('plugin:')) {
    const pluginId = id.slice('plugin:'.length)
    if (pluginId && !pluginId.includes('..') && !/[\\/]/.test(pluginId)) {
      return { id, source: 'plugin', pluginId }
    }
  }
  return { id: FACTORY_COMPANION_SKIN_ID, source: 'factory' }
}

function factoryCompanionSkin() {
  return {
    id: FACTORY_COMPANION_SKIN_ID,
    source: 'factory',
    factory: true,
    removable: false,
    name: { zh: 'Milk', en: 'Milk' },
    overlay: { ...DEFAULT_OVERLAY },
    mark: { ...DEFAULT_MARK },
    frames: {},
    files: {},
  }
}

function normalizeSkinPackageId(value) {
  const id = String(value ?? '').trim()
  if (id === FACTORY_COMPANION_SKIN_ID) {
    throw skinError('RESERVED_ID', '皮肤 id 不能叫 default', 'Skin id cannot be default')
  }
  if (!SKIN_ID_RE.test(id)) {
    throw skinError('INVALID_ID', '皮肤 id 不合法', 'Skin id is invalid')
  }
  return id
}

function packageFileName(value) {
  const name = String(value ?? '').trim()
  if (!name || name !== path.basename(name) || name.includes('..') || /[\\/]/.test(name)) {
    throw skinError('UNSAFE_PATH', '帧路径必须是包内文件名', 'Frame paths must be package file names')
  }
  if (!FRAME_FILE_RE.test(name)) {
    throw skinError('UNSAFE_PATH', '帧必须是 PNG 文件名', 'Frames must be PNG file names')
  }
  return name
}

function inspectCompanionPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) {
    throw skinError('INVALID_IMAGE', '帧不是 PNG', 'Frame is not a PNG')
  }
  if (buffer.length > MAX_FRAME_BYTES) {
    throw skinError('INVALID_IMAGE', '单张帧不能超过 2 MiB', 'Each frame must be at most 2 MiB')
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw skinError('INVALID_IMAGE', '帧不是 PNG', 'Frame is not a PNG')
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw skinError('INVALID_IMAGE', 'PNG 头无效', 'PNG header is invalid')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  if (!width || !height || width > MAX_FRAME_EDGE || height > MAX_FRAME_EDGE) {
    throw skinError('INVALID_IMAGE', '帧边长不能超过 1024', 'Frame edges cannot exceed 1024')
  }
  if (bitDepth !== 8 || (colorType !== 4 && colorType !== 6)) {
    throw skinError('INVALID_IMAGE', '帧必须是透明 PNG', 'Frames must be transparent PNG')
  }
  return { width, height, colorType }
}

function normalizeOverlay(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const think = String(raw.think ?? DEFAULT_OVERLAY.think).trim()
  const decide = String(raw.decide ?? DEFAULT_OVERLAY.decide).trim()
  const complete = String(raw.complete ?? DEFAULT_OVERLAY.complete).trim()
  if (think !== 'spin' && think !== 'none') {
    throw skinError('INVALID_OVERLAY', '思考叠层只能是 spin 或 none', 'Think overlay must be spin or none')
  }
  if (decide !== 'bang' && decide !== 'none') {
    throw skinError('INVALID_OVERLAY', '决策叠层只能是 bang 或 none', 'Decide overlay must be bang or none')
  }
  if (complete !== 'bang' && complete !== 'none') {
    throw skinError('INVALID_OVERLAY', '完成叠层只能是 bang 或 none', 'Complete overlay must be bang or none')
  }
  return { think, decide, complete }
}

function normalizeMark(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const cx = raw.cx == null ? DEFAULT_MARK.cx : Number(raw.cx)
  const cy = raw.cy == null ? DEFAULT_MARK.cy : Number(raw.cy)
  const size = raw.size == null ? DEFAULT_MARK.size : Number(raw.size)
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(size)) {
    throw skinError('INVALID_MARK', '帽顶锚点不合法', 'Hat mark is invalid')
  }
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1 || size < 0.05 || size > 0.6) {
    throw skinError('INVALID_MARK', '帽顶锚点不合法', 'Hat mark is invalid')
  }
  return { cx, cy, size }
}

function normalizeName(value) {
  const zh = String(value?.zh ?? '').trim()
  const en = String(value?.en ?? '').trim()
  if (!zh || !en) {
    throw skinError('INVALID_NAME', '皮肤名称必须中英成对', 'Skin name must include Chinese and English')
  }
  return { zh, en }
}

function parseCompanionSkinManifest(raw) {
  const manifest = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (String(manifest.api ?? '').trim() !== COMPANION_SKIN_API) {
    throw skinError('INVALID_API', '皮肤合同版本不对', 'Skin contract version is wrong')
  }
  const framesIn = manifest.frames && typeof manifest.frames === 'object' ? manifest.frames : {}
  const files = {}
  for (const motion of REQUIRED_FRAMES) {
    if (!framesIn[motion]) {
      throw skinError('MISSING_FRAMES', `缺少 ${motion}.png`, `Missing ${motion}.png`)
    }
    files[motion] = packageFileName(framesIn[motion])
  }
  for (const motion of OPTIONAL_FRAMES) {
    if (framesIn[motion]) files[motion] = packageFileName(framesIn[motion])
  }
  return {
    api: COMPANION_SKIN_API,
    id: normalizeSkinPackageId(manifest.id),
    name: normalizeName(manifest.name),
    overlay: normalizeOverlay(manifest.overlay),
    mark: normalizeMark(manifest.mark),
    frames: { ...files },
    files,
  }
}

async function readCompanionSkinPackage(directory) {
  const root = path.resolve(String(directory ?? ''))
  let raw
  try {
    raw = JSON.parse(await fs.readFile(path.join(root, 'skin.json'), 'utf8'))
  } catch (error) {
    if (error instanceof CompanionSkinError) throw error
    throw skinError('INVALID_PACKAGE', '找不到有效的 skin.json', 'skin.json is missing or invalid')
  }
  const parsed = parseCompanionSkinManifest(raw)
  const buffers = {}
  for (const [motion, file] of Object.entries(parsed.files)) {
    let payload
    try {
      payload = await fs.readFile(path.join(root, file))
    } catch {
      throw skinError('MISSING_FRAMES', `缺少 ${file}`, `Missing ${file}`)
    }
    inspectCompanionPng(payload)
    buffers[motion] = payload
  }
  return { directory: root, ...parsed, buffers }
}

function frameDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function copyCompanionSkinPackage(sourceDirectory, destinationDirectory) {
  const parsed = await readCompanionSkinPackage(sourceDirectory)
  await fs.mkdir(destinationDirectory, { recursive: true })
  const manifest = {
    api: parsed.api,
    id: parsed.id,
    name: parsed.name,
    overlay: parsed.overlay,
    mark: parsed.mark,
    frames: parsed.frames,
  }
  await fs.writeFile(path.join(destinationDirectory, 'skin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const written = new Set()
  for (const file of Object.values(parsed.files)) {
    if (written.has(file)) continue
    written.add(file)
    await fs.copyFile(path.join(parsed.directory, file), path.join(destinationDirectory, file))
  }
  return parsed
}

function rgbaPng1x1() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  )
}

async function writeCompanionSkinFixture(directory, overrides = {}) {
  const root = path.resolve(directory)
  await fs.mkdir(root, { recursive: true })
  const png = overrides.png || rgbaPng1x1()
  const frames = {
    idle: 'idle.png',
    talk: 'talk.png',
    decide: 'decide.png',
    ...(overrides.think ? { think: 'think.png' } : {}),
    ...(overrides.complete ? { complete: 'complete.png' } : {}),
  }
  const manifest = parseCompanionSkinManifest({
    api: COMPANION_SKIN_API,
    id: overrides.id || 'product-loop.fixture',
    name: overrides.name || { zh: '回路皮肤', en: 'Loop skin' },
    overlay: overrides.overlay,
    mark: overrides.mark,
    frames,
  })
  await fs.writeFile(path.join(root, 'skin.json'), `${JSON.stringify({
    api: manifest.api,
    id: manifest.id,
    name: manifest.name,
    overlay: manifest.overlay,
    mark: manifest.mark,
    frames: manifest.frames,
  }, null, 2)}\n`)
  for (const file of new Set(Object.values(manifest.frames))) {
    await fs.writeFile(path.join(root, file), png)
  }
  return manifest
}

module.exports = {
  ALL_FRAMES,
  COMPANION_SKIN_API,
  CompanionSkinError,
  DEFAULT_MARK,
  DEFAULT_OVERLAY,
  FACTORY_COMPANION_SKIN_ID,
  MAX_FRAME_BYTES,
  MAX_FRAME_EDGE,
  REQUIRED_FRAMES,
  copyCompanionSkinPackage,
  factoryCompanionSkin,
  frameDataUrl,
  importedCompanionSkinId,
  inspectCompanionPng,
  isFactoryCompanionSkinId,
  localizeSkinError,
  parseCompanionSkinManifest,
  parseCompanionSkinSelection,
  pluginCompanionSkinId,
  readCompanionSkinPackage,
  rgbaPng1x1,
  writeCompanionSkinFixture,
}
