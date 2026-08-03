<script setup lang="ts">
import { Archive, BrainCircuit } from 'lucide-vue-next'
import { Badge, Button } from '@felinic/ui'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import type { CTFTrainingMemory, CTFTrainingMemoryEvidenceLink } from '@/ctfTypes'

defineProps<{
  memories: CTFTrainingMemory[]
  loading?: boolean
}>()

const emit = defineEmits<{
  archive: [memory: CTFTrainingMemory]
  inspectEvidence: [evidence: CTFTrainingMemoryEvidenceLink]
}>()

function verificationLabel(memory: CTFTrainingMemory) {
  if (memory.verification === 'judge-verified') return 'Judge 验证'
  if (memory.verification === 'user-confirmed') return '用户确认'
  if (memory.verification === 'failure-observed') return '失败观察'
  return '旧记录 · 未分级'
}

function actorLabel(memory: CTFTrainingMemory) {
  if (memory.actor === 'user') return '用户完成'
  if (memory.actor === 'agent') return 'Agent 代做'
  if (memory.actor === 'shared') return '共同完成'
  return '贡献不可追溯'
}

function assistanceLabel(memory: CTFTrainingMemory) {
  if (memory.assistance === 'none') return '无协助'
  if (memory.assistance === 'hint') return '依赖提示'
  if (memory.assistance === 'copilot') return '搭档协作'
  return '代理/未归属'
}

function fallbackEvidence(ref: string) {
  const separator = ref.indexOf(':')
  const kind = separator > 0 ? ref.slice(0, separator) : 'evidence'
  const id = separator > 0 ? ref.slice(separator + 1) : ref
  return {
    kind,
    id,
    label: ref,
  }
}

function evidenceLinks(memory: CTFTrainingMemory) {
  return memory.recall?.evidence?.length
    ? memory.recall.evidence
    : memory.evidenceRefs.slice(0, 8).map(fallbackEvidence)
}
</script>

<template>
  <details class="group rounded-xl border border-border bg-card">
    <summary class="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
      <span class="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <BrainCircuit class="size-4" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-label font-medium">解题记忆</span>
        <span class="block truncate text-caption text-muted-foreground">
          {{
            loading
              ? '正在匹配'
              : memories.length
                ? `${memories.length} 条待验证先验`
                : '没有匹配的旧题技法'
          }}
        </span>
      </span>
      <Badge v-if="memories.length" variant="outline">
        {{ memories.length }}
      </Badge>
    </summary>

    <div class="border-t border-border px-5 py-4">
      <p class="text-caption leading-5 text-muted-foreground">
        这些内容来自你明确保存的旧题复盘。正确性证据和贡献归属分别标记；
        Agent 必须用当前材料重新验证，原始证据优先。
      </p>
      <div v-if="memories.length" class="mt-3 space-y-3">
        <article
          v-for="memory in memories"
          :key="memory.id"
          class="rounded-lg bg-muted/40 p-3"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <p class="line-clamp-1 text-control font-medium">{{ memory.title }}</p>
              <MarkdownContent
                class="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                :content="memory.summary"
                compact
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title="停用这条综合记忆；不删除原始证据"
              :aria-label="`停用记忆：${memory.title}`"
              @click="emit('archive', memory)"
            >
              <Archive class="size-3.5" />
            </Button>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {{ verificationLabel(memory) }}
            </Badge>
            <Badge variant="outline">
              {{ actorLabel(memory) }} · {{ assistanceLabel(memory) }}
            </Badge>
            <Badge variant="outline">置信 {{ Math.round(memory.confidence * 100) }}%</Badge>
            <Badge v-for="tag in memory.tags.slice(0, 2)" :key="tag" variant="secondary">
              {{ tag }}
            </Badge>
          </div>
          <div
            v-if="memory.recall?.reasons?.length || evidenceLinks(memory).length"
            class="mt-3 rounded-md border border-border bg-background/60 p-2 text-caption leading-5 text-muted-foreground"
          >
            <p v-if="memory.recall?.reasons?.length">
              推荐依据：{{ memory.recall.reasons.slice(0, 2).join('；') }}
            </p>
            <p v-if="evidenceLinks(memory).length" class="mt-1">
              可核对证据：
              <button
                v-for="(evidence, index) in evidenceLinks(memory).slice(0, 4)"
                :key="`${evidence.kind}:${evidence.id}`"
                type="button"
                class="rounded-sm text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :title="`${evidence.kind}:${evidence.id}`"
                :data-evidence-kind="evidence.kind"
                :data-evidence-id="evidence.id"
                @click="emit('inspectEvidence', evidence)"
              >
                <span v-if="index">；</span>{{ evidence.label }}
              </button>
            </p>
          </div>
        </article>
      </div>
    </div>
  </details>
</template>
