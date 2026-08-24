<script setup lang="ts">
import { computed } from 'vue'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  SettingsSection,
} from '@felinic/ui'
import { Check, Circle, RotateCcw, Send } from 'lucide-vue-next'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { redactProviderCredentials } from '@/lib/redaction'
import { t } from '@/lib/uiLocale'
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
      return t('这个候选已经被平台确认 Accepted，无需再次提交。', 'This candidate has already been Accepted by the platform; no need to submit again.')
    case 'fail':
      return t('这个候选已被平台拒绝，请修改后再提交。', 'This candidate was Rejected by the platform; change it before submitting again.')
    case 'needs_review':
      return t('这个候选正在等待平台判题，不能并发重复提交。', 'This candidate is waiting for a platform verdict; do not submit it again in parallel.')
    case 'inconclusive':
      return t('上次没有得到明确回执。你可以安全重试同一候选，或在平台页面核对后手动记录结果。', 'The last attempt did not return a clear receipt. You can safely retry the same candidate, or record the result after checking the platform page.')
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
  <SettingsSection :title="t('提交候选', 'Submit candidate')" aria-labelledby="ctf-submission-title">
    <div class="px-5 py-5">
    <h2 id="ctf-submission-title" class="sr-only">{{ t('提交候选', 'Submit candidate') }}</h2>
    <p class="mt-1 text-caption leading-5 text-muted-foreground">
      {{
        isArenaWorkspace
          ? t('由 Arena API 判题。', 'Judged by the Arena API.')
          : isCTFShowWorkspace
            ? t('通过已绑定的 CTFshow 标签页提交。', 'Submit through the bound CTFshow tab.')
            : isWebWorkspace
              ? t('通过已绑定的 NSSCTF 标签页提交。', 'Submit through the bound NSSCTF tab.')
              : t('复制到外部平台提交后，回来记录结果。', 'Copy to the external platform to submit, then come back to record the result.')
      }}
    </p>
    <p
      v-if="activeStartCost"
      class="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-caption leading-5"
    >
      {{ t(`题目需先在 NSSCTF 开启环境（${activeStartCost} 金币），开启后点“检测连接”。`, `Start the challenge environment on NSSCTF first (${activeStartCost} coins), then click Check connection.`) }}
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
        <span class="font-medium">{{ t('Agent 候选已载入', 'Agent candidate loaded') }}</span>
        <Badge
          :variant="activeAgentCandidate.assessment.status === 'unusual' ? 'destructive' : 'secondary'"
        >
          {{ activeAgentCandidate.assessment.status === 'unusual' ? t('格式需要确认', 'Format needs confirmation') : t('格式正常', 'Format looks valid') }}
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
          ? t('等待你在 NSSCTF 开启题目', 'Waiting for you to start the challenge on NSSCTF')
          : isCTFShowWorkspace
            ? t('提交到 CTFshow', 'Submit to CTFshow')
            : isWebWorkspace
              ? t('提交到 NSSCTF', 'Submit to NSSCTF')
              : t('提交候选', 'Submit candidate')
      }}
    </Button>

    <div v-if="projection.judgeReceipts.length" class="mt-4 rounded-lg bg-muted/50 p-3">
      <div class="flex items-center justify-between gap-3 text-caption">
        <span class="font-medium">{{ t('最新 Judge 回执', 'Latest Judge receipt') }}</span>
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
      <p class="text-caption font-medium">{{ t(`${redacted(externalJudgeLabel)}的结果是？`, `What was the result from ${redacted(externalJudgeLabel)}?`) }}</p>
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
    </div>
  </SettingsSection>
</template>
