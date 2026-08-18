/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const indexCss = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')

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
    expect(lightTheme).toContain('--sidebar: var(--night-chrome)')
    expect(lightTheme).toContain('--sidebar-foreground: var(--night-foreground)')
  })

  it('keeps dark command surfaces readable inside the day-mode document', () => {
    expect(indexCss).toContain('.tactical-command-surface,\n.tactical-dark-surface {')
    expect(indexCss).toContain('--foreground: var(--night-foreground)')
    expect(indexCss).toContain('--card-foreground: var(--night-foreground)')
    expect(indexCss).toContain('--popover-foreground: var(--night-foreground)')
    expect(indexCss).toContain('--muted-foreground: var(--night-muted-foreground)')
    expect(indexCss).toContain('--overlay-hover-strong: rgb(255 255 255 / 0.13)')
    expect(indexCss).toContain('--selected-bg: var(--overlay-hover-strong)')
  })

  it('limits paper colors to document surfaces in day mode', () => {
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper-surface {")
    expect(indexCss).toContain('--card: #f4f2eb')
    expect(indexCss).toContain('.tactical-desk-head {')
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper .tactical-acid-panel")
    expect(indexCss).not.toContain('\n.tactical-paper .tactical-acid-panel,\n.tactical-paper-surface .tactical-acid-panel')
  })

  it('uses the acid action color for primary buttons instead of the old SaaS blue', () => {
    expect(indexCss).toContain('background-color: var(--tactical-acid) !important')
    expect(indexCss).toContain('color: var(--brand-foreground) !important')
    expect(indexCss).toContain('border-color: var(--tactical-acid) !important')
    expect(indexCss).not.toContain('background-color: var(--tactical-blue) !important')
  })

  it('keeps night mode on neutral warm graphite instead of the retired blue-black palette', () => {
    expect(indexCss).toContain('--night-chrome: #11120f')
    expect(indexCss).toContain('--night-canvas: #171815')
    expect(indexCss).toContain('--night-card: #1f201c')
    expect(indexCss).toContain('--night-popover: #24251f')
    expect(indexCss).toContain('--night-muted: #272822')
    expect(indexCss).toContain('--night-border: #3a3c35')
    expect(indexCss).not.toMatch(/#(?:0d1115|090c0f|111519|14191d|171c21|1b2026|20262c)/i)
  })
})
