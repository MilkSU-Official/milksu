import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { codingAttachmentsDirectory } from '../home.ts'
import { detectContentType, lookPath, runHosted } from './paths.ts'

export const MAX_ATTACHMENT_COUNT = 8
export const MAX_ATTACHMENT_FILE_BYTES = 32 * 1024 * 1024
export const MAX_ATTACHMENT_TOTAL_BYTES = 96 * 1024 * 1024

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

export type Attachment = {
  id: string
  name: string
  mediaType: string
  size: number
  sha256: string
}

export type ImportPayload = {
  name: string
  mediaType: string
  dataBase64: string
}

export type AttachmentPreview = {
  name: string
  mediaType: string
  size: number
  kind: string
  dataUrl?: string
  text?: string
}

export function looksLikeHEIC(data: Uint8Array): boolean {
  if (data.length < 12) return false
  if (Buffer.from(data.subarray(4, 8)).toString('ascii') !== 'ftyp') return false
  return HEIC_BRANDS.has(Buffer.from(data.subarray(8, 12)).toString('ascii'))
}

export function isHEIFMediaType(mediaType: string): boolean {
  switch (mediaType.trim().toLowerCase()) {
    case 'image/heic':
    case 'image/heif':
    case 'image/heic-sequence':
    case 'image/heif-sequence':
      return true
    default:
      return false
  }
}

export function pngNameFor(name: string): string {
  const extension = extname(name)
  if (!extension) return `${name}.png`
  return `${name.slice(0, -extension.length)}.png`
}

export function pngPixelSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null
  if (
    data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47
    || data[4] !== 0x0d || data[5] !== 0x0a || data[6] !== 0x1a || data[7] !== 0x0a
  ) return null
  if (Buffer.from(data.subarray(12, 16)).toString('ascii') !== 'IHDR') return null
  const width = data[16] * 0x1000000 + data[17] * 0x10000 + data[18] * 0x100 + data[19]
  const height = data[20] * 0x1000000 + data[21] * 0x10000 + data[22] * 0x100 + data[23]
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export type HEICConverter = (sourcePath: string, targetPath: string) => Promise<void>

async function runSipsToPNG(sourcePath: string, targetPath: string): Promise<void> {
  const sips = await lookPath('sips')
  if (!sips) throw new Error(`本机系统是 ${process.platform}，没有 sips：HEIC/HEIF 照片只在 macOS 上支持导入`)
  const result = await runHosted(sips, ['-s', 'format', 'png', '--out', targetPath, sourcePath], { timeoutMs: 30_000 })
  if (result.code !== 0) {
    const detail = result.output.trim() || 'sips failed'
    throw new Error(`sips failed: ${detail}`)
  }
}

export async function convertHEICToPNG(data: Uint8Array, run?: HEICConverter): Promise<Buffer> {
  if (data.length === 0) throw new Error('empty image data')
  const convert = run ?? (process.platform === 'darwin' ? runSipsToPNG : undefined)
  if (!convert) {
    throw new Error(`本机系统是 ${process.platform}，没有 sips：HEIC/HEIF 照片只在 macOS 上支持导入`)
  }
  const directory = await mkdtemp(join(tmpdir(), 'milksu-heic-'))
  try {
    const source = join(directory, 'source.heic')
    const target = join(directory, 'converted.png')
    await writeFile(source, data, { mode: 0o600 })
    await convert(source, target)
    const converted = await readFile(target)
    if (!pngPixelSize(converted)) throw new Error('sips did not produce a PNG')
    return converted
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function prepareImportedData(
  name: string,
  mediaType: string,
  data: Buffer,
  convert?: HEICConverter,
): Promise<{ name: string; mediaType: string; data: Buffer }> {
  if (!looksLikeHEIC(data) && !isHEIFMediaType(mediaType)) {
    return { name, mediaType, data }
  }
  try {
    const converted = await convertHEICToPNG(data, convert)
    return { name: pngNameFor(name), mediaType: 'image/png', data: converted }
  } catch (error) {
    throw new Error(`附件 ${JSON.stringify(name)} 是 HEIC/HEIF 照片，无法在本机转成 PNG：${error instanceof Error ? error.message : error}`)
  }
}

function validateName(name: string): void {
  if (
    !name
    || name === '.'
    || name === '/'
    || name === '\\'
    || [...name].length > 160
    || [...name].some((ch) => ch.charCodeAt(0) < 0x20 || ch === '\u007f')
  ) {
    throw new Error('附件文件名无效')
  }
}

const EXT_MEDIA: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

function resolveAttachmentMediaType(name: string, declaredMediaType: string, data: Uint8Array): string {
  let detected = detectContentType(data).toLowerCase()
  const detectedSep = detected.indexOf(';')
  if (detectedSep >= 0) detected = detected.slice(0, detectedSep)
  if (detected.startsWith('image/')) return detected
  let mediaType = declaredMediaType.trim().toLowerCase()
  const sep = mediaType.indexOf(';')
  if (sep >= 0) mediaType = mediaType.slice(0, sep)
  if (!mediaType) mediaType = EXT_MEDIA[extname(name).toLowerCase()] ?? detected
  return mediaType
}

function attachmentFromData(name: string, declaredMediaType: string, data: Buffer): Attachment {
  validateName(name)
  if (data.length === 0 || data.length > MAX_ATTACHMENT_FILE_BYTES) {
    throw new Error(`附件 ${JSON.stringify(name)} 必须在 1 字节到 32 MiB 之间`)
  }
  const digestHex = createHash('sha256').update(data).digest('hex')
  return {
    id: digestHex,
    name,
    mediaType: resolveAttachmentMediaType(name, declaredMediaType, data),
    size: data.length,
    sha256: digestHex,
  }
}

export class AttachmentStore {
  readonly root: string
  private readonly convert?: HEICConverter

  constructor(root: string, convert?: HEICConverter) {
    this.root = root
    this.convert = convert
  }

  static async open(home: string, convert?: HEICConverter): Promise<AttachmentStore> {
    const root = codingAttachmentsDirectory(home)
    await mkdir(root, { recursive: true, mode: 0o700 })
    try {
      await chmod(root, 0o700)
    } catch {
      // Windows directory mode is best-effort
    }
    return new AttachmentStore(root, convert)
  }

  async importPaths(paths: string[]): Promise<Attachment[]> {
    if (paths.length > MAX_ATTACHMENT_COUNT) throw new Error(`一次最多添加 ${MAX_ATTACHMENT_COUNT} 个附件`)
    const attachments: Attachment[] = []
    let total = 0
    for (const sourcePath of paths) {
      const { attachment, data } = await this.readSource(sourcePath)
      total += attachment.size
      if (total > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('附件合计不能超过 96 MiB')
      await this.persist(attachment, data)
      attachments.push(attachment)
    }
    return attachments
  }

  async importPayloads(payloads: ImportPayload[]): Promise<Attachment[]> {
    if (payloads.length > MAX_ATTACHMENT_COUNT) throw new Error(`一次最多添加 ${MAX_ATTACHMENT_COUNT} 个附件`)
    const attachments: Attachment[] = []
    let total = 0
    for (const payload of payloads) {
      if (Buffer.byteLength(payload.dataBase64, 'utf8') > MAX_ATTACHMENT_FILE_BYTES * 2) {
        throw new Error(`附件 ${JSON.stringify(payload.name)} 必须在 1 字节到 32 MiB 之间`)
      }
      let data: Buffer
      try {
        data = Buffer.from(payload.dataBase64, 'base64')
      } catch {
        throw new Error(`附件 ${JSON.stringify(payload.name)} 的数据无效`)
      }
      const prepared = await prepareImportedData(payload.name, payload.mediaType, data, this.convert)
      const attachment = attachmentFromData(prepared.name, prepared.mediaType, prepared.data)
      total += attachment.size
      if (total > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('附件合计不能超过 96 MiB')
      await this.persist(attachment, prepared.data)
      attachments.push(attachment)
    }
    return attachments
  }

  async preview(attachment: Attachment): Promise<AttachmentPreview> {
    const data = await this.read(attachment)
    const mediaType = resolveAttachmentMediaType(attachment.name, attachment.mediaType, data)
    const preview: AttachmentPreview = {
      name: attachment.name,
      mediaType,
      size: data.length,
      kind: 'metadata',
    }
    if (mediaType.startsWith('image/') && data.length <= 12 * 1024 * 1024) {
      preview.kind = 'image'
      preview.dataUrl = `data:${mediaType};base64,${data.toString('base64')}`
      return preview
    }
    if (
      (mediaType.startsWith('text/') || mediaType.includes('json') || mediaType.includes('xml'))
      && data.length <= 1024 * 1024
      && Buffer.byteLength(data.toString('utf8'), 'utf8') === data.length
      && !data.includes(0)
    ) {
      preview.kind = 'text'
      preview.text = data.toString('utf8')
    }
    return preview
  }

  private async readSource(sourcePath: string): Promise<{ attachment: Attachment; data: Buffer }> {
    const trimmed = sourcePath.trim()
    const info = await lstat(trimmed)
    const name = basename(trimmed)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`附件 ${JSON.stringify(name)} 必须是普通文件，不能是链接或目录`)
    }
    validateName(name)
    if (info.size <= 0 || info.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new Error(`附件 ${JSON.stringify(name)} 必须在 1 字节到 32 MiB 之间`)
    }
    const handle = await open(trimmed, 'r')
    let data: Buffer
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size !== info.size) {
        throw new Error(`附件 ${JSON.stringify(name)} 在读取前发生变化`)
      }
      data = await handle.readFile()
    } finally {
      await handle.close()
    }
    if (data.length === 0 || data.length > MAX_ATTACHMENT_FILE_BYTES || data.length !== info.size) {
      throw new Error(`附件 ${JSON.stringify(name)} 在读取时发生变化或大小无效`)
    }
    const prepared = await prepareImportedData(name, '', data, this.convert)
    return { attachment: attachmentFromData(prepared.name, prepared.mediaType, prepared.data), data: prepared.data }
  }

  private async read(attachment: Attachment): Promise<Buffer> {
    if (attachment.id.length !== 64 || attachment.id !== attachment.sha256 || !/^[0-9a-f]+$/i.test(attachment.id)) {
      throw new Error('附件元数据无效')
    }
    validateName(attachment.name)
    const path = join(this.root, attachment.id, attachment.name)
    let info
    try {
      info = await lstat(path)
    } catch {
      throw new Error(`附件 ${JSON.stringify(attachment.name)} 不可用`)
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`附件 ${JSON.stringify(attachment.name)} 不可用`)
    }
    if (attachment.size !== 0 && info.size !== attachment.size) {
      throw new Error(`附件 ${JSON.stringify(attachment.name)} 不可用`)
    }
    const data = await readFile(path)
    const digest = createHash('sha256').update(data).digest('hex')
    if (digest !== attachment.sha256) throw new Error(`附件 ${JSON.stringify(attachment.name)} 完整性校验失败`)
    return data
  }

  private async persist(attachment: Attachment, data: Buffer): Promise<void> {
    const directory = join(this.root, attachment.id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await chmod(directory, 0o700)
    } catch {
      // Windows
    }
    const destination = join(directory, attachment.name)
    try {
      const existing = await lstat(destination)
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== attachment.size) {
        throw new Error(`附件存储目标 ${JSON.stringify(attachment.name)} 已存在但内容无效`)
      }
      const existingData = await readFile(destination)
      const existingDigest = createHash('sha256').update(existingData).digest('hex')
      if (existingDigest !== attachment.sha256) {
        throw new Error(`附件存储目标 ${JSON.stringify(attachment.name)} 的哈希不一致`)
      }
      try { await chmod(destination, 0o600) } catch { /* ignore */ }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && error instanceof Error && error.message.startsWith('附件存储目标')) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof Error && error.message.startsWith('附件'))) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error(`inspect attachment destination ${JSON.stringify(attachment.name)}: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    const temporaryPath = join(directory, `.import-${randomUUID()}`)
    await writeFile(temporaryPath, data, { mode: 0o600 })
    try {
      await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, destination)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw new Error(`store attachment ${JSON.stringify(attachment.name)}: ${error instanceof Error ? error.message : error}`)
    }
  }
}

export const ATTACHMENT_FILE_FILTERS = [
  {
    name: '代码、文档与图片',
    extensions: [
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'md', 'json', 'yaml', 'yml', 'toml',
      'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'go', 'rs', 'c', 'cpp', 'h',
      'java', 'kt', 'swift', 'sh', 'sql', 'csv', 'pdf', 'zip', 'gz', 'tar',
    ],
  },
  { name: '所有文件', extensions: ['*'] },
]
