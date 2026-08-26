<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isComposingKey } from '@/lib/imeComposition'
import AgentPixelLoader from '@/components-vue/AgentPixelLoader.vue'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@felinic/ui'
import {
  Archive,
  ArrowDownToLine,
  Bug,
  ChevronDown,
  Flag,
  FlaskConical,
  Clock,
  Folder,
  House,
  LogOut,
  SquarePen,
  Moon,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  SunMoon,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next'
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
import type { ThemeMode } from '@/lib/themeMode'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from '@/lib/sidebarWidth'
import { t } from '@/lib/uiLocale'
import type { AccountStatus, BuildTracking, Conversation, UpdateStatus } from '@/types'

const COLLAPSED_WIDTH = COLLAPSED_SIDEBAR_WIDTH

const props = defineProps<{
  activeSection: AppSection
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  actionError?: string
  ctfSection: CTFWorkspaceSection
  accountStatus: AccountStatus
  themeMode: ThemeMode
  collapsed?: boolean
  updateStatus?: UpdateStatus | null
}>()

const emit = defineEmits<{
  new: []
  collapse: []
  expand: []
  selectConversation: [id: string]
  deleteConversation: [id: string]
  deleteConversationPermanently: [id: string]
  newProjectSession: [workspacePath: string]
  renameConversation: [id: string, title: string]
  navigateCtf: [value: CTFWorkspaceSection]
  navigate: [value: WorkspaceSection]
  profile: []
  settings: []
  accountLogin: []
  accountLogout: []
  toggleTheme: []
  downloadUpdate: []
  installUpdate: []
}>()

const unreadConversationIds = ref(new Set<string>())
let observedRunningIds: Set<string> | undefined
const query = ref('')
const searchOpen = ref(false)
const conversationList = ref<HTMLElement | null>(null)
const pendingAction = ref<{ conversation: Conversation, action: 'archive' | 'delete' } | null>(null)
const pendingActionRunning = ref(false)
const editingConversationId = ref<string | null>(null)
const editingTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const workspaceOpen = ref(false)
const workspaceButton = ref<HTMLButtonElement | null>(null)
const workspaceMenuPosition = ref({ top: 0, left: 0 })
const buildTracking = ref<BuildTracking | null>(null)
const appVersion = ref('')
const expandedWidth = ref(readSidebarWidth())
const resizing = ref(false)
const updateAction = computed(() => {
  const state = props.updateStatus?.state
  if (state === 'available' || state === 'error') return 'download'
  if (state === 'downloading') return 'progress'
  if (state === 'downloaded') return 'install'
  return ''
})
const updatePercent = computed(() => Math.max(0, Math.min(100, Number(props.updateStatus?.percent) || 0)))
const updateButtonLabel = computed(() => {
  if (updateAction.value === 'progress') {
    return t(`正在下载 ${updatePercent.value.toFixed(0)}%`, `Downloading ${updatePercent.value.toFixed(0)}%`)
  }
  if (updateAction.value === 'install') return t('安装并重启', 'Install and restart')
  if (props.updateStatus?.state === 'error') return t('重试下载', 'Retry download')
  return t('下载更新', 'Download update')
})

const workspaceHome = computed<WorkspaceSection>(() => (
  props.activeSection === 'ctf' || props.activeSection === 'vuln' || props.activeSection === 'lab'
    ? props.activeSection
    : 'chat'
))
const codingGroups = computed(() => groupWorkspaceConversations(
  props.conversations,
  workspaceHome.value,
  query.value,
))
const workspaceNavIcons = {
  chat: House,
  ctf: Flag,
  vuln: Bug,
  lab: FlaskConical,
} as const
const runningConversationIds = computed(() => new Set(props.runningConversationIds ?? []))
const projectGroups = computed(() => codingGroups.value.filter(group => !group.temporary))
const temporaryGroup = computed(() => codingGroups.value.find(group => group.temporary) ?? null)
const avatarSource = computed(() => props.accountStatus.user?.avatarUrl || profileAvatar)
const workspaceName = computed(() => (
  props.accountStatus.user?.displayName
  || props.accountStatus.user?.githubLogin
  || t('MilkSU', 'MilkSU')
))
const isBetaChannel = computed(() => {
  if (buildTracking.value?.development || buildTracking.value?.missing) return false
  return String(buildTracking.value?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking.value?.appId ?? '') === 'com.milksu.app.beta'
})
const themeToggleLabel = computed(() => (
  props.themeMode === 'system'
    ? t('当前跟随系统，切换到日间模式', 'Following system. Switch to light mode')
    : props.themeMode === 'light'
      ? t('当前日间模式，切换到夜间模式', 'Light mode. Switch to dark mode')
      : t('当前夜间模式，切换到跟随系统', 'Dark mode. Switch to follow system')
))
const ThemeToggleIcon = computed(() => (
  props.themeMode === 'system' ? SunMoon : props.themeMode === 'light' ? Sun : Moon
))
const themeModeLabel = computed(() => (
  props.themeMode === 'system'
    ? t('跟随系统', 'System')
    : props.themeMode === 'light'
      ? t('日间', 'Light')
      : t('夜间', 'Dark')
))
const sidebarStyle = computed(() => ({
  width: `${props.collapsed ? COLLAPSED_WIDTH : expandedWidth.value}px`,
}))
const innerStyle = computed(() => ({
  width: `${expandedWidth.value}px`,
}))

function selectConversation(id: string) {
  unreadConversationIds.value.delete(id)
  emit('selectConversation', id)
}

function openSingleConversation(event: MouseEvent, group: CodingConversationGroup) {
  if (group.conversations.length !== 1) return
  event.preventDefault()
  selectConversation(group.conversations[0].id)
}

function confirmConversationAction() {
  if (!pendingAction.value || pendingActionRunning.value) return
  const { conversation, action } = pendingAction.value
  pendingActionRunning.value = true
  if (action === 'archive') emit('deleteConversation', conversation.id)
  else emit('deleteConversationPermanently', conversation.id)
}

function closeConversationAction() {
  pendingAction.value = null
  pendingActionRunning.value = false
}

function setRenameInput(element: unknown) {
  const node = (element as { $el?: unknown } | null)?.$el ?? element
  if (node instanceof HTMLInputElement) renameInput.value = node
  else renameInput.value = (node as HTMLElement | null)?.querySelector?.('input') ?? null
}

function startRename(conversation: Conversation) {
  editingConversationId.value = conversation.id
  editingTitle.value = conversation.title
  void nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function finishRename(conversation: Conversation) {
  if (editingConversationId.value !== conversation.id) return
  const title = editingTitle.value.trim().slice(0, 40)
  editingConversationId.value = null
  if (title && title !== conversation.title) emit('renameConversation', conversation.id, title)
}

function cancelRename() {
  editingConversationId.value = null
}

function submitRename(event: KeyboardEvent, conversation: Conversation) {
  if (isComposingKey(event)) return
  event.preventDefault()
  finishRename(conversation)
}

function abortRename(event: KeyboardEvent) {
  if (isComposingKey(event)) return
  event.preventDefault()
  cancelRename()
}

function toggleWorkspaceMenu() {
  if (props.collapsed) return
  if (!workspaceOpen.value && workspaceButton.value) {
    const rect = workspaceButton.value.getBoundingClientRect()
    workspaceMenuPosition.value = { top: rect.bottom + 6, left: rect.left }
  }
  workspaceOpen.value = !workspaceOpen.value
}

function closeWorkspaceMenu() {
  workspaceOpen.value = false
}

function collapseSidebar() {
  closeWorkspaceMenu()
  searchOpen.value = false
  query.value = ''
  emit('collapse')
}

function startResize(event: PointerEvent) {
  if (event.button !== 0 || props.collapsed) return
  const handle = event.currentTarget as HTMLElement
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  resizing.value = true
  const startX = event.clientX
  const startWidth = expandedWidth.value

  function onMove(move: PointerEvent) {
    expandedWidth.value = clampSidebarWidth(startWidth + (move.clientX - startX))
  }
  function onUp(up: PointerEvent) {
    handle.releasePointerCapture(up.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
    resizing.value = false
    expandedWidth.value = writeSidebarWidth(expandedWidth.value)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}

function closeOnOutsidePointer(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (workspaceButton.value?.contains(target)) return
  const menu = document.querySelector('[data-workspace-menu]')
  if (menu?.contains(target)) return
  workspaceOpen.value = false
}

watch(
  () => props.conversations.some(conversation => conversation.id === pendingAction.value?.conversation.id),
  present => {
    if (pendingActionRunning.value && !present) closeConversationAction()
  },
)

watch(() => props.actionError, value => {
  if (value) pendingActionRunning.value = false
})

watch(
  () => props.runningConversationIds ?? [],
  (ids) => {
    const next = new Set(ids)
    if (observedRunningIds) {
      for (const id of observedRunningIds) {
        if (!next.has(id) && id !== props.activeConversationId) {
          unreadConversationIds.value.add(id)
        }
      }
    }
    observedRunningIds = next
  },
  { immediate: true },
)

watch(
  () => props.activeConversationId,
  (id) => {
    if (id) unreadConversationIds.value.delete(id)
  },
)

watch(
  () => [props.activeConversationId, codingGroups.value.length] as const,
  async ([activeConversationId]) => {
    if (!activeConversationId || props.collapsed) return
    await nextTick()
    const activeRow = conversationList.value
      ?.querySelector<HTMLElement>('[data-active-conversation-row]')
    if (typeof activeRow?.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' })
    }
  },
  { immediate: true },
)

watch(() => props.collapsed, collapsed => {
  if (collapsed) {
    closeWorkspaceMenu()
    searchOpen.value = false
    query.value = ''
  }
})

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutsidePointer)
  void invokeCommand<BuildTracking>('get_build_tracking')
    .then(value => { buildTracking.value = value })
    .catch(() => { buildTracking.value = null })
  void invokeCommand<UpdateStatus>('get_update_status')
    .then(value => { appVersion.value = String(value.currentVersion ?? '').trim() })
    .catch(() => { appVersion.value = '' })
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointer))
</script>

<template>
  <div
    class="agent-sidebar app-no-drag relative flex h-full min-h-0 shrink-0 overflow-hidden"
    :class="{ 'is-resizing': resizing }"
    :data-sidebar-collapsed="collapsed ? 'true' : 'false'"
    data-shell-traffic-safe
    data-testid="coding-context-drawer"
    :style="sidebarStyle"
  >
    <div
      v-if="!collapsed"
      class="agent-sidebar__resize app-no-drag"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('调整侧栏宽度', 'Resize the sidebar')"
      :aria-valuemin="MIN_SIDEBAR_WIDTH"
      :aria-valuenow="expandedWidth"
      :aria-valuemax="MAX_SIDEBAR_WIDTH"
      @pointerdown="startResize"
    />
    <div class="agent-sidebar__inner flex min-h-0 shrink-0 flex-col" :style="innerStyle">
      <div class="agent-sidebar__head relative mb-2.5 h-10 shrink-0">
        <button
          ref="workspaceButton"
          type="button"
          data-workspace-trigger
          class="agent-sidebar__workspace app-no-drag absolute left-2 top-1 right-11 flex h-8 items-center rounded-[8px] px-2 text-left"
          :aria-label="t('账户与工作区', 'Account and workspace')"
          :aria-expanded="workspaceOpen"
          :aria-hidden="collapsed"
          :tabindex="collapsed ? -1 : 0"
          @click="toggleWorkspaceMenu"
        >
          <span class="agent-sidebar__avatar relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[7px]">
            <img
              :src="avatarSource"
              :alt="t('用户头像', 'User avatar')"
              class="size-5 object-cover"
            >
            <span
              v-if="isBetaChannel"
              class="pointer-events-none absolute -right-1 -top-1 bg-indigo-600 px-0.5 text-[8px] font-semibold leading-none text-white"
              :aria-label="t('Beta 渠道', 'Beta channel')"
              data-testid="beta-channel-badge"
            >BETA</span>
          </span>
          <span class="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
            {{ workspaceName }}
          </span>
          <ChevronDown class="agent-sidebar__copy ml-1 size-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          class="agent-sidebar__icon app-no-drag absolute right-2 top-1 flex size-8 items-center justify-center rounded-[8px]"
          data-testid="coding-history-toggle"
          :aria-label="t('收起侧栏', 'Collapse sidebar')"
          :title="t('收起侧栏', 'Collapse sidebar')"
          :aria-expanded="!collapsed"
          :aria-hidden="collapsed"
          :tabindex="collapsed ? -1 : 0"
          @click="collapseSidebar"
        >
          <PanelLeftClose class="size-4" />
        </button>
        <button
          type="button"
          class="agent-sidebar__expand app-no-drag absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-[8px]"
          data-testid="coding-history-expand"
          :aria-label="t('展开侧栏', 'Expand sidebar')"
          :title="t('展开侧栏', 'Expand sidebar')"
          :aria-hidden="!collapsed"
          :tabindex="collapsed ? 0 : -1"
          @click="$emit('expand')"
        >
          <PanelLeftOpen class="size-4" />
        </button>
      </div>

      <nav class="flex flex-col gap-px" :aria-label="t('工作区', 'Workspaces')">
        <button
          type="button"
          class="agent-sidebar-row app-no-drag mx-2 flex h-8 items-center rounded-[8px] px-2 text-left"
          data-testid="coding-new-task-button"
          @click="$emit('new')"
        >
          <span class="flex size-5 shrink-0 items-center justify-center">
            <SquarePen class="size-4" />
          </span>
          <span class="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
            {{ t('新会话', 'New chat') }}
          </span>
        </button>
        <button
          v-for="item in WORKSPACE_SIDEBAR_ITEMS"
          :key="item.id"
          type="button"
          class="agent-sidebar-row app-no-drag mx-2 flex h-8 items-center rounded-[8px] px-2 text-left"
          :class="{ 'is-current': activeSection === item.id }"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="$emit('navigate', item.id)"
        >
          <span class="flex size-5 shrink-0 items-center justify-center">
            <component :is="workspaceNavIcons[item.id]" class="size-4" />
          </span>
          <span class="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">
            {{ item.label() }}
          </span>
        </button>
      </nav>

      <div class="agent-sidebar__chats mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div class="agent-sidebar-search relative mx-2 mb-1 h-8">
          <div
            v-show="!searchOpen"
            class="agent-sidebar__copy absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-muted-foreground"
          >
            {{ t('会话', 'Chats') }}
          </div>
          <button
            v-show="!searchOpen"
            type="button"
            class="agent-sidebar__icon absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px]"
            :aria-label="t('搜索任务', 'Search tasks')"
            :aria-expanded="false"
            @click="searchOpen = true"
          >
            <Search class="size-3.5" />
          </button>
          <div
            v-show="searchOpen"
            class="absolute inset-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-muted/70"
          >
            <Search class="ml-2 size-3.5 shrink-0 text-muted-foreground" />
            <input
              v-model="query"
              class="coding-sidebar-control ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              :placeholder="t('搜索任务', 'Search tasks')"
              :aria-label="t('搜索任务', 'Search tasks')"
              @keydown.escape="searchOpen = false; query = ''"
            >
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground"
              :aria-label="t('关闭搜索', 'Close search')"
              @click="searchOpen = false; query = ''"
            >
              <X class="size-3.5" />
            </button>
          </div>
        </div>

        <div ref="conversationList" class="coding-conversation-list pb-3">
          <div v-if="projectGroups.length || temporaryGroup" class="flex flex-col">
            <div v-if="projectGroups.length" class="space-y-0.5">
              <details
                v-for="group in projectGroups"
                :key="group.key"
                open
                class="coding-project-group"
              >
                <summary
                  class="agent-sidebar-row group mx-2 flex h-9 cursor-pointer list-none items-center rounded-[8px] px-2"
                  :title="group.paths.length ? group.paths.join('\n') : group.name"
                  @click="openSingleConversation($event, group)"
                >
                  <span class="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                    <Folder class="size-4" />
                  </span>
                  <span class="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">{{ group.name }}</span>
                  <Button
                    v-if="group.path"
                    variant="ghost"
                    size="icon-sm"
                    class="coding-project-new-session agent-sidebar__copy shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    :aria-label="t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)"
                    :title="t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)"
                    @click.stop="$emit('newProjectSession', group.path)"
                  >
                    <Plus class="size-3.5" />
                  </Button>
                </summary>
                <div class="mt-0.5 space-y-0.5">
                  <div
                    v-for="conversation in group.conversations"
                    :key="conversation.id"
                    class="agent-sidebar-item group mx-2 flex h-9 items-center overflow-hidden rounded-[8px]"
                    :class="{ 'is-current': activeConversationId === conversation.id }"
                    :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                    :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
                  >
                    <Input
                      v-if="editingConversationId === conversation.id"
                      :ref="setRenameInput"
                      v-model="editingTitle"
                      size="sm"
                      class="coding-project-title-input h-7 min-w-0 flex-1 rounded-[8px]"
                      :aria-label="t('编辑会话标题', 'Edit chat title')"
                      maxlength="40"
                      @click.stop
                      @keydown.enter="submitRename($event, conversation)"
                      @keydown.escape="abortRename($event)"
                      @blur="finishRename(conversation)"
                    />
                    <button
                      v-else
                      type="button"
                      class="agent-sidebar-row coding-project-child relative h-9 min-w-0 flex-1 justify-start rounded-none px-2 text-left"
                      :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                      @click.stop="selectConversation(conversation.id)"
                    >
                      <span class="coding-session-status">
                        <AgentPixelLoader v-if="runningConversationIds.has(conversation.id)" :label="t('运行中', 'Running')" running />
                        <span
                          v-else-if="unreadConversationIds.has(conversation.id)"
                          class="coding-session-complete size-1.5 rounded-full bg-primary"
                          :aria-label="t('有新消息', 'New messages')"
                        />
                      </span>
                      <span class="flex size-5 shrink-0" aria-hidden="true" />
                      <span class="agent-sidebar__copy ml-1.5 truncate text-[14px] font-medium">{{ conversation.title }}</span>
                    </button>
                    <span
                      v-if="editingConversationId === conversation.id"
                      class="mr-1 size-8 shrink-0"
                      aria-hidden="true"
                      data-testid="conversation-action-placeholder"
                    />
                    <DropdownMenu v-if="editingConversationId !== conversation.id">
                      <DropdownMenuTrigger as-child>
                        <button
                          type="button"
                          class="agent-sidebar-item__menu agent-sidebar__copy"
                          :aria-label="t('会话操作', 'Chat actions')"
                          @click.stop
                        >
                          <MoreVertical class="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" :side-offset="4" class="agent-floating w-40">
                        <DropdownMenuItem :aria-label="t('重命名编码任务', 'Rename coding task')" @select="startRename(conversation)">
                          <Pencil class="size-4" />{{ t('重命名', 'Rename') }}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem :aria-label="t('归档编码任务', 'Archive coding task')" @select="pendingAction = { conversation, action: 'archive' }">
                          <Archive class="size-4" />{{ t('归档', 'Archive') }}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          class="text-destructive focus:text-destructive"
                          :aria-label="t('永久删除编码任务', 'Permanently delete coding task')"
                          @select="pendingAction = { conversation, action: 'delete' }"
                        >
                          <Trash2 class="size-4" />{{ t('删除', 'Delete') }}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </details>
            </div>

            <details
              v-if="temporaryGroup"
              open
              class="coding-temporary-group mt-2"
              data-testid="coding-temporary-group"
            >
              <summary
                class="agent-sidebar-row group mx-2 flex h-9 cursor-pointer list-none items-center rounded-[8px] px-2"
                :title="t('最近的会话', 'Recent chats')"
                @click="openSingleConversation($event, temporaryGroup)"
              >
                <span class="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  <Clock class="size-4" />
                </span>
                <span class="agent-sidebar__copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium">{{ temporaryGroup.name }}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="coding-project-new-session agent-sidebar__copy shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  :aria-label="t('新建会话', 'New chat')"
                  :title="t('新建会话', 'New chat')"
                  @click.stop="$emit('new')"
                >
                  <Plus class="size-3.5" />
                </Button>
              </summary>
              <div class="mt-0.5 space-y-0.5">
                <div
                  v-for="conversation in temporaryGroup.conversations"
                  :key="conversation.id"
                  class="agent-sidebar-item group mx-2 flex h-9 items-center overflow-hidden rounded-[8px]"
                  :class="{ 'is-current': activeConversationId === conversation.id }"
                  :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                  :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
                >
                  <Input
                    v-if="editingConversationId === conversation.id"
                    :ref="setRenameInput"
                    v-model="editingTitle"
                    size="sm"
                    class="coding-project-title-input h-7 min-w-0 flex-1 rounded-[8px]"
                    :aria-label="t('编辑会话标题', 'Edit chat title')"
                    maxlength="40"
                    @click.stop
                    @keydown.enter="submitRename($event, conversation)"
                    @keydown.escape="abortRename($event)"
                    @blur="finishRename(conversation)"
                  />
                  <button
                    v-else
                    type="button"
                    class="agent-sidebar-row coding-project-child relative h-9 min-w-0 flex-1 justify-start rounded-none px-2 text-left"
                    :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                    @click.stop="selectConversation(conversation.id)"
                  >
                    <span class="coding-session-status">
                      <AgentPixelLoader v-if="runningConversationIds.has(conversation.id)" :label="t('运行中', 'Running')" running />
                      <span
                        v-else-if="unreadConversationIds.has(conversation.id)"
                        class="coding-session-complete size-1.5 rounded-full bg-primary"
                        :aria-label="t('有新消息', 'New messages')"
                      />
                    </span>
                    <span class="flex size-5 shrink-0" aria-hidden="true" />
                    <span class="agent-sidebar__copy ml-1.5 truncate text-[14px] font-medium">{{ conversation.title }}</span>
                  </button>
                  <span
                    v-if="editingConversationId === conversation.id"
                    class="mr-1 size-8 shrink-0"
                    aria-hidden="true"
                    data-testid="conversation-action-placeholder"
                  />
                  <DropdownMenu v-if="editingConversationId !== conversation.id">
                    <DropdownMenuTrigger as-child>
                      <button
                        type="button"
                        class="agent-sidebar-item__menu agent-sidebar__copy"
                        :aria-label="t('会话操作', 'Chat actions')"
                        @click.stop
                      >
                        <MoreVertical class="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" :side-offset="4" class="agent-floating w-40">
                      <DropdownMenuItem :aria-label="t('重命名编码任务', 'Rename coding task')" @select="startRename(conversation)">
                        <Pencil class="size-4" />{{ t('重命名', 'Rename') }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem :aria-label="t('归档编码任务', 'Archive coding task')" @select="pendingAction = { conversation, action: 'archive' }">
                        <Archive class="size-4" />{{ t('归档', 'Archive') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="text-destructive focus:text-destructive"
                        :aria-label="t('永久删除编码任务', 'Permanently delete coding task')"
                        @select="pendingAction = { conversation, action: 'delete' }"
                      >
                        <Trash2 class="size-4" />{{ t('删除', 'Delete') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </details>
          </div>
          <p v-else-if="query.trim()" class="agent-sidebar__copy mx-2 px-2 py-2 text-[12.5px] text-muted-foreground">
            {{ t('没有匹配的会话', 'No matching chats') }}
          </p>
        </div>
      </div>

      <div class="agent-sidebar__foot">
        <p
          v-if="appVersion"
          class="agent-sidebar__version agent-sidebar__copy"
        >
          {{ appVersion }}
        </p>
        <span v-else class="agent-sidebar__copy min-w-0 flex-1" />
        <button
          v-if="updateAction"
          type="button"
          class="agent-sidebar__theme agent-sidebar__update app-no-drag"
          data-testid="sidebar-download-update"
          :disabled="updateAction === 'progress'"
          :aria-label="updateButtonLabel"
          :title="updateButtonLabel"
          @click="updateAction === 'install' ? $emit('installUpdate') : $emit('downloadUpdate')"
        >
          <span v-if="updateAction === 'progress'" class="agent-sidebar__update-progress">{{ updatePercent.toFixed(0) }}</span>
          <ArrowDownToLine v-else class="size-4" />
        </button>
        <button
          type="button"
          class="agent-sidebar__theme app-no-drag"
          :aria-label="themeToggleLabel"
          :title="themeModeLabel"
          @click="$emit('toggleTheme')"
        >
          <component :is="ThemeToggleIcon" class="size-4" />
        </button>
      </div>
    </div>

    <Teleport to="body">
      <section
        v-if="workspaceOpen && !collapsed"
        data-workspace-menu
        class="agent-sidebar-workspace-menu app-no-drag fixed z-50 w-max min-w-[11rem] overflow-hidden rounded-[8px] border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        :style="{ top: `${workspaceMenuPosition.top}px`, left: `${workspaceMenuPosition.left}px` }"
        :aria-label="t('用户菜单', 'User menu')"
      >
        <button class="user-menu-item" @click="closeWorkspaceMenu(); $emit('profile')">
          <UserRound class="size-4" />{{ t('个人资料', 'Profile') }}
        </button>
        <button class="user-menu-item" @click="closeWorkspaceMenu(); $emit('settings')">
          <Settings class="size-4" />{{ t('设置', 'Settings') }}
        </button>
        <button class="user-menu-item" @click="closeWorkspaceMenu(); $emit('toggleTheme')">
          <component :is="ThemeToggleIcon" class="size-4" />{{ themeModeLabel }}
          <span class="sr-only">{{ themeToggleLabel }}</span>
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          v-if="accountStatus.state === 'active'"
          class="user-menu-item"
          @click="closeWorkspaceMenu(); $emit('accountLogout')"
        >
          <LogOut class="size-4" />{{ t('退出登录', 'Sign out') }}
        </button>
        <button
          v-else-if="accountStatus.configured"
          class="user-menu-item"
          @click="closeWorkspaceMenu(); $emit('accountLogin')"
        >
          <LogOut class="size-4 rotate-180" />{{ t('使用 GitHub 登录', 'Sign in with GitHub') }}
        </button>
        <button v-else class="user-menu-item text-muted-foreground" disabled>
          <LogOut class="size-4" />{{ t('账户未配置', 'Account not configured') }}
        </button>
      </section>
    </Teleport>

    <Dialog :open="Boolean(pendingAction)" @update:open="open => { if (!open) closeConversationAction() }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ pendingAction?.action === 'delete' ? t('永久删除聊天？', 'Permanently delete this chat?') : t('归档聊天？', 'Archive this chat?') }}</DialogTitle>
          <DialogDescription>
            <template v-if="pendingAction?.action === 'delete'">
              {{ t(`“${pendingAction.conversation.title}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。`, `The chat history for “${pendingAction.conversation.title}” will be permanently deleted. This cannot be undone. Project files will not be deleted.`) }}
            </template>
            <template v-else>
              {{ t(`“${pendingAction?.conversation.title}”将从会话列表移到“设置 → 归档聊天”。之后可以恢复或永久删除。`, `“${pendingAction?.conversation.title}” will move from the chat list to Settings → Archived chats. You can restore or permanently delete it later.`) }}
            </template>
            <template v-if="pendingAction && runningConversationIds.has(pendingAction.conversation.id)">
              {{ t('该会话正在运行，本次操作会先中断当前回合。', 'This chat is running. This action will stop the current turn first.') }}
            </template>
          </DialogDescription>
        </DialogHeader>
        <p v-if="actionError" class="text-body text-destructive">{{ actionError }}</p>
        <DialogFooter>
          <Button variant="ghost" @click="closeConversationAction">{{ t('取消', 'Cancel') }}</Button>
          <Button
            :variant="pendingAction?.action === 'delete' ? 'destructive' : 'default'"
            :disabled="pendingActionRunning"
            @click="confirmConversationAction"
          >
            {{ pendingAction?.action === 'delete' ? t('确认永久删除', 'Permanently delete') : t('确认归档', 'Archive') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.agent-sidebar {
  background: var(--background);
  color: var(--foreground);
  transition: width 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

.agent-sidebar.is-resizing {
  transition: none;
}

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
.agent-sidebar.is-resizing .agent-sidebar__resize {
  background: var(--hover-2);
}

.agent-sidebar__inner {
  padding-top: 2.1rem;
  padding-bottom: 0.75rem;
}

.agent-sidebar__workspace,
.agent-sidebar__icon,
.agent-sidebar__expand,
.agent-sidebar-row {
  cursor: pointer;
}

.agent-sidebar__workspace:hover,
.agent-sidebar__icon:hover,
.agent-sidebar__expand:hover,
.agent-sidebar-row:hover {
  background: var(--hover-2);
}

.agent-sidebar-row.is-current,
.agent-sidebar-row[aria-current='page'] {
  background: var(--hover-2);
}

.agent-sidebar .agent-sidebar-item:hover,
.agent-sidebar .agent-sidebar-item.is-current,
.agent-sidebar .agent-sidebar-item[data-ui-selected] {
  background: var(--hover-2);
}

.agent-sidebar-item .agent-sidebar-row,
.agent-sidebar-item .agent-sidebar-row:hover,
.agent-sidebar-item .agent-sidebar-row.is-current,
.agent-sidebar-item__menu,
.agent-sidebar-item__menu:hover,
.agent-sidebar-item__menu:focus-visible,
.agent-sidebar-item__menu[data-state='open'] {
  background: transparent;
}

.agent-sidebar-item__menu {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border: 0;
  color: inherit;
  cursor: pointer;
  opacity: 0;
}

.agent-sidebar-item:hover .agent-sidebar-item__menu,
.agent-sidebar-item:focus-within .agent-sidebar-item__menu,
.agent-sidebar-item__menu[data-state='open'] {
  opacity: 1;
}

.agent-sidebar-row {
  color: var(--foreground);
}

.coding-sidebar-control {
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}

.coding-conversation-list {
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.coding-project-group > summary,
.coding-temporary-group > summary {
  list-style: none;
}

.coding-project-group > summary::-webkit-details-marker,
.coding-temporary-group > summary::-webkit-details-marker {
  display: none;
}

.coding-project-child {
  display: flex;
  align-items: center;
}

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

.agent-sidebar__theme:hover {
  background: var(--hover-2);
}

.agent-sidebar__update:disabled {
  cursor: default;
  opacity: 0.8;
}

.agent-sidebar__update-progress {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

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

.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__foot .agent-sidebar__copy {
  display: none;
}

.agent-sidebar[data-sidebar-collapsed='false'] .agent-sidebar__expand {
  pointer-events: none;
  opacity: 0;
}

.agent-sidebar[data-sidebar-collapsed='true'] .agent-sidebar__expand {
  pointer-events: auto;
  opacity: 1;
}

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
.user-menu-item:focus-visible {
  background: var(--hover-2);
  outline: 0;
}

.user-menu-item:disabled {
  cursor: default;
  opacity: 0.55;
}
</style>
