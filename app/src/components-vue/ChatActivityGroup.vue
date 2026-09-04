<script setup lang="ts">
import { computed, nextTick } from 'vue'
import AgentPixelLoader from '@/components-vue/AgentPixelLoader.vue'
import ChatSubagentRoster from '@/components-vue/ChatSubagentRoster.vue'
import {
  buildChatActivityEntries,
  detailsToggleOpen,
  visibleChatActivityEntries,
  type ChatActivityBlock,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
import { agentToolChip } from '@/lib/agentConversation'
import { subagentTasksForActivity } from '@/lib/subagentRoster'
import { t } from '@/lib/uiLocale'
import type { SubagentTask } from '@/types'

const props = withDefaults(defineProps<{
  activity: ChatActivityBlock
  open: boolean
  openEntryIds: ReadonlySet<string>
  revealCompleted?: boolean
  subagentTasks?: readonly SubagentTask[]
}>(), {
  revealCompleted: false,
  subagentTasks: () => [],
})

const emit = defineEmits<{
  toggleGroup: [open: boolean]
  toggleEntry: [entryId: string, open: boolean]
}>()

const rosterTasks = computed(() => (
  subagentTasksForActivity(props.subagentTasks, props.activity.messages)
))
const rosterCallIds = computed(() => new Set(
  rosterTasks.value.flatMap(task => [task.id, task.toolCallId].filter(Boolean) as string[]),
))
const toolEntries = computed(() => {
  const entries = buildChatActivityEntries(props.activity.messages)
    .filter(entry => (
      entry.toolName !== 'subagent'
      || !rosterCallIds.value.has(String(entry.request?.toolCallId ?? ''))
    ))
  return props.revealCompleted ? entries : visibleChatActivityEntries(entries, props.openEntryIds)
})
const entryDetails = new Map<string, HTMLDetailsElement>()

function setEntryDetails(entryId: string, element: unknown) {
  if (element instanceof HTMLDetailsElement) entryDetails.set(entryId, element)
  else entryDetails.delete(entryId)
}

function reveal(element: Element | null | undefined) {
  if (!element || typeof element.scrollIntoView !== 'function') return
  void nextTick(() => {
    element.scrollIntoView({ block: 'nearest' })
  })
}

function toggleEntry(entryId: string, event: Event) {
  const open = detailsToggleOpen(event)
  if (open === undefined) return
  emit('toggleEntry', entryId, open)
  if (open) reveal(entryDetails.get(entryId))
}

function chip(entry: ChatActivityEntry) {
  return agentToolChip(entry)
}

function durationLabel(durationMs?: number) {
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return t(`${durationMs} 毫秒`, `${durationMs} ms`)
  if (durationMs < 10_000) return t(`${(durationMs / 1000).toFixed(1)} 秒`, `${(durationMs / 1000).toFixed(1)} s`)
  return t(`${Math.round(durationMs / 1000)} 秒`, `${Math.round(durationMs / 1000)} s`)
}
</script>

<template>
  <div
    v-if="toolEntries.length || rosterTasks.length"
    class="tool-activity mb-7"
    :data-activity-open="open ? 'true' : 'false'"
  >
    <ChatSubagentRoster :tasks="rosterTasks" />
    <div v-if="toolEntries.length" class="tool-activity__entries">
      <details
        v-for="entry in toolEntries"
        :key="entry.id"
        :ref="element => setEntryDetails(entry.id, element)"
        class="tool-activity-entry"
        :open="openEntryIds.has(entry.id)"
        @toggle="toggleEntry(entry.id, $event)"
      >
        <summary class="tool-activity-entry__summary agent-chip">
          <span class="agent-chip__icon" aria-hidden="true">
            <svg class="agent-chip__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="chip(entry).verb === 'Edit' || chip(entry).verb === 'Write'" d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
              <path v-else-if="chip(entry).verb === 'bash'" d="M4 17l6-5-6-5M12 19h8" />
              <g v-else>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </g>
            </svg>
            <svg class="agent-chip__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <strong>{{ chip(entry).verb }}</strong>
          <span v-if="chip(entry).pill" class="agent-pill">
            <span class="min-w-0 truncate">{{ chip(entry).pill }}</span>
            <span v-if="chip(entry).add !== undefined" class="agent-pill__add">+{{ chip(entry).add }}</span>
            <span v-if="chip(entry).del !== undefined" class="agent-pill__del">-{{ chip(entry).del }}</span>
          </span>
          <span class="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
            <span v-if="entry.durationMs !== undefined">{{ durationLabel(entry.durationMs) }}</span>
            <AgentPixelLoader
              v-if="entry.running"
              :label="t('工具进行中', 'Tool running')"
              running
            />
          </span>
        </summary>
        <div class="tool-activity-entry__detail">
          <template v-if="entry.request">
            <pre>{{ entry.request.content || t('工具没有可显示的输入。', 'This tool had no displayable input.') }}</pre>
          </template>
          <template v-if="entry.result">
            <p v-if="entry.request" class="tool-activity-entry__result-label">
              {{ t('结果', 'Result') }}
            </p>
            <pre>{{ entry.result.content || t('工具没有返回可显示的内容。', 'This tool returned no displayable output.') }}</pre>
          </template>
        </div>
      </details>
    </div>
  </div>
</template>
