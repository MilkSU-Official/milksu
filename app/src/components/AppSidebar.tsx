import ContextSidebar from '@/components/ContextSidebar'
import { useT } from '@/hooks/useUiLocale'
import type { ThemeMode } from '@/lib/themeMode'
import type { NormalizedSettingsCategory } from '@/lib/settingsNavigation'
import type { AppSection, CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import type { CompanionPawState } from '@/lib/companionOverlayState'
import type { AccountStatus, Conversation, UpdateStatus } from '@/types'

export default function AppSidebar({
  activeSection,
  accountStatus,
  activeConversationId,
  conversations,
  runningConversationIds,
  conversationActionError,
  ctfSection,
  codingContextOpen,
  themeMode,
  updateStatus,
  onNew,
  onNavigate,
  onSettings,
  onCompanion,
  companionPaw,
  settingsCategory,
  onSelectSettingsCategory,
  onCloseSettings,
  onProfile,
  onAccountLogin,
  onAccountLogout,
  onToggleTheme,
  onSelectConversation,
  onDeleteConversation,
  onDeleteConversationPermanently,
  onNewProjectSession,
  onNewProject,
  onRenameConversation,
  onSetPinned,
  onMovePinned,
  onReorderPinned,
  onForkConversation,
  onNavigateCtf,
  onOpenCodingContext,
  onCollapseCodingContext,
  onApplyUpdate,
  onOpenCommandPanel,
}: {
  activeSection: AppSection
  accountStatus: AccountStatus
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  conversationActionError?: string
  ctfSection: CTFWorkspaceSection
  codingContextOpen?: boolean
  themeMode: ThemeMode
  updateStatus?: UpdateStatus | null
  onNew?: () => void
  onNavigate?: (value: WorkspaceSection) => void
  onSettings?: () => void
  onCompanion?: () => void
  companionPaw?: CompanionPawState
  settingsCategory?: NormalizedSettingsCategory
  onSelectSettingsCategory?: (value: NormalizedSettingsCategory) => void
  onCloseSettings?: () => void
  onProfile?: () => void
  onAccountLogin?: () => void
  onAccountLogout?: () => void
  onToggleTheme?: () => void
  onSelectConversation?: (id: string) => void
  onDeleteConversation?: (id: string) => void
  onDeleteConversationPermanently?: (id: string) => void
  onNewProjectSession?: (workspacePath: string) => void
  onNewProject?: () => void
  onRenameConversation?: (id: string, title: string) => void
  onSetPinned?: (id: string, pinned: boolean) => void
  onMovePinned?: (id: string, direction: -1 | 1) => void
  onReorderPinned?: (id: string, beforeId: string) => void
  onForkConversation?: (id: string) => void
  onNavigateCtf?: (value: CTFWorkspaceSection) => void
  onOpenCodingContext?: () => void
  onCollapseCodingContext?: () => void
  onApplyUpdate?: () => void
  onOpenCommandPanel?: () => void
}) {
  const t = useT()
  const sidebarHidden = activeSection !== 'settings' && codingContextOpen === false
  return (
    <aside
      className={`workspace-navigation-shell relative z-30 flex h-full min-h-0 shrink-0 text-sidebar-foreground${sidebarHidden ? ' workspace-navigation-shell--hidden' : ''}`}
      data-testid="stable-app-sidebar"
      aria-label={activeSection === 'settings' ? t('设置分类', 'Settings categories') : t('工作区导航', 'Workspace navigation')}
    >
      <ContextSidebar
        activeSection={activeSection}
        activeConversationId={activeConversationId}
        conversations={conversations}
        runningConversationIds={runningConversationIds}
        actionError={conversationActionError}
        ctfSection={ctfSection}
        accountStatus={accountStatus}
        themeMode={themeMode}
        updateStatus={updateStatus}
        collapsed={activeSection === 'settings' ? false : !codingContextOpen}
        settingsCategory={settingsCategory}
        onSelectSettingsCategory={onSelectSettingsCategory}
        onCloseSettings={onCloseSettings}
        onNew={onNew}
        onCollapse={onCollapseCodingContext}
        onExpand={onOpenCodingContext}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
        onDeleteConversationPermanently={onDeleteConversationPermanently}
        onNewProjectSession={onNewProjectSession}
        onNewProject={onNewProject}
        onRenameConversation={onRenameConversation}
        onSetPinned={onSetPinned}
        onMovePinned={onMovePinned}
        onReorderPinned={onReorderPinned}
        onForkConversation={onForkConversation}
        onNavigateCtf={onNavigateCtf}
        onNavigate={onNavigate}
        onProfile={onProfile}
        onSettings={onSettings}
        onCompanion={onCompanion}
        companionPaw={companionPaw}
        onAccountLogin={onAccountLogin}
        onAccountLogout={onAccountLogout}
        onToggleTheme={onToggleTheme}
        onApplyUpdate={onApplyUpdate}
        onOpenCommandPanel={onOpenCommandPanel}
      />
      <style>{`
.workspace-navigation-shell {
  border-right: 1px solid var(--border);
  background: var(--sidebar);
}
.workspace-navigation-shell--hidden {
  border-right: 0;
  background: transparent;
}
`}</style>
    </aside>
  )
}
