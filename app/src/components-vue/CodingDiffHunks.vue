<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import {
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-vue-next'
import { parseUnifiedDiffHunks } from '@/lib/unifiedDiff'
import type { CodingGitHunkAction } from '@/codingEnvironmentTypes'

const props = defineProps<{
  diff: string
  source: 'staged' | 'working-tree'
  busy?: boolean
}>()

defineEmits<{
  apply: [action: CodingGitHunkAction, patch: string]
}>()

const hunks = computed(() => parseUnifiedDiffHunks(props.diff))
</script>

<template>
  <div v-if="hunks.length" class="space-y-3">
    <article
      v-for="(hunk, index) in hunks"
      :key="hunk.id"
      class="overflow-hidden rounded-lg border border-border bg-surface-editor"
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {{ hunk.header }}
        </span>
        <Button
          v-if="source === 'working-tree'"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="busy"
          :aria-label="`暂存代码块 ${index + 1}`"
          @click="$emit('apply', 'stage-hunk', hunk.patch)"
        >
          <Plus class="size-3.5" />
          暂存此块
        </Button>
        <Button
          v-if="source === 'working-tree'"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="busy"
          :aria-label="`撤销代码块 ${index + 1}`"
          @click="$emit('apply', 'discard-hunk', hunk.patch)"
        >
          <RotateCcw class="size-3.5" />
          撤销
        </Button>
        <Button
          v-else
          type="button"
          variant="ghost"
          size="sm"
          :disabled="busy"
          :aria-label="`取消暂存代码块 ${index + 1}`"
          @click="$emit('apply', 'unstage-hunk', hunk.patch)"
        >
          <Minus class="size-3.5" />
          取消暂存
        </Button>
      </header>
      <pre class="max-h-80 overflow-auto py-1 font-mono text-[12px] leading-5"><code><span
        v-for="(line, lineIndex) in hunk.lines"
        :key="`${lineIndex}:${line.text}`"
        class="block min-w-max px-2.5"
        :class="{
          'bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary': line.kind === 'addition',
          'bg-destructive/10 text-destructive': line.kind === 'deletion',
          'text-muted-foreground': line.kind === 'metadata',
        }"
      >{{ line.text || ' ' }}</span></code></pre>
    </article>
  </div>
  <pre
    v-else
    class="max-h-[28rem] overflow-auto whitespace-pre font-mono text-[12px] leading-5"
  >{{ diff }}</pre>
</template>
