import ContextSidebar from '@/components/ContextSidebar'
import { useT } from '@/hooks/useUiLocale'
import type { ThemeMode } from '@/lib/themeMode'
import type { AppSection, CTFWorkspaceSection, WorkspaceSection } from '@/lib/workspaceNavigation'
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
  onProfile,
  onAccountLogin,
  onAccountLogout,
  onToggleTheme,
  onSelectConversation,
  onDeleteConversation,
  onDeleteConversationPermanently,
  onNewProjectSession,
  onRenameConversation,
  onSetPinned,
  onMovePinned,
  onReorderPinned,
  onNavigateCtf,
  onOpenCodingContext,
  onCollapseCodingContext,
  onDownloadUpdate,
  onInstallUpdate,
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
  onProfile?: () => void
  onAccountLogin?: () => void
  onAccountLogout?: () => void
  onToggleTheme?: () => void
  onSelectConversation?: (id: string) => void
  onDeleteConversation?: (id: string) => void
  onDeleteConversationPermanently?: (id: string) => void
  onNewProjectSession?: (workspacePath: string) => void
  onRenameConversation?: (id: string, title: string) => void
  onSetPinned?: (id: string, pinned: boolean) => void
  onMovePinned?: (id: string, direction: -1 | 1) => void
  onReorderPinned?: (id: string, beforeId: string) => void
  onNavigateCtf?: (value: CTFWorkspaceSection) => void
  onOpenCodingContext?: () => void
  onCollapseCodingContext?: () => void
  onDownloadUpdate?: () => void
  onInstallUpdate?: () => void
}) {
  const t = useT()
  return (
    <aside
      className="workspace-navigation-shell relative z-30 flex h-full min-h-0 shrink-0 text-sidebar-foreground"
      data-testid="stable-app-sidebar"
      aria-label={t('工作区导航', 'Workspace navigation')}
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
        collapsed={!codingContextOpen}
        onNew={onNew}
        onCollapse={onCollapseCodingContext}
        onExpand={onOpenCodingContext}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
        onDeleteConversationPermanently={onDeleteConversationPermanently}
        onNewProjectSession={onNewProjectSession}
        onRenameConversation={onRenameConversation}
        onSetPinned={onSetPinned}
        onMovePinned={onMovePinned}
        onReorderPinned={onReorderPinned}
        onNavigateCtf={onNavigateCtf}
        onNavigate={onNavigate}
        onProfile={onProfile}
        onSettings={onSettings}
        onAccountLogin={onAccountLogin}
        onAccountLogout={onAccountLogout}
        onToggleTheme={onToggleTheme}
        onDownloadUpdate={onDownloadUpdate}
        onInstallUpdate={onInstallUpdate}
      />
      <style>{`
.workspace-navigation-shell {
  border-right: 1px solid var(--border);
  background: var(--sidebar);
}
`}</style>
    </aside>
  )
}
