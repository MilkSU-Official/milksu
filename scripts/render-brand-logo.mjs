/**
 * Bake the white-haired companion plate into the product logo.
 *
 * Source is the Jimeng idle still (white hair, closed mouth), already
 * squared to an RGBA PNG. The blue-haired plates are not inputs and are
 * not overwritten.
 *
 *   node scripts/render-brand-logo.mjs path/to/square-rgba.png
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePngRgba, encodePngRgba } from './lib/png-rgba.mjs'
import { resizeRgbaAreaAverage } from './lib/linux-icons.mjs'
import { desktopChannelConfig } from './lib/desktop-channel.mjs'
import { applyRoundedRectAlpha } from './lib/rounded-icon.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const BRAND_LOGO_SIZE = 1024

const OUTPUTS = [
  { relative: desktopChannelConfig('stable').iconRelative, size: BRAND_LOGO_SIZE },
  { relative: 'app/public/logo.png', size: 512 },
  { relative: 'app/public/favicon.png', size: 256 },
  { relative: 'docs/public/logo.png', size: 256 },
]

/**
 * @param {Buffer} sourcePng
 * @param {number} size
 */
export function renderBrandLogoPng(sourcePng, size) {
  const decoded = decodePngRgba(sourcePng)
  if (decoded.width !== decoded.height) {
    throw new Error(`brand logo source must be square, got ${decoded.width}x${decoded.height}`)
  }
  const plate = decoded.width === size
    ? decoded.pixels
    : resizeRgbaAreaAverage(decoded.pixels, decoded.width, decoded.height, size, size)
  return encodePngRgba(size, size, applyRoundedRectAlpha(plate, size))
}

export async function writeBrandLogoSet(sourcePng, repoRoot = root) {
  const written = []
  for (const output of OUTPUTS) {
    const png = renderBrandLogoPng(sourcePng, output.size)
    const file = join(repoRoot, output.relative)
    await writeFile(file, png)
    written.push(file)
  }
  return written
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const sourcePath = process.argv[2]
  if (!sourcePath) {
    throw new Error('usage: node scripts/render-brand-logo.mjs <square-rgba.png>')
  }
  const written = await writeBrandLogoSet(await readFile(sourcePath))
  for (const file of written) process.stdout.write(`${file}\n`)
}
