import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodePngRgba, encodePngRgba } from './png-rgba.mjs'

// hicolor's index.theme on Ubuntu/Debian lists up to 512x512, not 1024x1024.
// electron-builder 26 ships a single source PNG as-is, so a 1024 brand asset
// lands only in an unindexed directory and GNOME falls back to a gear icon.
export const LINUX_HICOLOR_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

export function linuxIconPngName(size) {
  return `${size}x${size}.png`
}

export function resizeRgbaAreaAverage(src, srcW, srcH, dstW, dstH) {
  if (!Number.isInteger(dstW) || !Number.isInteger(dstH) || dstW < 1 || dstH < 1) {
    throw new Error(`invalid resize target ${dstW}x${dstH}`)
  }
  if (src.length !== srcW * srcH * 4) {
    throw new Error('source pixel buffer size mismatch')
  }
  const dst = Buffer.alloc(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy0 = (y * srcH) / dstH
    const sy1 = ((y + 1) * srcH) / dstH
    for (let x = 0; x < dstW; x++) {
      const sx0 = (x * srcW) / dstW
      const sx1 = ((x + 1) * srcW) / dstW
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let area = 0
      const ix0 = Math.floor(sx0)
      const iy0 = Math.floor(sy0)
      const ix1 = Math.min(srcW, Math.ceil(sx1))
      const iy1 = Math.min(srcH, Math.ceil(sy1))
      for (let iy = iy0; iy < iy1; iy++) {
        const yOverlap = Math.min(sy1, iy + 1) - Math.max(sy0, iy)
        if (yOverlap <= 0) continue
        for (let ix = ix0; ix < ix1; ix++) {
          const xOverlap = Math.min(sx1, ix + 1) - Math.max(sx0, ix)
          if (xOverlap <= 0) continue
          const weight = xOverlap * yOverlap
          const i = (iy * srcW + ix) * 4
          const pa = src[i + 3] / 255
          r += src[i] * pa * weight
          g += src[i + 1] * pa * weight
          b += src[i + 2] * pa * weight
          a += src[i + 3] * weight
          area += weight
        }
      }
      const di = (y * dstW + x) * 4
      if (area <= 0) continue
      const alpha = a / area
      dst[di + 3] = Math.round(alpha)
      if (alpha > 0) {
        const pa = alpha / 255
        dst[di] = Math.round(r / area / pa)
        dst[di + 1] = Math.round(g / area / pa)
        dst[di + 2] = Math.round(b / area / pa)
      }
    }
  }
  return dst
}

export async function writeLinuxIconSet({ sourcePng, outputDirectory }) {
  const decoded = decodePngRgba(sourcePng)
  if (decoded.width !== decoded.height) {
    throw new Error(`Linux icon source must be square, got ${decoded.width}x${decoded.height}`)
  }
  if (decoded.width < 256) {
    throw new Error(`Linux icon source must be at least 256x256, got ${decoded.width}`)
  }
  await mkdir(outputDirectory, { recursive: true })
  const written = []
  for (const size of LINUX_HICOLOR_ICON_SIZES) {
    const pixels = size === decoded.width
      ? decoded.pixels
      : resizeRgbaAreaAverage(decoded.pixels, decoded.width, decoded.height, size, size)
    const png = encodePngRgba(size, size, pixels)
    const name = linuxIconPngName(size)
    const file = join(outputDirectory, name)
    await writeFile(file, png)
    written.push({ size, file, name })
  }
  return written
}
