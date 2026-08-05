<script setup lang="ts">
import { computed } from 'vue'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  Compass,
  KeyRound,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next'
import type {
  CodingComputerUseStatus,
  CodingComputerUseTarget,
} from '@/codingEnvironmentTypes'
import type { ComputerUseOperationEvidence } from '@/lib/codingComputerUseEvidence'
import type { CodingApprovalPolicy, CodingExecutionMode } from '@/types'
import {
  computerUseTargetKey,
  selectedComputerUseTarget as resolveSelectedComputerUseTarget,
} from '@/lib/codingPolicy'

const props = defineProps<{
  status: CodingComputerUseStatus | null
  targets: CodingComputerUseTarget[]
  selectedTargetKey: string
  loading: boolean
  running: boolean
  ownedByCurrentTask: boolean
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  operationEvidence?: ComputerUseOperationEvidence | null
}>()

const emit = defineEmits<{
  'update:selectedTargetKey': [value: string]
  requestPermissions: []
  refresh: []
  start: []
  stop: []
}>()

const selectedKey = computed({
  get: () => props.selectedTargetKey,
  set: value => emit('update:selectedTargetKey', value),
})
const selectedTarget = computed(() => (
  resolveSelectedComputerUseTarget(props.targets, props.selectedTargetKey)
))
const sessionTarget = computed(() => (
  props.status?.conversationId ? props.status.target : null
))
const effectiveTarget = computed(() => sessionTarget.value ?? selectedTarget.value)
const matchingOperationEvidence = computed(() => {
  const target = effectiveTarget.value
  const evidence = props.operationEvidence
  if (!target || !evidence) return null
  return evidence.bundleId === target.bundleId
    && evidence.pid === target.pid
    && evidence.windowId === target.windowId
    ? evidence
    : null
})
const operationScopeMismatch = computed(() => Boolean(
  props.operationEvidence
  && effectiveTarget.value
  && !matchingOperationEvidence.value,
))
const permissionsReady = computed(() => Boolean(
  props.status?.permissions.accessibility
  && props.status.permissions.screenRecording,
))
const signingStatus = computed(() => props.status?.signing ?? null)
const signingIdentityLabel = computed(() => {
  const signing = signingStatus.value
  if (!signing) return '当前构建身份：未检测'
  const signature = signing.signature === 'adhoc'
    ? 'ad-hoc'
    : signing.signature === 'signed'
      ? '已签名'
      : signing.signature || '未知签名'
  const team = signing.teamIdentifier && signing.teamIdentifier !== 'not set'
    ? signing.teamIdentifier
    : '未设置'
  return `当前构建身份：${signature} · Team ${team}`
})
const signingDiagnostic = computed(() => {
  const signing = signingStatus.value
  if (!signing) return ''
  if (signing.stableIdentity) {
    return `${signingIdentityLabel.value}，权限应绑定到稳定 App 身份。`
  }
  return `${signingIdentityLabel.value}；${signing.problem || 'macOS 可能无法稳定复用辅助功能/屏幕录制授权。'}`
})
const signingUnstable = computed(() => Boolean(
  signingStatus.value && !signingStatus.value.stableIdentity,
))
const permissionProbeMayBeStale = computed(() => Boolean(
  signingUnstable.value && !permissionsReady.value,
))
const permissionReapprovalBlocked = computed(() => Boolean(
  permissionProbeMayBeStale.value && props.status?.available,
))
const accessibilityPermissionLabel = computed(() => {
  if (props.status?.permissions.accessibility) return '已授权'
  return permissionReapprovalBlocked.value ? '待稳定签名复检' : '未授权'
})
const screenRecordingPermissionLabel = computed(() => {
  if (props.status?.permissions.screenRecording) return '已授权'
  return permissionReapprovalBlocked.value ? '待稳定签名复检' : '未授权'
})
const readyForCurrentTask = computed(() => Boolean(
  props.status?.enabled
  && props.ownedByCurrentTask,
))
const attachedToOtherTask = computed(() => Boolean(
  props.status?.conversationId
  && !props.ownedByCurrentTask,
))
const canStart = computed(() => Boolean(
  !props.loading
  && !props.running
  && props.status?.available
  && permissionsReady.value
  && selectedTarget.value
  && !props.status?.conversationId,
))
const missingPermissions = computed(() => {
  const missing: string[] = []
  if (!props.status?.permissions.accessibility) missing.push('辅助功能')
  if (!props.status?.permissions.screenRecording) missing.push('屏幕录制')
  return missing
})
const connectionLabel = computed(() => {
  if (readyForCurrentTask.value) return '已接入当前任务'
  if (attachedToOtherTask.value) return '其他任务正在使用'
  if (!props.status?.available) return '不可用'
  if (!permissionsReady.value) return '缺系统权限'
  if (!effectiveTarget.value) return '待选择窗口'
  return '可启动'
})
const connectionVariant = computed(() => {
  if (readyForCurrentTask.value) return 'secondary'
  if (attachedToOtherTask.value) return 'outline'
  if (!props.status?.available) return 'outline'
  if (!permissionsReady.value) return 'outline'
  if (!effectiveTarget.value) return 'outline'
  return 'info'
})

function executionModeLabel(mode: CodingExecutionMode) {
  return mode === 'plan' ? 'Plan' : 'Go'
}

function approvalPolicyLabel(policy: CodingApprovalPolicy) {
  if (policy === 'full-auto') return '完全访问'
  if (policy === 'workspace-auto') return '替我审批'
  if (policy === 'ask') return '逐次审批'
  return '只读'
}

const approvalLabel = computed(() => (
  `${executionModeLabel(props.executionMode)} / ${approvalPolicyLabel(props.approvalPolicy)}`
))

const approvalGuidance = computed(() => {
  if (props.executionMode !== 'go' || props.approvalPolicy === 'read-only') {
    return '当前模式不会操作可见 App；切到 Go + 替我审批/完全访问后才会自动完成普通可见操作。'
  }
  if (props.approvalPolicy === 'ask') {
    return '逐次审批会在观察、点击或输入前暂停确认，适合第一次验证高风险 GUI。'
  }
  return '普通观察、点击和输入会自动执行；危险、越界或未锁定 Scope 的操作仍会停下。'
})

const readinessItems = computed(() => [
  {
    label: '系统权限',
    ready: permissionsReady.value,
    detail: permissionsReady.value
      ? `辅助功能与屏幕录制已授权；${signingIdentityLabel.value}`
      : `缺少 ${missingPermissions.value.join('、') || '系统权限'}；${signingIdentityLabel.value}`,
  },
  {
    label: '窗口 Scope',
    ready: Boolean(effectiveTarget.value),
    detail: effectiveTarget.value
      ? `${effectiveTarget.value.name} · PID ${effectiveTarget.value.pid} · Window ${effectiveTarget.value.windowId}`
      : '请选择当前可见 App / 窗口',
  },
  {
    label: '会话锁定',
    ready: readyForCurrentTask.value,
    detail: readyForCurrentTask.value
      ? '已锁定到当前 Coding 任务'
      : attachedToOtherTask.value
        ? '其他任务正在使用'
        : '点击“启动可见会话”后才算接入',
  },
  {
    label: '审批体感',
    ready: props.executionMode === 'go' && props.approvalPolicy !== 'read-only',
    detail: `${approvalLabel.value} · ${approvalGuidance.value}`,
  },
  {
    label: '真实操作',
    ready: Boolean(matchingOperationEvidence.value),
    detail: matchingOperationEvidence.value
      ? `${matchingOperationEvidence.value.action} · ${matchingOperationEvidence.value.targetName} · PID ${matchingOperationEvidence.value.pid} · Window ${matchingOperationEvidence.value.windowId}`
      : operationScopeMismatch.value
        ? '最近一次 Computer Use 操作来自另一个窗口，不计入当前 Scope 验收。'
        : '已锁定后仍需一次 click / type / key / scroll 工具结果作为真实操作证据；observe 只证明看见窗口。',
  },
])

const guidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || 'Computer Use 当前不可用。'
  }
  if (missingPermissions.value.length) {
    const signingHint = signingDiagnostic.value || '开发期 ad-hoc 重签后，macOS 可能显示 MilkSU 已勾选但探针仍返回未授权；请使用稳定 Apple 签名后重新检测。'
    if (permissionProbeMayBeStale.value) {
      return `${missingPermissions.value.join('、')} 缺少或尚未对当前构建生效；“App 管理”不能替代这两项。${signingHint} 如果系统设置里已经勾选 MilkSU，不要反复授权；请先退出并重新打开当前 App，或换用 Developer ID 签名版后再重新检测。首次授权也建议先换稳定签名版，再打开系统权限设置。`
    }
    return `${missingPermissions.value.join('、')} 缺少或尚未对当前构建生效；“App 管理”不能替代这两项。${signingHint}`
  }
  if (attachedToOtherTask.value) {
    return '可见会话正由另一个 Coding 任务使用；请回到该任务停止后再切换。'
  }
  if (!props.targets.length && !props.status?.target) {
    return '没有发现可选的可见窗口；请打开目标 App 窗口，然后重新检测。'
  }
  if (!effectiveTarget.value) {
    return '请选择一个当前可见窗口，MilkSU 会把 Computer Use 锁定到这个 App / PID / Window。'
  }
  if (readyForCurrentTask.value) {
    return `Computer Use 已锁定到当前任务；${approvalGuidance.value}`
  }
  return '权限和窗口都已就绪，点击“启动可见会话”后才算正式接入当前 Coding 任务。'
})

const primarySetupAction = computed<{
  label: string
  detail: string
  action: 'refresh' | 'permissions' | 'start' | 'stop' | 'none'
  variant: 'default' | 'outline' | 'brand'
  disabled: boolean
}>(() => {
  if (readyForCurrentTask.value) {
    return {
      label: '已接入当前任务',
      detail: effectiveTarget.value
        ? matchingOperationEvidence.value
          ? `最近真实操作：${matchingOperationEvidence.value.summary}`
          : `已锁定 ${effectiveTarget.value.name} · PID ${effectiveTarget.value.pid} · Window ${effectiveTarget.value.windowId}；下一步需要 Agent 对该窗口执行一次可见操作并保留工具结果。`
        : '已锁定当前 Coding 任务。',
      action: 'stop',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (!props.status?.available) {
    return {
      label: '重新检测 Computer Use',
      detail: props.status?.problem || '当前运行时未报告可用；重新检测不会操作任何 App。',
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (!permissionsReady.value) {
    if (permissionProbeMayBeStale.value) {
      return {
        label: '重新检测当前构建',
        detail: `${missingPermissions.value.join('、') || '系统权限'} 未对当前构建生效；${signingDiagnostic.value || '当前构建身份不稳定。'} 如果系统设置已勾选，不要重复打开授权，请先重启当前 App 或使用 Developer ID 签名版后再检测。首次授权也建议先换稳定签名版，再打开系统权限设置。`,
        action: 'refresh',
        variant: 'outline',
        disabled: props.loading || props.running,
      }
    }
    return {
      label: '打开系统权限设置',
      detail: `${missingPermissions.value.join('、') || '系统权限'} 缺少或未对当前构建生效；${signingDiagnostic.value || '打开设置页核对后回到这里重新检测。'}`,
      action: 'permissions',
      variant: 'default',
      disabled: props.loading || props.running,
    }
  }
  if (attachedToOtherTask.value) {
    return {
      label: '等待其他任务释放',
      detail: '当前可见会话已经被另一个 Coding 任务占用。',
      action: 'none',
      variant: 'outline',
      disabled: true,
    }
  }
  if (!effectiveTarget.value) {
    return {
      label: '重新检测可见窗口',
      detail: '打开目标 App 窗口后重新检测，再选择要锁定的 App / PID / Window。',
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  return {
    label: '启动可见会话',
    detail: `${effectiveTarget.value.name} 将被锁定为当前任务 Scope；${approvalGuidance.value}`,
    action: 'start',
    variant: 'brand',
    disabled: !canStart.value,
  }
})

function runPrimarySetupAction() {
  if (primarySetupAction.value.disabled) return
  if (primarySetupAction.value.action === 'refresh') emit('refresh')
  if (primarySetupAction.value.action === 'permissions') emit('requestPermissions')
  if (primarySetupAction.value.action === 'start') emit('start')
  if (primarySetupAction.value.action === 'stop') emit('stop')
}
</script>

<template>
  <div class="mt-5 border-t border-border pt-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-body font-medium">可见 App 会话</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          选择一个当前可见窗口，启动后锁定为本任务的 App Scope。
        </p>
      </div>
      <span
        class="mt-1 size-2 shrink-0 rounded-full"
        :class="readyForCurrentTask ? 'bg-primary' : 'bg-muted-foreground'"
      />
    </div>
    <div class="mt-4 rounded-md bg-muted/45 px-3 py-3 text-caption">
      <div class="mb-3 flex items-center justify-between gap-3">
        <span class="text-muted-foreground">接入状态</span>
        <Badge :variant="connectionVariant">
          {{ connectionLabel }}
        </Badge>
      </div>
      <div
        v-if="!ownedByCurrentTask"
        class="mb-3"
      >
        <Select
          v-model="selectedKey"
          :disabled="loading || running || Boolean(status?.conversationId)"
        >
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择可见 App 窗口" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="target in targets"
              :key="computerUseTargetKey(target)"
              :value="computerUseTargetKey(target)"
            >
              {{ target.name }}
              <span v-if="target.windowTitle"> · {{ target.windowTitle }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">
          {{ status?.conversationId ? '锁定范围' : '目标窗口' }}
        </span>
        <span class="font-medium text-foreground">
          {{ effectiveTarget?.name || '未选择' }}
        </span>
      </div>
      <p class="mt-1 break-all font-mono text-muted-foreground">
        {{ effectiveTarget?.bundleId || '—' }}
        · PID {{ effectiveTarget?.pid || '—' }}
        · Window {{ effectiveTarget?.windowId || '—' }}
      </p>
      <p
        v-if="effectiveTarget?.windowTitle"
        class="mt-1 truncate text-muted-foreground"
      >
        {{ effectiveTarget.windowTitle }}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full disabled:cursor-default"
          :disabled="Boolean(status?.permissions.accessibility) || permissionReapprovalBlocked || loading || running || !status?.available"
          aria-label="请求辅助功能权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
            :class="!status?.permissions.accessibility && status?.available && !permissionReapprovalBlocked ? 'cursor-pointer' : ''"
          >
            辅助功能
            {{ accessibilityPermissionLabel }}
          </Badge>
        </button>
        <button
          type="button"
          class="rounded-full disabled:cursor-default"
          :disabled="Boolean(status?.permissions.screenRecording) || permissionReapprovalBlocked || loading || running || !status?.available"
          aria-label="请求屏幕录制权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
            :class="!status?.permissions.screenRecording && status?.available && !permissionReapprovalBlocked ? 'cursor-pointer' : ''"
          >
            屏幕录制
            {{ screenRecordingPermissionLabel }}
          </Badge>
        </button>
      </div>
      <p
        v-if="signingDiagnostic"
        class="mt-3 break-all text-caption leading-5 text-muted-foreground"
      >
        {{ signingDiagnostic }}
      </p>
      <div class="mt-4 rounded-lg border border-border bg-background/70 px-3 py-3" aria-label="Computer Use 接入清单">
        <div class="flex items-center justify-between gap-3">
          <p class="text-caption font-medium text-muted-foreground">正式接入/验收需要</p>
          <Badge :variant="readyForCurrentTask ? 'secondary' : 'outline'">
            {{ readinessItems.filter(item => item.ready).length }}/{{ readinessItems.length }}
          </Badge>
        </div>
        <div class="mt-3 space-y-2">
          <div
            v-for="item in readinessItems"
            :key="item.label"
            class="grid grid-cols-[6rem_1fr] gap-3 rounded-md bg-muted/25 px-2.5 py-2"
            :data-computer-use-ready="item.ready ? 'true' : 'false'"
          >
            <span class="text-caption font-medium" :class="item.ready ? 'text-foreground' : 'text-muted-foreground'">
              {{ item.label }}
            </span>
            <span class="min-w-0 text-caption leading-5 text-muted-foreground">
              {{ item.detail }}
            </span>
          </div>
        </div>
      </div>
      <div class="mt-3 rounded-lg border border-border bg-background/70 px-3 py-3" aria-label="Computer Use 真实操作证据">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-caption font-medium text-muted-foreground">真实操作证据</p>
            <p v-if="matchingOperationEvidence" class="mt-1 text-body font-medium">
              {{ matchingOperationEvidence.summary }}
            </p>
            <p v-else class="mt-1 text-body font-medium">
              {{ operationScopeMismatch ? 'Scope 不匹配' : '等待真实操作' }}
            </p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              <template v-if="matchingOperationEvidence">
                来自已完成的 computer_use 工具结果；只有 action、bundle、PID 和 Window 与当前 Scope 全部一致才计入。
              </template>
              <template v-else-if="operationScopeMismatch">
                最近一次操作属于 {{ operationEvidence?.targetName }} · {{ operationEvidence?.bundleId }} · PID {{ operationEvidence?.pid }} · Window {{ operationEvidence?.windowId }}，不会冒充当前窗口验收。
              </template>
              <template v-else>
                仅锁定 Scope 还不算真实 GUI 验收；需要 Agent 使用 computer_use 对此窗口完成 click、type、key 或 scroll。observe 只算可见观察，不算操作完成。
              </template>
            </p>
          </div>
          <Badge :variant="matchingOperationEvidence ? 'secondary' : 'outline'" class="shrink-0">
            {{ matchingOperationEvidence ? '已操作' : operationScopeMismatch ? '不计入' : '待操作' }}
          </Badge>
        </div>
      </div>
      <div class="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" aria-label="Computer Use 下一步">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-caption font-medium text-muted-foreground">下一步</p>
            <p class="mt-1 text-body font-medium">{{ primarySetupAction.label }}</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              {{ primarySetupAction.detail }}
            </p>
          </div>
          <Button
            :variant="primarySetupAction.variant"
            size="sm"
            class="shrink-0"
            :disabled="primarySetupAction.disabled"
            aria-label="执行 Computer Use 下一步"
            @click="runPrimarySetupAction"
          >
            {{ primarySetupAction.label }}
          </Button>
        </div>
      </div>
    </div>
    <p
      v-if="status?.problem"
      class="mt-3 text-caption leading-5 text-destructive"
    >
      {{ status.problem }}
    </p>
    <p
      v-else
      class="mt-3 text-caption leading-5 text-muted-foreground"
    >
      {{ guidance }}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        :disabled="loading || running"
        @click="emit('refresh')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <RefreshCw v-else class="size-3.5" />
        重新检测
      </Button>
      <Button
        v-if="!permissionsReady && !permissionReapprovalBlocked"
        variant="outline"
        size="sm"
        :disabled="loading || running || !status?.available"
        @click="emit('requestPermissions')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <KeyRound v-else class="size-3.5" />
        打开系统权限设置
      </Button>
      <Button
        v-else-if="permissionReapprovalBlocked"
        variant="outline"
        size="sm"
        disabled
        aria-label="系统权限等待稳定签名后复检"
      >
        <KeyRound class="size-3.5" />
        先稳定签名再复检
      </Button>
      <Button
        v-if="ownedByCurrentTask"
        variant="outline"
        size="sm"
        :disabled="loading || running"
        @click="emit('stop')"
      >
        停止可见会话
      </Button>
      <Button
        v-else
        variant="brand"
        size="sm"
        :disabled="!canStart"
        @click="emit('start')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <Compass v-else class="size-3.5" />
        启动可见会话
      </Button>
    </div>
    <p class="mt-3 text-caption leading-5 text-muted-foreground">
      可见会话必须由你显式启动；{{ approvalGuidance }}
      Driver {{ status?.driverVersion || '0.14.2' }} · prerelease。
    </p>
  </div>
</template>
