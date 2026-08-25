<script setup lang="ts">
import { computed, nextTick } from 'vue'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import {
  buildChatActivityEntries,
  detailsToggleOpen,
  visibleChatActivityEntries,
  type ChatActivityBlock,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
import { agentToolChip } from '@/lib/agentConversation'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  activity: ChatActivityBlock
  open: boolean
  openEntryIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  toggleGroup: [open: boolean]
  toggleEntry: [entryId: string, open: boolean]
}>()

const toolEntries = computed(() => visibleChatActivityEntries(
  buildChatActivityEntries(props.activity.messages),
  props.openEntryIds,
))
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
    v-if="toolEntries.length"
    class="tool-activity mb-7"
    :data-activity-open="open ? 'true' : 'false'"
  >
    <div class="tool-activity__entries">
      <details
        v-for="entry in toolEntries"
        :key="entry.id"
        :ref="element => setEntryDetails(entry.id, element)"
        class="tool-activity-entry"
        :open="openEntryIds.has(entry.id)"
        @toggle="toggleEntry(entry.id, $event)"
      >
        <summary class="tool-activity-entry__summary agent-chip">
          <strong>{{ chip(entry).verb }}</strong>
          <span v-if="chip(entry).pill" class="agent-pill">
            <span class="min-w-0 truncate">{{ chip(entry).pill }}</span>
            <span v-if="chip(entry).add !== undefined" class="agent-pill__add">+{{ chip(entry).add }}</span>
            <span v-if="chip(entry).del !== undefined" class="agent-pill__del">-{{ chip(entry).del }}</span>
          </span>
          <span class="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
            <span v-if="entry.durationMs !== undefined">{{ durationLabel(entry.durationMs) }}</span>
            <AkLoadingMark
              v-if="entry.running"
              :label="t('工具进行中', 'Tool running')"
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
