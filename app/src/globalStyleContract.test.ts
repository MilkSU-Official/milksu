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

  it('keeps day mode on Beautiful UI cool white including chrome', () => {
    const lightTheme = indexCss.match(/:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)?.[1]

    expect(lightTheme).toContain('--day-canvas: oklch(0.985 0.001 286.376)')
    expect(lightTheme).toContain('--day-card: oklch(1 0 0)')
    expect(lightTheme).toContain('--background: color-mix(in oklab, var(--day-canvas) 86%, transparent)')
    expect(lightTheme).toContain('--card: color-mix(in oklab, var(--day-card) 80%, transparent)')
    expect(lightTheme).toContain('--foreground: oklch(0.247 0.006 258.361)')
    expect(lightTheme).toContain('--hover-2: oklch(0.933 0.003 247.86)')
    expect(lightTheme).toContain('--sidebar: color-mix(in oklab, var(--day-canvas) 74%, transparent)')
    expect(lightTheme).toContain('--sidebar-foreground: var(--foreground)')
  })

  it('lets menus follow the document theme and keeps tactical-dark-surface as an optional night island', () => {
    expect(indexCss).toContain('.tactical-dark-surface {')
    expect(indexCss).toContain('.tactical-command-surface {')
    expect(indexCss).toContain('background-color: var(--surface-clear) !important')
    expect(indexCss).toContain('backdrop-filter: var(--surface-blur)')
    expect(indexCss).toContain('.tactical-floating-surface {')
    expect(indexCss).toContain('--overlay-hover-strong: rgb(255 255 255 / 0.13)')
    expect(indexCss).toContain('--selected-bg: var(--overlay-hover-strong)')
  })

  it('limits paper colors to document surfaces in day mode', () => {
    expect(indexCss).toContain(":root[data-theme='light'] .tactical-paper-surface {")
    expect(indexCss).toContain('--card: #fafaf7')
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
    expect(indexCss).toContain('--page-card-radius: 8px')
    expect(indexCss).toContain('@import "./styles/beautiful-chrome.css"')
    const chromeCss = readFileSync(
      fileURLToPath(new URL('./styles/beautiful-chrome.css', import.meta.url)),
      'utf8',
    )
    expect(chromeCss).toContain('--bui-ease')
    expect(chromeCss).toContain('--bui-radius: 8px')
    expect(chromeCss).toContain('[data-slot="native-select"]')
    expect(chromeCss).toContain('border-radius: var(--bui-radius) !important')
    expect(chromeCss).toContain('bui-page-in')
    expect(chromeCss).toContain('.settings-nav-item.active')
    expect(chromeCss).toContain('display: none')
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

  it('scopes the Agent conversation language instead of restyling settings', () => {
    expect(indexCss).toContain('@import "./styles/agent-conversation.css"')
    const agentCss = readFileSync(
      fileURLToPath(new URL('./styles/agent-conversation.css', import.meta.url)),
      'utf8',
    )
    expect(agentCss).toContain('[data-agent-conversation]')
    expect(agentCss).toContain('.agent-thread')
    expect(agentCss).toContain('width: 72%')
    expect(agentCss).toContain('margin-inline: auto')
    expect(agentCss).toContain('.agent-thread > .chat-model-loading')
    expect(agentCss).toContain('.agent-chip')
    expect(agentCss).toContain('width: fit-content')
    expect(agentCss).toContain('.agent-approve')
    expect(agentCss).toContain('.agent-choice')
    expect(agentCss).toContain('.agent-choice__mark')
    expect(agentCss).toContain('.agent-turn-actions')
    expect(agentCss).toContain('.agent-pixel')
    expect(agentCss).toContain('agent-pixel-on')
    expect(agentCss).not.toContain('.agent-stream-tail')
    expect(agentCss).not.toContain('blur(1.6px)')
    expect(agentCss).toContain('.agent-stream-caret')
    expect(agentCss).toContain('.agent-stream-caret.is-streaming')
    expect(agentCss).toContain('agent-caret-blink')
    expect(agentCss).toContain('.agent-chrome-icon')
    expect(agentCss).toContain('.coding-terminal-dock')
    expect(agentCss).toContain('agent-chrome-in-y')
    expect(agentCss).toContain('.agent-task-rows')
    expect(agentCss).toContain('.agent-composer-aux')
    expect(agentCss).toContain('.agent-change-rows')
    expect(agentCss).toContain('.agent-status-capsule')
    expect(agentCss).toContain('justify-content: center')
    expect(agentCss).toContain('.agent-status-capsule .agent-task-rows__more')
    expect(agentCss).toContain('width: max(100%, 18rem)')
    expect(agentCss).toContain('min-width: 18rem')
    expect(agentCss).toContain('max-height: min(16rem, 42vh)')
    expect(agentCss).toContain('overflow-y: auto')
    expect(agentCss).toContain('transform: none')
    expect(agentCss).toContain('grid-template-rows')
    expect(agentCss).toContain('border-radius: 22px')
    expect(agentCss).toContain('--agent-code-radius')
    expect(agentCss).toContain('--agent-control-radius')
    expect(agentCss).toContain('--agent-island-radius')
    expect(agentCss).toContain('--agent-hairline')
    expect(agentCss).toContain('--agent-float-shadow')
    expect(agentCss).toContain('.agent-status-sep')
    expect(agentCss).not.toContain('--agent-card-radius')
    expect(agentCss).toContain('--agent-chip-radius')
    expect(agentCss).toContain('--agent-code-surface')
    expect(agentCss).not.toContain('.page-column')
    expect(agentCss).not.toContain('max-w-3xl')
  })

  it('keeps conversation cards on code blocks and the prompt island only', () => {
    const agentCss = readFileSync(
      fileURLToPath(new URL('./styles/agent-conversation.css', import.meta.url)),
      'utf8',
    )
    const userRule = agentCss.slice(
      agentCss.indexOf('[data-agent-conversation] .agent-user {'),
      agentCss.indexOf('[data-agent-conversation] .agent-user-edit {'),
    )
    const pillRule = agentCss.slice(
      agentCss.indexOf('[data-agent-conversation] .agent-pill {'),
      agentCss.indexOf('[data-agent-conversation] .agent-pill__add'),
    )
    expect(pillRule).toContain('border-radius: var(--agent-chip-radius)')
    expect(pillRule).toContain('border: 0')
    const approveRule = agentCss.slice(
      agentCss.indexOf('[data-agent-conversation] .agent-approve {'),
      agentCss.indexOf('[data-agent-conversation] .agent-approve__kicker'),
    )
    const toolDetailRule = agentCss.slice(
      agentCss.indexOf('[data-agent-conversation] .tool-activity-entry__detail {'),
      agentCss.indexOf('[data-agent-conversation] .tool-activity-entry__result-label'),
    )
    const compactRule = agentCss.slice(
      agentCss.indexOf('[data-agent-conversation] .compact-bar {'),
      agentCss.indexOf('[data-agent-conversation] .agent-composer-aux {'),
    )
    expect(userRule).toContain('border-radius: 16px')
    expect(userRule).toContain('border: 0')
    expect(userRule).toContain('box-shadow: none')
    expect(userRule).not.toContain('border: 1px solid var(--border)')
    for (const rule of [approveRule, toolDetailRule, compactRule]) {
      expect(rule).toContain('border: 0')
      expect(rule).toContain('background: transparent')
      expect(rule).not.toContain('border-radius')
    }
    expect(agentCss).toContain('[data-agent-conversation] .agent-turn .markdown-content pre')
    expect(agentCss).toContain('border-radius: var(--agent-code-radius)')
    expect(agentCss).toContain('border-radius: var(--agent-island-radius)')
    expect(agentCss).toContain('[data-agent-conversation] .agent-task-row')
    expect(agentCss).toContain('border-radius: 22px')
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

  it('keeps night mode on Beautiful UI cool black instead of warm graphite or navy', () => {
    expect(indexCss).toContain('--night-canvas: oklch(0.209 0.004 264.477)')
    expect(indexCss).toContain('--night-chrome: oklch(0.231 0.004 264.487)')
    expect(indexCss).toContain('--night-card: oklch(0.26 0.006 271.191)')
    expect(indexCss).toContain('--night-foreground: oklch(0.964 0.002 247.839)')
    expect(indexCss).toContain('--hover-2: oklch(0.318 0.007 274.747)')
    expect(indexCss).toContain('--background: color-mix(in oklab, var(--night-canvas) 88%, transparent)')
    expect(indexCss).not.toMatch(/#(?:0d1115|090c0f|111519|14191d|171c21|1b2026|20262c|11120f|171815)/i)
  })

  it('uses a clear material: opaque wash, translucent chrome, blur only on overlays', () => {
    expect(indexCss).toContain('--surface-wash: var(--night-wash)')
    expect(indexCss).toContain('--surface-clear:')
    expect(indexCss).toContain('--surface-blur: blur(22px) saturate(1.18)')
    expect(indexCss).toContain('.game-shell {\n  background-color: transparent;\n}')
    expect(indexCss).toContain('--surface-specular: inset 0 1px 0 rgb(255 255 255 / 0.08)')
    expect(indexCss).toContain('background-color: var(--surface-wash)')
    expect(indexCss).toContain('prefers-reduced-transparency')
    expect(indexCss).toContain('--surface-blur: none')
    const chromeCss = readFileSync(
      fileURLToPath(new URL('./styles/beautiful-chrome.css', import.meta.url)),
      'utf8',
    )
    expect(indexCss).toContain('--surface-read:')
    expect(chromeCss).toContain('--bui-radius: 8px')
  })

  it('uses a pointer cursor on clickable controls', () => {
    expect(indexCss).toContain('button:not(:disabled)')
    expect(indexCss).toContain('cursor: pointer')
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
    expect(markdownContentSource).toContain('background: var(--agent-code-surface, var(--card));')
    expect(markdownContentSource).toContain('color: var(--foreground);')
    expect(markdownContentSource).toContain('decorateAgentStream')
    expect(markdownContentSource).toContain('streaming?: boolean')
    expect(markdownContentSource).not.toContain('color-mix(in oklab, var(--surface-editor) 82%, black)')
  })
})
