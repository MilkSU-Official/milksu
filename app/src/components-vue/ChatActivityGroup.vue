<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ChevronDown,
  FilePenLine,
  Image,
  Search,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import {
  buildChatActivityEntries,
  chatActivityEntrySummary,
  chatActivitySummary,
  detailsToggleOpen,
  type ChatActivityBlock,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
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

const summary = computed(() => chatActivitySummary(props.activity.messages))
const toolEntries = computed(() => buildChatActivityEntries(props.activity.messages))
const groupDetails = ref<HTMLDetailsElement | null>(null)
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

function toggleGroup(event: Event) {
  const open = detailsToggleOpen(event)
  if (open === undefined) return
  emit('toggleGroup', open)
  if (open) reveal(groupDetails.value)
}

function toggleEntry(entryId: string, event: Event) {
  const open = detailsToggleOpen(event)
  if (open === undefined) return
  emit('toggleEntry', entryId, open)
  if (open) reveal(entryDetails.get(entryId))
}
const summaryIcon = computed(() => {
  const names = new Set(toolEntries.value.map(entry => entry.toolName))
  if (names.has('edit') || names.has('write') || names.has('lsp_fix')) return FilePenLine
  if (names.has('milksu_archify')) return Wrench
  if (names.has('milksu_imagegen')) return Image
  if ([...names].some(name => ['read', 'ls', 'find', 'grep'].includes(name))) return Search
  return Terminal
})

function entryIcon(entry: ChatActivityEntry) {
  const name = entry.toolName
  if (
    name === 'bash'
    || name === 'background'
    || name === 'background_output'
    || name === 'bg_task'
    || name === 'bg_status'
  ) return Terminal
  if (name === 'write' || name === 'edit') return FilePenLine
  if (name === 'milksu_imagegen') return Image
  if (name === 'read' || name === 'ls' || name === 'find' || name === 'grep') return Search
  return Wrench
}

function detailLabel(entry: ChatActivityEntry) {
  const name = entry.toolName
  if (name === 'bash') return 'Shell'
  if (name === 'background' || name === 'bg_task') return t('后台进程', 'Background process')
  if (name === 'background_output' || name === 'bg_status') return t('进程状态', 'Process status')
  if (name === 'read') return t('文件内容', 'File contents')
  if (name === 'write' || name === 'edit') return t('文件变更', 'File changes')
  if (name === 'ls' || name === 'find' || name === 'grep') return t('检索结果', 'Search results')
  if (name === 'milksu_archify') return t('架构图', 'Architecture diagram')
  if (name === 'milksu_imagegen') return t('ImageGen 输入、输出、usage 与费用', 'ImageGen input, output, usage, and cost')
  return entry.request?.toolName ?? entry.result?.toolName ?? t('工具详情', 'Tool details')
}

function durationLabel(durationMs?: number) {
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return t(`${durationMs} 毫秒`, `${durationMs} ms`)
  if (durationMs < 10_000) return t(`${(durationMs / 1000).toFixed(1)} 秒`, `${(durationMs / 1000).toFixed(1)} s`)
  return t(`${Math.round(durationMs / 1000)} 秒`, `${Math.round(durationMs / 1000)} s`)
}
</script>

<template>
  <details
    ref="groupDetails"
    class="tool-activity mb-7"
    :open="open"
    @toggle="toggleGroup"
  >
    <summary class="tool-activity__summary">
      <component :is="summaryIcon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 truncate">{{ summary }}</span>
      <span v-if="activity.running" class="ak-tag ak-tag--compact">RUN</span>
      <AkLoadingMark v-if="activity.running" :label="t('工具进行中', 'Tool running')" />
      <ChevronDown class="tool-activity__chevron size-4 shrink-0 text-muted-foreground" />
    </summary>

    <div class="tool-activity__entries">
      <details
        v-for="entry in toolEntries"
        :key="entry.id"
        :ref="element => setEntryDetails(entry.id, element)"
        class="tool-activity-entry"
        :open="openEntryIds.has(entry.id)"
        @toggle="toggleEntry(entry.id, $event)"
      >
        <summary class="tool-activity-entry__summary">
          <component :is="entryIcon(entry)" class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">
            {{ chatActivityEntrySummary(entry) }}
          </span>
          <span
            v-if="entry.durationMs !== undefined"
            class="shrink-0 text-caption tabular-nums text-muted-foreground"
          >
            {{ durationLabel(entry.durationMs) }}
          </span>
          <AkLoadingMark
            v-if="entry.running"
            :label="t('工具进行中', 'Tool running')"
          />
          <ChevronDown class="tool-activity-entry__chevron size-3.5 shrink-0 text-muted-foreground" />
        </summary>
        <div class="tool-activity-entry__detail">
          <p class="tool-activity-entry__detail-label">
            {{ detailLabel(entry) }}
          </p>
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
  </details>
</template>

<style scoped>
.tool-activity {
  color: var(--muted-foreground);
}

.tool-activity__summary,
.tool-activity-entry__summary {
  display: flex;
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
  list-style: none;
  align-items: center;
  gap: 0.55rem;
  border-radius: 0.45rem;
}

.tool-activity__summary {
  min-height: 2.25rem;
  padding: 0.35rem 0.25rem;
  font-size: var(--text-label, 0.875rem);
  line-height: 1.25rem;
  font-weight: 550;
}

.tool-activity__summary:hover,
.tool-activity-entry__summary:hover {
  background: color-mix(in srgb, var(--muted) 45%, transparent);
  color: var(--foreground);
}

.tool-activity__summary::-webkit-details-marker,
.tool-activity-entry__summary::-webkit-details-marker {
  display: none;
}

.tool-activity__entries {
  margin-top: 0.15rem;
  max-height: min(28rem, 48vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.25rem;
}

.tool-activity-entry__summary {
  min-height: 2.2rem;
  padding: 0.3rem 0.25rem;
  font-size: var(--text-body, 0.875rem);
  line-height: 1.25rem;
}

.tool-activity__chevron,
.tool-activity-entry__chevron {
  transition: transform 140ms ease;
}

.tool-activity[open] > .tool-activity__summary .tool-activity__chevron,
.tool-activity-entry[open] > .tool-activity-entry__summary .tool-activity-entry__chevron {
  transform: rotate(180deg);
}

.tool-activity-entry__detail {
  margin: 0.2rem 0 0.65rem 1.75rem;
  max-height: 18rem;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--background) 70%, var(--muted));
  padding: 0.75rem 0.85rem;
  color: var(--foreground);
  font-size: var(--text-caption, 0.8125rem);
  line-height: 1.35rem;
}

.tool-activity-entry__detail-label {
  margin: 0 0 0.55rem;
  color: var(--muted-foreground);
  font-family: var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--text-caption, 0.8125rem);
  line-height: 1.1rem;
}

.tool-activity-entry__result-label {
  margin: 0.75rem 0 0.35rem;
  border-top: 1px solid var(--border);
  padding-top: 0.65rem;
  color: var(--muted-foreground);
  font-family: var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--text-caption, 0.8125rem);
  line-height: 1.1rem;
}

.tool-activity-entry__detail pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
</style>
