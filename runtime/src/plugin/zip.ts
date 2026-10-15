import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { canonicalArchivePaths } from './digest.ts'
import { MAX_PACKAGE_ARCHIVE_BYTES, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from './types.ts'
import { validSlashPath } from './util.ts'

const ZIP_STORED = 0
const ZIP_DEFLATE = 8

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
      return i
    }
  }
  throw new Error('open plugin package: missing zip directory')
}

export async function extractPluginArchive(archive: Buffer, destination: string): Promise<void> {
  if (archive.length > MAX_PACKAGE_ARCHIVE_BYTES) {
    throw new Error(`plugin package must be a regular .milksu-plugin file no larger than ${MAX_PACKAGE_ARCHIVE_BYTES >> 20} MiB`)
  }
  const eocd = findEocd(archive)
  const diskEntries = archive.readUInt16LE(eocd + 8)
  const totalEntries = archive.readUInt16LE(eocd + 10)
  const directorySize = archive.readUInt32LE(eocd + 12)
  const directoryOffset = archive.readUInt32LE(eocd + 16)
  if (diskEntries !== totalEntries || archive.readUInt16LE(eocd + 4) !== 0 || archive.readUInt16LE(eocd + 6) !== 0) {
    throw new Error('open plugin package: zip64 or split archives are not accepted')
  }
  if (totalEntries === 0 || totalEntries > MAX_PACKAGE_FILES) {
    throw new Error(`plugin package must contain between 1 and ${MAX_PACKAGE_FILES} files`)
  }
  const directory = archive.subarray(directoryOffset, directoryOffset + directorySize)
  const caseFolded = new Map<string, string>()
  let cursor = 0
  let total = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (directory[cursor] !== 0x50 || directory[cursor + 1] !== 0x4b || directory[cursor + 2] !== 0x01 || directory[cursor + 3] !== 0x02) {
      throw new Error('open plugin package: invalid central directory')
    }
    const compression = directory.readUInt16LE(cursor + 10)
    const compressedSize = directory.readUInt32LE(cursor + 20)
    const uncompressedSize = directory.readUInt32LE(cursor + 24)
    const nameLength = directory.readUInt16LE(cursor + 28)
    const extraLength = directory.readUInt16LE(cursor + 30)
    const commentLength = directory.readUInt16LE(cursor + 32)
    const external = directory.readUInt32LE(cursor + 38)
    const localOffset = directory.readUInt32LE(cursor + 42)
    const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    const trimmed = name.endsWith('/') ? name.slice(0, -1) : name
    if (!trimmed) continue
    if (!validSlashPath(trimmed) || name.includes('\\')) {
      throw new Error(`plugin archive path "${name}" is invalid`)
    }
    const folded = trimmed.toLowerCase()
    const previous = caseFolded.get(folded)
    if (previous && previous !== trimmed) {
      throw new Error(`plugin archive paths collide across filesystems: ${previous} and ${trimmed}`)
    }
    if (previous === trimmed) throw new Error(`plugin archive contains duplicate path "${trimmed}"`)
    caseFolded.set(folded, trimmed)
    const isDirectory = name.endsWith('/') || ((external >>> 16) & 0o170000) === 0o040000
    const isSymlink = ((external >>> 16) & 0o170000) === 0o120000
    if (isSymlink) throw new Error(`plugin archive entry "${trimmed}" is not a regular file or directory`)
    if (isDirectory) continue
    if (compression !== ZIP_STORED && compression !== ZIP_DEFLATE) {
      throw new Error(`plugin archive entry "${trimmed}" uses an unsupported compression method`)
    }
    total += uncompressedSize
    if (uncompressedSize > MAX_PACKAGE_BYTES || total > MAX_PACKAGE_BYTES) {
      throw new Error(`plugin package expands beyond ${MAX_PACKAGE_BYTES >> 20} MiB`)
    }
    if (compressedSize > 0 && uncompressedSize > compressedSize * 1000) {
      throw new Error(`plugin archive entry "${trimmed}" has a suspicious compression ratio`)
    }
    if (archive[localOffset] !== 0x50 || archive[localOffset + 1] !== 0x4b || archive[localOffset + 2] !== 0x03 || archive[localOffset + 3] !== 0x04) {
      throw new Error(`extract plugin archive entry "${trimmed}" failed`)
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)
    const payload = compression === ZIP_STORED ? compressed : inflateRawSync(compressed)
    if (payload.length !== uncompressedSize) {
      throw new Error(`extract plugin archive entry "${trimmed}" failed`)
    }
    const path = join(destination, ...trimmed.split('/'))
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(payload)
      await handle.close()
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
  }
}

function writeU16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value & 0xffff, offset)
}

function writeU32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value >>> 0, offset)
}

export async function createDeterministicZip(directory: string, outputPath: string): Promise<void> {
  const paths = await canonicalArchivePaths(directory)
  if (paths.length === 0 || paths.length > MAX_PACKAGE_FILES) {
    throw new Error(`plugin package must contain between 1 and ${MAX_PACKAGE_FILES} files`)
  }
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let total = 0
  for (const relative of paths) {
    const payload = await readFile(join(directory, ...relative.split('/')))
    total += payload.length
    if (payload.length > MAX_PACKAGE_BYTES || total > MAX_PACKAGE_BYTES) {
      throw new Error(`plugin package expands beyond ${MAX_PACKAGE_BYTES >> 20} MiB`)
    }
    const name = Buffer.from(relative, 'utf8')
    const crc = crc32(payload) >>> 0
    const local = Buffer.alloc(30 + name.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0)
    writeU16(local, 8, ZIP_STORED)
    writeU16(local, 10, 0)
    writeU16(local, 12, 0)
    writeU32(local, 14, crc)
    writeU32(local, 18, payload.length)
    writeU32(local, 22, payload.length)
    writeU16(local, 26, name.length)
    writeU16(local, 28, 0)
    name.copy(local, 30)
    locals.push(local, payload)
    const record = Buffer.alloc(46 + name.length)
    writeU32(record, 0, 0x02014b50)
    writeU16(record, 4, 0x0314)
    writeU16(record, 6, 20)
    writeU16(record, 8, 0)
    writeU16(record, 10, ZIP_STORED)
    writeU16(record, 12, 0)
    writeU16(record, 14, 0)
    writeU32(record, 16, crc)
    writeU32(record, 20, payload.length)
    writeU32(record, 24, payload.length)
    writeU16(record, 28, name.length)
    writeU16(record, 30, 0)
    writeU16(record, 32, 0)
    writeU16(record, 34, 0)
    writeU16(record, 36, 0)
    writeU32(record, 38, ((0o100000 | 0o600) << 16) >>> 0)
    writeU32(record, 42, offset)
    name.copy(record, 46)
    central.push(record)
    offset += local.length + payload.length
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0)
  const eocd = Buffer.alloc(22)
  writeU32(eocd, 0, 0x06054b50)
  writeU16(eocd, 4, 0)
  writeU16(eocd, 6, 0)
  writeU16(eocd, 8, paths.length)
  writeU16(eocd, 10, paths.length)
  writeU32(eocd, 12, centralSize)
  writeU32(eocd, 16, offset)
  writeU16(eocd, 20, 0)
  const archive = Buffer.concat([...locals, ...central, eocd])
  if (archive.length > MAX_PACKAGE_ARCHIVE_BYTES) {
    throw new Error('signed plugin archive is too large')
  }
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  const handle = await open(outputPath, 'wx', 0o600)
  let complete = false
  try {
    await handle.writeFile(archive)
    await handle.sync()
    await handle.close()
    complete = true
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  } finally {
    if (!complete) await unlink(outputPath).catch(() => {})
  }
}
