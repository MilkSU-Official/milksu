import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Finder window size in points. The SVG viewBox must match. */
export const DMG_WINDOW_WIDTH = 660
export const DMG_WINDOW_HEIGHT = 440
export const DMG_BACKGROUND_RETINA_SCALE = 2

export function dmgBackgroundRetinaPath(pngPath) {
  if (!/\.png$/i.test(pngPath)) {
    throw new Error(`DMG background output must be a .png path, got ${pngPath}`)
  }
  return pngPath.replace(/\.png$/i, '@2x.png')
}

export function scaleDmgBackgroundSvg(svg, width, height) {
  const pattern = /^(<svg\b[^>]*?)\bwidth="\d+"(\s+)height="\d+"/u
  if (!pattern.test(svg)) {
    throw new Error('DMG background SVG is missing a root width/height to scale')
  }
  return svg.replace(pattern, `$1width="${width}"$2height="${height}"`)
}

export function assertDmgBackgroundSvgLayout(svg) {
  const viewBox = `viewBox="0 0 ${DMG_WINDOW_WIDTH} ${DMG_WINDOW_HEIGHT}"`
  if (!svg.includes(viewBox)) {
    throw new Error(`DMG background SVG must use ${viewBox} so Finder points stay ${DMG_WINDOW_WIDTH}x${DMG_WINDOW_HEIGHT}`)
  }
}

/**
 * Rasterize the installer SVG at 1x and @2x.
 * electron-builder combines the pair into a HiDPI TIFF; sips still reports the
 * 1x pixel size, so the Finder window stays 660x440 points.
 */
export async function rasterizeDmgBackground({ sourceSvgPath, outputPngPath }) {
  const svg = await readFile(sourceSvgPath, 'utf8')
  assertDmgBackgroundSvgLayout(svg)
  const retinaPath = dmgBackgroundRetinaPath(outputPngPath)
  await mkdir(dirname(outputPngPath), { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'milksu-dmg-background-'))
  try {
    const svg1x = join(work, 'background.svg')
    const svg2x = join(work, 'background@2x.svg')
    await writeFile(svg1x, svg)
    await writeFile(
      svg2x,
      scaleDmgBackgroundSvg(
        svg,
        DMG_WINDOW_WIDTH * DMG_BACKGROUND_RETINA_SCALE,
        DMG_WINDOW_HEIGHT * DMG_BACKGROUND_RETINA_SCALE,
      ),
    )
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', svg1x, '--out', outputPngPath])
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', svg2x, '--out', retinaPath])
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  return { pngPath: outputPngPath, retinaPngPath: retinaPath }
}
