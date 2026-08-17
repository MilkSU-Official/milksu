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
import appSource from '../App.vue?raw'
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
    expect(contextSidebarSource).toContain('data-testid="coding-new-task-button"')
    expect(contextSidebarSource).toContain('aria-label="收起会话历史"')
    expect(contextSidebarSource).not.toContain('Task archive')
    expect(contextSidebarSource).toContain('px-3 py-1.5 text-label font-medium text-muted-foreground')
    expect(chatMessageItemSource).toContain('class="break-words text-control leading-7"')
    expect(chatComposerSource).toContain('font-size: var(--text-label)')
    expect(chatComposerSource).toContain('line-height: var(--text-label--line-height)')
    expect(chatComposerSource).toContain('class="chat-composer__goal-panel"')
    expect(chatComposerSource).toContain('border-radius: 9999px;')
    expect(workspaceRailSource).toContain('font-size: var(--text-body)')
    expect(workspaceRailSource).toContain('line-height: var(--text-body--line-height)')
  })

  it('pins every persistent dark surface to its own readable theme roles', () => {
    expect(appSource).toContain('game-shell tactical-dark-surface grid h-screen')
    expect(appSource).not.toContain('bg-[#071524]')
    expect(loginPageSource).toContain('game-shell tactical-dark-surface')
    expect(loginPageSource).toContain('login-signal-field')
    expect(loginPageSource).toContain('background: var(--primary)')
    expect(loginPageSource).toContain('mask-image: radial-gradient')
    expect(settingsPageSource).toContain('settings-nav-surface tactical-dark-surface')
    expect(settingsPageSource).toContain('background-color: rgb(17 18 15 / .68)')
    expect(settingsPageSource).not.toContain('bg-[#101418]')
    expect(chatPageSource).toContain("import TacticalPanelShell from '@/components-vue/TacticalPanelShell.vue'")
    expect(chatPageSource).toContain('class="context-sidebar"')
    expect(workspaceRailSource).toContain('--foreground: var(--night-foreground)')
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
