import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ctfChallengeDeskSource from './CTFChallengeDesk.vue?raw'
import chatComposerSource from './ChatComposer.vue?raw'
import chatMessageItemSource from './ChatMessageItem.vue?raw'
import contextSidebarSource from './ContextSidebar.vue?raw'
import chatPageSource from './ChatPage.vue?raw'
import conversationDockSource from './ConversationDock.vue?raw'
import loginPageSource from './AccountLoginPage.vue?raw'
import missionOperationSource from './MissionOperationPanel.vue?raw'
import settingsPageSource from './SettingsPage.vue?raw'
import tacticalPanelShellSource from './TacticalPanelShell.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import labPageSource from './LabPage.vue?raw'
import profilePageSource from './ProfilePage.vue?raw'
import evalSettingsPanelSource from './EvalSettingsPanel.vue?raw'
import vulnIntelSettingsSource from './VulnerabilityIntelSettingsPanel.vue?raw'
import workspaceRailSource from './WorkspaceRail.vue?raw'
import ctfArtifactsSource from './CTFArtifacts.vue?raw'
import ctfPageSource from './CTFPage.vue?raw'
import ctfTrajectorySource from './CTFTrajectory.vue?raw'
import domainTaskContextSource from './DomainTaskContextPanel.vue?raw'
import appSource from '../App.vue?raw'
const appStylesSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('Workspace visual contract', () => {
  it('opens CTF and CVE into a dossier instead of expanding the list', () => {
    expect(ctfChallengeDeskSource).not.toContain('game-focus-panel')
    expect(vulnPageSource).not.toContain('game-focus-panel')
    expect(vulnPageSource).toContain('开始复现')
    expect(vulnPageSource).toContain('ResearchReportPanel')
    expect(vulnPageSource).toContain('ConversationDock')
    expect(vulnPageSource).toContain('RelatedCvePanel')
    expect(vulnPageSource).toContain('data-testid="open-item"')
    expect(chatPageSource).toContain("surface?: 'page' | 'dock'")
    expect(chatPageSource).toContain("props.surface === 'dock'")
    expect(chatPageSource).toContain(':context-usage="contextUsagePresentation"')
    expect(conversationDockSource).toContain('surface="dock"')
    expect(conversationDockSource).not.toContain("from '@/components-vue/ContextUsageMeter.vue'")
    expect(chatComposerSource).toContain('data-testid="composer-context-strip"')
    expect(vulnPageSource).toContain('SettingsSection')
    expect(vulnPageSource).not.toContain('rounded-xl border border-border bg-card p-6')
    expect(vulnPageSource).not.toContain('VulnerabilityLoopPanel')
    expect(vulnPageSource).not.toContain('当前下一步')
    expect(vulnPageSource).toContain('<WorkspaceModuleTopBar module="cve" :title="t(\'漏洞\', \'CVE\')">')
  })

  it('raises Coding reading surfaces and aligns its compact controls', () => {
    expect(contextSidebarSource).toContain('font-size: var(--text-label)')
    expect(contextSidebarSource).toContain('font-size: var(--text-control)')
    expect(contextSidebarSource).toContain('line-height: var(--text-control--line-height)')
    expect(contextSidebarSource).toContain('data-testid="coding-new-task-button"')
    expect(contextSidebarSource).toContain('新会话')
    // Open panel: collapse is the first header row; new-session is one row below.
    expect(contextSidebarSource).toContain('收起会话历史')
    expect(contextSidebarSource).toContain('coding-history-header')
    expect(contextSidebarSource).toContain(".coding-history-toggle[aria-expanded='true']:not(:hover)::before")
    expect(contextSidebarSource).not.toContain('Task archive')
    expect(contextSidebarSource).toContain('px-3 py-1.5 text-label font-medium text-muted-foreground')
    expect(contextSidebarSource).toContain('group flex items-center transition-colors hover:bg-accent/50')
    expect(contextSidebarSource).toContain('color: var(--foreground)')
    // Collapsed: expand + new-task park on the Coding topbar leading slot.
    expect(chatPageSource).toContain('data-testid="coding-history-toggle"')
    expect(chatPageSource).toContain('coding-history-collapsed-controls')
    expect(chatPageSource).toContain('展开会话历史')
    expect(chatPageSource).toContain('v-if="!conversationDrawerOpen"')
    expect(chatMessageItemSource).toContain('break-words text-control leading-7')
    expect(chatComposerSource).toContain('font-size: var(--text-label)')
    expect(chatComposerSource).toContain('line-height: var(--text-label--line-height)')
    expect(chatComposerSource).toContain('class="chat-composer__goal-panel"')
    expect(chatComposerSource).toContain('border-radius: 9999px;')
    expect(chatComposerSource).toContain('background-color: var(--card)')
    expect(chatComposerSource).toContain('color: var(--foreground)')
    expect(chatComposerSource).not.toContain('background-color: #f3f4ef')
    expect(workspaceRailSource).toContain('font-size: var(--text-body)')
    expect(workspaceRailSource).toContain('line-height: var(--text-body--line-height)')
    expect(workspaceRailSource).toContain('FlaskConical')
    expect(workspaceRailSource).toContain('lab: FlaskConical')
    expect(workspaceRailSource).toContain('ak-media--album workspace-rail-profile__album')
  })

  it('lets chrome follow the document theme instead of pinning night graphite in day mode', () => {
    expect(appSource).not.toContain('bg-[#071524]')
    expect(appSource).toContain('bg-background text-xl font-semibold text-foreground')
    expect(loginPageSource).toContain('login-signal-field')
    expect(loginPageSource).toContain('background: var(--primary)')
    expect(loginPageSource).toContain('mask-image: radial-gradient')
    expect(loginPageSource).not.toContain('tactical-dark-surface')
    expect(settingsPageSource).toContain('settings-nav-surface')
    expect(settingsPageSource).not.toContain('tactical-dark-surface')
    expect(settingsPageSource).toContain('background-color: var(--background)')
    expect(settingsPageSource).toContain('settings-notice--ok')
    expect(settingsPageSource).toContain('color-mix(in srgb, var(--success) 22%, var(--card))')
    expect(settingsPageSource).not.toContain("t('保存设置', 'Save settings')")
    expect(settingsPageSource).not.toContain('bg-[#101418]')
    expect(chatPageSource).toContain("import TacticalPanelShell from '@/components-vue/TacticalPanelShell.vue'")
    expect(chatPageSource).toContain('class="context-sidebar"')
    expect(workspaceRailSource).toContain('background: var(--background)')
    expect(workspaceRailSource).toContain('background: #05a7dc')
    expect(workspaceRailSource).toContain('box-shadow: 0 0 1.4rem color-mix(in srgb, #05a7dc 55%, transparent)')
    expect(workspaceRailSource).not.toContain('background: var(--brand)')
  })

  it('uses one tactical shell for hidden Coding surfaces and adapts the task layout to its container', () => {
    expect(chatPageSource).toContain('<TacticalPanelShell')
    expect(tacticalPanelShellSource).toContain("data-panel-size='wide'")
    expect(tacticalPanelShellSource).toContain('tactical-panel-shell__resize')
    expect(tacticalPanelShellSource).toContain('调整右侧栏宽度')
    expect(chatPageSource).toContain('persistContextRailWidth')
    expect(tacticalPanelShellSource).toContain('@container coding-workspace (max-width: 68rem)')
    expect(missionOperationSource).toContain('@container chat-main (max-width: 56rem)')
    expect(missionOperationSource).toContain('overflow-wrap: anywhere')
    expect(domainTaskContextSource).toContain('@container domain-dossier (max-width: 25rem)')
  })

  it('uses one card column for settings, dossiers, and profile', () => {
    expect(appStylesSource).toContain('--page-stack-width: 64rem')
    expect(appStylesSource).toContain('.page-column {')
    expect(appStylesSource).toContain('.page-stack {')
    expect(appStylesSource).toContain('--settings-field-fill:')
    expect(settingsPageSource).toContain('page-column page-stack')
    expect(settingsPageSource).not.toContain('/Applications/MilkSU.app')
    expect(settingsPageSource).not.toContain('Playwright MCP 官方扩展')
    expect(settingsPageSource).not.toContain('CTF 平台 Bridge')
    expect(settingsPageSource).not.toContain('max-w-3xl')
    expect(settingsPageSource).not.toContain('max-w-5xl')
    expect(settingsPageSource).not.toContain('max-w-6xl')
    expect(evalSettingsPanelSource).not.toContain('max-w-6xl')
    expect(vulnPageSource).toContain('page-column')
    expect(vulnPageSource).toContain('page-stack')
    expect(vulnPageSource).not.toContain('max-w-5xl')
    expect(labPageSource).toContain('page-column page-stack')
    expect(labPageSource).not.toContain('max-w-5xl')
    expect(ctfPageSource).toContain('CollectionViewFilter')
    expect(vulnPageSource).toContain('CollectionViewFilter')
    expect(labPageSource).toContain('ak-segmented')
    expect(labPageSource).toContain('#filters')
    expect(labPageSource).not.toContain('v-model="labTab"')
    expect(ctfPageSource).toContain("screen === 'challenge' ? 'h-full' : 'page-column'")
    expect(ctfPageSource).toContain('class="page-stack"')
    expect(ctfPageSource).not.toContain('max-w-4xl')
    expect(ctfPageSource).not.toContain('max-w-5xl')
    expect(profilePageSource).toContain('page-column')
    expect(profilePageSource).not.toContain('max-w-[1280px]')
    expect(vulnIntelSettingsSource).toContain("t('公开源', 'Public sources')")
    expect(vulnIntelSettingsSource).toContain('SettingsRow')
    expect(vulnIntelSettingsSource).not.toContain('Finder')
    expect(vulnIntelSettingsSource).not.toContain('variant="info"')
    expect(vulnIntelSettingsSource).not.toContain('查看情报源说明')
    expect(vulnIntelSettingsSource).not.toContain('rounded-xl border border-border bg-card')
    expect(vulnIntelSettingsSource).not.toContain('待接入')
  })

  it('keeps hidden menus above content and gives every floating primitive the tactical theme', () => {
    expect(ctfTrajectorySource).toContain('rounded-menu-shell')
    expect(ctfArtifactsSource).toContain('rounded-menu-shell')
    expect(ctfTrajectorySource).not.toContain('game-surface')
    expect(ctfArtifactsSource).not.toContain('game-surface')
    expect(appStylesSource).not.toContain('.game-surface')
    expect(ctfPageSource).toContain('z-[var(--z-overlay)]')
    expect(appStylesSource).toContain('[data-slot="select-content"]')
    expect(appStylesSource).toContain('[data-slot="sheet-content"]')
    expect(appStylesSource).toContain('[data-slot="hover-card-content"]')
    expect(appStylesSource).toContain('.tactical-floating-surface')
  })
})
