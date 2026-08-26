<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { AgentFileDiffChip } from '@/lib/agentConversation'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  files: AgentFileDiffChip[]
}>()

const emit = defineEmits<{
  openChanges: [path: string]
}>()

const preview = ref<{
  file: AgentFileDiffChip
  x: number
  top?: number
  bottom?: number
} | null>(null)

function openPreview(file: AgentFileDiffChip, event: Event) {
  const host = (event.currentTarget as HTMLElement | null)?.closest('[data-diffchip]')
  if (!(host instanceof HTMLElement)) return
  const rect = host.getBoundingClientRect()
  const height = 38 + file.lines.length * 19
  const fitsBelow = rect.bottom + 6 + height <= window.innerHeight - 12
  preview.value = {
    file,
    x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
    ...(fitsBelow
      ? { top: rect.bottom + 6 }
      : { bottom: window.innerHeight - rect.top + 6 }),
  }
}

function closePreview(file: AgentFileDiffChip) {
  if (preview.value?.file.path === file.path) preview.value = null
}

onBeforeUnmount(() => {
  preview.value = null
})
</script>

<template>
  <div
    v-if="files.length"
    class="agent-diff-chips"
    :aria-label="t('本轮文件改动', 'Files changed this turn')"
    data-testid="agent-file-chips"
  >
    <span
      v-for="file in files"
      :key="file.path"
      data-diffchip
      @mouseenter="openPreview(file, $event)"
      @mouseleave="closePreview(file)"
    >
      <button
        type="button"
        class="agent-diff-chip"
        :aria-label="t(`在变更中打开 ${file.path}`, `Open ${file.path} in changes`)"
        @focus="openPreview(file, $event)"
        @blur="closePreview(file)"
        @click="emit('openChanges', file.path)"
      >
        <span class="min-w-0 truncate">{{ file.path }}</span>
        <span
          v-if="file.add"
          class="agent-pill__add shrink-0"
        >+{{ file.add }}</span>
        <span
          v-if="file.del"
          class="agent-pill__del shrink-0"
        >-{{ file.del }}</span>
      </button>
    </span>
  </div>
  <Teleport to="body">
    <div
      v-if="preview"
      data-agent-conversation
      class="agent-diff-preview"
      role="tooltip"
      :style="{
        left: `${preview.x}px`,
        top: preview.top === undefined ? undefined : `${preview.top}px`,
        bottom: preview.bottom === undefined ? undefined : `${preview.bottom}px`,
      }"
    >
      <div class="agent-diff-preview__bar">
        <span class="min-w-0 truncate">{{ preview.file.path }}</span>
        <span class="shrink-0">
          <span
            v-if="preview.file.add"
            class="agent-pill__add"
          >+{{ preview.file.add }}</span>
          <span
            v-if="preview.file.del"
            class="agent-pill__del"
          > -{{ preview.file.del }}</span>
        </span>
      </div>
      <div v-if="preview.file.lines.length" class="py-1">
        <div
          v-for="(line, index) in preview.file.lines"
          :key="index"
          class="agent-diff-preview__line"
          :class="{
            'agent-diff-preview__line--add': line.tone === 'add',
            'agent-diff-preview__line--del': line.tone === 'del',
          }"
        >
          <span class="w-3 shrink-0 select-none">{{ line.tone === 'add' ? '+' : line.tone === 'del' ? '-' : ' ' }}</span>
          <span class="min-w-0 truncate">{{ line.text }}</span>
        </div>
      </div>
      <p
        v-else
        class="px-2.5 py-2 text-[11px] text-muted-foreground"
      >
        {{ t('没有可预览的文本 Diff。', 'No previewable text diff.') }}
      </p>
    </div>
  </Teleport>
</template>
