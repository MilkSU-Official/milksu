import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import chatComposerSource from './ChatComposer.vue?raw'
import chatMessageItemSource from './ChatMessageItem.vue?raw'
import contextSidebarSource from './ContextSidebar.vue?raw'
import chatPageSource from './ChatPage.vue?raw'
import loginPageSource from './AccountLoginPage.vue?raw'
import missionOperationSource from './MissionOperationPanel.vue?raw'
import settingsPageSource from './SettingsPage.vue?raw'
import tacticalPanelShellSource from './TacticalPanelShell.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import workspaceRailSource from './WorkspaceRail.vue?raw'
import ctfPageSource from './CTFPage.vue?raw'
import domainTaskContextSource from './DomainTaskContextPanel.vue?raw'
const appStylesSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('Workspace visual contract', () => {
  it('uses compact inline expansion for CTF and CVE instead of separate dashboards', () => {
    expect(ctfChallengeDeskSource).toContain('game-focus-panel')
    expect(ctfChallengeDeskSource).toContain('交给 Coding')
    expect(vulnPageSource).toContain('game-focus-panel')
    expect(vulnPageSource).toContain('关联的 Coding 对话')
    expect(vulnPageSource).not.toContain('VulnerabilityLoopPanel')
    expect(vulnPageSource).not.toContain('当前下一步')
    expect(vulnPageSource).toContain('<WorkspaceModuleTopBar module="cve" title="漏洞">')
  })

  it('raises Coding reading surfaces and aligns its compact controls', () => {
    expect(contextSidebarSource).toContain('font-size: var(--text-label)')
    expect(contextSidebarSource).toContain('font-size: var(--text-control)')
    expect(contextSidebarSource).toContain('line-height: var(--text-control--line-height)')
    expect(contextSidebarSource).toContain('<p class="tactical-label px-0.5 text-primary">Task archive</p>')
    expect(contextSidebarSource).toContain('<h2 class="mb-3 mt-1 px-0.5 font-semibold">Coding 会话</h2>')
    expect(contextSidebarSource).toContain('px-3 py-2 text-label font-medium text-muted-foreground')
    expect(chatMessageItemSource).toContain('class="break-words text-control leading-7"')
    expect(chatComposerSource).toContain('font-size: var(--text-label)')
    expect(chatComposerSource).toContain('line-height: var(--text-label--line-height)')
    expect(chatComposerSource).toContain('class="chat-composer__goal-panel"')
    expect(chatComposerSource).toContain('border-radius: 9999px;')
    expect(workspaceRailSource).toContain('font-size: var(--text-body)')
    expect(workspaceRailSource).toContain('line-height: var(--text-body--line-height)')
  })

  it('pins every persistent dark surface to its own readable theme roles', () => {
    expect(loginPageSource).toContain('game-shell tactical-dark-surface')
    expect(settingsPageSource).toContain('settings-nav tactical-dark-surface')
    expect(chatPageSource).toContain("import TacticalPanelShell from '@/components-vue/TacticalPanelShell.vue'")
    expect(chatPageSource).toContain('class="context-sidebar"')
    expect(workspaceRailSource).toContain('--foreground: #f4f7fb')
  })

  it('uses one tactical shell for hidden Coding surfaces and adapts the task layout to its container', () => {
    expect(chatPageSource).toContain('<TacticalPanelShell')
    expect(tacticalPanelShellSource).toContain("data-panel-size='wide'")
    expect(tacticalPanelShellSource).toContain('@container coding-workspace (max-width: 68rem)')
    expect(missionOperationSource).toContain('@container chat-main (max-width: 56rem)')
    expect(missionOperationSource).toContain('overflow-wrap: anywhere')
    expect(domainTaskContextSource).toContain('@container domain-dossier (max-width: 25rem)')
  })

  it('keeps hidden menus above content and gives every floating primitive the tactical theme', () => {
    expect(ctfPageSource).toContain('z-[var(--z-overlay)]')
    expect(appStylesSource).toContain('[data-slot="select-content"]')
    expect(appStylesSource).toContain('[data-slot="sheet-content"]')
    expect(appStylesSource).toContain('[data-slot="hover-card-content"]')
    expect(appStylesSource).toContain('.tactical-floating-surface')
  })
})
