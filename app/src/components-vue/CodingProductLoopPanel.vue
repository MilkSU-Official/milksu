<script setup lang="ts">
import { computed, ref } from 'vue'
import { Badge, Button } from '@felinic/ui'
import { Check, CircleDot, Copy, FileDiff, FileImage, GitBranch, Globe2, Terminal } from 'lucide-vue-next'
import type {
  CodingBrowserStatus,
  CodingComputerUseStatus,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'
import { artifactKindLabel, suggestedArtifactPaths } from '@/lib/codingArtifact'
import type { CodingApprovalPolicy, CodingExecutionMode } from '@/types'

type LoopState = 'done' | 'active' | 'pending' | 'blocked'
type LoopPanel = 'changes' | 'terminal' | 'artifacts' | 'browser'
type VerificationRecord = {
  label: string
  state: string
  detail: string
  panel?: LoopPanel
  actionLabel?: string
}
type ArtifactPreviewEvidence = {
  relativePath: string
  kind: 'markdown' | 'html' | 'image'
}
type BrowserEvidence = {
  path: string
}
type ComputerUseEvidence = {
  name: string
  bundleId: string
  pid: number
  windowId: number
  windowTitle?: string
}

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  messageCount: number
  toolMessageCount: number
  running: boolean
  resumed: boolean
  compacting: boolean
  compactedAt?: number
  compactionError?: string
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  browserStatus: CodingBrowserStatus | null
  computerUseStatus: CodingComputerUseStatus | null
  artifactPreviewEvidence?: ArtifactPreviewEvidence | null
  browserEvidence?: BrowserEvidence | null
  computerUseEvidence?: ComputerUseEvidence | null
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

const artifactSuggestions = computed(() => suggestedArtifactPaths(props.environment))

const validationReady = computed(() => (
  artifactSuggestions.value.length > 0
  || Boolean(props.artifactPreviewEvidence)
  || Boolean(props.browserStatus?.enabled)
  || Boolean(props.computerUseStatus?.enabled)
))

const visibleValidationPerformed = computed(() => (
  Boolean(props.artifactPreviewEvidence)
  || Boolean(props.browserEvidence)
  || Boolean(props.computerUseEvidence)
  || Boolean(props.browserStatus?.enabled)
  || Boolean(props.computerUseStatus?.enabled)
))

const validationDetail = computed(() => {
  const channels = [
    artifactSuggestions.value.length
      ? `产物预览可检查 ${artifactSuggestions.value.length} 个：${artifactSuggestions.value.slice(0, 3).join('、')}`
      : '',
    props.artifactPreviewEvidence
      ? `已预览 ${artifactKindLabel(props.artifactPreviewEvidence.kind)}：${props.artifactPreviewEvidence.relativePath}`
      : '',
    props.browserEvidence
      ? `已打开浏览器证据：${props.browserEvidence.path}`
      : '',
    props.computerUseEvidence
      ? `已锁定可见 App：${props.computerUseEvidence.name} · PID ${props.computerUseEvidence.pid} · Window ${props.computerUseEvidence.windowId}`
      : '',
    props.browserStatus?.enabled ? 'Browser 已接入' : '',
    props.computerUseStatus?.enabled ? 'Computer Use 已接入' : '',
  ].filter(Boolean)
  return channels.length
    ? channels.join(' · ')
    : '打开产物预览、Browser 或 Computer Use，保留真实 UI/产物证据。'
})

const gitState = computed<LoopState>(() => {
  const git = props.environment?.git
  if (!git?.isRepository) return 'blocked'
  if (git.conflicts > 0) return 'blocked'
  if (git.dirty || git.ahead > 0) return 'active'
  return props.messageCount > 0 ? 'done' : 'pending'
})

const recoveryState = computed<LoopState>(() => {
  if (props.compactionError) return 'blocked'
  if (props.compacting) return 'active'
  if (props.resumed) return 'done'
  if (props.compactedAt) return 'active'
  return props.messageCount > 0 ? 'pending' : 'pending'
})

const recoveryDetail = computed(() => {
  if (props.compactionError) return `上下文压缩失败：${props.compactionError}`
  if (props.compacting) return '正在压缩上下文；完成后继续任务时应复用当前恢复点。'
  if (props.resumed) return '本会话已从恢复点继续；交付前确认没有重复已经完成的步骤。'
  if (props.compactedAt) return `已生成上下文恢复点：${new Date(props.compactedAt).toLocaleString()}；还需实际继续一次来证明不会重复已完成步骤。`
  if (props.messageCount > 0) return '尚未触发中断/失败继续；若本轮要验收自举闭环，需要保留一次恢复证据。'
  return '开始任务后，失败、超时或上下文压缩应能从当前会话继续。'
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
    detail: validationDetail.value,
  },
  {
    id: 'recovery',
    label: '失败/继续',
    state: recoveryState.value,
    detail: recoveryDetail.value,
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

const computerUseVerificationRecord = computed<VerificationRecord>(() => {
  const status = props.computerUseStatus
  if (!status) {
    return {
      label: 'Computer Use',
      state: '未检测',
      detail: '打开 Browser/App 面板检测系统权限、可见窗口和会话锁定状态。',
      panel: 'browser',
      actionLabel: '检测',
    }
  }
  if (!status.available) {
    return {
      label: 'Computer Use',
      state: '不可用',
      detail: status.problem || '当前运行环境不可用；可先用 Browser 或产物预览验收。',
      panel: 'browser',
      actionLabel: '查看',
    }
  }
  if (!status.permissions.accessibility || !status.permissions.screenRecording) {
    const missing = [
      status.permissions.accessibility ? '' : '辅助功能',
      status.permissions.screenRecording ? '' : '屏幕录制',
    ].filter(Boolean).join('、')
    return {
      label: 'Computer Use',
      state: '待授权',
      detail: `缺少 ${missing}；打开 Browser/App 面板请求系统权限并重新检测。`,
      panel: 'browser',
      actionLabel: '授权',
    }
  }
  if (!status.enabled) {
    return {
      label: 'Computer Use',
      state: '待启动',
      detail: '系统权限已具备；打开 Browser/App 面板选择当前可见窗口并启动可见会话。',
      panel: 'browser',
      actionLabel: '启动',
    }
  }
  return {
    label: 'Computer Use',
    state: '已接入',
    detail: status.target
      ? `${status.target.name} · PID ${status.target.pid} · Window ${status.target.windowId}`
      : '已接入当前任务；等待下一次可见 App 操作证据。',
  }
})

const computerUseQuickAction = computed(() => (
  computerUseVerificationRecord.value.state === '已接入'
    ? null
    : computerUseVerificationRecord.value
))

const verificationRecords = computed<VerificationRecord[]>(() => [
  {
    label: '窄自动化',
    state: props.toolMessageCount > 0 ? '已有记录' : '待运行',
    detail: props.toolMessageCount > 0
      ? `${props.toolMessageCount} 条工具记录；仍需在最终交付说明中列出实际命令。`
      : '尚未看到测试/build 工具记录。',
  },
  {
    label: '用户可见验证',
    state: validationReady.value ? '已有入口' : '待补',
    detail: validationReady.value
      ? validationDetail.value
      : '需要打开产物预览、Browser 或 Computer Use，保留用户可见证据。',
  },
  {
    label: '真实 App 验收',
    state: props.artifactPreviewEvidence || props.browserEvidence || props.computerUseEvidence
      ? '已有证据'
      : props.browserStatus?.enabled || props.computerUseStatus?.enabled
        ? '可执行'
        : '未证明',
    detail: props.artifactPreviewEvidence
      ? `已打开产物预览：${props.artifactPreviewEvidence.relativePath}；若需要真实交互，再补 Browser 或 Computer Use。`
      : props.browserEvidence
        ? `已打开浏览器证据目录：${props.browserEvidence.path}；用于核对截图、Console、Network 或页面证据。`
        : props.computerUseEvidence
          ? `已锁定可见 App Scope：${props.computerUseEvidence.name} · ${props.computerUseEvidence.bundleId} · PID ${props.computerUseEvidence.pid} · Window ${props.computerUseEvidence.windowId}；这证明会话边界，不等于已完成 GUI 操作。`
          : props.browserStatus?.enabled || props.computerUseStatus?.enabled
            ? 'Browser/Computer Use 已接入；仍需实际截图、DOM、控制台或窗口操作证据。'
            : '当前只有组件/构建证据；打包 App 或 Browser 真实验收尚未证明。',
  },
  computerUseVerificationRecord.value,
  {
    label: 'Git 交付',
    state: gitState.value === 'done' ? '可交付' : gitState.value === 'blocked' ? '阻塞' : '待收口',
    detail: items.value.find(item => item.id === 'git')?.detail ?? '尚未读取 Git 状态。',
  },
])

const nextVerificationAction = computed<{
  label: string
  detail: string
  panel?: LoopPanel
}>(() => {
  if (!props.workspacePath) {
    return {
      label: '选择项目目录',
      detail: '先把任务绑定到授权仓库，后续测试、预览和 Git 才有可靠边界。',
    }
  }
  if (!props.messageCount) {
    return {
      label: '启动 Agent 任务',
      detail: '用“直接完成”或输入框描述一个小产品任务，让闭环产生真实工具记录。',
    }
  }
  if (props.toolMessageCount === 0) {
    return {
      label: '运行测试或构建',
      detail: '还没有工具记录；优先让 Agent 执行窄测试或 build。',
      panel: 'terminal',
    }
  }
  if (!visibleValidationPerformed.value) {
    return {
      label: '补用户可见验证',
      detail: artifactSuggestions.value.length
        ? '已有可预览产物候选；打开产物预览并保留 UI/产物证据。'
        : '打开产物预览、Browser 或 Computer Use，保留 UI/产物证据。',
      panel: artifactSuggestions.value.length ? 'artifacts' : 'browser',
    }
  }
  if (recoveryState.value === 'pending') {
    return {
      label: '验收恢复/继续',
      detail: '触发一次失败、超时或上下文压缩后的继续路径，确认不重复已完成步骤。',
    }
  }
  if (gitState.value !== 'done') {
    return {
      label: '收口 Git 交付',
      detail: items.value.find(item => item.id === 'git')?.detail ?? '打开变更面板完成审阅、暂存、提交和 push。',
      panel: 'changes',
    }
  }
  return {
    label: '复制接力棒',
    detail: '当前自动化、验证、恢复和 Git 状态已可汇总；复制摘要给下一轮验收或发布说明。',
  }
})

const handoffSummary = computed(() => {
  const git = props.environment?.git
  const lines = [
    '# MilkSU Coding 接力棒',
    `- 工作区：${props.workspacePath || '尚未选择'}`,
    `- 权限：${executionModeLabel(props.executionMode)} / ${approvalPolicyLabel(props.approvalPolicy)}`,
    `- Agent：${props.running ? '执行中' : props.messageCount ? `已有 ${props.messageCount} 条消息、${props.toolMessageCount} 条工具记录` : '尚未启动'}`,
    `- 可见验证：${validationReady.value
      ? validationDetail.value.replaceAll(' · ', '；')
      : '待补：产物预览、Browser 或 Computer Use'}`,
    `- 恢复/继续：${stateLabel(recoveryState.value)}；${recoveryDetail.value}`,
    `- Git：${git?.isRepository
      ? git.conflicts > 0
        ? `${git.conflicts} 个冲突待解决`
        : git.dirty
          ? `${git.changedFiles} 个文件待审阅/暂存/提交`
          : git.ahead > 0
            ? `本地领先 ${git.ahead} 个提交，待 push`
            : '工作区干净且无待 push 提交'
      : git?.problem || '不是 Git 仓库或尚未读取 Git 状态'}`,
    '- 验收记录：',
    ...verificationRecords.value.map(record => `  - ${record.label}：${record.state}；${record.detail}`),
    `- 下一步：${nextVerificationAction.value.label}；${nextVerificationAction.value.detail}`,
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

    <div class="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-caption font-medium text-muted-foreground">下一步验收动作</p>
          <p class="mt-1 text-body font-medium">{{ nextVerificationAction.label }}</p>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            {{ nextVerificationAction.detail }}
          </p>
        </div>
        <Button
          v-if="nextVerificationAction.panel"
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          @click="emit('openPanel', nextVerificationAction.panel)"
        >
          打开
        </Button>
      </div>
    </div>

    <div
      v-if="computerUseQuickAction"
      class="mt-3 rounded-lg border border-border bg-background px-3 py-3"
      aria-label="Computer Use 快速接入"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-caption font-medium text-muted-foreground">Computer Use 快速接入</p>
            <Badge variant="outline">{{ computerUseQuickAction.state }}</Badge>
          </div>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            {{ computerUseQuickAction.detail }}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0"
          @click="emit('openPanel', 'browser')"
        >
          {{ computerUseQuickAction.actionLabel || '打开' }}
        </Button>
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
        Browser / Computer Use
      </Button>
      <Button variant="outline" size="sm" class="justify-start" @click="emit('openPanel', 'changes')">
        <FileDiff v-if="environment?.git.dirty" class="size-3.5" />
        <GitBranch v-else class="size-3.5" />
        Git 交付
      </Button>
    </div>

    <details class="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <summary class="cursor-pointer text-caption font-medium text-muted-foreground">
        验收记录
      </summary>
      <div class="mt-2 space-y-2">
        <div
          v-for="record in verificationRecords"
          :key="record.label"
          class="rounded-md bg-background px-3 py-2"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium">{{ record.label }}</p>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                v-if="record.panel"
                type="button"
                variant="ghost"
                size="sm"
                @click="emit('openPanel', record.panel)"
              >
                {{ record.actionLabel || '打开' }}
              </Button>
              <Badge variant="outline">{{ record.state }}</Badge>
            </div>
          </div>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ record.detail }}</p>
        </div>
      </div>
    </details>

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
