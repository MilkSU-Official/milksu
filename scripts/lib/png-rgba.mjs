/**
 * Minimal 8-bit RGBA PNG codec for packaging helpers.
 * Supports color type 6 (RGBA) with filters 0-4. No external deps.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { crc32 } from 'node:zlib'

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32buf(buf) {
  // node:zlib.crc32 is available on Node 22+
  if (typeof crc32 === 'function') return crc32(buf) >>> 0
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * @param {Buffer} data
 * @returns {{ width: number, height: number, pixels: Buffer }}
 */
export function decodePngRgba(data) {
  if (!Buffer.isBuffer(data) || data.length < 8 || !data.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('not a PNG')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const chunk = data.subarray(offset + 8, offset + 8 + length)
    const crcExpected = data.readUInt32BE(offset + 8 + length)
    const crcActual = crc32buf(data.subarray(offset + 4, offset + 8 + length))
    if (crcActual !== crcExpected) throw new Error(`PNG chunk CRC mismatch for ${type}`)
    offset += 12 + length
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      bitDepth = chunk[8]
      colorType = chunk[9]
    } else if (type === 'IDAT') {
      idat.push(chunk)
    } else if (type === 'IEND') {
      break
    }
  }
  if (!width || !height) throw new Error('PNG missing IHDR')
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}; need 8-bit RGBA`)
  }
  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rowSize = stride + 1
  if (inflated.length !== rowSize * height) {
    throw new Error(`PNG inflated size mismatch: got ${inflated.length}, expected ${rowSize * height}`)
  }
  const pixels = Buffer.alloc(stride * height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize
    const filter = inflated[rowStart]
    const raw = inflated.subarray(rowStart + 1, rowStart + rowSize)
    const out = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const x = raw[i]
      const a = i >= 4 ? out[i - 4] : 0
      const b = prev[i]
      const c = i >= 4 ? prev[i - 4] : 0
      let value = 0
      switch (filter) {
        case 0: value = x; break
        case 1: value = (x + a) & 0xff; break
        case 2: value = (x + b) & 0xff; break
        case 3: value = (x + Math.floor((a + b) / 2)) & 0xff; break
        case 4: value = (x + paeth(a, b, c)) & 0xff; break
        default: throw new Error(`unsupported PNG filter ${filter}`)
      }
      out[i] = value
    }
    out.copy(pixels, y * stride)
    prev = out
  }
  return { width, height, pixels }
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} pixels RGBA
 */
export function encodePngRgba(width, height, pixels) {
  const stride = width * 4
  if (pixels.length !== stride * height) {
    throw new Error('pixel buffer size mismatch')
  }
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const dest = y * (stride + 1)
    raw[dest] = 0 // filter None is fine for packaging assets
    pixels.copy(raw, dest + 1, y * stride, y * stride + stride)
  }
  const compressed = deflateSync(raw, { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const chunk = (type, body) => {
    const typeBuf = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32buf(Buffer.concat([typeBuf, body])), 0)
    return Buffer.concat([len, typeBuf, body, crc])
  }
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Alpha-composite src over dst at (x0,y0). Both RGBA.
 */
export function compositeRgba(dst, dstW, dstH, src, srcW, srcH, x0, y0) {
  for (let y = 0; y < srcH; y++) {
    const dy = y0 + y
    if (dy < 0 || dy >= dstH) continue
    for (let x = 0; x < srcW; x++) {
      const dx = x0 + x
      if (dx < 0 || dx >= dstW) continue
      const si = (y * srcW + x) * 4
      const di = (dy * dstW + dx) * 4
      const sa = src[si + 3] / 255
      if (sa <= 0) continue
      const inv = 1 - sa
      dst[di] = Math.round(src[si] * sa + dst[di] * inv)
      dst[di + 1] = Math.round(src[si + 1] * sa + dst[di + 1] * inv)
      dst[di + 2] = Math.round(src[si + 2] * sa + dst[di + 2] * inv)
      dst[di + 3] = Math.min(255, Math.round(src[si + 3] + dst[di + 3] * inv))
    }
  }
}
