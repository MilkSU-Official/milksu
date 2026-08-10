import { describe, expect, it } from 'vitest'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import chatComposerSource from './ChatComposer.vue?raw'
import chatMessageItemSource from './ChatMessageItem.vue?raw'
import contextSidebarSource from './ContextSidebar.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import workspaceDetailTitleSource from './WorkspaceDetailTitle.vue?raw'
import workspaceRailSource from './WorkspaceRail.vue?raw'

describe('Workspace visual contract', () => {
  it('uses one shared detail title component for CTF and CVE detail panes', () => {
    expect(workspaceDetailTitleSource).toContain('data-workspace-detail-title')
    expect(workspaceDetailTitleSource).toContain('workspace-detail-title mt-3 text-2xl font-semibold')
    expect(workspaceDetailTitleSource).toContain('<h2')

    expect(ctfChallengeDeskSource).toContain("import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'")
    expect(ctfChallengeDeskSource).toContain('<WorkspaceDetailTitle :title="selectedNssctf.title" />')
    expect(ctfChallengeDeskSource).toContain('<WorkspaceDetailTitle :title="selectedCtfshow.title" />')

    expect(vulnPageSource).toContain("import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'")
    expect(vulnPageSource).toContain('<WorkspaceDetailTitle class="mt-4" :title="dashboard.selected.value.title" />')
    expect(vulnPageSource).not.toContain('text-xl font-semibold leading-8')
  })

  it('raises Coding reading surfaces and aligns its compact controls', () => {
    expect(contextSidebarSource).toContain('font-size: var(--text-body)')
    expect(contextSidebarSource).toContain('line-height: var(--text-body--line-height)')
    expect(contextSidebarSource).toContain('letter-spacing: var(--text-body--letter-spacing)')
    expect(contextSidebarSource).toContain('<h2 class="mb-2 px-0.5 text-body font-semibold">Coding</h2>')
    expect(contextSidebarSource).toContain('px-3 py-2 text-body font-medium text-muted-foreground')
    expect(chatMessageItemSource).toContain('class="break-words text-control leading-7"')
    expect(chatComposerSource).toContain('font-size: var(--text-label)')
    expect(chatComposerSource).toContain('line-height: var(--text-label--line-height)')
    expect(chatComposerSource).toContain('class="chat-composer__goal-panel"')
    expect(chatComposerSource).toContain('border-radius: 9999px;')
    expect(workspaceRailSource).toContain('font-size: var(--text-body)')
    expect(workspaceRailSource).toContain('line-height: var(--text-body--line-height)')
  })
})
