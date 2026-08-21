<script setup lang="ts">
import { computed } from 'vue'
import {
  externalEditorLabel,
  normalizePreferredExternalEditor,
  type ExternalEditorId,
} from '@/lib/externalEditor'

const props = withDefaults(defineProps<{
  editor?: string
}>(), {
  editor: 'vscode',
})

const editorId = computed<ExternalEditorId>(() => (
  normalizePreferredExternalEditor(props.editor)
))
const label = computed(() => externalEditorLabel(editorId.value))
</script>

<template>
  <span
    class="inline-flex size-4 shrink-0 items-center justify-center"
    :title="label"
    role="img"
    :aria-label="label"
  >
    <svg
      v-if="editorId === 'vscode' || editorId === 'vscode-insiders'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="#2488FF"
        d="M23.15 2.59 18.21.21a1.49 1.49 0 0 0-1.7.29l-9.46 8.63-4.12-3.13a1 1 0 0 0-1.28.06L.33 7.26a1 1 0 0 0 0 1.46L3.9 12 .33 15.28a1 1 0 0 0 0 1.46l1.32 1.2a1 1 0 0 0 1.28.06l4.12-3.13 9.46 8.63a1.49 1.49 0 0 0 1.7.29l4.94-2.38A1.5 1.5 0 0 0 24 20.06V3.94a1.5 1.5 0 0 0-.85-1.35Zm-5.15 14.86L10.83 12l7.17-5.45Z"
      />
    </svg>
    <svg
      v-else-if="editorId === 'cursor'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M4 3.2 20.4 12 4 20.8V14l8.2-2L4 10z"
      />
    </svg>
    <svg
      v-else-if="editorId === 'windsurf'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="#0EA5E9"
        d="M4 6.5 12 3l8 3.5v11L12 21 4 17.5zm2.2 1.3v8.4L12 19l5.8-2.8V7.8L12 5z"
      />
    </svg>
    <svg
      v-else-if="editorId === 'zed'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M5 5h14l-9 7h9v7H5l9-7H5z"
      />
    </svg>
    <svg
      v-else-if="editorId === 'trae'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2" />
      <path fill="currentColor" d="M12 7.2 16.2 16h-2.1l-.8-1.8H10.7L9.9 16H7.8z" />
    </svg>
    <svg
      v-else-if="editorId === 'sublime'"
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="#FF9800"
        d="M3.2 6.4 20.8 3v5.4L3.2 11.8zm0 6.2 17.6-3.4v5.4L3.2 18zm0 6.2 17.6-3.4V21L3.2 24z"
      />
    </svg>
    <svg
      v-else
      viewBox="0 0 24 24"
      class="size-4"
      aria-hidden="true"
    >
      <path
        fill="#FE315D"
        d="M7 3h10v2.4H13.2v13.2H10.8V5.4H7z"
      />
    </svg>
  </span>
</template>
