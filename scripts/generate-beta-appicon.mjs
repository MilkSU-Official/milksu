/**
 * Derive MilkSU Beta app icon from the real Stable brand asset (build/appicon.png).
 * Pure JS PNG decode/composite/encode — no Homebrew Python/Pillow, no silent copy fallback.
 *
 * Output lives under ignored build/desktop/ so generation never dirties git status.
 */

import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compositeRgba,
  decodePngRgba,
  encodePngRgba,
} from './lib/png-rgba.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE_ICON_RELATIVE = 'build/appicon.png'
export const OUTPUT_ICON_RELATIVE = 'build/desktop/appicon-beta.png'

/**
 * Compact lower-right capsule badge region (Dock-readable, ~12% width).
 * Kept small so the brand character is not covered.
 */
export const BETA_BADGE_REGION = {
  x0: 1024 - 168,
  y0: 1024 - 108,
  x1: 1024 - 28,
  y1: 1024 - 36,
}

/**
 * @param {Buffer} sourcePng
 * @returns {Buffer}
 */
export function renderBetaAppIcon(sourcePng) {
  const { width, height, pixels } = decodePngRgba(sourcePng)
  if (width !== 1024 || height !== 1024) {
    throw new Error(`brand icon must be 1024x1024, got ${width}x${height}`)
  }
  const out = Buffer.from(pixels)
  const badge = buildBetaCapsuleRgba()
  compositeRgba(
    out,
    width,
    height,
    badge.pixels,
    badge.width,
    badge.height,
    BETA_BADGE_REGION.x0,
    BETA_BADGE_REGION.y0,
  )
  return encodePngRgba(width, height, out)
}

/**
 * Small rounded capsule with BETA label.
 * Palette: deep indigo + soft violet edge (coordinates with blue/purple brand).
 */
function buildBetaCapsuleRgba() {
  const w = BETA_BADGE_REGION.x1 - BETA_BADGE_REGION.x0
  const h = BETA_BADGE_REGION.y1 - BETA_BADGE_REGION.y0
  const pixels = Buffer.alloc(w * h * 4)
  const radius = Math.floor(h / 2)
  const fill = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 4
    pixels[i] = rgba[0]
    pixels[i + 1] = rgba[1]
    pixels[i + 2] = rgba[2]
    pixels[i + 3] = rgba[3]
  }
  const insideCapsule = (x, y) => {
    const cy = h / 2
    if (x >= radius && x < w - radius) {
      return Math.abs(y - cy) <= radius - 0.5
    }
    if (x < radius) {
      const dx = x - radius
      const dy = y - cy
      return dx * dx + dy * dy <= (radius - 0.5) ** 2
    }
    const dx = x - (w - radius)
    const dy = y - cy
    return dx * dx + dy * dy <= (radius - 0.5) ** 2
  }
  // Body
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!insideCapsule(x, y)) continue
      // slight vertical gradient indigo -> violet
      const t = y / Math.max(1, h - 1)
      const r = Math.round(48 + (92 - 48) * t)
      const g = Math.round(62 + (78 - 62) * t)
      const b = Math.round(168 + (210 - 168) * t)
      fill(x, y, [r, g, b, 242])
    }
  }
  // Soft rim
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!insideCapsule(x, y)) continue
      const nearEdge = !insideCapsule(x - 1, y)
        || !insideCapsule(x + 1, y)
        || !insideCapsule(x, y - 1)
        || !insideCapsule(x, y + 1)
      if (nearEdge) fill(x, y, [210, 220, 255, 220])
    }
  }
  // Block "BETA" letters (white), scaled to capsule
  const white = [255, 255, 255, 255]
  const bar = (bx, by, bw, bh) => {
    for (let yy = by; yy < by + bh; yy++) {
      for (let xx = bx; xx < bx + bw; xx++) fill(xx, yy, white)
    }
  }
  const ly = Math.floor(h * 0.28)
  const lh = Math.floor(h * 0.46)
  const t = Math.max(3, Math.floor(h * 0.12))
  let lx = Math.floor(w * 0.14)
  const gap = Math.floor(w * 0.04)
  // B
  bar(lx, ly, t, lh)
  bar(lx, ly, Math.floor(lh * 0.55), t)
  bar(lx, ly + Math.floor(lh * 0.4), Math.floor(lh * 0.5), t)
  bar(lx, ly + lh - t, Math.floor(lh * 0.55), t)
  bar(lx + Math.floor(lh * 0.45), ly + t, t, Math.floor(lh * 0.28))
  bar(lx + Math.floor(lh * 0.45), ly + Math.floor(lh * 0.52), t, Math.floor(lh * 0.28))
  lx += Math.floor(lh * 0.7) + gap
  // E
  bar(lx, ly, t, lh)
  bar(lx, ly, Math.floor(lh * 0.6), t)
  bar(lx, ly + Math.floor(lh * 0.42), Math.floor(lh * 0.5), t)
  bar(lx, ly + lh - t, Math.floor(lh * 0.6), t)
  lx += Math.floor(lh * 0.7) + gap
  // T
  bar(lx, ly, Math.floor(lh * 0.7), t)
  bar(lx + Math.floor(lh * 0.28), ly, t, lh)
  lx += Math.floor(lh * 0.75) + gap
  // A
  bar(lx, ly + t, t, lh - t)
  bar(lx + Math.floor(lh * 0.45), ly + t, t, lh - t)
  bar(lx, ly, Math.floor(lh * 0.55), t)
  bar(lx + Math.floor(t * 0.5), ly + Math.floor(lh * 0.48), Math.floor(lh * 0.4), t)

  return { pixels, width: w, height: h }
}

export async function generateBetaAppIconFiles(repoRoot = root) {
  const sourcePath = join(repoRoot, SOURCE_ICON_RELATIVE)
  const outputPath = join(repoRoot, OUTPUT_ICON_RELATIVE)
  const source = await fs.readFile(sourcePath)
  const rendered = renderBetaAppIcon(source)
  if (rendered.equals(source)) {
    throw new Error('beta icon render produced an identical copy of the stable brand asset')
  }
  await fs.mkdir(dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, rendered)
  return outputPath
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const path = await generateBetaAppIconFiles()
  process.stdout.write(`${path}\n`)
}
