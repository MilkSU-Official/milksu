import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { decodePngRgba, encodePngRgba } from '../../scripts/lib/png-rgba.mjs'
import {
  applyRoundedRectAlpha,
  iconCornerRadius,
  roundedRectCoverage,
} from '../../scripts/lib/rounded-icon.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function alphaAt(pixels, size, x, y) {
  return pixels[(y * size + x) * 4 + 3]
}

test('rounded rect coverage is empty in the corner and solid in the middle', () => {
  const size = 100
  const radius = iconCornerRadius(size)
  assert.equal(roundedRectCoverage(0.5, 0.5, size, radius), 0)
  assert.equal(roundedRectCoverage(size / 2, size / 2, size, radius), 1)
  assert.ok(radius >= 20 && radius <= 25)
})

test('applyRoundedRectAlpha clears the corner and keeps the center', () => {
  const size = 32
  const pixels = Buffer.alloc(size * size * 4, 255)
  const out = applyRoundedRectAlpha(pixels, size)
  assert.equal(alphaAt(out, size, 0, 0), 0)
  assert.equal(alphaAt(out, size, size - 1, size - 1), 0)
  assert.equal(alphaAt(out, size, 16, 16), 255)
  const png = encodePngRgba(size, size, out)
  assert.equal(decodePngRgba(png).width, size)
})

test('product logo is the rounded white-haired plate; blue-haired sources stay square', async () => {
  const logo = decodePngRgba(await readFile(join(repoRoot, 'app/src/assets/milksu-logo.png')))
  assert.equal(logo.width, 1024)
  assert.equal(logo.height, 1024)
  assert.equal(alphaAt(logo.pixels, 1024, 0, 0), 0)
  assert.equal(alphaAt(logo.pixels, 1024, 1023, 1023), 0)
  assert.ok(alphaAt(logo.pixels, 1024, 512, 512) > 200)

  for (const relative of ['build/appicon.png', 'app/src/assets/milksu-app-icon.png']) {
    const original = decodePngRgba(await readFile(join(repoRoot, relative)))
    assert.equal(original.width, original.height)
    assert.equal(alphaAt(original.pixels, original.width, 0, 0), 255)
    assert.equal(alphaAt(original.pixels, original.width, original.width - 1, original.height - 1), 255)
  }
})
