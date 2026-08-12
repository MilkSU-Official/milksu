/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const indexCss = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

describe('global style contract', () => {
  it('keeps compact form controls on one shared font scale', () => {
    expect(indexCss).toContain('[data-slot="native-select"][data-size="sm"],\n[data-slot="select-trigger"][data-size="sm"],\n[data-slot="input"][data-size="sm"]')
    expect(indexCss).toContain('[data-slot="native-select"][data-size="default"],\n[data-slot="select-trigger"][data-size="default"],\n[data-slot="input"][data-size="default"]')
    expect(indexCss).toContain('[data-slot="native-select"][data-size="lg"],\n[data-slot="select-trigger"][data-size="lg"],\n[data-slot="input"][data-size="lg"]')
  })

  it('does not override the UI package type tokens that keep buttons globally consistent', () => {
    expect(indexCss).not.toMatch(/^\s*--text-(?:caption|body|label|control|title):/m)
  })

  it('keeps button hit targets while using the compact label type rung', () => {
    expect(indexCss).toContain('[data-button] {')
    expect(indexCss).toContain('font-size: var(--text-label)')
    expect(indexCss).toContain('line-height: var(--text-label--line-height)')
    expect(indexCss).toContain('letter-spacing: var(--text-label--letter-spacing)')
    expect(indexCss).toContain('font-weight: var(--font-weight-medium)')
  })

  it('uses a sturdier conventional weight ladder across the desktop surface', () => {
    expect(indexCss).toContain('--font-weight-normal: 400')
    expect(indexCss).toContain('--font-weight-medium: 500')
    expect(indexCss).toContain('--font-weight-semibold: 600')
    expect(indexCss).toContain('--font-weight-bold: 700')
    expect(indexCss).toContain('font-weight: var(--font-weight-normal)')
    expect(indexCss).toContain('-webkit-font-smoothing: auto')
  })

  it('keeps day mode on the tactical paper palette with a persistent dark rail', () => {
    const lightTheme = indexCss.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(lightTheme).toContain('--background: #ebe9e2')
    expect(lightTheme).toContain('--background-chrome: #deddd6')
    expect(lightTheme).toContain('--sidebar: #090c0f')
    expect(lightTheme).toContain('--sidebar-foreground: #f4f7fb')
  })

  it('keeps dark command surfaces readable inside the day-mode document', () => {
    expect(indexCss).toContain('.tactical-command-surface,\n.tactical-dark-surface {')
    expect(indexCss).toContain('--foreground: #f4f7fb')
    expect(indexCss).toContain('--card-foreground: #f4f7fb')
    expect(indexCss).toContain('--popover-foreground: #f4f7fb')
    expect(indexCss).toContain('--muted-foreground: #9ba6b4')
  })

  it('limits paper colors to document surfaces in day mode', () => {
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper-surface {")
    expect(indexCss).toContain('--card: #f4f2eb')
    expect(indexCss).toContain('.tactical-desk-head {')
  })
})
