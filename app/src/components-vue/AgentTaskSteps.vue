<script setup lang="ts">
import { computed } from 'vue'
import {
  FilePenLine,
  Image,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import {
  chatActivityEntrySummary,
  presentRecentActivitySteps,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
import type { Message } from '@/types'

const props = defineProps<{
  messages: Message[]
  running: boolean
  /** Max rows in the side rail. */
  limit?: number
}>()

const steps = computed(() => (
  presentRecentActivitySteps(props.messages, props.running, props.limit ?? 12)
))

const hasRunning = computed(() => steps.value.some(step => step.running))

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

function durationLabel(durationMs?: number) {
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs / 1000)}s`
}
</script>

<template>
  <section
    class="agent-task-steps border-b border-border px-4 py-4"
    aria-label="当前任务步骤"
    data-testid="agent-task-steps"
  >
    <div class="flex items-center justify-between gap-3">
      <p class="text-caption font-medium text-muted-foreground">当前步骤</p>
      <span
        v-if="running || hasRunning"
        class="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
      >
        <LoaderCircle class="size-3 animate-spin" />
        进行中
      </span>
      <span v-else-if="steps.length" class="text-caption text-muted-foreground">
        {{ steps.length }} 步
      </span>
    </div>

    <ol v-if="steps.length" class="mt-3 space-y-1">
      <li
        v-for="(entry, index) in steps"
        :key="entry.id"
        class="agent-task-steps__row flex min-w-0 items-center gap-2 rounded-md px-1 py-1.5"
        :class="{ 'agent-task-steps__row--active': entry.running }"
      >
        <span
          class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] tabular-nums text-muted-foreground"
        >
          {{ index + 1 }}
        </span>
        <component
          :is="entryIcon(entry)"
          class="size-3.5 shrink-0 text-muted-foreground"
        />
        <span class="min-w-0 flex-1 truncate text-caption leading-5">
          {{ chatActivityEntrySummary(entry) }}
        </span>
        <LoaderCircle
          v-if="entry.running"
          class="size-3 shrink-0 animate-spin text-primary"
        />
        <span
          v-else-if="entry.durationMs !== undefined"
          class="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
        >
          {{ durationLabel(entry.durationMs) }}
        </span>
      </li>
    </ol>
    <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
      {{ running ? '模型思考中…' : '发送消息后，工具步骤会显示在这里。' }}
    </p>
  </section>
</template>

<style scoped>
.agent-task-steps__row--active {
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  color: var(--foreground);
}
</style>
