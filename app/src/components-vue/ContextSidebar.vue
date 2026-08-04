<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Button,
  Input,
} from '@felinic/ui'
import {
  Boxes,
  ChevronRight,
  Folder,
  Library,
  MessageSquarePlus,
  Radar,
  Search,
  Trash2,
} from 'lucide-vue-next'
import { groupCodingConversations } from '@/lib/codingConversationGroups'
import {
  CTF_CONTEXT_ITEMS,
  showsCodingHistory,
  workspaceContextLabel,
  type CTFWorkspaceSection,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'
import type { Conversation } from '@/types'

const props = defineProps<{
  activeSection: WorkspaceSection
  activeConversationId: string | null
  conversations: Conversation[]
  ctfSection: CTFWorkspaceSection
}>()

defineEmits<{
  new: []
  selectConversation: [id: string]
  deleteConversation: [id: string]
  navigateCtf: [value: CTFWorkspaceSection]
}>()

const query = ref('')
const conversationList = ref<HTMLElement | null>(null)
const codingGroups = computed(() => groupCodingConversations(props.conversations, query.value))
const contextLabel = computed(() => workspaceContextLabel(props.activeSection))
const codingContext = computed(() => showsCodingHistory(props.activeSection))
const ctfContext = computed(() => props.activeSection === 'ctf')
const vulnContext = computed(() => props.activeSection === 'vuln')

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
  <div class="app-drag flex min-w-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
    <header class="flex h-[4.75rem] flex-col justify-center border-b border-border px-4">
      <p class="text-label font-semibold tracking-[-0.02em]">MilkSU</p>
      <p class="mt-0.5 text-caption text-muted-foreground">{{ contextLabel }}</p>
    </header>

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

    <div v-else-if="codingContext" class="app-no-drag flex min-h-0 flex-1 flex-col pt-4">
      <div class="px-3">
        <Button
          variant="outline"
          size="sm"
          block
          class="coding-sidebar-control h-7 justify-start"
          @click="$emit('new')"
        >
          <MessageSquarePlus class="size-3.5" />
          新建编码任务
        </Button>
        <label class="relative mt-3 block">
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

      <div ref="conversationList" class="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        <p class="px-3 py-2 text-caption font-medium text-muted-foreground">项目</p>
        <div v-if="codingGroups.length" class="space-y-1">
          <details
            v-for="group in codingGroups"
            :key="group.key"
            open
            class="coding-project-group"
          >
            <summary
              class="coding-project-row flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 font-medium hover:bg-accent/50"
              :title="group.path ?? '未绑定仓库的临时编码任务'"
            >
              <ChevronRight class="coding-project-chevron size-3.5 shrink-0 text-muted-foreground" />
              <Folder class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ group.name }}</span>
              <span class="text-caption font-normal tabular-nums text-muted-foreground">
                {{ group.conversations.length }}
              </span>
            </summary>
            <div class="ml-5 mt-0.5 space-y-0.5 border-l border-border/70 pl-1.5">
              <div
                v-for="conversation in group.conversations"
                :key="conversation.id"
                class="group flex items-center rounded-md"
                :data-ui-selected="activeConversationId === conversation.id ? '' : undefined"
                :data-active-conversation-row="activeConversationId === conversation.id ? '' : undefined"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  class="coding-project-row h-7 min-w-0 flex-1 justify-start pl-2"
                  @click="$emit('selectConversation', conversation.id)"
                >
                  <span class="truncate">{{ conversation.title }}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="删除编码任务"
                  @click="$emit('deleteConversation', conversation.id)"
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
.coding-sidebar-control,
.coding-project-row {
  font-size: var(--text-caption);
  line-height: var(--text-caption--line-height);
  letter-spacing: var(--text-caption--letter-spacing);
}

.coding-project-group[open] > summary .coding-project-chevron {
  transform: rotate(90deg);
}

.coding-project-chevron {
  transition: transform 140ms ease;
}

.context-nav-active {
  color: var(--brand);
}
</style>
