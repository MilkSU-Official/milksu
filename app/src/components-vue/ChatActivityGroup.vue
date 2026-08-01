<script setup lang="ts">
import { computed } from 'vue'
import {
  Bot,
  ChevronDown,
  FilePenLine,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import {
  chatActivityEntrySummary,
  chatActivitySummary,
  type ChatActivityBlock,
} from '@/lib/chatActivity'
import type { Message } from '@/types'

const props = defineProps<{
  activity: ChatActivityBlock
}>()

const summary = computed(() => chatActivitySummary(props.activity.messages))
const toolMessages = computed(() => (
  props.activity.messages.filter(message => message.role === 'tool')
))

function entryIcon(message: Message) {
  if (message.role === 'assistant') return Bot
  const name = String(message.toolName ?? '').toLowerCase()
  if (name === 'bash' || name === 'background' || name === 'background_output') return Terminal
  if (name === 'write' || name === 'edit') return FilePenLine
  if (name === 'read' || name === 'ls' || name === 'find' || name === 'grep') return Search
  return Wrench
}
</script>

<template>
  <details class="tool-activity mb-7">
    <summary class="tool-activity__summary">
      <Terminal class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate">{{ summary }}</span>
      <span class="shrink-0 text-caption font-normal text-muted-foreground">
        {{ toolMessages.length ? `${toolMessages.length} 个工具` : '思考中' }}
      </span>
      <LoaderCircle v-if="activity.running" class="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      <ChevronDown class="tool-activity__chevron size-4 shrink-0 text-muted-foreground" />
    </summary>

    <div class="tool-activity__entries">
      <details
        v-for="message in activity.messages"
        :key="message.id"
        class="tool-activity-entry"
      >
        <summary class="tool-activity-entry__summary">
          <component :is="entryIcon(message)" class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">
            {{ chatActivityEntrySummary(message) }}
          </span>
          <LoaderCircle
            v-if="message.status === 'running'"
            class="size-3.5 shrink-0 animate-spin text-muted-foreground"
          />
          <ChevronDown class="tool-activity-entry__chevron size-3.5 shrink-0 text-muted-foreground" />
        </summary>
        <div class="tool-activity-entry__detail">
          <MarkdownContent
            v-if="message.role === 'assistant'"
            :content="message.content"
            compact
          />
          <pre v-else>{{ message.content || '工具没有返回可显示的内容。' }}</pre>
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
  cursor: pointer;
  list-style: none;
  align-items: center;
  gap: 0.55rem;
  border-radius: 0.45rem;
}

.tool-activity__summary {
  min-height: 2.25rem;
  padding: 0.35rem 0.5rem;
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
  margin: 0.25rem 0 0 0.85rem;
  border-left: 1px solid var(--border);
  padding: 0.15rem 0 0.15rem 0.75rem;
}

.tool-activity-entry__summary {
  min-height: 2rem;
  padding: 0.3rem 0.5rem;
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
  margin: 0.2rem 0.5rem 0.55rem 1.65rem;
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

.tool-activity-entry__detail pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
</style>
