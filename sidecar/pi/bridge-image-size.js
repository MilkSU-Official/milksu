// How many pixels an attachment holds, read from the file header only.
//
// The model-facing description line wants a size (1179x17728 px), and having it is what lets an agent
// foresee that a screenshot will be refused instead of walking into the wall. Decoding the whole image
// is not an option: attachments are described on every turn, so this has to be a header read, and the
// result is cached by content hash so the same image is measured once.
//
// Only the three containers the app accepts are parsed, and anything unreadable yields null - the
// caller shows no size rather than guessing one.

/** Bumped if the parsing changes what we would report, so cached entries can be invalidated. */
export const IMAGE_SIZE_HEADER_VERSION = 1

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function asBuffer(bytes) {
  if (!bytes) return null
  if (Buffer.isBuffer(bytes)) return bytes
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (Array.isArray(bytes)) return Buffer.from(bytes)
  return null
}

function looksNonsense(width, height) {
  return !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
}

/**
 * `{ width, height, mediaType, format }`, or null when the bytes are not an image we can measure.
 * Never throws: a damaged file must not take a turn down.
 */
export function imageSizeFromHeader(bytes) {
  const buffer = asBuffer(bytes)
  if (!buffer || buffer.length < 16) return null
  try {
    return pngSize(buffer) ?? jpegSize(buffer) ?? heicSize(buffer)
  } catch {
    return null
  }
}

function pngSize(buffer) {
  if (buffer.length < 24) return null
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) return null
  }
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (looksNonsense(width, height)) return null
  return { width, height, mediaType: "image/png", format: "png" }
}

// SOF0..SOF15, minus the ones that are not frame headers (DHT, JPG, DAC).
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    let marker = buffer[offset + 1]
    // Padding fill bytes before a marker are legal.
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1
      marker = buffer[offset + 1]
    }
    offset += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 1 >= buffer.length) return null
    const length = buffer.readUInt16BE(offset)
    if (length < 2) return null
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 7 >= buffer.length) return null
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      if (looksNonsense(width, height)) return null
      return { width, height, mediaType: "image/jpeg", format: "jpeg" }
    }
    offset += length
  }
  return null
}

// HEIC/HEIF: one file holds several `ispe` boxes - a thumbnail, a few previews, sometimes a gain map -
// and the primary image is usually NOT the first one. On the real 5712x4284 file we checked, the first
// `ispe` (byte 2357) is a 640x896 thumbnail and the primary image is the next one, so returning the
// first box silently reported the thumbnail.
//
// Resolving the primary item properly means walking meta -> pitm -> iprp/ipma and matching the item's
// property index, which is a much larger parser than this needs. So we scan a bounded window, read
// every `ispe` we find, and take the largest - which on the real file picks 5712x4284, agreeing with
// `sips`. THIS IS A HEURISTIC, not a spec-conformant primary-item lookup: a gain map larger than the
// primary image would defeat it. The earlier box wins a tie.
const HEIC_SCAN_LIMIT = 256 * 1024

function heicSize(buffer) {
  const probe = buffer.toString("latin1", 0, Math.min(buffer.length, 32))
  // 品牌清单与 internal/codingattachment/heic.go 的 heicBrands 对齐（heim/heis/hevm/hevs 是
  // HEIF 变体品牌）；avif 只在这里量尺寸，不自动转换（转换归 Go 侧，本轮不动）。
  if (!/ftyp(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif)/.test(probe)) return null
  const window = buffer.subarray(0, Math.min(buffer.length, HEIC_SCAN_LIMIT))
  let best = null
  let at = -1
  while ((at = window.indexOf("ispe", at + 1, "latin1")) >= 0) {
    if (at + 16 > window.length) break
    // The box is size(4) + 'ispe'(4) + version/flags(4) + width(4) + height(4); a size field that is
    // obviously not a box header means this ASCII is a coincidence inside image data, so skip it.
    const boxSize = window.readUInt32BE(at - 4)
    if (boxSize < 12 || boxSize > 4096) continue
    const width = window.readUInt32BE(at + 8)
    const height = window.readUInt32BE(at + 12)
    if (looksNonsense(width, height)) continue
    // Largest area wins (the primary image is the big one); ties keep the earlier box.
    if (!best || width * height > best.width * best.height) best = { width, height }
  }
  if (!best) return null
  return { width: best.width, height: best.height, mediaType: "image/heic", format: "heic" }
}

/**
 * Measure-once cache keyed by the content hash, so a conversation that re-sends the same attachment
 * does not re-parse it every turn. Unmeasurable files are remembered too (as null) for the same reason.
 */
export function createImageSizeCache({ measure = imageSizeFromHeader, limit = 512 } = {}) {
  const entries = new Map()
  return {
    sizeFor(sha256, bytes) {
      const key = String(sha256 ?? "").trim()
      if (key && entries.has(key)) return entries.get(key)
      const measured = measure(bytes)
      const value = measured && !looksNonsense(measured.width, measured.height) ? measured : null
      if (key) {
        if (entries.size >= limit) entries.delete(entries.keys().next().value)
        entries.set(key, value)
      }
      return value
    },
    get size() {
      return entries.size
    },
  }
}
