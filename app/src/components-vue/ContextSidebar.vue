<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { isComposingKey } from '@/lib/imeComposition'
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
  ctfContextItemLabel,
  showsCodingHistory,
  type CTFWorkspaceSection,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'
import { t } from '@/lib/uiLocale'
import type { Conversation } from '@/types'

const props = defineProps<{
  activeSection: WorkspaceSection
  activeConversationId: string | null
  conversations: Conversation[]
  runningConversationIds?: string[]
  /** Set by the parent when archiving or deleting failed; keeps the dialog open. */
  actionError?: string
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
const pendingActionRunning = ref(false)
const editingConversationId = ref<string | null>(null)
const editingTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const codingGroups = computed(() => groupCodingConversations(props.conversations, query.value))
const runningConversationIds = computed(() => new Set(props.runningConversationIds ?? []))
const projectGroups = computed(() => codingGroups.value.filter(group => !group.temporary))
const temporaryGroup = computed(() => codingGroups.value.find(group => group.temporary) ?? null)
const codingContext = computed(() => showsCodingHistory(props.activeSection))
const ctfContext = computed(() => props.activeSection === 'ctf')
const vulnContext = computed(() => props.activeSection === 'vuln')

// The parent owns the RPC, so the dialog stays open until the conversation leaves
// the list (success) or an error arrives (failure).
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
      :aria-label="t('CTF 工作区', 'CTF workspace')"
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
        {{ ctfContextItemLabel(item.id) }}
      </Button>
    </nav>

    <nav
      v-else-if="vulnContext"
      class="app-no-drag flex flex-1 flex-col gap-1 p-3"
      :aria-label="t('CVE 工作区', 'CVE workspace')"
    >
      <Button
        variant="secondary"
        block
        class="context-nav-active justify-start"
        aria-current="page"
        data-ui-selected=""
      >
        <Radar class="size-4" />
        {{ t('追踪', 'Tracking') }}
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
            :aria-label="t('收起会话历史', 'Collapse chat history')"
            :title="t('收起会话历史', 'Collapse chat history')"
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
            {{ t('新会话', 'New chat') }}
          </Button>
        </div>
        <label class="relative mt-2 block">
          <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="query"
            size="sm"
            emphasis="subtle"
            class="coding-sidebar-control h-7 pl-8"
            :placeholder="t('搜索任务', 'Search tasks')"
          />
        </label>
      </div>

      <div ref="conversationList" class="coding-conversation-list mt-2 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        <p class="px-3 py-1.5 text-label font-medium text-muted-foreground">{{ t('项目', 'Projects') }}</p>
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
                  :aria-label="t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)"
                  :title="t(`在 ${group.name} 中新建会话`, `New chat in ${group.name}`)"
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
                  class="group flex items-center transition-colors hover:bg-accent/50"
                  :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                  :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
                >
                  <Input
                    v-if="editingConversationId === conversation.id"
                    :ref="setRenameInput"
                    v-model="editingTitle"
                    size="sm"
                    class="coding-project-title-input h-7 min-w-0 flex-1 rounded-none"
                    :aria-label="t('编辑会话标题', 'Edit chat title')"
                    maxlength="40"
                    @click.stop
                    @keydown.enter="submitRename($event, conversation)"
                    @keydown.escape="abortRename($event)"
                    @blur="finishRename(conversation)"
                  />
                  <Button
                    v-else
                    variant="quiet"
                    size="sm"
                    class="coding-project-row coding-project-child relative h-7 min-w-0 flex-1 justify-start rounded-none text-foreground hover:bg-transparent"
                    :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                    @click.stop="selectConversation(conversation.id)"
                  >
                    <span class="coding-session-status">
                      <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" :label="t('运行中', 'Running')" />
                      <span
                        v-else-if="unreadConversationIds.has(conversation.id)"
                        class="coding-session-complete size-1.5 rounded-full bg-primary"
                        :aria-label="t('有新消息', 'New messages')"
                      />
                    </span>
                    <span class="truncate">{{ conversation.title }}</span>
                  </Button>
                  <span
                    v-if="editingConversationId === conversation.id"
                    class="mr-1 size-8 shrink-0"
                    aria-hidden="true"
                    data-testid="conversation-action-placeholder"
                  />
                  <DropdownMenu v-if="editingConversationId !== conversation.id">
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        class="mr-1 rounded-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        :aria-label="t('会话操作', 'Chat actions')"
                        @click.stop
                      >
                        <MoreVertical class="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" :side-offset="4" class="w-40">
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

          <!-- Scratch tasks sit alone under the project tree: no folder, no shared sort rank. -->
          <details
            v-if="temporaryGroup"
            open
            class="coding-temporary-group mt-3"
            data-testid="coding-temporary-group"
          >
            <summary
              class="coding-project-row flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-accent/50"
              :title="t('未绑定项目的编码任务', 'Coding tasks not bound to a project')"
              @click="openSingleConversation($event, temporaryGroup)"
            >
              <span class="min-w-0 flex-1 truncate">{{ temporaryGroup.name }}</span>
            </summary>
            <div class="coding-project-children mt-0.5 space-y-0.5">
              <div
                v-for="conversation in temporaryGroup.conversations"
                :key="conversation.id"
                class="group flex items-center transition-colors hover:bg-accent/50"
                :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
              >
                <Input
                  v-if="editingConversationId === conversation.id"
                  :ref="setRenameInput"
                  v-model="editingTitle"
                  size="sm"
                  class="coding-project-title-input h-7 min-w-0 flex-1 rounded-none"
                  :aria-label="t('编辑会话标题', 'Edit chat title')"
                  maxlength="40"
                  @click.stop
                  @keydown.enter="submitRename($event, conversation)"
                  @keydown.escape="abortRename($event)"
                  @blur="finishRename(conversation)"
                />
                <Button
                  v-else
                  variant="quiet"
                  size="sm"
                  class="coding-project-row coding-project-child relative h-7 min-w-0 flex-1 justify-start rounded-none text-foreground hover:bg-transparent"
                  :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                  @click.stop="selectConversation(conversation.id)"
                >
                  <span class="coding-session-status">
                    <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" :label="t('运行中', 'Running')" />
                    <span
                      v-else-if="unreadConversationIds.has(conversation.id)"
                      class="coding-session-complete size-1.5 rounded-full bg-primary"
                      :aria-label="t('有新消息', 'New messages')"
                    />
                  </span>
                  <span class="truncate">{{ conversation.title }}</span>
                </Button>
                <span
                  v-if="editingConversationId === conversation.id"
                  class="mr-1 size-8 shrink-0"
                  aria-hidden="true"
                  data-testid="conversation-action-placeholder"
                />
                <DropdownMenu v-if="editingConversationId !== conversation.id">
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="mr-1 rounded-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      :aria-label="t('会话操作', 'Chat actions')"
                      @click.stop
                    >
                      <MoreVertical class="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" :side-offset="4" class="w-40">
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
        <p v-else-if="query.trim()" class="px-3 py-3 text-body text-muted-foreground">
          {{ t('没有匹配的 Coding 任务', 'No matching Coding tasks') }}
        </p>
      </div>
    </div>
    <div v-else class="flex-1" />

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

.coding-history-toggle[aria-expanded='true']:not(:hover)::before {
  background-color: transparent !important;
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
  color: var(--foreground);
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

.coding-project-children :deep([data-button][data-variant='ghost']:hover::before),
.coding-project-children :deep([data-button][data-variant='ghost']:active::before) {
  background-color: transparent;
}

.coding-project-title-input {
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
