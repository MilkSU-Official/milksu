import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { decodePngRgba, encodePngRgba } from '../../scripts/lib/png-rgba.mjs'
import {
  LINUX_HICOLOR_ICON_SIZES,
  linuxIconPngName,
  resizeRgbaAreaAverage,
  writeLinuxIconSet,
} from '../../scripts/lib/linux-icons.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('area-average resize keeps a solid opaque square', () => {
  const srcW = 4
  const srcH = 4
  const src = Buffer.alloc(srcW * srcH * 4, 0)
  for (let i = 0; i < srcW * srcH; i++) {
    src[i * 4] = 200
    src[i * 4 + 1] = 40
    src[i * 4 + 2] = 80
    src[i * 4 + 3] = 255
  }
  const out = resizeRgbaAreaAverage(src, srcW, srcH, 2, 2)
  assert.equal(out.length, 2 * 2 * 4)
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 4], 200)
    assert.equal(out[i * 4 + 1], 40)
    assert.equal(out[i * 4 + 2], 80)
    assert.equal(out[i * 4 + 3], 255)
  }
})

test('writeLinuxIconSet emits hicolor sizes GNOME can look up, not 1024-only', async () => {
  const pixels = Buffer.alloc(256 * 256 * 4, 255)
  const sourcePng = encodePngRgba(256, 256, pixels)
  const dir = await mkdtemp(join(tmpdir(), 'milksu-linux-icons-'))
  try {
    const written = await writeLinuxIconSet({ sourcePng, outputDirectory: dir })
    assert.deepEqual(written.map(item => item.size), LINUX_HICOLOR_ICON_SIZES)
    assert.equal(LINUX_HICOLOR_ICON_SIZES.includes(1024), false)
    for (const item of written) {
      assert.equal(item.name, linuxIconPngName(item.size))
      const decoded = decodePngRgba(await readFile(item.file))
      assert.equal(decoded.width, item.size)
      assert.equal(decoded.height, item.size)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('brand appicon downscales to a 48px hicolor tile', async () => {
  const sourcePng = await readFile(join(repoRoot, 'build', 'appicon.png'))
  const dir = await mkdtemp(join(tmpdir(), 'milksu-linux-brand-icons-'))
  try {
    const written = await writeLinuxIconSet({ sourcePng, outputDirectory: dir })
    const tile = written.find(item => item.size === 48)
    assert.ok(tile)
    const decoded = decodePngRgba(await readFile(tile.file))
    assert.equal(decoded.width, 48)
    let opaque = 0
    for (let i = 3; i < decoded.pixels.length; i += 4) {
      if (decoded.pixels[i] > 8) opaque += 1
    }
    assert.ok(opaque > 48 * 48 * 0.2, 'downscaled brand icon should keep visible pixels')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
