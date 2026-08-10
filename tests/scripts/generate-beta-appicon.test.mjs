import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  BETA_BADGE_REGION,
  generateBetaAppIconFiles,
  renderBetaAppIcon,
  SOURCE_ICON_RELATIVE,
  OUTPUT_ICON_RELATIVE,
} from '../../scripts/generate-beta-appicon.mjs'
import { decodePngRgba } from '../../scripts/lib/png-rgba.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const brandIcon = join(repoRoot, SOURCE_ICON_RELATIVE)

test('renderBetaAppIcon keeps 1024 brand pixels outside badge and changes badge region', async () => {
  const source = await readFile(brandIcon)
  const rendered = renderBetaAppIcon(source)
  assert.notEqual(Buffer.compare(source, rendered), 0, 'beta icon must not be a byte-identical copy')

  const src = decodePngRgba(source)
  const out = decodePngRgba(rendered)
  assert.equal(out.width, 1024)
  assert.equal(out.height, 1024)

  const { x0, y0, x1, y1 } = BETA_BADGE_REGION
  let badgeDiff = 0
  let outsideDiff = 0
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const i = (y * 1024 + x) * 4
      const changed = src.pixels[i] !== out.pixels[i]
        || src.pixels[i + 1] !== out.pixels[i + 1]
        || src.pixels[i + 2] !== out.pixels[i + 2]
        || src.pixels[i + 3] !== out.pixels[i + 3]
      const inBadge = x >= x0 && x < x1 && y >= y0 && y < y1
      if (inBadge) {
        if (changed) badgeDiff++
      } else if (changed) {
        outsideDiff++
      }
    }
  }
  assert.ok(badgeDiff > 1000, `badge region should change substantially, diffs=${badgeDiff}`)
  assert.equal(outsideDiff, 0, `pixels outside badge must stay brand-identical, diffs=${outsideDiff}`)
})

test('generateBetaAppIconFiles writes sips-readable 1024 PNG distinct from brand asset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-beta-icon-'))
  try {
    await mkdir(join(dir, 'build'), { recursive: true })
    await copyFile(brandIcon, join(dir, SOURCE_ICON_RELATIVE))
    const outPath = await generateBetaAppIconFiles(dir)
    assert.equal(outPath, join(dir, OUTPUT_ICON_RELATIVE))
    const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outPath])
    assert.match(stdout, /pixelWidth:\s*1024/)
    assert.match(stdout, /pixelHeight:\s*1024/)
    const source = await readFile(join(dir, SOURCE_ICON_RELATIVE))
    const output = await readFile(outPath)
    assert.notEqual(Buffer.compare(source, output), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('renderBetaAppIcon rejects non-1024 brand assets', async () => {
  const { encodePngRgba } = await import('../../scripts/lib/png-rgba.mjs')
  const tiny = encodePngRgba(2, 2, Buffer.alloc(2 * 2 * 4, 255))
  assert.throws(() => renderBetaAppIcon(tiny), /1024x1024/)
})
