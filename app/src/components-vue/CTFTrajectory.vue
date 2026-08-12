<script setup lang="ts">
import { computed, ref } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  FileCode2,
  Flag,
  RotateCcw,
  X,
} from 'lucide-vue-next'
import type { CTFProjection } from '@/ctfTypes'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'

type TimelineKind = 'agent' | 'experiment' | 'submission' | 'failure'

interface TimelineEntry {
  id: string
  number: number
  kind: TimelineKind
  title: string
  summary: string
  status: string
  detail: string
  artifactCount: number
  occurredAt: string
}

const props = defineProps<{
  projection: CTFProjection
}>()

const expanded = ref(false)

function actionTitle(name: string) {
  switch (name) {
    case 'ctf.pi_agent_turn':
      return { kind: 'agent' as const, title: 'PI Agent 解题回合' }
    case 'ctf.submit_flag':
      return { kind: 'submission' as const, title: '候选进入 Judge 闸门' }
    case 'ctf.record_learning':
      return { kind: 'experiment' as const, title: '训练观察已记录' }
    default:
      return { kind: 'experiment' as const, title: name || '可复现实验' }
  }
}

const entries = computed<TimelineEntry[]>(() => {
  const attempts = new Map(props.projection.attempts.map(attempt => [attempt.id, attempt]))
  const experimentAttemptIds = new Set(props.projection.experiments.map(experiment => experiment.attemptId))
  const values = props.projection.experiments.map(experiment => {
    const attempt = attempts.get(experiment.attemptId)
    const action = experiment.action
    const definition = actionTitle(action?.name ?? '')
    const observation = experiment.observations.at(-1)?.summary
    const failed = experiment.status === 'failed' || attempt?.status === 'failed'
    return {
      id: experiment.id,
      number: experiment.number,
      kind: failed ? 'failure' as const : definition.kind,
      title: failed ? `${definition.title}失败` : definition.title,
      summary: failed
        ? '这个回合没有完成。需要诊断时可回到关联的 Coding 会话继续处理。'
        : observation || action?.rationale || '该步骤尚未形成完整观察。',
      status: failed ? 'failed' : experiment.status,
      detail: [attempt?.engine, attempt?.model].filter(Boolean).join(' · '),
      artifactCount: experiment.artifactIds.length,
      occurredAt: experiment.finishedAt || experiment.startedAt,
    }
  })
  for (const attempt of props.projection.attempts) {
    if (experimentAttemptIds.has(attempt.id) || (!attempt.reason && attempt.status !== 'failed')) continue
    values.push({
      id: attempt.id,
      number: values.length + 1,
      kind: 'failure',
      title: 'Agent 回合中断',
      summary: '这个回合没有完成。需要诊断时可回到关联的 Coding 会话继续处理。',
      status: attempt.status,
      detail: [attempt.engine, attempt.model].filter(Boolean).join(' · '),
      artifactCount: 0,
      occurredAt: attempt.finishedAt || attempt.startedAt,
    })
  }
  return values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
})

const visibleEntries = computed(() => (
  expanded.value || entries.value.length <= 5 ? entries.value : entries.value.slice(-5)
))

function formatTime(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function statusLabel(status: string) {
  switch (status) {
    case 'completed': return '已完成'
    case 'running': return '进行中'
    case 'failed': return '失败'
    case 'cancelled':
    case 'aborted':
    case 'interrupted': return '已中断'
    default: return status || '等待'
  }
}
</script>

<template>
  <details class="group game-surface px-5 py-4">
    <summary class="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
      <div>
        <h2 class="flex items-center gap-2 text-label font-medium">
          <RotateCcw class="size-4" />
          解题轨迹
        </h2>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          每次 Agent 回合、确定性实验和 Judge 分支都来自 Runtime 事实。
        </p>
      </div>
      <span class="flex items-center gap-2"><Badge variant="outline">{{ entries.length }} 步</Badge><ChevronDown class="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></span>
    </summary>

    <div v-if="visibleEntries.length" class="mt-5 border-t border-border pt-5">
      <article
        v-for="(entry, index) in visibleEntries"
        :key="entry.id"
        class="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
      >
        <span
          v-if="index < visibleEntries.length - 1"
          class="absolute bottom-0 left-[13px] top-7 w-px bg-border"
          aria-hidden="true"
        />
        <span
          class="relative z-10 flex size-7 items-center justify-center rounded-full border bg-background"
          :class="entry.kind === 'failure' ? 'border-destructive/50 text-destructive' : 'border-border text-foreground'"
        >
          <X v-if="entry.kind === 'failure'" class="size-3.5" />
          <Bot v-else-if="entry.kind === 'agent'" class="size-3.5" />
          <Flag v-else-if="entry.kind === 'submission'" class="size-3.5" />
          <FileCode2 v-else class="size-3.5" />
        </span>
        <div class="min-w-0 pt-0.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-mono text-caption text-muted-foreground">#{{ entry.number }}</span>
            <p class="text-control font-medium">{{ entry.title }}</p>
            <Badge :variant="entry.kind === 'failure' ? 'destructive' : 'outline'">
              {{ statusLabel(entry.status) }}
            </Badge>
            <span class="text-caption text-muted-foreground">{{ formatTime(entry.occurredAt) }}</span>
          </div>
          <MarkdownContent
            class="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
            :content="entry.summary"
            compact
          />
          <div v-if="entry.detail || entry.artifactCount" class="mt-2 flex flex-wrap gap-3 text-caption text-muted-foreground">
            <span v-if="entry.detail">{{ entry.detail }}</span>
            <span v-if="entry.artifactCount">{{ entry.artifactCount }} 个制品</span>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="mt-5 border-t border-border px-4 py-7 text-center">
      <Circle class="mx-auto size-4 text-muted-foreground" />
      <p class="mt-2 text-control font-medium">等待第一次可验证实验</p>
      <p class="mt-1 text-caption text-muted-foreground">打开 PI 后，工具结果和失败原因会出现在这里。</p>
    </div>

    <Button
      v-if="entries.length > 5"
      variant="link"
      size="text"
      class="mt-4"
      @click="expanded = !expanded"
    >
      <ChevronUp v-if="expanded" class="size-3.5" />
      <ChevronDown v-else class="size-3.5" />
      {{ expanded ? '只看最近 5 步' : `展开全部 ${entries.length} 步` }}
    </Button>

    <p
      v-if="projection.agentCandidates.length"
      class="mt-5 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-caption leading-5"
    >
      <Check class="size-3.5 shrink-0" />
      最新候选来自 PI 的显式候选文件；提交前仍需你确认。
    </p>
  </details>
</template>
