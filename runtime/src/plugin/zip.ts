import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
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
