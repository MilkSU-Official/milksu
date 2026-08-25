/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const indexCss = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')
const flourishCss = readFileSync(fileURLToPath(new URL('./styles/ak-ui-flourish.css', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')
const markdownContentSource = readFileSync(
  fileURLToPath(new URL('./components-vue/MarkdownContent.vue', import.meta.url)),
  'utf8',
).replaceAll('\r\n', '\n')
const mainTs = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')
const akUiCss = readFileSync(fileURLToPath(new URL('./styles/ak-ui.css', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')

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

  it('keeps day mode on the tactical paper palette including chrome', () => {
    const lightTheme = indexCss.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(lightTheme).toContain('--background: #ebe9e2')
    expect(lightTheme).toContain('--background-chrome: #deddd6')
    expect(lightTheme).toContain('--sidebar: var(--background)')
    expect(lightTheme).toContain('--sidebar-foreground: var(--foreground)')
  })

  it('lets menus follow the document theme and keeps tactical-dark-surface as an optional night island', () => {
    expect(indexCss).toContain('.tactical-dark-surface {')
    expect(indexCss).toContain('.tactical-command-surface {')
    expect(indexCss).toContain('background-color: var(--popover) !important')
    expect(indexCss).toContain('.tactical-floating-surface {')
    expect(indexCss).toContain('--overlay-hover-strong: rgb(255 255 255 / 0.13)')
    expect(indexCss).toContain('--selected-bg: var(--overlay-hover-strong)')
  })

  it('limits paper colors to document surfaces in day mode', () => {
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper-surface {")
    expect(indexCss).toContain('--card: #f4f2eb')
    expect(indexCss).toContain('.tactical-desk-head {')
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper .tactical-acid-panel")
    expect(indexCss).toContain('box-shadow: inset 4px 0 0 var(--signal-gold)')
    expect(indexCss).not.toContain('\n.tactical-paper .tactical-acid-panel,\n.tactical-paper-surface .tactical-acid-panel')
  })

  it('keeps one page column width for card stacks', () => {
    expect(indexCss).toContain('--page-stack-width: 64rem')
    expect(indexCss).toContain('.page-column {')
    expect(indexCss).toContain('.page-stack {')
    expect(indexCss).toContain('.page-scroll {')
    expect(indexCss).toContain('--settings-field-fill:')
    expect(indexCss).toContain('--page-card-radius: 0.45rem')
  })

  it('keeps list-page Import on the shared execution blue fill', () => {
    expect(indexCss).toContain('[data-workspace-catalog-actions] .workspace-catalog-action[data-variant=\'default\']')
    expect(indexCss).toContain('background-color: var(--accent-blue-fill)')
  })

  it('keeps connection LIVE/OFF chrome on one shared button wrap', () => {
    expect(indexCss).toContain('[data-connection-live-action]')
    expect(indexCss).toContain('[data-connection-live-action] [data-connection-live]')
    expect(indexCss).toContain('.connection-live-action__label')
  })

  it('uses the ak-ui cyan action color instead of acid green or the old SaaS blue', () => {
    expect(indexCss).toContain('@import "./styles/ak-ui-flourish.css"')
    expect(indexCss).toContain('--brand: #05a7dc')
    expect(indexCss).toContain('--tactical-acid: #22bbff')
    expect(indexCss).toContain('--signal-gold: #f1c644')
    expect(indexCss).toContain('background-color: var(--tactical-acid) !important')
    expect(indexCss).not.toContain('#9fef00')
    expect(indexCss).not.toContain('#b7ef28')
    expect(indexCss).not.toContain('background-color: var(--tactical-blue) !important')
  })

  it('keeps night mode on the ak-ui terminal canvas instead of warm graphite or navy', () => {
    expect(indexCss).toContain('--night-chrome: #111315')
    expect(indexCss).toContain('--night-canvas: #111315')
    expect(indexCss).toContain('--night-card: #17191b')
    expect(indexCss).toContain('--night-popover: #1b1d1f')
    expect(indexCss).toContain('--night-muted: #222222')
    expect(indexCss).toContain('--night-border: #3a3d40')
    expect(indexCss).not.toMatch(/#(?:0d1115|090c0f|111519|14191d|171c21|1b2026|20262c|11120f|171815)/i)
  })

  it('uses one OFL sans stack for titles, chrome and body instead of Songti/serif', () => {
    expect(mainTs).toContain("import '@fontsource-variable/inter'")
    expect(mainTs).toContain("import '@fontsource-variable/noto-sans-sc'")
    expect(indexCss).toContain('--font-sans: "Inter Variable", "Noto Sans SC Variable"')
    expect(indexCss).toContain('--font-display: var(--font-sans)')
    expect(akUiCss).toContain('--ak-font-command: var(--font-sans)')
    expect(akUiCss).toContain('--ak-font-serif: var(--font-sans)')
    expect(indexCss).not.toContain('Noto Serif SC')
    expect(akUiCss).not.toContain('Noto Serif SC')
    expect(indexCss).not.toMatch(/--font-display:[^;]*serif/)
  })

  it('keeps night-mode agent bubbles on paper tokens so fenced code stays readable', () => {
    const agentBubble = flourishCss.match(/\.chat-bubble--agent \{([\s\S]*?)\n\}/)?.[1]
    expect(agentBubble).toContain('--foreground: #17191b')
    expect(agentBubble).toContain('--card: #f3f4ef')
    expect(agentBubble).toContain('--muted: #e6e7e1')
    expect(agentBubble).toContain('--surface-editor: #e6e7e1')
    expect(markdownContentSource).toContain('background: color-mix(in oklab, var(--surface-editor) 88%, var(--foreground));')
    expect(markdownContentSource).toContain('color: var(--foreground);')
    expect(markdownContentSource).not.toContain('color-mix(in oklab, var(--surface-editor) 82%, black)')
  })
})
