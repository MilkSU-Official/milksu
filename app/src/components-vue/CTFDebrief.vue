<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Badge, Button, Textarea } from '@felinic/ui'
import {
  BookOpenCheck,
  BrainCircuit,
  Check,
  Circle,
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
const canSaveMemory = computed(
  () => props.debrief.status !== 'in_progress' && props.debrief.reflectionCount > 0,
)
const memoryHint = computed(() => {
  if (props.debrief.status === 'in_progress') {
    return '题目结束后，再把 Judge 结果和解题复盘沉淀为记忆。'
  }
  if (props.debrief.reflectionCount === 0) {
    return '先用你自己的话完成复盘，再保存为本机解题记忆。'
  }
  return '保存后，同分类题会把这条经验作为待验证先验交给 Agent。'
})

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
    case 'user': return '用户'
    case 'agent': return 'Agent'
    case 'shared': return '用户与 Agent 共同完成'
    default: return '尚无可归属证据'
  }
}

function assistanceLabel(assistance: CTFLearningAssistance) {
  switch (assistance) {
    case 'none': return '无协助'
    case 'hint': return '依赖提示'
    case 'copilot': return '搭档协作'
    default: return '代理完成'
  }
}

function statusLabel(status: CTFDebrief['status']) {
  switch (status) {
    case 'succeeded': return '已完成'
    case 'failed': return '未完成'
    case 'cancelled': return '已中断'
    default: return '进行中'
  }
}

function verdictLabel(verdict: string) {
  switch (verdict) {
    case 'pass': return 'Accepted'
    case 'fail': return 'Rejected'
    case 'needs_review': return '待平台确认'
    default: return verdict || '未判定'
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-6" aria-labelledby="debrief-title">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="debrief-title" class="flex items-center gap-2 text-label font-medium">
          <BookOpenCheck class="size-4" />
          证据复盘
        </h2>
        <p class="mt-1 max-w-xl text-caption leading-5 text-muted-foreground">
          只从 Runtime 的观察、失败、Judge 和学习记录生成，不让 Agent 自己给自己打分。
        </p>
      </div>
      <Badge :variant="debrief.status === 'failed' ? 'destructive' : 'outline'">
        {{ statusLabel(debrief.status) }}
      </Badge>
    </div>

    <MarkdownContent class="mt-5 text-body leading-6" :content="debrief.summary" />

    <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">证据</p>
        <p class="mt-1 font-mono text-control">{{ debrief.evidenceCount }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">制品</p>
        <p class="mt-1 font-mono text-control">{{ debrief.artifactCount }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">用户独立步骤</p>
        <p class="mt-1 font-mono text-control">{{ debrief.independentSteps }}</p>
      </div>
      <div class="rounded-lg bg-muted/50 px-3 py-2">
        <p class="text-caption text-muted-foreground">提示</p>
        <p class="mt-1 font-mono text-control">{{ debrief.hintCount }}</p>
      </div>
    </div>

    <div class="mt-5 rounded-lg border border-border bg-muted/20 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="flex items-center gap-2 text-control font-medium">
            <Handshake class="size-3.5" />
            贡献归属
          </p>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            Judge 只证明答案是否正确；这里单独记录谁完成了关键步骤。
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
        用户独立 {{ humanOutcome.contribution.userIndependentSteps }} 步 ·
        用户在协助下 {{ humanOutcome.contribution.userAssistedSteps }} 步 ·
        Agent 记录 {{ humanOutcome.contribution.agentRecords }} 条 ·
        旧记录/导入 {{ humanOutcome.contribution.importedRecords }} 条
      </p>
    </div>

    <div class="mt-6 grid gap-5 md:grid-cols-2">
      <div>
        <h3 class="flex items-center gap-2 text-control font-medium">
          <FileCheck2 class="size-3.5" />
          关键观察
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
        <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
          还没有完整观察；下一次实验应明确记录“看到了什么”。
        </p>
      </div>

      <div>
        <h3 class="flex items-center gap-2 text-control font-medium">
          <Route class="size-3.5" />
          失败分支
        </h3>
        <ul v-if="debrief.failureBranches.length" class="mt-3 space-y-2">
          <li
            v-for="item in debrief.failureBranches"
            :key="item"
            class="flex gap-2 text-caption leading-5 text-muted-foreground"
          >
            <X class="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <MarkdownContent class="min-w-0 flex-1" :content="item" compact />
          </li>
        </ul>
        <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
          暂无已确认的失败分支。
        </p>
      </div>
    </div>

    <div v-if="debrief.candidates.length" class="mt-6 border-t border-border pt-5">
      <h3 class="text-control font-medium">候选历史</h3>
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
        推荐下一步
      </p>
      <MarkdownContent
        class="mt-1 text-caption leading-5 text-muted-foreground"
        :content="debrief.recommendedNextAction"
        compact
      />
      <p class="mt-2 text-caption leading-5 text-muted-foreground">
        {{ memoryHint }}
      </p>
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
        沉淀为可复用技法
      </Button>
    </div>

    <form class="mt-6 border-t border-border pt-5" @submit.prevent="submitIndependentStep">
      <p class="flex items-center gap-2 text-control font-medium">
        <UserRoundCheck class="size-3.5" />
        记录我实际完成的步骤
      </p>
      <p class="mt-1 text-caption leading-5 text-muted-foreground">
        只写你亲自执行或推导的具体步骤。Agent 的总结、猜测或代做结果不能登记为你的独立能力。
      </p>
      <Textarea
        v-model="independentStep"
        class="mt-3"
        placeholder="例如：我手动比较了两组响应长度，确认第四个字节会改变校验分支……"
      />
      <label class="mt-3 flex cursor-pointer items-start gap-2 text-caption leading-5 text-muted-foreground">
        <input
          v-model="independentStepConfirmed"
          type="checkbox"
          class="mt-0.5 size-4 rounded border-border accent-primary"
        >
        <span>我确认这是我实际完成的步骤，而不是 Agent 自动生成的描述。</span>
      </label>
      <Button
        type="submit"
        variant="outline"
        class="mt-3"
        :loading="submitting"
        :disabled="!independentStep.trim() || !independentStepConfirmed"
      >
        <UserRoundCheck class="size-3.5" />
        保存用户步骤
      </Button>
    </form>

    <form v-if="debrief.needsReflection" class="mt-6 border-t border-border pt-5" @submit.prevent="submit">
      <p class="flex items-center gap-2 text-control font-medium">
        <Lightbulb class="size-3.5" />
        用你自己的话完成复盘
      </p>
      <p class="mt-1 text-caption leading-5 text-muted-foreground">
        写下关键转折、失败原因和下次会先做什么；保存后可沉淀为本机解题记忆。
      </p>
      <Textarea
        v-model="reflection"
        class="mt-3"
        placeholder="例如：我一开始把输入当作编码题，直到 strings 的输出证明它更像逆向题……"
      />
      <Button
        type="submit"
        class="mt-2"
        :loading="submitting"
        :disabled="!reflection.trim()"
      >
        <Circle class="size-3.5" />
        保存复盘
      </Button>
    </form>
  </section>
</template>
