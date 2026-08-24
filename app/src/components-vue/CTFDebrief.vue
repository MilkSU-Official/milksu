<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Badge, Button, SettingsSection, Textarea } from '@felinic/ui'
import {
  BrainCircuit,
  Check,
  Circle,
  Copy,
  FileCheck2,
  Handshake,
  Lightbulb,
  Route,
  Sparkles,
  UserRoundCheck,
  X,
} from 'lucide-vue-next'
import type {
  CTFDebrief,
  CTFHumanOutcome,
  CTFLearningActor,
  CTFLearningAssistance,
} from '@/ctfTypes'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { t } from '@/lib/uiLocale'

const props = defineProps<{
  debrief: CTFDebrief
  humanOutcome: CTFHumanOutcome
  submitting?: boolean
}>()

const emit = defineEmits<{
  submitIndependentStep: [content: string]
  submitReflection: [content: string]
  saveMemory: []
}>()

const independentStep = ref('')
const independentStepConfirmed = ref(false)
const submittedAtStepCount = ref<number | null>(null)
const reflection = ref('')
const submittedAtCount = ref<number | null>(null)
const copyNotice = ref('')
function userFacingDebriefText(value: string) {
  const text = value.trim()
  if (/CTF engine propose|engine propose|context deadline exceeded|unavailable capability|i\/o timeout/i.test(text)) {
    return t('这一步没有完成', 'This step did not complete')
  }
  return text
}

const visibleFailureBranches = computed(() => (
  [...new Set(props.debrief.failureBranches.map(userFacingDebriefText).filter(Boolean))]
))

const canSaveMemory = computed(
  () => props.debrief.status !== 'in_progress' && props.debrief.reflectionCount > 0,
)
const handoffSummary = computed(() => [
  t('# MilkSU CTF 复盘接力棒', '# MilkSU CTF debrief handoff'),
  t(`- 状态：${statusLabel(props.debrief.status)}`, `- Status: ${statusLabel(props.debrief.status)}`),
  t(
    `- Judge：${props.debrief.candidates.at(-1) ? verdictLabel(props.debrief.candidates.at(-1)?.verdict ?? '') : t('未判定', 'Not judged')}`,
    `- Judge: ${props.debrief.candidates.at(-1) ? verdictLabel(props.debrief.candidates.at(-1)?.verdict ?? '') : t('未判定', 'Not judged')}`,
  ),
  t(
    `- 证据：${props.debrief.evidenceCount} 条；制品 ${props.debrief.artifactCount} 个；候选 ${props.debrief.candidates.length} 个`,
    `- Evidence: ${props.debrief.evidenceCount}; artifacts ${props.debrief.artifactCount}; candidates ${props.debrief.candidates.length}`,
  ),
  t(
    `- 贡献归属：${actorLabel(props.humanOutcome.contribution.primaryActor)}；${assistanceLabel(props.humanOutcome.contribution.assistance)}`,
    `- Attribution: ${actorLabel(props.humanOutcome.contribution.primaryActor)}; ${assistanceLabel(props.humanOutcome.contribution.assistance)}`,
  ),
  t(
    `- 用户步骤：独立 ${props.humanOutcome.contribution.userIndependentSteps}；协助 ${props.humanOutcome.contribution.userAssistedSteps}`,
    `- User steps: independent ${props.humanOutcome.contribution.userIndependentSteps}; assisted ${props.humanOutcome.contribution.userAssistedSteps}`,
  ),
  t(
    `- Agent/导入记录：Agent ${props.humanOutcome.contribution.agentRecords}；导入 ${props.humanOutcome.contribution.importedRecords}`,
    `- Agent/imported records: Agent ${props.humanOutcome.contribution.agentRecords}; imported ${props.humanOutcome.contribution.importedRecords}`,
  ),
  t(
    `- 提示依赖：${props.debrief.hintCount}；复盘 ${props.debrief.reflectionCount}`,
    `- Hint dependence: ${props.debrief.hintCount}; debrief ${props.debrief.reflectionCount}`,
  ),
  t(
    `- 推荐下一步：${props.debrief.recommendedNextAction}`,
    `- Recommended next: ${props.debrief.recommendedNextAction}`,
  ),
].join('\n'))

function submit() {
  const content = reflection.value.trim()
  if (!content) return
  submittedAtCount.value = props.debrief.reflectionCount
  emit('submitReflection', content)
}

function submitIndependentStep() {
  const content = independentStep.value.trim()
  if (!content || !independentStepConfirmed.value) return
  submittedAtStepCount.value = props.humanOutcome.contribution.userIndependentSteps
    + props.humanOutcome.contribution.userAssistedSteps
  emit('submitIndependentStep', content)
}

async function copyHandoffSummary() {
  copyNotice.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(handoffSummary.value)
    copyNotice.value = t('已复制', 'Copied')
  } catch {
    copyNotice.value = t('复制失败，请手动选择摘要', 'Copy failed; select the summary manually')
  }
}

watch(
  () => props.debrief.reflectionCount,
  (count) => {
    if (submittedAtCount.value !== null && count > submittedAtCount.value) {
      reflection.value = ''
      submittedAtCount.value = null
    }
  },
)

watch(
  () => props.humanOutcome.contribution.userIndependentSteps
    + props.humanOutcome.contribution.userAssistedSteps,
  (count) => {
    if (submittedAtStepCount.value !== null && count > submittedAtStepCount.value) {
      independentStep.value = ''
      independentStepConfirmed.value = false
      submittedAtStepCount.value = null
    }
  },
)

function actorLabel(actor: CTFLearningActor) {
  switch (actor) {
    case 'user': return t('用户', 'User')
    case 'agent': return 'Agent'
    case 'shared': return t('用户与 Agent 共同完成', 'Completed together by user and Agent')
    default: return t('尚无可归属证据', 'No attributable evidence yet')
  }
}

function assistanceLabel(assistance: CTFLearningAssistance) {
  switch (assistance) {
    case 'none': return t('无协助', 'No assistance')
    case 'hint': return t('依赖提示', 'Used hints')
    case 'copilot': return t('搭档协作', 'Copilot collaboration')
    default: return t('代理完成', 'Delegate completed')
  }
}

function statusLabel(status: CTFDebrief['status']) {
  switch (status) {
    case 'succeeded': return t('已完成', 'Completed')
    case 'failed': return t('未完成', 'Not completed')
    case 'cancelled': return t('已中断', 'Interrupted')
    default: return t('进行中', 'In progress')
  }
}

function verdictLabel(verdict: string) {
  switch (verdict) {
    case 'pass': return 'Accepted'
    case 'fail': return 'Rejected'
    case 'needs_review': return t('待平台确认', 'Awaiting platform confirmation')
    default: return verdict || t('未判定', 'Not judged')
  }
}
</script>

<template>
  <SettingsSection :title="t('证据复盘', 'Evidence debrief')" aria-labelledby="debrief-title">
    <template #actions>
      <Badge :variant="debrief.status === 'failed' ? 'destructive' : 'outline'">
        {{ statusLabel(debrief.status) }}
      </Badge>
    </template>
    <div class="px-5 py-5">

    <MarkdownContent class="mt-5 text-body leading-6" :content="debrief.summary" />

    <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">{{ t('证据', 'Evidence') }}</p>
        <p class="mt-1 font-mono text-control">{{ debrief.evidenceCount }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">{{ t('制品', 'Artifacts') }}</p>
        <p class="mt-1 font-mono text-control">{{ debrief.artifactCount }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">{{ t('用户独立步骤', 'Independent user steps') }}</p>
        <p class="mt-1 font-mono text-control">{{ debrief.independentSteps }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">{{ t('提示', 'Hints') }}</p>
        <p class="mt-1 font-mono text-control">{{ debrief.hintCount }}</p>
      </div>
    </div>

    <div class="mt-5 rounded-lg border border-border bg-muted/20 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="flex items-center gap-2 text-control font-medium">
            <Handshake class="size-3.5" />
            {{ t('贡献归属', 'Attribution') }}
          </p>

        </div>
        <div class="flex flex-wrap gap-2">
          <Badge variant="outline">
            {{ actorLabel(humanOutcome.contribution.primaryActor) }}
          </Badge>
          <Badge variant="secondary">
            {{ assistanceLabel(humanOutcome.contribution.assistance) }}
          </Badge>
        </div>
      </div>
      <p class="mt-3 text-caption leading-5 text-muted-foreground">
        {{ t(`用户独立 ${humanOutcome.contribution.userIndependentSteps} 步 · 用户在协助下 ${humanOutcome.contribution.userAssistedSteps} 步 · Agent 记录 ${humanOutcome.contribution.agentRecords} 条 · 旧记录/导入 ${humanOutcome.contribution.importedRecords} 条`, `Independent user steps ${humanOutcome.contribution.userIndependentSteps} · assisted user steps ${humanOutcome.contribution.userAssistedSteps} · Agent records ${humanOutcome.contribution.agentRecords} · imported records ${humanOutcome.contribution.importedRecords}`) }}
      </p>
    </div>

    <div class="mt-6 grid gap-5 md:grid-cols-2">
      <div>
        <h3 class="flex items-center gap-2 text-control font-medium">
          <FileCheck2 class="size-3.5" />
          {{ t('关键观察', 'Key observations') }}
        </h3>
        <ul v-if="debrief.keyObservations.length" class="mt-3 space-y-2">
          <li
            v-for="item in debrief.keyObservations"
            :key="item"
            class="flex gap-2 text-caption leading-5 text-muted-foreground"
          >
            <Check class="mt-0.5 size-3.5 shrink-0 text-primary" />
            <MarkdownContent class="min-w-0 flex-1" :content="item" compact />
          </li>
        </ul>

      </div>

      <div>
        <h3 class="flex items-center gap-2 text-control font-medium">
          <Route class="size-3.5" />
          {{ t('失败分支', 'Failed branches') }}
        </h3>
        <ul v-if="visibleFailureBranches.length" class="mt-3 space-y-2">
          <li
            v-for="item in visibleFailureBranches"
            :key="item"
            class="flex gap-2 text-caption leading-5 text-muted-foreground"
          >
            <X class="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <MarkdownContent class="min-w-0 flex-1" :content="item" compact />
          </li>
        </ul>

      </div>
    </div>

    <div v-if="debrief.candidates.length" class="mt-6 border-t border-border pt-5">
      <h3 class="text-control font-medium">{{ t('候选历史', 'Candidate history') }}</h3>
      <div class="mt-3 space-y-2">
        <div
          v-for="(candidate, index) in debrief.candidates"
          :key="`${candidate.candidate}-${index}`"
          class="rounded-lg border border-border px-3 py-2"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <code class="break-all text-caption">{{ candidate.candidate }}</code>
            <Badge :variant="candidate.verdict === 'fail' ? 'destructive' : 'outline'">
              {{ verdictLabel(candidate.verdict) }}
            </Badge>
          </div>
          <MarkdownContent
            v-if="candidate.summary"
            class="mt-1 text-caption leading-5 text-muted-foreground"
            :content="candidate.summary"
            compact
          />
        </div>
      </div>
    </div>

    <div v-if="debrief.knowledgePoints.length" class="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
      <Badge v-for="point in debrief.knowledgePoints" :key="point" variant="secondary">
        {{ point }}
      </Badge>
    </div>

    <div class="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <p class="flex items-center gap-2 text-control font-medium">
        <Sparkles class="size-3.5 text-primary" />
        {{ t('推荐下一步', 'Recommended next step') }}
      </p>
      <MarkdownContent
        class="mt-1 text-caption leading-5 text-muted-foreground"
        :content="debrief.recommendedNextAction"
        compact
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="mt-3"
        :loading="submitting"
        :disabled="!canSaveMemory"
        @click="$emit('saveMemory')"
      >
        <BrainCircuit class="size-3.5" />
        {{ t('沉淀为可复用技法', 'Save as a reusable technique') }}
      </Button>
    </div>

    <details class="mt-6 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <summary class="cursor-pointer text-caption font-medium text-muted-foreground">
        {{ t('复盘接力棒', 'Debrief handoff') }}
      </summary>
      <pre class="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-caption leading-5">{{ handoffSummary }}</pre>
      <div class="mt-2 flex items-center justify-between gap-2">
        <span v-if="copyNotice" class="text-caption text-muted-foreground">
          {{ copyNotice }}
        </span>
        <Button type="button" variant="outline" size="sm" @click="copyHandoffSummary">
          <Copy class="size-3.5" />
          {{ t('复制复盘摘要', 'Copy debrief summary') }}
        </Button>
      </div>
    </details>

    <form class="mt-6 border-t border-border pt-5" @submit.prevent="submitIndependentStep">
      <p class="flex items-center gap-2 text-control font-medium">
        <UserRoundCheck class="size-3.5" />
        {{ t('记录我实际完成的步骤', 'Record a step I actually completed') }}
      </p>
      <Textarea
        v-model="independentStep"
        class="mt-3"
        :placeholder="t('例如：我手动比较了两组响应长度，确认第四个字节会改变校验分支……', 'Example: I compared two response lengths and confirmed the fourth byte changes the checksum branch…')"
      />
      <label class="mt-3 flex cursor-pointer items-start gap-2 text-caption leading-5 text-muted-foreground">
        <input
          v-model="independentStepConfirmed"
          type="checkbox"
          class="mt-0.5 size-4 rounded border-border accent-primary"
        >
        <span>{{ t('我确认这是我实际完成的步骤，而不是 Agent 自动生成的描述。', 'I confirm this is a step I actually completed, not a description generated by the Agent.') }}</span>
      </label>
      <Button
        type="submit"
        variant="outline"
        class="mt-3"
        :loading="submitting"
        :disabled="!independentStep.trim() || !independentStepConfirmed"
      >
        <UserRoundCheck class="size-3.5" />
        {{ t('保存用户步骤', 'Save user step') }}
      </Button>
    </form>

    <form v-if="debrief.needsReflection" class="mt-6 border-t border-border pt-5" @submit.prevent="submit">
      <p class="flex items-center gap-2 text-control font-medium">
        <Lightbulb class="size-3.5" />
        {{ t('用你自己的话完成复盘', 'Write the debrief in your own words') }}
      </p>
      <Textarea
        v-model="reflection"
        class="mt-3"
        :placeholder="t('例如：我一开始把输入当作编码题，直到 strings 的输出证明它更像逆向题……', 'Example: I first treated this as an encoding challenge until strings output showed it was closer to reverse engineering…')"
      />
      <Button
        type="submit"
        class="mt-2"
        :loading="submitting"
        :disabled="!reflection.trim()"
      >
        <Circle class="size-3.5" />
        {{ t('保存复盘', 'Save debrief') }}
      </Button>
    </form>
    </div>
  </SettingsSection>
</template>
