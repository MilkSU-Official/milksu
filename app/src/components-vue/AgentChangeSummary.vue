<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentFileChips from '@/components-vue/AgentFileChips.vue'
import type { AgentFileDiffChip } from '@/lib/agentConversation'
import type { CodingGitChange } from '@/codingEnvironmentTypes'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  summary?: {
    changedFiles: number
    additions: number
    deletions: number
    changes?: CodingGitChange[]
    changesTruncated?: boolean
  }
  previews?: AgentFileDiffChip[]
}>()

const emit = defineEmits<{
  openChanges: [path?: string]
}>()

const expanded = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | undefined

const files = computed((): AgentFileDiffChip[] => {
  const changes = props.summary?.changes ?? []
  if (!changes.length && props.previews?.length) return props.previews
  return changes.map(change => {
    const base = change.path.split(/[/\\]/).at(-1) ?? change.path
    const preview = props.previews?.find(file => file.path === change.path || file.path === base)
    return {
      path: change.path,
      add: change.additions ?? preview?.add ?? 0,
      del: change.deletions ?? preview?.del ?? 0,
      lines: preview?.lines ?? [],
    }
  })
})

function open() {
  if (closeTimer !== undefined) clearTimeout(closeTimer)
  expanded.value = true
}

function close(event?: MouseEvent | FocusEvent) {
  const next = event && 'relatedTarget' in event ? event.relatedTarget : null
  if (next instanceof Node && event?.currentTarget instanceof Node && event.currentTarget.contains(next)) {
    return
  }
  if (next instanceof Element && next.closest('.agent-diff-preview')) return
  closeTimer = setTimeout(() => {
    expanded.value = false
  }, 180)
}

function toggle() {
  expanded.value = !expanded.value
}

function openFile(path: string) {
  emit('openChanges', path)
  expanded.value = false
}
</script>

<template>
  <section
    v-if="summary && summary.changedFiles > 0"
    class="agent-change-rows"
    :aria-label="t('代码变更', 'Code changes')"
    data-testid="agent-change-summary"
    @mouseenter="open"
    @mouseleave="close"
    @focusin="open"
    @focusout="close"
  >
    <div class="agent-task-row" :data-open="expanded ? 'true' : 'false'">
      <button
        type="button"
        class="agent-task-row__head"
        :aria-expanded="expanded"
        :aria-label="t('查看代码变更', 'View code changes')"
        @click.stop="toggle"
      >
        <span class="agent-task-row__label">{{ t(`${summary.changedFiles} 个文件已更改`, `${summary.changedFiles} files changed`) }}</span>
        <span class="agent-task-row__amount">
          <span class="agent-change-add">+{{ summary.additions }}</span>
          <span class="agent-change-del">-{{ summary.deletions }}</span>
        </span>
      </button>
    </div>

    <div class="agent-task-rows__more" :data-open="expanded ? 'true' : 'false'">
      <div class="agent-task-rows__more-inner">
        <AgentFileChips
          :files="files"
          @open-changes="openFile"
        />
      </div>
    </div>
  </section>
</template>
