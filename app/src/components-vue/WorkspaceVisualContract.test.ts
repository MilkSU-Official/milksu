import { describe, expect, it } from 'vitest'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import chatComposerSource from './ChatComposer.vue?raw'
import chatMessageItemSource from './ChatMessageItem.vue?raw'
import contextSidebarSource from './ContextSidebar.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import workspaceRailSource from './WorkspaceRail.vue?raw'

describe('Workspace visual contract', () => {
  it('uses compact inline expansion for CTF and CVE instead of separate dashboards', () => {
    expect(ctfChallengeDeskSource).toContain('game-focus-panel')
    expect(ctfChallengeDeskSource).toContain('交给 Coding')
    expect(vulnPageSource).toContain('game-focus-panel')
    expect(vulnPageSource).toContain('关联的 Coding 对话')
    expect(vulnPageSource).not.toContain('VulnerabilityLoopPanel')
    expect(vulnPageSource).not.toContain('当前下一步')
  })

  it('raises Coding reading surfaces and aligns its compact controls', () => {
    expect(contextSidebarSource).toContain('font-size: var(--text-label)')
    expect(contextSidebarSource).toContain('font-size: var(--text-control)')
    expect(contextSidebarSource).toContain('line-height: var(--text-control--line-height)')
    expect(contextSidebarSource).toContain('<h2 class="mb-2 px-0.5 text-control font-semibold">Coding</h2>')
    expect(contextSidebarSource).toContain('px-3 py-2 text-label font-medium text-muted-foreground')
    expect(chatMessageItemSource).toContain('class="break-words text-control leading-7"')
    expect(chatComposerSource).toContain('font-size: var(--text-label)')
    expect(chatComposerSource).toContain('line-height: var(--text-label--line-height)')
    expect(chatComposerSource).toContain('class="chat-composer__goal-panel"')
    expect(chatComposerSource).toContain('border-radius: 9999px;')
    expect(workspaceRailSource).toContain('font-size: var(--text-body)')
    expect(workspaceRailSource).toContain('line-height: var(--text-body--line-height)')
  })
})
