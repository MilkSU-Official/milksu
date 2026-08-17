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
  /** When true, only show unified diff (GitHub PR style). */
  readOnly?: boolean
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
      class="coding-diff-hunk overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {{ hunk.header }}
        </span>
        <template v-if="!readOnly">
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
        </template>
      </header>
      <pre class="coding-diff-pre max-h-80 overflow-auto py-1 font-mono text-[12px] leading-5"><code><span
        v-for="(line, lineIndex) in hunk.lines"
        :key="`${lineIndex}:${line.text}`"
        class="coding-diff-line block min-w-max px-2.5"
        :class="{
          'coding-diff-line--add': line.kind === 'addition',
          'coding-diff-line--del': line.kind === 'deletion',
          'coding-diff-line--meta': line.kind === 'metadata',
        }"
      >{{ line.text || ' ' }}</span></code></pre>
    </article>
  </div>
  <pre
    v-else
    class="coding-diff-pre coding-diff-fallback max-h-[28rem] overflow-auto whitespace-pre font-mono text-[12px] leading-5"
  >{{ diff }}</pre>
</template>

<style scoped>
.coding-diff-hunk,
.coding-diff-fallback {
  color: var(--card-foreground, var(--foreground));
}

.coding-diff-pre,
.coding-diff-pre code {
  color: inherit;
}

.coding-diff-line {
  color: inherit;
}

.coding-diff-line--add {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}

.coding-diff-line--del {
  background: color-mix(in srgb, var(--destructive) 12%, transparent);
  color: var(--destructive);
}

.coding-diff-line--meta {
  color: var(--muted-foreground);
}
</style>
