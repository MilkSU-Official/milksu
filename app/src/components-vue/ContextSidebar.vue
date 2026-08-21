<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import {
  Button,
  Input,
} from '@felinic/ui'
import {
  Boxes,
  Folder,
  Library,
  MessageSquarePlus,
  PanelLeftClose,
  Plus,
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
  newProjectSession: [workspacePath: string]
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
const codingGroups = computed(() => groupCodingConversations(props.conversations, query.value))
const runningConversationIds = computed(() => new Set(props.runningConversationIds ?? []))
const projectGroups = computed(() => codingGroups.value.filter(group => !group.temporary))
const temporaryGroup = computed(() => codingGroups.value.find(group => group.temporary) ?? null)
const codingContext = computed(() => showsCodingHistory(props.activeSection))
const ctfContext = computed(() => props.activeSection === 'ctf')
const vulnContext = computed(() => props.activeSection === 'vuln')

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
      <!--
        Open history header:
        1) collapse + compact new-task icon (same pair that parks on the topbar when closed)
        2) full-width “新会话” button on the next row
      -->
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
            variant="ghost"
            size="icon-sm"
            class="coding-new-task-icon app-no-drag shrink-0"
            aria-label="新建编码任务"
            title="新建编码任务"
            data-testid="coding-new-task-button"
            @click="$emit('new')"
          >
            <MessageSquarePlus class="size-4" />
          </Button>
        </div>
        <div class="mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="coding-new-session-button app-no-drag min-h-8 w-full justify-center"
            @click="$emit('new')"
          >
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
                  class="group flex items-center rounded-md hover:bg-accent/50"
                  :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                  :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    class="coding-project-row coding-project-child h-7 min-w-0 flex-1 justify-start hover:bg-transparent"
                    :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                    @click.stop="selectConversation(conversation.id)"
                  >
                    <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" label="运行中" />
                    <span
                      v-else-if="unreadConversationIds.has(conversation.id)"
                      class="coding-session-complete size-1.5 shrink-0 rounded-full bg-primary"
                      aria-label="有新消息"
                    />
                    <span class="truncate">{{ conversation.title }}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="删除编码任务"
                    @click.stop="$emit('deleteConversation', conversation.id)"
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
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
                class="group flex items-center rounded-md hover:bg-accent/50"
                :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  class="coding-project-row coding-project-child h-7 min-w-0 flex-1 justify-start hover:bg-transparent"
                  :aria-current="activeConversationId === conversation.id ? 'true' : undefined"
                  @click.stop="selectConversation(conversation.id)"
                >
                  <AkLoadingMark v-if="runningConversationIds.has(conversation.id)" label="运行中" />
                  <span
                    v-else-if="unreadConversationIds.has(conversation.id)"
                    class="coding-session-complete size-1.5 shrink-0 rounded-full bg-primary"
                    aria-label="有新消息"
                  />
                  <span class="truncate">{{ conversation.title }}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="删除编码任务"
                  @click.stop="$emit('deleteConversation', conversation.id)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
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

.coding-project-children :deep([data-button][data-variant='ghost']:hover::before),
.coding-project-children :deep([data-button][data-variant='ghost']:active::before) {
  background-color: transparent;
}

.context-nav-active {
  color: var(--brand);
}
</style>
