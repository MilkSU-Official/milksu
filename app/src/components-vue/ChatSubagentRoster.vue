<script setup lang="ts">
import { nextTick } from 'vue'
import AgentPixelLoader from '@/components-vue/AgentPixelLoader.vue'
import { formatSubagentYield } from '@/lib/subagentRoster'
import { t } from '@/lib/uiLocale'
import type { SubagentTask } from '@/types'

defineProps<{
  tasks: readonly SubagentTask[]
}>()

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

function onToggle(entryId: string, event: Event) {
  const details = event.currentTarget
  if (!(details instanceof HTMLDetailsElement) || event.target !== event.currentTarget) return
  if (details.open) reveal(entryDetails.get(entryId))
}

function durationLabel(durationMs?: number) {
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return t(`${durationMs} 毫秒`, `${durationMs} ms`)
  if (durationMs < 10_000) return t(`${(durationMs / 1000).toFixed(1)} 秒`, `${(durationMs / 1000).toFixed(1)} s`)
  return t(`${Math.round(durationMs / 1000)} 秒`, `${Math.round(durationMs / 1000)} s`)
}

function statusLabel(task: SubagentTask) {
  if (task.status === 'succeeded') return t('成功', 'Succeeded')
  if (task.status === 'failed') return t('失败', 'Failed')
  return t('进行中', 'Running')
}

function yieldText(task: SubagentTask) {
  return formatSubagentYield(task.yield)
}
</script>

<template>
  <div
    v-if="tasks.length"
    class="tool-activity__entries"
    data-testid="subagent-roster"
  >
    <details
      v-for="task in tasks"
      :key="task.id"
      :ref="element => setEntryDetails(task.id, element)"
      class="tool-activity-entry"
      :data-subagent-status="task.status"
      @toggle="onToggle(task.id, $event)"
    >
      <summary class="tool-activity-entry__summary agent-chip">
        <span class="agent-chip__icon" aria-hidden="true">
          <svg class="agent-chip__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="3" />
            <path d="M5 19a7 7 0 0 1 14 0" />
          </svg>
          <svg class="agent-chip__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
        <strong>{{ task.role }}</strong>
        <span class="min-w-0 truncate text-caption text-muted-foreground">{{ task.id }}</span>
        <span class="agent-pill">
          <span class="min-w-0 truncate">{{ statusLabel(task) }}</span>
        </span>
        <span class="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
          <span v-if="task.durationMs !== undefined">{{ durationLabel(task.durationMs) }}</span>
          <span v-if="task.exitCode !== undefined">{{ t(`结束码 ${task.exitCode}`, `exit ${task.exitCode}`) }}</span>
          <AgentPixelLoader
            v-if="task.status === 'start' || task.status === 'running'"
            :label="t('子任务进行中', 'Subtask running')"
            running
          />
        </span>
      </summary>
      <div v-if="yieldText(task)" class="tool-activity-entry__detail">
        <pre>{{ yieldText(task) }}</pre>
      </div>
    </details>
  </div>
</template>
