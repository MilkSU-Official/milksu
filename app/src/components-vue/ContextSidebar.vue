<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
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
  Boxes,
  Folder,
  Library,
  MessageSquarePlus,
  MoreVertical,
  PanelLeftClose,
  Plus,
  Pencil,
  Radar,
  Search,
  Trash2,
} from 'lucide-vue-next'
import {
  groupCodingConversations,
  type CodingConversationGroup,
} from '@/lib/codingConversationGroups'
import {
  CTF_CONTEXT_ITEMS,
  showsCodingHistory,
  type CTFWorkspaceSection,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'
import type { Conversation } from '@/types'

const props = defineProps<{
  activeSection: WorkspaceSection
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  ctfSection: CTFWorkspaceSection
}>()

const emit = defineEmits<{
  new: []
  /** Collapse the Coding history panel (control lives in this header while open). */
  collapse: []
  selectConversation: [id: string]
  deleteConversation: [id: string]
  deleteConversationPermanently: [id: string]
  newProjectSession: [workspacePath: string]
  renameConversation: [id: string, title: string]
  navigateCtf: [value: CTFWorkspaceSection]
}>()

const unreadConversationIds = ref(new Set<string>())
let observedRunningIds: Set<string> | undefined

function selectConversation(id: string) {
  unreadConversationIds.value.delete(id)
  emit('selectConversation', id)
}

function openSingleConversation(event: MouseEvent, group: CodingConversationGroup) {
  if (group.conversations.length !== 1) return
  event.preventDefault()
  selectConversation(group.conversations[0].id)
}

const query = ref('')
const conversationList = ref<HTMLElement | null>(null)
const pendingAction = ref<{ conversation: Conversation, action: 'archive' | 'delete' } | null>(null)
const editingConversationId = ref<string | null>(null)
const editingTitle = ref('')
const codingGroups = computed(() => groupCodingConversations(props.conversations, query.value))
const runningConversationIds = computed(() => new Set(props.runningConversationIds ?? []))
const projectGroups = computed(() => codingGroups.value.filter(group => !group.temporary))
const temporaryGroup = computed(() => codingGroups.value.find(group => group.temporary) ?? null)
const codingContext = computed(() => showsCodingHistory(props.activeSection))
const ctfContext = computed(() => props.activeSection === 'ctf')
const vulnContext = computed(() => props.activeSection === 'vuln')

function confirmConversationAction() {
  if (!pendingAction.value) return
  const { conversation, action } = pendingAction.value
  if (action === 'archive') emit('deleteConversation', conversation.id)
  else emit('deleteConversationPermanently', conversation.id)
  pendingAction.value = null
}

function startRename(conversation: Conversation) {
  editingConversationId.value = conversation.id
  editingTitle.value = conversation.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="编辑会话标题"]')
    input?.focus()
    input?.select()
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
  () => [props.activeConversationId, codingContext.value, codingGroups.value.length] as const,
  async ([activeConversationId, isCodingContext]) => {
    if (!activeConversationId || !isCodingContext) return
    await nextTick()
    const activeRow = conversationList.value
      ?.querySelector<HTMLElement>('[data-active-conversation-row]')
    if (typeof activeRow?.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' })
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="coding-context-archive app-no-drag flex h-full min-h-0 min-w-0 flex-1 flex-col text-sidebar-foreground">
    <nav
      v-if="ctfContext"
      class="app-no-drag flex flex-1 flex-col gap-1 p-3"
      aria-label="CTF 工作区"
    >
      <Button
        v-for="item in CTF_CONTEXT_ITEMS"
        :key="item.id"
        :variant="ctfSection === item.id ? 'secondary' : 'ghost'"
        block
        :class="[
          'justify-start',
          ctfSection === item.id ? 'context-nav-active' : '',
        ]"
        :aria-current="ctfSection === item.id ? 'page' : undefined"
        :data-ui-selected="ctfSection === item.id ? '' : undefined"
        @click="$emit('navigateCtf', item.id)"
      >
        <Library v-if="item.id === 'catalog'" class="size-4" />
        <Boxes v-else class="size-4" />
        {{ item.label }}
      </Button>
    </nav>

    <nav
      v-else-if="vulnContext"
      class="app-no-drag flex flex-1 flex-col gap-1 p-3"
      aria-label="CVE 工作区"
    >
      <Button
        variant="secondary"
        block
        class="context-nav-active justify-start"
        aria-current="page"
        data-ui-selected=""
      >
        <Radar class="size-4" />
        追踪
      </Button>
    </nav>

    <div v-else-if="codingContext" class="coding-context-content app-no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- Collapse and the single global new-task action share the open history header. -->
      <div class="coding-history-header shrink-0 px-3 pt-2">
        <div class="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="coding-history-toggle app-no-drag shrink-0"
            data-testid="coding-history-toggle"
            aria-label="收起会话历史"
            title="收起会话历史"
            :aria-expanded="true"
            aria-controls="coding-context-sidebar"
            @click="$emit('collapse')"
          >
            <PanelLeftClose class="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="coding-new-session-button app-no-drag min-h-8 min-w-0 flex-1 justify-center"
            data-testid="coding-new-task-button"
            @click="$emit('new')"
          >
            <MessageSquarePlus class="size-4" />
            新会话
          </Button>
        </div>
        <label class="relative mt-2 block">
          <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="query"
            size="sm"
            emphasis="subtle"
            class="coding-sidebar-control h-7 pl-8"
            placeholder="搜索任务"
          />
        </label>
      </div>

      <div ref="conversationList" class="coding-conversation-list mt-2 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        <p class="px-3 py-1.5 text-label font-medium text-muted-foreground">项目</p>
        <div v-if="projectGroups.length || temporaryGroup" class="flex flex-col">
          <div v-if="projectGroups.length" class="space-y-1">
            <details
              v-for="group in projectGroups"
              :key="group.key"
              open
              class="coding-project-group"
            >
              <summary
                class="coding-project-row group flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 font-medium hover:bg-accent/50"
                :title="group.paths.length ? group.paths.join('\n') : group.name"
                @click="openSingleConversation($event, group)"
              >
                <Folder class="size-4 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{{ group.name }}</span>
                <Button
                  v-if="group.path"
                  variant="ghost"
                  size="icon-sm"
                  class="coding-project-new-session shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  :aria-label="`在 ${group.name} 中新建会话`"
                  :title="`在 ${group.name} 中新建会话`"
                  @click.stop="$emit('newProjectSession', group.path)"
                >
                  <Plus class="size-3.5" />
                </Button>
              </summary>
              <!-- Child title starts under the folder name (right of the folder icon). -->
              <div class="coding-project-children mt-0.5 space-y-0.5">
                <div
                  v-for="conversation in group.conversations"
                  :key="conversation.id"
                  class="group flex items-center rounded-md transition-colors hover:bg-accent/50"
                  :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                  :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
                >
                  <Input
                    v-if="editingConversationId === conversation.id"
                    v-model="editingTitle"
                    size="sm"
                    class="ml-1 h-7 min-w-0 flex-1"
                    aria-label="编辑会话标题"
                    maxlength="40"
                    @click.stop
                    @keydown.enter.prevent="finishRename(conversation)"
                    @keydown.escape.prevent="cancelRename"
                    @blur="finishRename(conversation)"
                  />
                  <Button
                    v-else
                    variant="quiet"
                    size="sm"
                    class="coding-project-row coding-project-child relative h-7 min-w-0 flex-1 justify-start text-foreground"
                    :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                    @click.stop="selectConversation(conversation.id)"
                  >
                    <span class="coding-session-status">
                      <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" label="运行中" />
                      <span
                        v-else-if="unreadConversationIds.has(conversation.id)"
                        class="coding-session-complete size-1.5 rounded-full bg-primary"
                        aria-label="有新消息"
                      />
                    </span>
                    <span class="truncate">{{ conversation.title }}</span>
                  </Button>
                  <DropdownMenu v-if="editingConversationId !== conversation.id">
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label="会话操作"
                        @click.stop
                      >
                        <MoreVertical class="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" :side-offset="4" class="w-40">
                      <DropdownMenuItem aria-label="重命名编码任务" @select="startRename(conversation)">
                        <Pencil class="size-4" />重命名
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem aria-label="归档编码任务" @select="pendingAction = { conversation, action: 'archive' }">
                        <Archive class="size-4" />归档
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="text-destructive focus:text-destructive"
                        aria-label="永久删除编码任务"
                        @select="pendingAction = { conversation, action: 'delete' }"
                      >
                        <Trash2 class="size-4" />删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </details>
          </div>

          <!-- Scratch tasks sit alone under the project tree: no folder, no shared sort rank. -->
          <details
            v-if="temporaryGroup"
            open
            class="coding-temporary-group mt-3"
            data-testid="coding-temporary-group"
          >
            <summary
              class="coding-project-row flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-accent/50"
              title="未绑定项目的编码任务"
              @click="openSingleConversation($event, temporaryGroup)"
            >
              <span class="min-w-0 flex-1 truncate">{{ temporaryGroup.name }}</span>
            </summary>
            <div class="coding-project-children mt-0.5 space-y-0.5">
              <div
                v-for="conversation in temporaryGroup.conversations"
                :key="conversation.id"
                class="group flex items-center rounded-md transition-colors hover:bg-accent/50"
                :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
              >
                <Input
                  v-if="editingConversationId === conversation.id"
                  v-model="editingTitle"
                  size="sm"
                  class="ml-1 h-7 min-w-0 flex-1"
                  aria-label="编辑会话标题"
                  maxlength="40"
                  @click.stop
                  @keydown.enter.prevent="finishRename(conversation)"
                  @keydown.escape.prevent="cancelRename"
                  @blur="finishRename(conversation)"
                />
                <Button
                  v-else
                  variant="quiet"
                  size="sm"
                  class="coding-project-row coding-project-child relative h-7 min-w-0 flex-1 justify-start text-foreground"
                  :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                  @click.stop="selectConversation(conversation.id)"
                >
                  <span class="coding-session-status">
                    <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" label="运行中" />
                    <span
                      v-else-if="unreadConversationIds.has(conversation.id)"
                      class="coding-session-complete size-1.5 rounded-full bg-primary"
                      aria-label="有新消息"
                    />
                  </span>
                  <span class="truncate">{{ conversation.title }}</span>
                </Button>
                <DropdownMenu v-if="editingConversationId !== conversation.id">
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      aria-label="会话操作"
                      @click.stop
                    >
                      <MoreVertical class="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" :side-offset="4" class="w-40">
                    <DropdownMenuItem aria-label="重命名编码任务" @select="startRename(conversation)">
                      <Pencil class="size-4" />重命名
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem aria-label="归档编码任务" @select="pendingAction = { conversation, action: 'archive' }">
                      <Archive class="size-4" />归档
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      class="text-destructive focus:text-destructive"
                      aria-label="永久删除编码任务"
                      @select="pendingAction = { conversation, action: 'delete' }"
                    >
                      <Trash2 class="size-4" />删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </details>
        </div>
        <p v-else class="px-3 py-3 text-body text-muted-foreground">
          {{ query.trim() ? '没有匹配的 Coding 任务' : '还没有 Coding 项目' }}
        </p>
      </div>
    </div>
    <div v-else class="flex-1" />

    <Dialog :open="Boolean(pendingAction)" @update:open="open => { if (!open) pendingAction = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ pendingAction?.action === 'delete' ? '永久删除聊天？' : '归档聊天？' }}</DialogTitle>
          <DialogDescription>
            <template v-if="pendingAction?.action === 'delete'">
              “{{ pendingAction.conversation.title }}”的聊天记录将被永久删除，此操作无法撤销。项目文件不会被删除。
            </template>
            <template v-else>
              “{{ pendingAction?.conversation.title }}”将从会话列表移到“设置 → 归档聊天”。之后可以恢复或永久删除。
            </template>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="pendingAction = null">取消</Button>
          <Button :variant="pendingAction?.action === 'delete' ? 'destructive' : 'default'" @click="confirmConversationAction">
            {{ pendingAction?.action === 'delete' ? '确认永久删除' : '确认归档' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  </div>
</template>

<style scoped>
.coding-sidebar-control {
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}

.coding-history-toggle,
.coding-new-task-icon,
.coding-new-session-button {
  -webkit-app-region: no-drag;
}

.coding-new-session-button {
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}

.coding-context-content {
  /* Traffic lights sit on the icon rail; history panel starts flush under the top edge. */
  min-height: 0;
  padding-top: 0.35rem;
}

.coding-conversation-list {
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.coding-context-archive {
  min-height: 0;
  background-color: transparent;
  color: var(--night-foreground);
  --foreground: var(--night-foreground);
  --card-foreground: var(--night-foreground);
  --muted-foreground: var(--night-muted-foreground);
  --secondary: var(--night-muted);
  --secondary-foreground: var(--night-foreground);
  --muted: var(--night-muted);
  --accent: var(--night-accent);
  --accent-foreground: var(--night-foreground);
  --border: var(--night-border);
  --input: var(--night-input);
  --surface-sunken: var(--night-sunken);
  /*
   * This panel stays a dark carbon surface in day mode. Paper-theme overlays
   * are dark-on-dark and hide the current-session fill; keep the night wash.
   */
  --overlay-hover-light: rgb(255 255 255 / 0.055);
  --overlay-hover: rgb(255 255 255 / 0.09);
  --overlay-hover-strong: rgb(255 255 255 / 0.13);
  --overlay-active: rgb(255 255 255 / 0.155);
  --overlay-active-strong: rgb(255 255 255 / 0.19);
  --selected-bg: var(--overlay-hover-strong);
}

.coding-context-archive :deep([data-slot='input']) {
  color: var(--night-foreground);
}

.coding-project-row {
  font-size: var(--text-control);
  line-height: var(--text-control--line-height);
  letter-spacing: var(--text-control--letter-spacing);
}


/*
 * Align nested task titles with the folder name column:
 * parent summary uses px-3 + Folder(size-4) + gap-2 before the name.
 * Override Button sm horizontal padding so the first glyph sits on that column.
 */
.coding-project-child {
  padding-inline-start: calc(0.75rem + 1rem + 0.5rem) !important;
  padding-inline-end: 0.5rem !important;
}

.coding-session-status {
  position: absolute;
  inset-inline-start: 0.75rem;
  top: 50%;
  display: inline-flex;
  width: 1rem;
  height: 1rem;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
}

.coding-session-status :deep(.ak-loading-host) {
  width: 1rem;
  min-width: 1rem;
  min-height: 1rem;
}

.context-nav-active {
  color: var(--brand);
}
</style>
