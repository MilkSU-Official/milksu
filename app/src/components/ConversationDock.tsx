import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import ChatPage, { type ChatPageHandle } from '@/components/ChatPage'
import type { SessionTurnSnapshot } from '@/lib/sessionTurnStatus'
import type { CodingMessageQueue } from '@/composables/useConversations'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import { useT } from '@/hooks/useUiLocale'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingExecutionMode,
  Conversation,
  CTFChatAction,
} from '@/types'

const DOCK_STYLES = `
.conversation-dock.is-column {
  position: relative;
  z-index: 1;
  height: min(22rem, 42vh);
  min-height: 16rem;
  width: 100%;
  box-shadow: inset 4px 0 0 var(--brand);
}
.conversation-dock.is-column .conversation-dock__head { cursor: default; }
.conversation-dock {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-overlay);
  box-shadow: var(--surface-glass-shadow), var(--surface-specular);
  color: var(--foreground);
}
.conversation-dock.is-dragging { cursor: grabbing; }
.conversation-dock__head {
  display: flex;
  align-items: center;
  gap: .45rem;
  min-height: 2.1rem;
  padding: 0 .55rem;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  font-size: var(--text-caption);
}
.conversation-dock__icon {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.conversation-dock__main {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.conversation-dock__thread {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  width: 100%;
  flex-direction: column;
  overflow: hidden;
}
.conversation-dock__thread .chat-surface-dock,
.conversation-dock__thread .coding-workspace,
.conversation-dock__thread .chat-main {
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.conversation-dock__thread .chat-composer { overflow: visible; }
.conversation-dock__thread .composer-model { min-width: 9rem; flex: 0 0 auto; }
.conversation-dock__thread .chat-composer__command-menu {
  z-index: 30;
  width: min(30rem, 100%);
  max-height: min(18rem, 42vh);
}
.conversation-dock__thread .composer-add-menu {
  z-index: 30;
  width: min(28rem, calc(100vw - 8rem));
  max-height: min(22rem, 48vh);
}
.conversation-dock__resize {
  position: absolute;
  z-index: 2;
  width: 14px;
  height: 14px;
}
.conversation-dock__resize--nw { top: 0; left: 0; cursor: nwse-resize; }
.conversation-dock__resize--ne { top: 0; right: 0; cursor: nesw-resize; }
.conversation-dock__resize--sw { bottom: 0; left: 0; cursor: nesw-resize; }
.conversation-dock__resize--se { right: 0; bottom: 0; cursor: nwse-resize; }
`

const DOCK_STORAGE_KEY = 'milksu.conversation-dock.v1'
const MIN_WIDTH = 880
const ASPECT_W = 4
const ASPECT_H = 3
const EDGE = 20
const FALLBACK_SIDEBAR_WIDTH = 264
const MIN_TOP = 48

function sidebarLeftBound() {
  const sidebar = document.querySelector<HTMLElement>('.agent-sidebar')
  const width = sidebar?.getBoundingClientRect().width ?? 0
  return width > 0 ? Math.round(width) : FALLBACK_SIDEBAR_WIDTH
}

function heightForWidth(nextWidth: number) {
  return Math.max(1, Math.round(nextWidth * ASPECT_H / ASPECT_W))
}

const MIN_HEIGHT = heightForWidth(MIN_WIDTH)

export type ConversationDockHandle = {
  revealAndFocus: () => Promise<void>
}

const ConversationDock = forwardRef<ConversationDockHandle, {
  placement?: 'float' | 'column'
  conversation: Conversation | null
  conversations?: Conversation[]
  running?: boolean
  aborting?: boolean
  abortStalled?: boolean
  settings?: AppSettings | null
  workspacePath?: string
  messageQueue?: CodingMessageQueue
  sessionReady?: boolean
  resumed?: boolean
  compacting?: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: SessionTurnSnapshot
  ctfSession?: boolean
  vulnerabilitySession?: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  kernel?: 'pi' | 'dsh'
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  modelSourcePreference?: CodingAgentSurfaceBind['modelSourcePreference']
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
  ensureConversation?: (title?: string) => string
  pendingComposerDraft?: { prompt: string; visibleText: string } | null
  onSend?: (...args: CodingAgentSendArgs) => void
  onAbort?: () => void
  onExpand?: () => void
  onClose?: () => void
  onSelect?: (id: string) => void
  onConsumePendingDraft?: () => void
  onCtfAction?: (action: CTFChatAction) => void
  onCompactContext?: () => void
  onRewindContext?: () => void
  onHandoffContext?: () => void
  onControlGoal?: (action: 'pause' | 'resume' | 'clear') => void
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onChangeModel?: (mode: 'auto' | 'manual', provider?: string, model?: string) => void
  onChangeKernel?: (kernel: 'pi' | 'dsh') => void
  onMigrateKernel?: (kernel: 'pi' | 'dsh') => void
  onChangeModelSource?: (preference: 'auto' | 'account' | 'personal') => void
  onChangeCodingPolicy?: (executionMode: CodingExecutionMode, approvalPolicy: CodingApprovalPolicy) => void
  onChangeMcpServers?: (servers: string[], configDigest: string) => void
  onChooseWorkspace?: () => void
  onChooseWorkspaceForNewTask?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
  onCancelQueuedGuidance?: (index: number) => void
  onEditQueuedGuidance?: (index: number) => void
  onOpenSettings?: () => void
}>(function ConversationDock({
  placement = 'float',
  conversation,
  conversations = [],
  running = false,
  aborting = false,
  abortStalled = false,
  settings = null,
  workspacePath = '',
  messageQueue,
  sessionReady = false,
  resumed = false,
  compacting = false,
  compactedAt,
  compactionError,
  turnStatus,
  ctfSession = false,
  vulnerabilitySession = false,
  ctfMode,
  ctfRole,
  kernel,
  modelMode,
  modelProvider,
  modelId,
  modelSourcePreference = 'auto',
  executionMode,
  approvalPolicy,
  mcpServers = [],
  mcpConfigDigest,
  ensureConversation = () => '',
  pendingComposerDraft = null,
  onSend,
  onAbort,
  onExpand,
  onClose,
  onConsumePendingDraft,
  onCtfAction,
  onCompactContext,
  onRewindContext,
  onHandoffContext,
  onControlGoal,
  onRespondApproval,
  onChangeModel,
  onChangeKernel,
  onMigrateKernel,
  onChangeModelSource,
  onChangeCodingPolicy,
  onChangeMcpServers,
  onChooseWorkspace,
  onChooseWorkspaceForNewTask,
  onSelectWorkspace,
  onForgetWorkspace,
  onClearWorkspace,
  onCancelQueuedGuidance,
  onEditQueuedGuidance,
  onOpenSettings,
}, ref) {
  const t = useT()
  const chatPage = useRef<ChatPageHandle | null>(null)
  const [width, setWidth] = useState(960)
  const [height, setHeight] = useState(heightForWidth(960))
  const [left, setLeft] = useState<number | null>(null)
  const [top, setTop] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  const heightRef = useRef(height)
  const leftRef = useRef(left)
  const topRef = useRef(top)
  widthRef.current = width
  heightRef.current = height
  leftRef.current = left
  topRef.current = top
  void conversations

  const dockCtfSession = ctfSession || Boolean(conversation?.ctfJobId)
  const dockVulnerabilitySession = vulnerabilitySession || conversation?.domainTaskContext?.kind === 'cve'

  function maxWidth() {
    return Math.max(MIN_WIDTH, window.innerWidth - sidebarLeftBound() - EDGE)
  }
  function maxHeight() {
    return Math.max(MIN_HEIGHT, window.innerHeight - MIN_TOP - EDGE)
  }

  function clampGeometry(
    nextWidth = widthRef.current,
    _nextHeight = heightRef.current,
    nextLeft = leftRef.current,
    nextTop = topRef.current,
  ) {
    let w = Math.min(maxWidth(), Math.max(MIN_WIDTH, nextWidth))
    let h = heightForWidth(w)
    if (h > maxHeight()) {
      h = maxHeight()
      w = Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(h * ASPECT_W / ASPECT_H)))
      h = Math.min(maxHeight(), heightForWidth(w))
    }
    const minLeft = sidebarLeftBound()
    const maxLeft = Math.max(minLeft, window.innerWidth - w - EDGE)
    const maxTop = Math.max(MIN_TOP, window.innerHeight - h - EDGE)
    const l = Math.min(maxLeft, Math.max(minLeft, nextLeft ?? minLeft))
    const tp = Math.min(maxTop, Math.max(MIN_TOP, nextTop ?? MIN_TOP))
    setWidth(w)
    setHeight(h)
    setLeft(l)
    setTop(tp)
    return { width: w, height: h, left: l, top: tp }
  }

  function loadGeometry() {
    try {
      const raw = window.localStorage?.getItem(DOCK_STORAGE_KEY)
      if (!raw) return
      const value = JSON.parse(raw) as Record<string, unknown>
      if (typeof value.width === 'number') setWidth(value.width)
      if (typeof value.height === 'number') setHeight(value.height)
      if (typeof value.left === 'number') setLeft(value.left)
      if (typeof value.top === 'number') setTop(value.top)
    } catch {
      // Renderer storage may be missing in tests.
    }
  }

  function persistGeometry() {
    try {
      window.localStorage?.setItem(DOCK_STORAGE_KEY, JSON.stringify({
        width: widthRef.current,
        height: heightRef.current,
        left: leftRef.current,
        top: topRef.current,
      }))
    } catch {
      // Ignore quota / private-mode failures.
    }
  }

  function defaultExpandedPosition() {
    const minLeft = sidebarLeftBound()
    setLeft(Math.max(minLeft, window.innerWidth - widthRef.current - EDGE))
    setTop(Math.max(MIN_TOP, window.innerHeight - heightRef.current - EDGE))
  }

  useEffect(() => {
    loadGeometry()
    if (leftRef.current === null) defaultExpandedPosition()
    clampGeometry()
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  function onWindowResize() {
    clampGeometry()
  }

  useEffect(() => {
    persistGeometry()
  }, [width, height, left, top])

  async function revealAndFocus() {
    await Promise.resolve()
    clampGeometry()
    await chatPage.current?.focusComposer()
  }

  useImperativeHandle(ref, () => ({ revealAndFocus }), [])

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    const handle = event.currentTarget
    setDragging(true)
    const startX = event.clientX
    const startY = event.clientY
    const originLeft = leftRef.current ?? 0
    const originTop = topRef.current ?? 0
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      clampGeometry(widthRef.current, heightRef.current, originLeft + next.clientX - startX, originTop + next.clientY - startY)
    }
    const up = () => {
      setDragging(false)
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  function startResize(corner: 'nw' | 'ne' | 'sw' | 'se', event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.stopPropagation()
    const handle = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const originW = widthRef.current
    const originH = heightRef.current
    const originLeft = leftRef.current ?? 0
    const originTop = topRef.current ?? 0
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      const dx = next.clientX - startX
      const dy = next.clientY - startY
      const growX = corner === 'ne' || corner === 'se' ? dx : -dx
      const growY = corner === 'sw' || corner === 'se' ? dy : -dy
      let nextW = originW
      let nextH = originH
      if (Math.abs(growY) > Math.abs(growX)) {
        nextH = Math.min(maxHeight(), Math.max(MIN_HEIGHT, originH + growY))
        nextW = Math.round(nextH * ASPECT_W / ASPECT_H)
      } else {
        nextW = Math.min(maxWidth(), Math.max(MIN_WIDTH, originW + growX))
        nextH = heightForWidth(nextW)
      }
      const nextLeft = corner === 'nw' || corner === 'sw' ? originLeft + originW - nextW : originLeft
      const nextTop = corner === 'nw' || corner === 'ne' ? originTop + originH - nextH : originTop
      clampGeometry(nextW, nextH, nextLeft, nextTop)
    }
    const up = () => {
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  const dockStyle = {
    left: `${left ?? 0}px`,
    top: `${top ?? 0}px`,
    width: `${width}px`,
    height: `${height}px`,
  }

  return (
    <>
      <style>{DOCK_STYLES}</style>
      <aside
        className={`conversation-dock${dragging && placement !== 'column' ? ' is-dragging' : ''}${placement === 'column' ? ' is-column' : ''}`}
        style={placement === 'column' ? undefined : dockStyle}
        data-testid="conversation-dock"
      >
        <header className="conversation-dock__head" onPointerDown={placement === 'column' ? undefined : startDrag}>
          <strong>{t('对话', 'Chat')}</strong>
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{conversation?.title}</span>
          <button
            type="button"
            className="conversation-dock__icon"
            aria-label={t('最大化对话', 'Maximize chat')}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => onExpand?.()}
          >
            <Maximize2 className="size-3.5" />
          </button>
          {placement !== 'column' ? (
            <button
              type="button"
              className="conversation-dock__icon"
              aria-label={t('关闭对话', 'Close chat')}
              onPointerDown={event => event.stopPropagation()}
              onClick={() => onClose?.()}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </header>
        <div className="conversation-dock__main">
          <div className="conversation-dock__thread">
            <ChatPage
              ref={chatPage}
              surface="dock"
              onExpand={onExpand}
              conversation={conversation}
              settings={settings}
              workspacePath={workspacePath}
              running={running}
              aborting={aborting}
              abortStalled={abortStalled}
              messageQueue={messageQueue}
              sessionReady={sessionReady}
              resumed={resumed}
              compacting={compacting}
              compactedAt={compactedAt}
              compactionError={compactionError}
              turnStatus={turnStatus}
              ctfSession={dockCtfSession}
              vulnerabilitySession={dockVulnerabilitySession}
              ctfMode={ctfMode}
              ctfRole={ctfRole}
              kernel={kernel}
              modelMode={modelMode}
              modelProvider={modelProvider}
              modelId={modelId}
              modelSourcePreference={modelSourcePreference}
              executionMode={executionMode}
              approvalPolicy={approvalPolicy}
              mcpServers={mcpServers}
              mcpConfigDigest={mcpConfigDigest}
              ensureConversation={ensureConversation}
              pendingComposerDraft={pendingComposerDraft}
              onSend={onSend}
              onAbort={onAbort}
              onConsumePendingDraft={onConsumePendingDraft}
              onCtfAction={onCtfAction}
              onCompactContext={onCompactContext}
              onRewindContext={onRewindContext}
              onHandoffContext={onHandoffContext}
              onControlGoal={onControlGoal}
              onRespondApproval={onRespondApproval}
              onChangeModel={onChangeModel}
              onChangeKernel={onChangeKernel}
              onMigrateKernel={onMigrateKernel}
              onChangeModelSource={onChangeModelSource}
              onChangeCodingPolicy={onChangeCodingPolicy}
              onChangeMcpServers={onChangeMcpServers}
              onChooseWorkspace={onChooseWorkspace}
              onChooseWorkspaceForNewTask={onChooseWorkspaceForNewTask}
              onSelectWorkspace={onSelectWorkspace}
              onForgetWorkspace={onForgetWorkspace}
              onClearWorkspace={onClearWorkspace}
              onCancelQueuedGuidance={onCancelQueuedGuidance}
              onEditQueuedGuidance={onEditQueuedGuidance}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>
        {placement !== 'column' ? (
          <>
            <span className="conversation-dock__resize conversation-dock__resize--nw" aria-label={t('左上角缩放', 'Resize from top left')} onPointerDown={event => startResize('nw', event)} />
            <span className="conversation-dock__resize conversation-dock__resize--ne" aria-label={t('右上角缩放', 'Resize from top right')} onPointerDown={event => startResize('ne', event)} />
            <span className="conversation-dock__resize conversation-dock__resize--sw" aria-label={t('左下角缩放', 'Resize from bottom left')} onPointerDown={event => startResize('sw', event)} />
            <span className="conversation-dock__resize conversation-dock__resize--se" aria-label={t('右下角缩放', 'Resize from bottom right')} onPointerDown={event => startResize('se', event)} />
          </>
        ) : null}
      </aside>
    </>
  )
})

export default ConversationDock
