<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Maximize2, Minus, Plus, Square } from 'lucide-vue-next'
import ChatPage from '@/components-vue/ChatPage.vue'
import type { SessionTurnSnapshot } from '@/lib/sessionTurnStatus'
import type { CodingMessageQueue } from '@/composables/useConversations'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingExecutionMode,
  Conversation,
  CTFChatAction,
} from '@/types'

const props = withDefaults(defineProps<{
  conversation: Conversation | null
  conversations?: Conversation[]
  running?: boolean
  aborting?: boolean
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
}>(), {
  conversations: () => [],
  running: false,
  aborting: false,
  settings: null,
  workspacePath: '',
  sessionReady: false,
  resumed: false,
  compacting: false,
  ctfSession: false,
  vulnerabilitySession: false,
  modelSourcePreference: 'auto',
  mcpServers: () => [],
  ensureConversation: () => '',
  pendingComposerDraft: null,
})

const emit = defineEmits<{
  send: CodingAgentSendArgs
  abort: []
  select: [id: string]
  create: []
  expand: []
  consumePendingDraft: []
  ctfAction: [action: CTFChatAction]
  compactContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
  openSettings: []
}>()

const DOCK_STORAGE_KEY = 'milksu.conversation-dock.v1'
const MIN_WIDTH = 520
const MIN_HEIGHT = 320
const COLLAPSED_WIDTH = 256
const COLLAPSED_HEIGHT = 36
const EDGE = 20
const MIN_LEFT = 76
const MIN_TOP = 48
const collapsed = ref(false)
const width = ref(640)
const height = ref(420)
const left = ref<number | null>(null)
const top = ref<number | null>(null)
const dragging = ref(false)

const listed = computed(() => {
  const seen = new Set<string>()
  const rows: Conversation[] = []
  for (const item of props.conversations) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    rows.push(item)
  }
  if (props.conversation && !seen.has(props.conversation.id)) {
    rows.unshift(props.conversation)
  }
  return rows
})

const dockCtfSession = computed(() => (
  props.ctfSession || Boolean(props.conversation?.ctfJobId)
))
const dockVulnerabilitySession = computed(() => (
  props.vulnerabilitySession || props.conversation?.domainTaskContext?.kind === 'cve'
))

function maxWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_LEFT - EDGE)
}

function maxHeight() {
  return Math.max(MIN_HEIGHT, window.innerHeight - MIN_TOP - EDGE)
}

function collapsedLeft() {
  return Math.max(MIN_LEFT, window.innerWidth - COLLAPSED_WIDTH - EDGE)
}

function collapsedTop() {
  return Math.max(MIN_TOP, window.innerHeight - COLLAPSED_HEIGHT - EDGE)
}

function clampGeometry() {
  width.value = Math.min(maxWidth(), Math.max(MIN_WIDTH, width.value))
  height.value = Math.min(maxHeight(), Math.max(MIN_HEIGHT, height.value))
  const maxLeft = Math.max(MIN_LEFT, window.innerWidth - width.value - EDGE)
  const maxTop = Math.max(MIN_TOP, window.innerHeight - height.value - EDGE)
  left.value = Math.min(maxLeft, Math.max(MIN_LEFT, left.value ?? MIN_LEFT))
  top.value = Math.min(maxTop, Math.max(MIN_TOP, top.value ?? MIN_TOP))
}

function loadGeometry() {
  try {
    const raw = window.localStorage?.getItem(DOCK_STORAGE_KEY)
    if (!raw) return
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.width === 'number') width.value = value.width
    if (typeof value.height === 'number') height.value = value.height
    if (typeof value.left === 'number') left.value = value.left
    if (typeof value.top === 'number') top.value = value.top
    collapsed.value = value.collapsed === true
  } catch {
    // Renderer storage may be missing in tests.
  }
}

function persistGeometry() {
  try {
    window.localStorage?.setItem(DOCK_STORAGE_KEY, JSON.stringify({
      width: width.value,
      height: height.value,
      left: left.value,
      top: top.value,
      collapsed: collapsed.value,
    }))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function defaultExpandedPosition() {
  left.value = Math.max(MIN_LEFT, window.innerWidth - width.value - EDGE)
  top.value = Math.max(MIN_TOP, window.innerHeight - height.value - EDGE)
}

onMounted(() => {
  loadGeometry()
  if (left.value === null) defaultExpandedPosition()
  clampGeometry()
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
})

function onWindowResize() {
  clampGeometry()
}

watch([width, height, left, top, collapsed], persistGeometry)

watch(collapsed, async value => {
  if (value) return
  await nextTick()
  clampGeometry()
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || collapsed.value) return
  const handle = event.currentTarget as HTMLElement
  dragging.value = true
  const startX = event.clientX
  const startY = event.clientY
  const originLeft = left.value ?? 0
  const originTop = top.value ?? 0
  handle.setPointerCapture(event.pointerId)
  const move = (next: PointerEvent) => {
    left.value = originLeft + next.clientX - startX
    top.value = originTop + next.clientY - startY
    clampGeometry()
  }
  const up = () => {
    dragging.value = false
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

function startResize(corner: 'nw' | 'ne' | 'sw' | 'se', event: PointerEvent) {
  if (event.button !== 0) return
  event.stopPropagation()
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startY = event.clientY
  const originW = width.value
  const originH = height.value
  const originLeft = left.value ?? 0
  const originTop = top.value ?? 0
  handle.setPointerCapture(event.pointerId)
  const move = (next: PointerEvent) => {
    const dx = next.clientX - startX
    const dy = next.clientY - startY
    const growX = corner === 'ne' || corner === 'se' ? dx : -dx
    const growY = corner === 'sw' || corner === 'se' ? dy : -dy
    const nextW = Math.min(maxWidth(), Math.max(MIN_WIDTH, originW + growX))
    const nextH = Math.min(maxHeight(), Math.max(MIN_HEIGHT, originH + growY))
    width.value = nextW
    height.value = nextH
    if (corner === 'nw' || corner === 'sw') {
      left.value = originLeft + originW - nextW
    }
    if (corner === 'nw' || corner === 'ne') {
      top.value = originTop + originH - nextH
    }
    clampGeometry()
  }
  const up = () => {
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

const dockStyle = computed(() => (
  collapsed.value
    ? { left: `${collapsedLeft()}px`, top: `${collapsedTop()}px` }
    : {
        left: `${left.value ?? 0}px`,
        top: `${top.value ?? 0}px`,
        width: `${width.value}px`,
        height: `${height.value}px`,
      }
))

function forwardSend(...args: CodingAgentSendArgs) {
  emit('send', ...args)
}
</script>

<template>
  <aside
    class="conversation-dock"
    :class="{ 'is-collapsed': collapsed, 'is-dragging': dragging }"
    :style="dockStyle"
    data-testid="conversation-dock"
  >
    <header class="conversation-dock__head" @pointerdown="startDrag">
      <strong>对话</strong>
      <span class="min-w-0 flex-1 truncate text-caption text-muted-foreground">{{ conversation?.title }}</span>
      <button
        type="button"
        class="conversation-dock__icon"
        aria-label="进入 Coding"
        @pointerdown.stop
        @click="$emit('expand')"
      >
        <Maximize2 class="size-3.5" />
      </button>
      <button
        type="button"
        class="conversation-dock__icon"
        :aria-label="collapsed ? '展开对话' : '收起对话'"
        @pointerdown.stop
        @click="toggleCollapsed"
      >
        <Minus v-if="!collapsed" class="size-3.5" />
        <Square v-else class="size-3.5" />
      </button>
    </header>
    <div v-show="!collapsed" class="conversation-dock__main">
      <nav class="conversation-dock__list" aria-label="对话列表">
        <button
          type="button"
          class="conversation-dock__new"
          aria-label="新对话"
          @click="$emit('create')"
        >
          <Plus class="size-3.5" />
          新对话
        </button>
        <button
          v-for="item in listed"
          :key="item.id"
          type="button"
          class="conversation-dock__item"
          :class="{ 'is-current': item.id === conversation?.id }"
          :aria-current="item.id === conversation?.id ? 'true' : undefined"
          @click="$emit('select', item.id)"
        >
          {{ item.title }}
        </button>
      </nav>
      <div class="conversation-dock__thread">
        <ChatPage
          surface="dock"
          :conversation="conversation"
          :settings="settings"
          :workspace-path="workspacePath"
          :running="running"
          :aborting="aborting"
          :message-queue="messageQueue"
          :session-ready="sessionReady"
          :resumed="resumed"
          :compacting="compacting"
          :compacted-at="compactedAt"
          :compaction-error="compactionError"
          :turn-status="turnStatus"
          :ctf-session="dockCtfSession"
          :vulnerability-session="dockVulnerabilitySession"
          :ctf-mode="ctfMode"
          :ctf-role="ctfRole"
          :model-mode="modelMode"
          :model-provider="modelProvider"
          :model-id="modelId"
          :model-source-preference="modelSourcePreference"
          :execution-mode="executionMode"
          :approval-policy="approvalPolicy"
          :mcp-servers="mcpServers"
          :mcp-config-digest="mcpConfigDigest"
          :ensure-conversation="ensureConversation"
          :pending-composer-draft="pendingComposerDraft"
          @send="forwardSend"
          @abort="$emit('abort')"
          @consume-pending-draft="$emit('consumePendingDraft')"
          @ctf-action="$emit('ctfAction', $event)"
          @compact-context="$emit('compactContext')"
          @control-goal="$emit('controlGoal', $event)"
          @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
          @change-model="(mode, provider, model) => $emit('changeModel', mode, provider, model)"
          @change-model-source="$emit('changeModelSource', $event)"
          @change-coding-policy="(mode, policy) => $emit('changeCodingPolicy', mode, policy)"
          @change-mcp-servers="(servers, digest) => $emit('changeMcpServers', servers, digest)"
          @choose-workspace="$emit('chooseWorkspace')"
          @choose-workspace-for-new-task="$emit('chooseWorkspaceForNewTask')"
          @select-workspace="$emit('selectWorkspace', $event)"
          @forget-workspace="$emit('forgetWorkspace', $event)"
          @clear-workspace="$emit('clearWorkspace')"
          @cancel-queued-guidance="$emit('cancelQueuedGuidance', $event)"
          @edit-queued-guidance="$emit('editQueuedGuidance', $event)"
          @open-settings="$emit('openSettings')"
        />
      </div>
    </div>
    <template v-if="!collapsed">
      <span class="conversation-dock__resize conversation-dock__resize--nw" aria-label="左上角缩放" @pointerdown="startResize('nw', $event)" />
      <span class="conversation-dock__resize conversation-dock__resize--ne" aria-label="右上角缩放" @pointerdown="startResize('ne', $event)" />
      <span class="conversation-dock__resize conversation-dock__resize--sw" aria-label="左下角缩放" @pointerdown="startResize('sw', $event)" />
      <span class="conversation-dock__resize conversation-dock__resize--se" aria-label="右下角缩放" @pointerdown="startResize('se', $event)" />
    </template>
  </aside>
</template>

<style scoped>
.conversation-dock {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--card);
  box-shadow: inset 4px 0 0 var(--brand), 0 18px 48px rgb(0 0 0 / .22);
  color: var(--foreground);
}
.conversation-dock.is-collapsed {
  width: 16rem;
  height: auto;
}
.conversation-dock.is-dragging {
  cursor: grabbing;
}
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
.conversation-dock.is-collapsed .conversation-dock__head {
  cursor: pointer;
}
.conversation-dock__icon {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.conversation-dock__main {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 8.5rem minmax(0, 1fr);
}
.conversation-dock__list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: .15rem;
  overflow: auto;
  border-right: 1px solid var(--border);
  padding: .4rem .35rem;
  background: var(--background);
}
.conversation-dock__new,
.conversation-dock__item {
  display: block;
  width: 100%;
  overflow: hidden;
  border: 0;
  background: transparent;
  padding: .35rem .4rem;
  color: var(--foreground);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-caption);
  cursor: pointer;
}
.conversation-dock__new {
  display: flex;
  align-items: center;
  gap: .25rem;
  color: var(--muted-foreground);
}
.conversation-dock__item.is-current {
  background: color-mix(in oklab, var(--primary) 16%, transparent);
}
.conversation-dock__thread {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.conversation-dock__resize {
  position: absolute;
  z-index: 2;
  width: 14px;
  height: 14px;
}
.conversation-dock__resize--nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.conversation-dock__resize--ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.conversation-dock__resize--sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.conversation-dock__resize--se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}
</style>
