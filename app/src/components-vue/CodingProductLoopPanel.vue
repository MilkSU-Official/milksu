<script setup lang="ts">
import { computed, ref } from 'vue'
import { Badge, Button } from '@felinic/ui'
import { Check, CircleDot, Copy, FileDiff, FileImage, GitBranch, Globe2, Terminal } from 'lucide-vue-next'
import type {
  CodingBrowserStatus,
  CodingComputerUseStatus,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'
import type { CodingApprovalPolicy, CodingExecutionMode } from '@/types'

type LoopState = 'done' | 'active' | 'pending' | 'blocked'
type LoopPanel = 'changes' | 'terminal' | 'artifacts' | 'browser'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  messageCount: number
  toolMessageCount: number
  running: boolean
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  browserStatus: CodingBrowserStatus | null
  computerUseStatus: CodingComputerUseStatus | null
}>()

const emit = defineEmits<{
  openPanel: [panel: LoopPanel]
}>()

const copyNotice = ref('')

const canAct = computed(() => (
  props.executionMode === 'go'
  && props.approvalPolicy !== 'read-only'
))

function executionModeLabel(mode: CodingExecutionMode) {
  return mode === 'plan' ? 'Plan' : 'Go'
}

function approvalPolicyLabel(policy: CodingApprovalPolicy) {
  if (policy === 'full-auto') return '完全访问'
  if (policy === 'workspace-auto') return '替我审批'
  if (policy === 'ask') return '逐次审批'
  return '只读'
}

const validationReady = computed(() => (
  Boolean(props.browserStatus?.enabled)
  || Boolean(props.computerUseStatus?.enabled)
))

const gitState = computed<LoopState>(() => {
  const git = props.environment?.git
  if (!git?.isRepository) return 'blocked'
  if (git.conflicts > 0) return 'blocked'
  if (git.dirty || git.ahead > 0) return 'active'
  return props.messageCount > 0 ? 'done' : 'pending'
})

const items = computed(() => [
  {
    id: 'workspace',
    label: '选择任务与仓库',
    state: props.workspacePath ? 'done' as const : 'pending' as const,
    detail: props.workspacePath
      ? props.workspacePath
      : '先选择项目目录，再让 Agent 接手具体产品任务。',
  },
  {
    id: 'agent',
    label: 'Agent 执行',
    state: props.running ? 'active' as const : props.messageCount > 0 ? 'done' as const : 'pending' as const,
    detail: props.running
      ? 'Agent 正在执行；完成后继续查看验证与 Git。'
      : props.messageCount > 0
        ? `已有 ${props.messageCount} 条消息、${props.toolMessageCount} 条工具记录。`
        : canAct.value
          ? '可用“直接完成”或输入任务启动。'
          : '当前权限不适合自动修改；切到 Go + 替我审批/完全访问后再跑闭环。',
  },
  {
    id: 'validation',
    label: '用户可见验证',
    state: validationReady.value ? 'active' as const : props.toolMessageCount > 0 ? 'pending' as const : 'pending' as const,
    detail: validationReady.value
      ? [
          props.browserStatus?.enabled ? 'Browser 已接入' : '',
          props.computerUseStatus?.enabled ? 'Computer Use 已接入' : '',
        ].filter(Boolean).join(' · ')
      : '打开产物预览、Browser 或 Computer Use，保留真实 UI/产物证据。',
  },
  {
    id: 'git',
    label: 'Diff 与 Git 交付',
    state: gitState.value,
    detail: props.environment?.git.isRepository
      ? props.environment.git.conflicts > 0
        ? `${props.environment.git.conflicts} 个冲突需要先解决，不能进入交付。`
        : props.environment.git.dirty
        ? `${props.environment.git.changedFiles} 个文件待审阅/暂存/提交。`
        : props.environment.git.ahead > 0
          ? `本地领先 ${props.environment.git.ahead} 个提交，仍需 push 才能作为交付证据。`
        : props.messageCount > 0
          ? '当前 Git 工作区干净且没有待 push 提交，可作为本轮交付证据。'
          : 'Git 可用，等待实际任务产生变更。'
      : props.environment?.git.problem || '当前目录不是 Git 仓库。',
  },
  {
    id: 'handoff',
    label: '接力棒',
    state: props.messageCount > 0 ? 'done' as const : 'pending' as const,
    detail: props.messageCount > 0
      ? '下一位 Agent 可从当前会话、右侧验证面板和 Git 状态继续。'
      : '开始任务后，记录测试命令、产物位置、真实验收和剩余缺口。',
  },
])

const completedCount = computed(() => (
  items.value.filter(item => item.state === 'done').length
))

const handoffSummary = computed(() => {
  const git = props.environment?.git
  const lines = [
    '# MilkSU Coding 接力棒',
    `- 工作区：${props.workspacePath || '尚未选择'}`,
    `- 权限：${executionModeLabel(props.executionMode)} / ${approvalPolicyLabel(props.approvalPolicy)}`,
    `- Agent：${props.running ? '执行中' : props.messageCount ? `已有 ${props.messageCount} 条消息、${props.toolMessageCount} 条工具记录` : '尚未启动'}`,
    `- 可见验证：${validationReady.value
      ? [
          props.browserStatus?.enabled ? 'Browser 已接入' : '',
          props.computerUseStatus?.enabled ? 'Computer Use 已接入' : '',
        ].filter(Boolean).join('；')
      : '待补：产物预览、Browser 或 Computer Use'}`,
    `- Git：${git?.isRepository
      ? git.conflicts > 0
        ? `${git.conflicts} 个冲突待解决`
        : git.dirty
          ? `${git.changedFiles} 个文件待审阅/暂存/提交`
          : git.ahead > 0
            ? `本地领先 ${git.ahead} 个提交，待 push`
            : '工作区干净且无待 push 提交'
      : git?.problem || '不是 Git 仓库或尚未读取 Git 状态'}`,
    '- 下一步：补齐待补项后，再用 Diff/Hunk、测试/预览证据和 push 结果收口。',
  ]
  return lines.join('\n')
})

async function copyHandoffSummary() {
  copyNotice.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(handoffSummary.value)
    copyNotice.value = '已复制'
  } catch {
    copyNotice.value = '复制失败，请手动选择摘要'
  }
}

function stateLabel(state: LoopState) {
  if (state === 'done') return '已具备'
  if (state === 'active') return '进行中'
  if (state === 'blocked') return '阻塞'
  return '待补'
}

function stateBadgeVariant(state: LoopState) {
  if (state === 'done') return 'success'
  if (state === 'active') return 'secondary'
  if (state === 'blocked') return 'destructive'
  return 'outline'
}
</script>

<template>
  <section class="border-b border-border px-4 py-4" aria-label="Coding 产品闭环">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-caption font-medium text-muted-foreground">本轮产品闭环</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          只展示当前证据，不把 smoke 外推成完成声明。
        </p>
      </div>
      <Badge variant="outline" class="shrink-0">
        {{ completedCount }}/{{ items.length }}
      </Badge>
    </div>

    <div class="mt-3 space-y-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="rounded-lg border border-border bg-background px-3 py-2"
        :data-product-loop-state="item.state"
      >
        <div class="flex items-center gap-2">
          <Check
            v-if="item.state === 'done'"
            class="size-3.5 shrink-0 text-primary"
          />
          <CircleDot
            v-else
            class="size-3.5 shrink-0"
            :class="item.state === 'active'
              ? 'text-primary'
              : item.state === 'blocked'
                ? 'text-destructive'
                : 'text-muted-foreground'"
          />
          <p class="min-w-0 flex-1 truncate text-body font-medium">{{ item.label }}</p>
          <Badge :variant="stateBadgeVariant(item.state)" class="shrink-0">
            {{ stateLabel(item.state) }}
          </Badge>
        </div>
        <p class="mt-1 line-clamp-2 text-caption leading-5 text-muted-foreground">
          {{ item.detail }}
        </p>
      </div>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" class="justify-start" @click="emit('openPanel', 'terminal')">
        <Terminal class="size-3.5" />
        终端/测试
      </Button>
      <Button variant="outline" size="sm" class="justify-start" @click="emit('openPanel', 'artifacts')">
        <FileImage class="size-3.5" />
        产物预览
      </Button>
      <Button variant="outline" size="sm" class="justify-start" @click="emit('openPanel', 'browser')">
        <Globe2 class="size-3.5" />
        Browser/App
      </Button>
      <Button variant="outline" size="sm" class="justify-start" @click="emit('openPanel', 'changes')">
        <FileDiff v-if="environment?.git.dirty" class="size-3.5" />
        <GitBranch v-else class="size-3.5" />
        Git 交付
      </Button>
    </div>

    <details class="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <summary class="cursor-pointer text-caption font-medium text-muted-foreground">
        接力棒摘要
      </summary>
      <pre class="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-caption leading-5">{{ handoffSummary }}</pre>
      <div class="mt-2 flex items-center justify-between gap-2">
        <span class="text-caption text-muted-foreground">
          {{ copyNotice || '复制后可直接交给下一位 Agent 或写入验收记录。' }}
        </span>
        <Button type="button" variant="outline" size="sm" @click="copyHandoffSummary">
          <Copy class="size-3.5" />
          复制接力棒
        </Button>
      </div>
    </details>
  </section>
</template>
