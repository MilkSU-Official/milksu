import { randomUUID } from 'node:crypto'

export const VALID_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/
export const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export function validateIdentifier(name: string, value: string): void {
  if (!VALID_IDENTIFIER.test(value)) {
    throw new Error(`invalid ${name}`)
  }
}

export function runeCount(value: string): number {
  return [...value].length
}

export function clipRunes(value: string, max: number, ellipsis = false): string {
  const runes = [...value]
  if (runes.length <= max) return value
  return ellipsis ? `${runes.slice(0, max).join('')}…` : runes.slice(0, max).join('')
}

export function firstLine(value: string, maxRunes: number): string {
  let text = value.trim()
  if (!text || maxRunes <= 0) return ''
  for (const delimiter of ['\r\n', '\n', '\r']) {
    const cut = text.indexOf(delimiter)
    if (cut >= 0) {
      text = text.slice(0, cut).trim()
      break
    }
  }
  return clipRunes(text, maxRunes, true)
}

export function formatRFC3339(date = new Date()): string {
  return date.toISOString().replace(/\.000Z$/, 'Z')
}

export function formatSnapshotStamp(date: Date): string {
  const iso = date.toISOString().replace(/\.000Z$/, 'Z')
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}
