import { open, readFile } from 'node:fs/promises'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const METHOD_DEFLATE = 8

export type ZipFileEntry = {
  name: string
  data: Buffer
  mode?: number
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear())
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

function unixExternalAttributes(mode: number): number {
  return ((0o100000 | (mode & 0o777)) << 16) >>> 0
}

function writeU16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value & 0xffff, offset)
}

function writeU32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value >>> 0, offset)
}

export async function writeZipFile(path: string, entries: ZipFileEntry[], modified = new Date()): Promise<number> {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const { time, date } = dosDateTime(modified)
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const uncompressed = entry.data
    const compressed = deflateRawSync(uncompressed)
    const crc = crc32(uncompressed) >>> 0
    const local = Buffer.alloc(30 + name.length)
    writeU32(local, 0, LOCAL_SIG)
    writeU16(local, 4, 20)
    writeU16(local, 6, 0)
    writeU16(local, 8, METHOD_DEFLATE)
    writeU16(local, 10, time)
    writeU16(local, 12, date)
    writeU32(local, 14, crc)
    writeU32(local, 18, compressed.length)
    writeU32(local, 22, uncompressed.length)
    writeU16(local, 26, name.length)
    writeU16(local, 28, 0)
    name.copy(local, 30)
    chunks.push(local, compressed)
    const record = Buffer.alloc(46 + name.length)
    writeU32(record, 0, CENTRAL_SIG)
    writeU16(record, 4, 0x031e)
    writeU16(record, 6, 20)
    writeU16(record, 8, 0)
    writeU16(record, 10, METHOD_DEFLATE)
    writeU16(record, 12, time)
    writeU16(record, 14, date)
    writeU32(record, 16, crc)
    writeU32(record, 20, compressed.length)
    writeU32(record, 24, uncompressed.length)
    writeU16(record, 28, name.length)
    writeU16(record, 30, 0)
    writeU16(record, 32, 0)
    writeU16(record, 34, 0)
    writeU16(record, 36, 0)
    writeU32(record, 38, unixExternalAttributes(entry.mode ?? 0o600))
    writeU32(record, 42, offset)
    name.copy(record, 46)
    central.push(record)
    offset += local.length + compressed.length
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0)
  const eocd = Buffer.alloc(22)
  writeU32(eocd, 0, EOCD_SIG)
  writeU16(eocd, 4, 0)
  writeU16(eocd, 6, 0)
  writeU16(eocd, 8, entries.length)
  writeU16(eocd, 10, entries.length)
  writeU32(eocd, 12, centralSize)
  writeU32(eocd, 16, offset)
  writeU16(eocd, 20, 0)
  const payload = Buffer.concat([...chunks, ...central, eocd])
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(payload)
    await handle.sync()
  } finally {
    await handle.close()
  }
  return payload.length
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff)
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIG) return index
  }
  throw new Error('zip end of central directory was not found')
}

export async function readZipFile(path: string): Promise<ZipFileEntry[]> {
  const buffer = await readFile(path)
  return readZipBuffer(buffer)
}

export function readZipBuffer(buffer: Buffer): ZipFileEntry[] {
  const eocd = findEocd(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (centralOffset + centralSize > buffer.length) {
    throw new Error('zip central directory is truncated')
  }
  const result: ZipFileEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) {
      throw new Error('invalid zip central directory')
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`invalid zip local header for ${name}`)
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(compressed)
    else if (method === METHOD_DEFLATE) data = Buffer.from(inflateRawSync(compressed))
    else throw new Error(`unsupported zip compression method ${method}`)
    if (data.length !== uncompressedSize) {
      throw new Error(`zip size mismatch for ${name}`)
    }
    if ((crc32(data) >>> 0) !== crc) {
      throw new Error(`zip checksum mismatch for ${name}`)
    }
    result.push({ name, data })
  }
  return result
}
