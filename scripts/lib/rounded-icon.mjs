/**
 * Rounded-rect alpha for MilkSU app icons.
 *
 * macOS masks a square icon to a squircle at display time. Windows ICO and
 * Linux hicolor tiles show the PNG as drawn, so a full-bleed square stays a
 * square tile. Bake the same corner into the brand PNG those targets use.
 *
 * The blue-haired source plates stay where they are:
 * `build/appicon.png` and `app/src/assets/milksu-app-icon.png`.
 */

/** Fraction of the icon side. About a modern desktop app tile, not a circle. */
export const ICON_CORNER_RADIUS_RATIO = 0.22

export function iconCornerRadius(size) {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`icon size must be an integer >= 2, got ${size}`)
  }
  return Math.max(1, Math.round(size * ICON_CORNER_RADIUS_RATIO))
}

/**
 * Coverage of a rounded rectangle for one sample point, 0 outside and 1 inside.
 * `radius` is the circular corner radius in the same units as `size`.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 */
export function roundedRectCoverage(x, y, size, radius) {
  let dx = 0
  let dy = 0
  if (x < radius) dx = radius - x
  else if (x > size - radius) dx = x - (size - radius)
  if (y < radius) dy = radius - y
  else if (y > size - radius) dy = y - (size - radius)
  if (dx === 0 && dy === 0) return 1
  const delta = radius - Math.hypot(dx, dy)
  if (delta >= 0.5) return 1
  if (delta <= -0.5) return 0
  return delta + 0.5
}

/**
 * Multiply alpha by the rounded-rect coverage. RGB stays put so a later
 * composite can still read the plate.
 * @param {Buffer} pixels
 * @param {number} size
 * @param {number} [radius]
 * @returns {Buffer}
 */
export function applyRoundedRectAlpha(pixels, size, radius = iconCornerRadius(size)) {
  if (pixels.length !== size * size * 4) {
    throw new Error('pixel buffer size mismatch')
  }
  const out = Buffer.from(pixels)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = roundedRectCoverage(x + 0.5, y + 0.5, size, radius)
      const i = (y * size + x) * 4 + 3
      if (coverage <= 0) out[i] = 0
      else if (coverage < 1) out[i] = Math.round(out[i] * coverage)
    }
  }
  return out
}
