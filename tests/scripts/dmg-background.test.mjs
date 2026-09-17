import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  DMG_BACKGROUND_RETINA_SCALE,
  DMG_WINDOW_HEIGHT,
  DMG_WINDOW_WIDTH,
  assertDmgBackgroundSvgLayout,
  dmgBackgroundRetinaPath,
  rasterizeDmgBackground,
  scaleDmgBackgroundSvg,
} from '../../scripts/lib/dmg-background.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceSvgPath = join(repoRoot, 'desktop', 'build', 'dmg-background.svg')

test('installer SVG viewBox matches the Finder window in points', async () => {
  const svg = await readFile(sourceSvgPath, 'utf8')
  assertDmgBackgroundSvgLayout(svg)
  assert.equal(DMG_WINDOW_WIDTH, 660)
  assert.equal(DMG_WINDOW_HEIGHT, 440)
  assert.equal(DMG_BACKGROUND_RETINA_SCALE, 2)
})

test('retina sibling uses electron-builder @2x naming', () => {
  assert.equal(
    dmgBackgroundRetinaPath('/build/desktop/dmg-background.png'),
    '/build/desktop/dmg-background@2x.png',
  )
  assert.throws(() => dmgBackgroundRetinaPath('/build/desktop/dmg-background.tiff'), /must be a \.png path/)
})

test('SVG root pixel size scales without changing viewBox', async () => {
  const svg = await readFile(sourceSvgPath, 'utf8')
  const scaled = scaleDmgBackgroundSvg(svg, 1320, 880)
  assert.match(scaled, /width="1320" height="880"/u)
  assert.match(scaled, /viewBox="0 0 660 440"/u)
  assert.doesNotMatch(scaled.replace(/^<svg\b[^>]+>/u, ''), /width="1320"/u)
})

test('sips raster pair is 660x440 and 1320x880; HiDPI TIFF stays 660x440 logical', {
  skip: process.platform !== 'darwin' ? 'sips and tiffutil are macOS release tools' : false,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-dmg-background-'))
  try {
    const outputPngPath = join(dir, 'dmg-background.png')
    const { pngPath, retinaPngPath } = await rasterizeDmgBackground({
      sourceSvgPath,
      outputPngPath,
    })
    assert.equal(pngPath, outputPngPath)
    assert.equal(retinaPngPath, join(dir, 'dmg-background@2x.png'))

    const oneX = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', pngPath])
    assert.match(oneX.stdout, /pixelWidth:\s*660/u)
    assert.match(oneX.stdout, /pixelHeight:\s*440/u)

    const twoX = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', retinaPngPath])
    assert.match(twoX.stdout, /pixelWidth:\s*1320/u)
    assert.match(twoX.stdout, /pixelHeight:\s*880/u)

    const tiffPath = join(dir, 'dmg-background.tiff')
    await execFileAsync('/usr/bin/tiffutil', [
      '-cathidpicheck',
      pngPath,
      retinaPngPath,
      '-out',
      tiffPath,
    ])
    const hidpi = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tiffPath])
    assert.match(hidpi.stdout, /pixelWidth:\s*660/u)
    assert.match(hidpi.stdout, /pixelHeight:\s*440/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
