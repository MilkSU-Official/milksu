import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isComposingKey } from '@/lib/imeComposition'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand } from '@/desktop'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui'
import { menuContentClass, menuItemClass, menuSeparatorClass } from '@/components/ui/menu'
import { conversationCopyText } from '@/lib/conversationActions'
import { formatRelativeAge } from '@/lib/relativeAge'
import { conversationActivityAt } from '@/lib/workspaceSessionRouting'
import {
  Archive,
  Box,
  BookMarked,
  Bug,
  ChevronDown,
  ChevronLeft,
  Copy,
  Flag,
  FlaskConical,
  Clock,
  Folder,
  FolderOpen,
  Gauge,
  GitFork,
  Globe2,
  House,
  LogOut,
  SquarePen,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  Puzzle,
  ArrowDown,
  ArrowUp,
  Search,
  Settings,
  Sun,
  SunMoon,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  groupWorkspaceConversations,
  type CodingConversationGroup,
} from '@/lib/codingConversationGroups'
import {
  WORKSPACE_SIDEBAR_ITEMS,
  type AppSection,
  type CTFWorkspaceSection,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'
import {
  SETTINGS_SIDEBAR_ITEMS,
  type NormalizedSettingsCategory,
} from '@/lib/settingsNavigation'
import type { ThemeMode } from '@/lib/themeMode'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from '@/lib/sidebarWidth'
import { useT } from '@/hooks/useUiLocale'
import { updateControlVisible } from '@/lib/updateRestart'
import { updateStatusMessage } from '@/lib/updateStatus'
import type { AccountStatus, BuildTracking, Conversation, UpdateStatus } from '@/types'

const COLLAPSED_WIDTH = COLLAPSED_SIDEBAR_WIDTH
const PINNED_GROUP_KEY = 'pinned'
const CONVERSATION_MENU_WIDTH = 176
const CONVERSATION_MENU_HEIGHT = 320

function conversationMenuPosition(x: number, y: number) {
  const pad = 8
  const width = Math.min(CONVERSATION_MENU_WIDTH, window.innerWidth - pad * 2)
  const height = Math.min(CONVERSATION_MENU_HEIGHT, window.innerHeight - pad * 2)
  return {
    position: 'fixed' as const,
    top: `${Math.min(Math.max(pad, y), window.innerHeight - height - pad)}px`,
    left: `${Math.min(Math.max(pad, x), window.innerWidth - width - pad)}px`,
  }
}

const workspaceNavIcons = {
  chat: House,
  ctf: Flag,
  vuln: Bug,
  lab: FlaskConical,
} as const

const settingsNavIcons = {
  general: Settings,
  apikeys: Box,
  ctf: Flag,
  cve: Bug,
  lab: FlaskConical,
  skills: BookMarked,
  mcp: Plug,
  chats: Archive,
  browser: Globe2,
  eval: Gauge,
  plugins: Puzzle,
} as const

export default function ContextSidebar({
  activeSection,
  activeConversationId,
  conversations,
  runningConversationIds: runningIdsProp,
  actionError,
  ctfSection: _ctfSection,
  accountStatus,
  themeMode,
  collapsed,
  settingsCategory,
  updateStatus,
  onNew,
  onCollapse,
  onExpand,
  onSelectConversation,
  onDeleteConversation,
  onDeleteConversationPermanently,
  onNewProjectSession,
  onRenameConversation,
  onSetPinned,
  onMovePinned,
  onReorderPinned,
  onForkConversation,
  onNavigate,
  onProfile,
  onSettings,
  onSelectSettingsCategory,
  onCloseSettings,
  onAccountLogin,
  onAccountLogout,
  onToggleTheme,
  onApplyUpdate,
  onOpenCommandPanel,
}: {
  activeSection: AppSection
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  actionError?: string
  ctfSection: CTFWorkspaceSection
  accountStatus: AccountStatus
  themeMode: ThemeMode
  collapsed?: boolean
  settingsCategory?: NormalizedSettingsCategory
  updateStatus?: UpdateStatus | null
  onNew?: () => void
  onCollapse?: () => void
  onExpand?: () => void
  onSelectConversation?: (id: string) => void
  onDeleteConversation?: (id: string) => void
  onDeleteConversationPermanently?: (id: string) => void
  onNewProjectSession?: (workspacePath: string) => void
  onRenameConversation?: (id: string, title: string) => void
  onSetPinned?: (id: string, pinned: boolean) => void
  onMovePinned?: (id: string, direction: -1 | 1) => void
  onReorderPinned?: (id: string, beforeId: string) => void
  onForkConversation?: (id: string) => void
  onNavigateCtf?: (value: CTFWorkspaceSection) => void
  onNavigate?: (value: WorkspaceSection) => void
  onProfile?: () => void
  onSettings?: () => void
  onSelectSettingsCategory?: (value: NormalizedSettingsCategory) => void
  onCloseSettings?: () => void
  onAccountLogin?: () => void
  onAccountLogout?: () => void
  onToggleTheme?: () => void
  onApplyUpdate?: () => void
  onOpenCommandPanel?: () => void
}) {
  const t = useT()
  const [unreadConversationIds, setUnreadConversationIds] = useState(() => new Set<string>())
  const [pinnedDragId, setPinnedDragId] = useState('')
  const [pinnedDropTarget, setPinnedDropTarget] = useState('')
  const observedRunningIds = useRef<Set<string> | undefined>(undefined)
  const conversationList = useRef<HTMLDivElement | null>(null)
  const [pendingAction, setPendingAction] = useState<{ conversation: Conversation, action: 'archive' | 'delete' } | null>(null)
  const [pendingActionRunning, setPendingActionRunning] = useState(false)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [conversationMenu, setConversationMenu] = useState<{
    conversation: Conversation
    showPinnedMove: boolean
    x: number
    y: number
  } | null>(null)
  const renameInput = useRef<HTMLInputElement | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const workspaceButton = useRef<HTMLButtonElement | null>(null)
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({ top: 0, left: 0 })
  const [buildTracking, setBuildTracking] = useState<BuildTracking | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [expandedWidth, setExpandedWidth] = useState(() => readSidebarWidth())
  const [resizing, setResizing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const updateVisible = updateControlVisible(updateStatus?.state)
  const updateDownloading = updateStatus?.state === 'downloading'
  const updatePercent = Math.max(0, Math.min(100, Number(updateStatus?.percent) || 0))
  const updateButtonLabel = updateDownloading
    ? `${updatePercent.toFixed(0)}%`
    : t('更新', 'Update')
  const updateButtonTitle = updateStatus?.state === 'error'
    ? updateStatusMessage(updateStatus) || updateButtonLabel
    : updateDownloading
      ? t(`正在下载 ${updatePercent.toFixed(0)}%`, `Downloading ${updatePercent.toFixed(0)}%`)
      : updateButtonLabel

  const workspaceHome: WorkspaceSection = (
    activeSection === 'ctf' || activeSection === 'vuln' || activeSection === 'lab'
      ? activeSection
      : 'chat'
  )
  const codingGroups = groupWorkspaceConversations(conversations, workspaceHome)
  const runningConversationIds = new Set(runningIdsProp ?? [])
  const projectGroups = codingGroups.filter(group => !group.temporary)
  const temporaryGroup = codingGroups.find(group => group.temporary) ?? null
  const avatarSource = accountStatus.user?.avatarUrl || profileAvatar
  const workspaceName = accountStatus.user?.displayName
    || accountStatus.user?.githubLogin
    || t('MilkSU', 'MilkSU')
  const isBetaChannel = Boolean(
    !buildTracking?.development
    && !buildTracking?.missing
    && String(buildTracking?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking?.appId ?? '') === 'com.milksu.app.beta',
  )
  const themeToggleLabel = themeMode === 'system'
    ? t('当前跟随系统，切换到日间模式', 'Following system. Switch to light mode')
    : themeMode === 'light'
      ? t('当前日间模式，切换到夜间模式', 'Light mode. Switch to dark mode')
      : t('当前夜间模式，切换到跟随系统', 'Dark mode. Switch to follow system')
  const ThemeToggleIcon = themeMode === 'system' ? SunMoon : themeMode === 'light' ? Sun : Moon
  const themeModeLabel = themeMode === 'system'
    ? t('跟随系统', 'System')
    : themeMode === 'light'
      ? t('日间', 'Light')
      : t('夜间', 'Dark')
  const sidebarStyle = { width: `${collapsed ? COLLAPSED_WIDTH : expandedWidth}px` }
  const innerStyle = { width: `${expandedWidth}px` }

  function selectConversation(id: string) {
    setUnreadConversationIds(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    onSelectConversation?.(id)
  }

  function openSingleConversation(event: React.MouseEvent, group: CodingConversationGroup) {
    if (group.conversations.length !== 1) return
    event.preventDefault()
    selectConversation(group.conversations[0].id)
  }

  function confirmConversationAction() {
    if (!pendingAction || pendingActionRunning) return
    const { conversation, action } = pendingAction
    setPendingActionRunning(true)
    if (action === 'archive') onDeleteConversation?.(conversation.id)
    else onDeleteConversationPermanently?.(conversation.id)
  }

  function closeConversationAction() {
    setPendingAction(null)
    setPendingActionRunning(false)
  }

  function startRename(conversation: Conversation) {
    setEditingConversationId(conversation.id)
    setEditingTitle(conversation.title)
    requestAnimationFrame(() => {
      renameInput.current?.focus()
      renameInput.current?.select()
    })
  }

  function finishRename(conversation: Conversation) {
    if (editingConversationId !== conversation.id) return
    const title = editingTitle.trim().slice(0, 40)
    setEditingConversationId(null)
    if (title && title !== conversation.title) onRenameConversation?.(conversation.id, title)
  }

  function cancelRename() {
    setEditingConversationId(null)
  }

  function submitRename(event: KeyboardEvent<HTMLInputElement>, conversation: Conversation) {
    if (isComposingKey(event)) return
    event.preventDefault()
    finishRename(conversation)
  }

  function abortRename(event: KeyboardEvent<HTMLInputElement>) {
    if (isComposingKey(event)) return
    event.preventDefault()
    cancelRename()
  }

  function closeConversationMenu() {
    setConversationMenu(null)
  }

  function openConversationMenu(
    conversation: Conversation,
    showPinnedMove: boolean,
    x: number,
    y: number,
  ) {
    setConversationMenu({ conversation, showPinnedMove, x, y })
  }

  async function copyConversation(conversation: Conversation) {
    const text = conversationCopyText(conversation)
    if (!text || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard is best effort; the menu still closes.
    }
  }

  function runConversationMenuAction(action: () => void) {
    closeConversationMenu()
    action()
  }

  function toggleWorkspaceMenu() {
    if (collapsed) return
    if (!workspaceOpen && workspaceButton.current) {
      const rect = workspaceButton.current.getBoundingClientRect()
      setWorkspaceMenuPosition({ top: rect.bottom + 6, left: rect.left })
    }
    setWorkspaceOpen(open => !open)
  }

  function closeWorkspaceMenu() {
    setWorkspaceOpen(false)
  }

  function collapseSidebar() {
    closeWorkspaceMenu()
    onCollapse?.()
  }

  function startPinnedDrag(id: string, event: DragEvent) {
    setPinnedDragId(id)
    setPinnedDropTarget('')
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function dropPinnedConversation(targetId: string) {
    const sourceId = pinnedDragId
    setPinnedDragId('')
    setPinnedDropTarget('')
    if (!sourceId || sourceId === targetId) return
    onReorderPinned?.(sourceId, targetId)
  }

  function endPinnedDrag() {
    setPinnedDragId('')
    setPinnedDropTarget('')
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || collapsed) return
    const handle = event.currentTarget
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    const startX = event.clientX
    const startWidth = expandedWidth

    function onMove(move: PointerEvent) {
      setExpandedWidth(clampSidebarWidth(startWidth + (move.clientX - startX)))
    }
    function onUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setResizing(false)
      setExpandedWidth(current => writeSidebarWidth(current))
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (workspaceButton.current?.contains(target)) return
      const menu = document.querySelector('[data-workspace-menu]')
      if (menu?.contains(target)) return
      setWorkspaceOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    void invokeCommand<BuildTracking>('get_build_tracking')
      .then(value => { setBuildTracking(value) })
      .catch(() => { setBuildTracking(null) })
    void invokeCommand<UpdateStatus>('get_update_status')
      .then(value => { setAppVersion(String(value.currentVersion ?? '').trim()) })
      .catch(() => { setAppVersion('') })
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (pendingActionRunning && pendingAction && !conversations.some(conversation => conversation.id === pendingAction.conversation.id)) {
      closeConversationAction()
    }
  }, [conversations, pendingAction, pendingActionRunning])

  useEffect(() => {
    if (actionError) setPendingActionRunning(false)
  }, [actionError])

  const runningIdsKey = (runningIdsProp ?? []).join('\0')
  useEffect(() => {
    const next = new Set(runningIdsProp ?? [])
    if (observedRunningIds.current) {
      setUnreadConversationIds(current => {
        let changed = false
        const unread = new Set(current)
        for (const id of observedRunningIds.current!) {
          if (!next.has(id) && id !== activeConversationId && !unread.has(id)) {
            unread.add(id)
            changed = true
          }
        }
        return changed ? unread : current
      })
    }
    observedRunningIds.current = next
  }, [runningIdsKey, activeConversationId])

  useEffect(() => {
    if (!activeConversationId) return
    setUnreadConversationIds(current => {
      if (!current.has(activeConversationId)) return current
      const next = new Set(current)
      next.delete(activeConversationId)
      return next
    })
  }, [activeConversationId])

  useEffect(() => {
    if (!activeConversationId || collapsed) return
    const activeRow = conversationList.current?.querySelector<HTMLElement>('[data-active-conversation-row]')
    if (typeof activeRow?.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' })
    }
  }, [activeConversationId, codingGroups.length, collapsed])

  useEffect(() => {
    if (collapsed) {
      closeWorkspaceMenu()
      closeConversationMenu()
    }
  }, [collapsed])

  useEffect(() => {
    if (!conversationMenu) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      const menu = document.querySelector('[data-conversation-menu]')
      if (menu?.contains(target)) return
      setConversationMenu(null)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setConversationMenu(null)
    }
    function onViewportChange() {
      setConversationMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    conversationList.current?.addEventListener('scroll', onViewportChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      conversationList.current?.removeEventListener('scroll', onViewportChange)
    }
  }, [conversationMenu])

  function conversationActionButton(
    conversation: Conversation,
    showPinnedMove: boolean,
    {
      className,
      label,
      title,
      testId,
      onClick,
      children,
    }: {
      className?: string
      label: string
      title?: string
      testId?: string
      onClick: (event: MouseEvent<HTMLButtonElement>) => void
      children: ReactNode
    },
  ) {
    return (
      <button
        type="button"
        className={`agent-sidebar-item__action agent-sidebar__copy${className ? ` ${className}` : ''}`}
        aria-label={label}
        title={title ?? label}
        data-testid={testId}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          onClick(event)
        }}
        onContextMenu={event => {
          event.preventDefault()
          event.stopPropagation()
          openConversationMenu(conversation, showPinnedMove, event.clientX, event.clientY)
        }}
      >
        {children}
      </button>
    )
  }

  function conversationRow(conversation: Conversation, groupKey?: string) {
    const pinned = groupKey === PINNED_GROUP_KEY
    const menuOpen = conversationMenu?.conversation.id === conversation.id
    const age = formatRelativeAge(conversationActivityAt(conversation), now)
    return (
      <div
        key={conversation.id}
        className={`agent-sidebar-item group mx-2 flex h-9 items-center overflow-hidden rounded-[8px]${activeConversationId === conversation.id ? ' is-current' : ''}${conversation.pinned ? ' is-pinned-row' : ''}${pinnedDropTarget === conversation.id ? ' is-pinned-drop-target' : ''}${menuOpen ? ' is-menu-open' : ''}`}
        draggable={pinned}
        data-ui-selected={activeConversationId === conversation.id ? '' : undefined}
        data-active-conversation-row={activeConversationId === conversation.id ? '' : undefined}
        onDragStart={event => { if (pinned) startPinnedDrag(conversation.id, event) }}
        onDragOver={event => {
          if (!pinned) return
          event.preventDefault()
          setPinnedDropTarget(conversation.id)
        }}
        onDragLeave={() => { if (pinnedDropTarget === conversation.id) setPinnedDropTarget('') }}
        onDrop={event => {
          event.preventDefault()
          dropPinnedConversation(conversation.id)
        }}
        onDragEnd={endPinnedDrag}
        onContextMenu={event => {
          if (editingConversationId === conversation.id) return
          event.preventDefault()
          event.stopPropagation()
          openConversationMenu(conversation, pinned, event.clientX, event.clientY)
        }}
      >
        {editingConversationId === conversation.id ? (
          <Input
            ref={renameInput}
            value={editingTitle}
            onChange={event => setEditingTitle(event.target.value)}
            className="coding-project-title-input h-7 min-w-0 flex-1 rounded-[8px]"
            aria-label={t('编辑会话标题', 'Edit chat title')}
            maxLength={40}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Enter') submitRename(event, conversation)
              if (event.key === 'Escape') abortRename(event)
            }}
            onBlur={() => finishRename(conversation)}
          />
        ) : (
          <button
            type="button"
            className="agent-sidebar-row coding-project-child relative h-9 min-w-0 flex-1 justify-start rounded-none px-2 text-left"
            aria-current={activeConversationId === conversation.id ? 'true' : undefined}
            onClick={event => {
              event.stopPropagation()
              selectConversation(conversation.id)
            }}
          >
            <span className="coding-session-status">
              {runningConversationIds.has(conversation.id) ? (
                <AgentPixelLoader label={t('运行中', 'Running')} running compact />
              ) : unreadConversationIds.has(conversation.id) ? (
                <span className="coding-session-complete size-1.5 rounded-full bg-primary" aria-label={t('有新消息', 'New messages')} />
              ) : null}
            </span>
            <span className="flex size-5 shrink-0" aria-hidden="true" />
            <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">{conversation.title}</span>
            {age ? (
              <span className="agent-sidebar-item__age agent-sidebar__copy" aria-hidden="true">{age}</span>
            ) : null}
          </button>
        )}
        {editingConversationId === conversation.id ? (
          <span className="mr-1 size-8 shrink-0" aria-hidden="true" data-testid="conversation-action-placeholder" />
        ) : (
          <div className="agent-sidebar-item__actions">
            {conversationActionButton(conversation, pinned, {
              className: conversation.pinned ? 'is-pinned' : '',
              label: conversation.pinned ? t('取消置顶', 'Unpin') : t('置顶', 'Pin'),
              testId: conversation.pinned ? 'conversation-pinned-mark' : undefined,
              onClick: () => onSetPinned?.(conversation.id, !conversation.pinned),
              children: <Pin className="size-3.5" />,
            })}
            {conversationActionButton(conversation, pinned, {
              label: t('归档', 'Archive'),
              onClick: () => setPendingAction({ conversation, action: 'archive' }),
              children: <Archive className="size-3.5" />,
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`agent-sidebar app-no-drag relative flex h-full min-h-0 shrink-0 overflow-hidden${resizing ? ' is-resizing' : ''}`}
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      data-shell-traffic-safe
      data-testid="coding-context-drawer"
      style={sidebarStyle}
    >
      {!collapsed ? (
        <div
          className="agent-sidebar__resize app-no-drag"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('调整侧栏宽度', 'Resize the sidebar')}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuenow={expandedWidth}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          onPointerDown={startResize}
        />
      ) : null}
      <div className="agent-sidebar__inner flex min-h-0 shrink-0 flex-col" style={innerStyle}>
        <div className="agent-sidebar__head relative mb-2.5 h-10 shrink-0">
          {activeSection === 'settings' ? (
            <button
              type="button"
              className="agent-sidebar__workspace app-no-drag absolute inset-x-2 top-1 flex h-8 items-center rounded-[8px] px-2 text-left"
              aria-label={t('返回', 'Back')}
              title={t('返回', 'Back')}
              onClick={onCloseSettings}
            >
              <ChevronLeft className="size-4 shrink-0" />
              <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
                {t('设置', 'Settings')}
              </span>
            </button>
          ) : (
          <>
          <button
            ref={workspaceButton}
            type="button"
            data-workspace-trigger
            className="agent-sidebar__workspace app-no-drag absolute left-2 top-1 right-11 flex h-8 items-center rounded-[8px] px-2 text-left"
            aria-label={t('账户与工作区', 'Account and workspace')}
            aria-expanded={workspaceOpen}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={toggleWorkspaceMenu}
          >
            <span className="agent-sidebar__avatar relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[7px]">
              <img src={avatarSource} alt={t('用户头像', 'User avatar')} className="size-5 object-cover" />
              {isBetaChannel ? (
                <span
                  className="pointer-events-none absolute -right-1 -top-1 bg-indigo-600 px-0.5 text-[8px] font-semibold leading-none text-white"
                  aria-label={t('Beta 渠道', 'Beta channel')}
                  data-testid="beta-channel-badge"
                >
                  BETA
                </span>
              ) : null}
            </span>
            <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
              {workspaceName}
            </span>
            <ChevronDown className="agent-sidebar__copy ml-1 size-4 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            className="agent-sidebar__icon app-no-drag absolute right-2 top-1 flex size-8 items-center justify-center rounded-[8px]"
            data-testid="coding-history-toggle"
            aria-label={t('收起侧栏', 'Collapse sidebar')}
            title={t('收起侧栏', 'Collapse sidebar')}
            aria-expanded={!collapsed}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={collapseSidebar}
          >
            <PanelLeftClose className="size-4" />
          </button>
          <button
            type="button"
            className="agent-sidebar__expand app-no-drag absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-[8px]"
            data-testid="coding-history-expand"
            aria-label={t('展开侧栏', 'Expand sidebar')}
            title={t('展开侧栏', 'Expand sidebar')}
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={onExpand}
          >
            <PanelLeftOpen className="size-4" />
          </button>
          </>
          )}
        </div>

        {activeSection === 'settings' ? (
        <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto" aria-label={t('设置分类', 'Settings categories')}>
          {SETTINGS_SIDEBAR_ITEMS.map(item => {
            const Icon = settingsNavIcons[item.value]
            const current = settingsCategory === item.value
            return (
              <button
                key={item.value}
                type="button"
                className={`agent-sidebar-row app-no-drag mx-2 flex h-8 items-center rounded-[8px] px-2 text-left${current ? ' is-current' : ''}`}
                aria-current={current ? 'page' : undefined}
                onClick={() => onSelectSettingsCategory?.(item.value)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <Icon className="size-4" />
                </span>
                <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
                  {item.label()}
                </span>
              </button>
            )
          })}
        </nav>
        ) : (
        <>
        <nav className="flex flex-col gap-px" aria-label={t('工作区', 'Workspaces')}>
          <button
            type="button"
            className="agent-sidebar-row app-no-drag mx-2 flex h-8 items-center rounded-[8px] px-2 text-left"
            data-testid="coding-new-task-button"
            onClick={onNew}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <SquarePen className="size-4" />
            </span>
            <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
              {t('新会话', 'New chat')}
            </span>
          </button>
          {WORKSPACE_SIDEBAR_ITEMS.map(item => {
            const Icon = workspaceNavIcons[item.id]
            return (
              <button
                key={item.id}
                type="button"
                className={`agent-sidebar-row app-no-drag mx-2 flex h-8 items-center rounded-[8px] px-2 text-left${activeSection === item.id ? ' is-current' : ''}`}
                aria-current={activeSection === item.id ? 'page' : undefined}
                onClick={() => onNavigate?.(item.id)}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <Icon className="size-4" />
                </span>
                <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
                  {item.label()}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="agent-sidebar__chats mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="agent-sidebar-search relative mx-2 mb-1 h-8">
            <div className="agent-sidebar__copy absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-muted-foreground">
              {t('会话', 'Chats')}
            </div>
            <button
              type="button"
              className="agent-sidebar__icon absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px]"
              aria-label={t('搜索任务', 'Search tasks')}
              onClick={() => onOpenCommandPanel?.()}
            >
              <Search className="size-3.5" />
            </button>
          </div>

          <div ref={conversationList} className="coding-conversation-list pb-3" data-plugin-surface="workspace-list">
            {projectGroups.length || temporaryGroup ? (
              <div className="flex flex-col">
                {projectGroups.length ? (
                  <div className="space-y-0.5">
                    {projectGroups.map(group => (
                      <details key={group.key} open className="coding-project-group">
                        <summary
                          className="agent-sidebar-row group mx-2 flex h-9 cursor-pointer list-none items-center rounded-[8px] px-2"
                          title={group.paths.length ? group.paths.join('\n') : group.name}
                          onClick={event => openSingleConversation(event, group)}
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                            {group.key === PINNED_GROUP_KEY ? (
                              <Pin className="size-4" />
                            ) : (
                              <>
                                <Folder className="folder-closed size-4" />
                                <FolderOpen className="folder-open size-4" />
                              </>
                            )}
                          </span>
                          <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">{group.name}</span>
                          {group.path ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="coding-project-new-session agent-sidebar__copy shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              aria-label={t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)}
                              title={t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)}
                              onClick={event => {
                                event.stopPropagation()
                                if (group.path) onNewProjectSession?.(group.path)
                              }}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          ) : null}
                        </summary>
                        <div className="mt-0.5 space-y-0.5">
                          {group.conversations.map(conversation => conversationRow(conversation, group.key))}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : null}
                {temporaryGroup ? (
                  <details open className="coding-temporary-group mt-2" data-testid="coding-temporary-group">
                    <summary
                      className="agent-sidebar-row group mx-2 flex h-9 cursor-pointer list-none items-center rounded-[8px] px-2"
                      title={t('最近的会话', 'Recent chats')}
                      onClick={event => openSingleConversation(event, temporaryGroup)}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                        <Clock className="size-4" />
                      </span>
                      <span className="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">{temporaryGroup.name}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="coding-project-new-session agent-sidebar__copy shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={t('新建会话', 'New chat')}
                        title={t('新建会话', 'New chat')}
                        onClick={event => {
                          event.stopPropagation()
                          onNew?.()
                        }}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </summary>
                    <div className="mt-0.5 space-y-0.5">
                      {temporaryGroup.conversations.map(conversation => conversationRow(conversation))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        </>
        )}

        <div className="agent-sidebar__foot">
          {appVersion ? (
            <p className="agent-sidebar__version agent-sidebar__copy">{appVersion}</p>
          ) : (
            <span className="agent-sidebar__copy min-w-0 flex-1" />
          )}
          {updateVisible ? (
            <button
              type="button"
              className="agent-sidebar__update app-no-drag"
              data-testid="sidebar-apply-update"
              disabled={updateDownloading}
              aria-label={updateButtonLabel}
              title={updateButtonTitle}
              onClick={() => onApplyUpdate?.()}
            >
              {updateButtonLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="agent-sidebar__theme app-no-drag"
            aria-label={themeToggleLabel}
            title={themeModeLabel}
            onClick={onToggleTheme}
          >
            <ThemeToggleIcon className="size-4" />
          </button>
          <button
            type="button"
            className={`agent-sidebar__theme app-no-drag${activeSection === 'settings' ? ' is-current' : ''}`}
            data-testid="sidebar-open-settings"
            aria-label={t('设置', 'Settings')}
            title={t('设置', 'Settings')}
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            onClick={onSettings}
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>

      {workspaceOpen && !collapsed && activeSection !== 'settings'
        ? createPortal(
          <section
            data-workspace-menu
            className="agent-sidebar-workspace-menu app-no-drag fixed z-50 w-max min-w-[11rem] overflow-hidden rounded-[8px] border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            style={{ top: `${workspaceMenuPosition.top}px`, left: `${workspaceMenuPosition.left}px` }}
            aria-label={t('用户菜单', 'User menu')}
          >
            <button className="user-menu-item" onClick={() => { closeWorkspaceMenu(); onProfile?.() }}>
              <UserRound className="size-4" />{t('个人资料', 'Profile')}
            </button>
            <button className="user-menu-item" onClick={() => { closeWorkspaceMenu(); onSettings?.() }}>
              <Settings className="size-4" />{t('设置', 'Settings')}
            </button>
            <button className="user-menu-item" onClick={() => { closeWorkspaceMenu(); onToggleTheme?.() }}>
              <ThemeToggleIcon className="size-4" />{themeModeLabel}
              <span className="sr-only">{themeToggleLabel}</span>
            </button>
            <div className="my-1 h-px bg-border" />
            {accountStatus.state === 'active' ? (
              <button className="user-menu-item" onClick={() => { closeWorkspaceMenu(); onAccountLogout?.() }}>
                <LogOut className="size-4" />{t('退出登录', 'Sign out')}
              </button>
            ) : accountStatus.configured ? (
              <button className="user-menu-item" onClick={() => { closeWorkspaceMenu(); onAccountLogin?.() }}>
                <LogOut className="size-4 rotate-180" />{t('使用 GitHub 登录', 'Sign in with GitHub')}
              </button>
            ) : (
              <button className="user-menu-item text-muted-foreground" disabled>
                <LogOut className="size-4" />{t('账户未配置', 'Account not configured')}
              </button>
            )}
          </section>,
          document.body,
        )
        : null}

      <Dialog open={Boolean(pendingAction)} onOpenChange={open => { if (!open) closeConversationAction() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.action === 'delete' ? t('永久删除聊天？', 'Permanently delete this chat?') : t('归档聊天？', 'Archive this chat?')}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.action === 'delete'
                ? t(`“${pendingAction.conversation.title}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。`, `The chat history for “${pendingAction.conversation.title}” will be permanently deleted. This cannot be undone. Project files will not be deleted.`)
                : t(`“${pendingAction?.conversation.title}”将从会话列表移到“设置 → 归档聊天”。之后可以恢复或永久删除。`, `“${pendingAction?.conversation.title}” will move from the chat list to Settings → Archived chats. You can restore or permanently delete it later.`)}
              {pendingAction && runningConversationIds.has(pendingAction.conversation.id)
                ? t('该会话正在运行，本次操作会先中断当前回合。', 'This chat is running. This action will stop the current turn first.')
                : null}
            </DialogDescription>
          </DialogHeader>
          {actionError ? <p className="text-body text-destructive">{actionError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={closeConversationAction}>{t('取消', 'Cancel')}</Button>
            <Button
              variant={pendingAction?.action === 'delete' ? 'destructive' : 'default'}
              disabled={pendingActionRunning}
              onClick={confirmConversationAction}
            >
              {pendingAction?.action === 'delete' ? t('确认永久删除', 'Permanently delete') : t('确认归档', 'Archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {conversationMenu
        ? createPortal(
          <section
            data-conversation-menu
            className={`${menuContentClass} conversation-row-menu app-no-drag w-44`}
            style={conversationMenuPosition(conversationMenu.x, conversationMenu.y)}
            aria-label={t('会话操作', 'Chat actions')}
            onContextMenu={event => event.preventDefault()}
          >
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item`}
              onClick={() => runConversationMenuAction(() => onSetPinned?.(conversationMenu.conversation.id, !conversationMenu.conversation.pinned))}
            >
              {conversationMenu.conversation.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {conversationMenu.conversation.pinned ? t('取消置顶', 'Unpin') : t('置顶', 'Pin')}
            </button>
            {conversationMenu.showPinnedMove && conversationMenu.conversation.pinned ? (
              <>
                <button
                  type="button"
                  className={`${menuItemClass} conversation-row-menu__item`}
                  onClick={() => runConversationMenuAction(() => onMovePinned?.(conversationMenu.conversation.id, -1))}
                >
                  <ArrowUp className="size-4" />{t('上移', 'Move up')}
                </button>
                <button
                  type="button"
                  className={`${menuItemClass} conversation-row-menu__item`}
                  onClick={() => runConversationMenuAction(() => onMovePinned?.(conversationMenu.conversation.id, 1))}
                >
                  <ArrowDown className="size-4" />{t('下移', 'Move down')}
                </button>
              </>
            ) : null}
            <div className={menuSeparatorClass} />
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item`}
              onClick={() => runConversationMenuAction(() => startRename(conversationMenu.conversation))}
            >
              <Pencil className="size-4" />{t('重命名', 'Rename')}
            </button>
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item`}
              onClick={() => runConversationMenuAction(() => onForkConversation?.(conversationMenu.conversation.id))}
            >
              <GitFork className="size-4" />{t('Fork', 'Fork')}
            </button>
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item`}
              onClick={() => runConversationMenuAction(() => { void copyConversation(conversationMenu.conversation) })}
            >
              <Copy className="size-4" />{t('复制', 'Copy')}
            </button>
            <div className={menuSeparatorClass} />
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item`}
              onClick={() => runConversationMenuAction(() => setPendingAction({ conversation: conversationMenu.conversation, action: 'archive' }))}
            >
              <Archive className="size-4" />{t('归档', 'Archive')}
            </button>
            <button
              type="button"
              className={`${menuItemClass} conversation-row-menu__item text-destructive focus:text-destructive`}
              onClick={() => runConversationMenuAction(() => setPendingAction({ conversation: conversationMenu.conversation, action: 'delete' }))}
            >
              <Trash2 className="size-4" />{t('删除', 'Delete')}
            </button>
          </section>,
          document.body,
        )
        : null}

      <style>{contextSidebarCss}</style>
    </div>
  )
}

const contextSidebarCss = `
.agent-sidebar {
  background: var(--sidebar);
  color: var(--foreground);
  transition: width 280ms cubic-bezier(0.16, 1, 0.3, 1);
}
.agent-sidebar.is-resizing { transition: none; }
.agent-sidebar__resize {
  position: absolute;
  top: 0;
  right: -2px;
  z-index: 2;
  width: 6px;
  height: 100%;
  cursor: col-resize;
}
.agent-sidebar__resize:hover,
.agent-sidebar.is-resizing .agent-sidebar__resize { background: var(--hover-2); }
.agent-sidebar__inner { padding-top: var(--shell-title-safe-top); padding-bottom: 0.75rem; }
.agent-sidebar__workspace,
.agent-sidebar__icon,
.agent-sidebar__expand,
.agent-sidebar-row { cursor: pointer; }
.agent-sidebar__workspace:hover,
.agent-sidebar__icon:hover,
.agent-sidebar__expand:hover,
.agent-sidebar-row:hover { background: var(--hover-2); }
.agent-sidebar-row.is-current,
.agent-sidebar-row[aria-current='page'] { background: var(--hover-2); }
.agent-sidebar .agent-sidebar-item:hover,
.agent-sidebar .agent-sidebar-item.is-current,
.agent-sidebar .agent-sidebar-item[data-ui-selected] { background: var(--hover-2); }
.agent-sidebar .agent-sidebar-item.is-current,
.agent-sidebar .agent-sidebar-item[data-ui-selected] {
  box-shadow: inset 3px 0 0 var(--primary);
}
.agent-sidebar-item .agent-sidebar-row,
.agent-sidebar-item .agent-sidebar-row:hover,
.agent-sidebar-item .agent-sidebar-row.is-current,
.agent-sidebar-item__action,
.agent-sidebar-item__action:hover,
.agent-sidebar-item__action:focus-visible,
.agent-sidebar-item__action.is-open { background: transparent; }
.agent-sidebar-item { position: relative; }
.agent-sidebar-item__actions {
  position: absolute;
  top: 50%;
  right: 0.125rem;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  transform: translateY(-50%);
}
.agent-sidebar-item__age {
  min-width: 1.75rem;
  max-width: 2.25rem;
  flex: none;
  margin-left: 0.25rem;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: var(--text-caption);
  line-height: var(--text-caption--line-height);
  text-align: right;
  white-space: nowrap;
}
.agent-sidebar-item:hover .agent-sidebar-item__age,
.agent-sidebar-item:focus-within .agent-sidebar-item__age,
.agent-sidebar-item.is-menu-open .agent-sidebar-item__age { opacity: 0; }
.agent-sidebar-item.is-pinned-row .agent-sidebar-row {
  padding-right: 2rem;
}
.agent-sidebar-item:not(:hover):not(:focus-within):not(.is-menu-open) .agent-sidebar-item__action:not(.is-pinned) {
  display: none;
}
.agent-sidebar-item__action {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  opacity: 0;
}
.agent-sidebar-item__action:hover,
.agent-sidebar-item__action:focus-visible,
.agent-sidebar-item__action.is-open { background: var(--hover-2); }
.agent-sidebar-item:hover .agent-sidebar-item__action,
.agent-sidebar-item:focus-within .agent-sidebar-item__action,
.agent-sidebar-item.is-menu-open .agent-sidebar-item__action,
.agent-sidebar-item__action.is-pinned,
.agent-sidebar-item__action.is-open { opacity: 1; }
.conversation-row-menu {
  z-index: 60;
}
.conversation-row-menu__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}
.conversation-row-menu__item:hover,
.conversation-row-menu__item:focus-visible { background: var(--hover-2); outline: 0; }
.agent-sidebar-row { color: var(--foreground); }
.coding-sidebar-control {
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}
.coding-conversation-list { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.coding-project-group > summary,
.coding-temporary-group > summary { list-style: none; }
.coding-project-group > summary::-webkit-details-marker,
.coding-temporary-group > summary::-webkit-details-marker { display: none; }
.coding-project-group:not([open]) .folder-open,
.coding-temporary-group:not([open]) .folder-open { display: none; }
.coding-project-group[open] .folder-closed,
.coding-temporary-group[open] .folder-closed { display: none; }
.coding-project-child { display: flex; align-items: center; }
.coding-session-status {
  position: absolute;
  inset-inline-start: 0.5rem;
  top: 50%;
  display: inline-flex;
  width: 1rem;
  height: 1rem;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
}
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__copy,
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__workspace,
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__icon,
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__chats {
  pointer-events: none;
  opacity: 0;
}
.agent-sidebar__foot {
  display: flex;
  min-height: 2rem;
  align-items: center;
  gap: 0.25rem;
  margin: 0.75rem 0.5rem 0.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}
.agent-sidebar__version {
  min-width: 0;
  flex: 1;
  padding: 0 0.5rem;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 500;
  line-height: 2rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.agent-sidebar__theme {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--foreground);
  cursor: pointer;
}
.agent-sidebar__theme:hover,
.agent-sidebar__theme.is-current { background: var(--hover-2); }
.agent-sidebar__update {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.4rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--update);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.agent-sidebar__update:hover { background: var(--hover-2); }
.agent-sidebar__update:disabled { cursor: default; opacity: 0.8; }
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__foot {
  align-self: flex-start;
  width: 52px;
  margin: 0.5rem 0 0.75rem;
  padding: 0;
  border-top: 0;
  justify-content: center;
  flex-direction: column;
  gap: 0.25rem;
}
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__foot .agent-sidebar__copy { display: none; }
.agent-sidebar[data-sidebar-collapsed='false'] .agent-sidebar__expand { pointer-events: none; opacity: 0; }
.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__expand { pointer-events: auto; opacity: 1; }
.user-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.65rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 0.55rem 0.7rem;
  color: var(--foreground);
  font-size: var(--text-body);
  cursor: pointer;
}
.user-menu-item:hover:not(:disabled),
.user-menu-item:focus-visible { background: var(--hover-2); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: 0.55; }
`
