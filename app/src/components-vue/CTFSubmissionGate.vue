<script setup lang="ts">
import { computed } from 'vue'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
} from '@felinic/ui'
import { Check, Circle, Flag, RotateCcw, Send } from 'lucide-vue-next'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { redactProviderCredentials } from '@/lib/redaction'
import type { CTFProjection } from '@/ctfTypes'

const props = defineProps<{
  projection: CTFProjection
  working: boolean
  canContinue: boolean
  activeStartCost: number
  activeBrowserCanSubmit: boolean
  ctfshowBridgeReady: boolean
  platformReview: boolean
  externalJudgeLabel: string
}>()

const emit = defineEmits<{
  submit: []
  recordPlatformResult: [accepted: boolean]
}>()

const candidate = defineModel<string>({ required: true })

const isArenaWorkspace = computed(() => (
  props.projection.challenge.externalPlatform === 'nssctf-agent-arena'
))
const isWebWorkspace = computed(() => (
  props.projection.challenge.externalPlatform === 'nssctf-web'
))
const isCTFShowWorkspace = computed(() => (
  props.projection.challenge.externalPlatform === 'ctfshow-web'
))
const activeAgentCandidate = computed(() => {
  const value = props.projection.agentCandidates.at(-1)
  if (!value || value.candidate !== candidate.value.trim()) return null
  return value
})
const matchingSubmission = computed(() => {
  const value = candidate.value.trim()
  if (!value) return null
  return props.projection.submissions.find(submission => submission.candidate === value) ?? null
})
const matchingSubmissionMessage = computed(() => {
  switch (matchingSubmission.value?.verdict) {
    case 'pass':
      return '这个候选已经被平台确认 Accepted，无需再次提交。'
    case 'fail':
      return '这个候选已被平台拒绝，请修改后再提交。'
    case 'needs_review':
      return '这个候选正在等待平台判题，不能并发重复提交。'
    case 'inconclusive':
      return '上次没有得到明确回执。你可以安全重试同一候选，或在平台页面核对后手动记录结果。'
    default:
      return ''
  }
})
const matchingSubmissionBlocks = computed(() => (
  matchingSubmission.value?.verdict === 'pass'
  || matchingSubmission.value?.verdict === 'fail'
  || matchingSubmission.value?.verdict === 'needs_review'
))

function redacted(value: string) {
  return redactProviderCredentials(value)
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5" aria-labelledby="ctf-submission-title">
    <h2 id="ctf-submission-title" class="flex items-center gap-2 text-label font-medium">
      <Flag class="size-4" />
      提交候选
    </h2>
    <p class="mt-1 text-caption leading-5 text-muted-foreground">
      {{
        isArenaWorkspace
          ? '由 Arena API 判题。'
          : isCTFShowWorkspace
            ? '通过已绑定的 CTFshow 标签页提交。'
            : isWebWorkspace
              ? '通过已绑定的 NSSCTF 标签页提交。'
              : '复制到外部平台提交后，回来记录结果。'
      }}
    </p>
    <p
      v-if="activeStartCost"
      class="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-caption leading-5"
    >
      题目需先在 NSSCTF 开启环境（{{ activeStartCost }} 金币），开启后点“检测连接”。
    </p>
    <Input v-model="candidate" class="mt-4 font-mono" placeholder="flag{...}" />
    <Alert v-if="matchingSubmissionMessage" class="mt-3">
      <RotateCcw class="size-4" />
      <AlertDescription>{{ matchingSubmissionMessage }}</AlertDescription>
    </Alert>
    <div
      v-if="activeAgentCandidate && !projection.submissions.length"
      class="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-caption leading-5"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium">Agent 候选已载入</span>
        <Badge
          :variant="activeAgentCandidate.assessment.status === 'unusual' ? 'destructive' : 'secondary'"
        >
          {{ activeAgentCandidate.assessment.status === 'unusual' ? '格式需要确认' : '格式正常' }}
        </Badge>
      </div>
      <p class="mt-1 line-clamp-4 text-muted-foreground">
        {{ redacted(activeAgentCandidate.explanation) }}
      </p>
      <ul
        v-if="activeAgentCandidate.assessment.warnings.length"
        class="mt-2 space-y-1 border-t border-border pt-2 text-destructive"
      >
        <li
          v-for="warning in activeAgentCandidate.assessment.warnings"
          :key="warning"
          class="flex items-start gap-1.5"
        >
          <Circle class="mt-1 size-2 shrink-0 fill-current" />
          <span>{{ redacted(warning) }}</span>
        </li>
      </ul>

    </div>
    <Button
      block
      class="mt-3"
      :loading="working"
      :disabled="!candidate.trim()
        || !canContinue
        || matchingSubmissionBlocks
        || (isWebWorkspace && !activeBrowserCanSubmit)
        || (isCTFShowWorkspace && !ctfshowBridgeReady)"
      @click="emit('submit')"
    >
      <Send class="size-4" />
      {{
        isWebWorkspace && activeStartCost
          ? '等待你在 NSSCTF 开启题目'
          : isCTFShowWorkspace
            ? '提交到 CTFshow'
            : isWebWorkspace
              ? '提交到 NSSCTF'
              : '提交候选'
      }}
    </Button>

    <div v-if="projection.judgeReceipts.length" class="mt-4 rounded-lg bg-muted/50 p-3">
      <div class="flex items-center justify-between gap-3 text-caption">
        <span class="font-medium">最新 Judge 回执</span>
        <Badge variant="outline">{{ projection.judgeReceipts.at(-1)?.status }}</Badge>
      </div>
      <MarkdownContent
        class="mt-2 line-clamp-3 text-caption leading-5 text-muted-foreground"
        :content="redacted(projection.judgeReceipts.at(-1)?.summary ?? '')"
        compact
      />
    </div>

    <div
      v-if="platformReview && (!isWebWorkspace || projection.evaluations.at(-1)?.verdict === 'inconclusive')"
      class="mt-4 border-t border-border pt-4"
    >
      <p class="text-caption font-medium">{{ redacted(externalJudgeLabel) }}的结果是？</p>
      <div class="mt-3 flex gap-2">
        <Button variant="outline" class="flex-1" @click="emit('recordPlatformResult', false)">
          <RotateCcw class="size-4" />
          Rejected
        </Button>
        <Button class="flex-1" @click="emit('recordPlatformResult', true)">
          <Check class="size-4" />
          Accepted
        </Button>
      </div>
    </div>
  </section>
</template>
