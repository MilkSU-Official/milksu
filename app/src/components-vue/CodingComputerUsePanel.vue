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

const props = withDefaults(defineProps<{
  status: CodingComputerUseStatus | null
  targets: CodingComputerUseTarget[]
  selectedTargetKey: string
  loading: boolean
  running: boolean
  ownedByCurrentTask: boolean
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  operationEvidence?: ComputerUseOperationEvidence | null
  standalone?: boolean
  activeTargetMatchesScope?: boolean
}>(), {
  standalone: false,
  activeTargetMatchesScope: true,
})

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
// Pre-release / ad-hoc builds must still allow the user to open macOS permission
// panes and attempt a real TCC grant. We never invent permissions, never auto-
// approve, and Start still requires Permissions.Ready from the Go probe.
// Signing diagnostics stay in the Settings/audit surface, not this compact side panel.
const accessibilityPermissionLabel = computed(() => (
  props.status?.permissions.accessibility ? '已授权' : '未授权'
))
const screenRecordingPermissionLabel = computed(() => (
  props.status?.permissions.screenRecording ? '已授权' : '未授权'
))
const readyForCurrentTask = computed(() => Boolean(
  props.status?.enabled
  && props.ownedByCurrentTask
  && props.activeTargetMatchesScope !== false,
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
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) return '已接入其他 Scope'
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
    return `${approvalLabel.value}：当前不会自动操作可见 App。`
  }
  if (props.approvalPolicy === 'ask') {
    return `${approvalLabel.value}：操作前会暂停确认。`
  }
  return `${approvalLabel.value}：普通可见操作自动执行。`
})

const guidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || 'Computer Use 当前不可用。'
  }
  if (missingPermissions.value.length) {
    return `缺少 ${missingPermissions.value.join('、')}；授权后点“重新检测”。`
  }
  if (attachedToOtherTask.value) {
    return '可见会话正由另一个 Coding 任务使用；请回到该任务停止后再切换。'
  }
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return `当前 Scope 不匹配；先停止后重新选择窗口。`
  }
  if (!props.targets.length && !props.status?.target) {
    return '没有发现可选的可见窗口；请打开目标 App 窗口，然后重新检测。'
  }
  if (!effectiveTarget.value) {
    return '请选择一个当前可见窗口。'
  }
  if (readyForCurrentTask.value) {
    return `已锁定当前窗口；${approvalGuidance.value}`
  }
  return '权限和窗口已就绪。'
})

const operationEvidenceDetail = computed(() => {
  if (matchingOperationEvidence.value) return '已匹配当前 Scope。'
  if (operationScopeMismatch.value) return '最近操作来自其他窗口，不计入当前验收。'
  return '等待 Agent 对当前窗口执行 click、type、key 或 scroll。'
})

const primarySetupAction = computed<{
  label: string
  detail: string
  action: 'refresh' | 'permissions' | 'start' | 'stop' | 'none'
  variant: 'default' | 'outline' | 'brand'
  disabled: boolean
}>(() => {
  if (props.status?.enabled && props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return {
      label: '停止当前其他 Scope',
      detail: '停止后重新选择正确窗口。',
      action: 'stop',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
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
      detail: props.status?.problem || '重新检测不会操作任何 App。',
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (!permissionsReady.value) {
    return {
      label: '打开系统权限设置',
      detail: `缺少 ${missingPermissions.value.join('、') || '系统权限'}；授权后重新检测。`,
      action: 'permissions',
      variant: 'default',
      disabled: props.loading || props.running || !props.status?.available,
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
      detail: '打开目标 App 窗口后重新检测。',
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  return {
    label: '启动可见会话',
    detail: `锁定 ${effectiveTarget.value.name}；${approvalGuidance.value}`,
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
  <div
    class="computer-use-panel"
    :class="standalone ? '' : 'mt-5 border-t border-border pt-5'"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-body font-medium">可见 App 会话</p>
        <p class="mt-1 text-body leading-5 text-muted-foreground">
          选择可见窗口并锁定给当前任务。
        </p>
      </div>
      <span
        class="mt-1 size-2 shrink-0 rounded-full"
        :class="readyForCurrentTask ? 'bg-primary' : 'bg-muted-foreground'"
      />
    </div>
    <div class="mt-4 rounded-md bg-muted/45 px-3 py-3 text-body">
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
          :disabled="Boolean(status?.permissions.accessibility) || loading || running || !status?.available"
          aria-label="请求辅助功能权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
            :class="!status?.permissions.accessibility && status?.available ? 'cursor-pointer' : ''"
          >
            辅助功能
            {{ accessibilityPermissionLabel }}
          </Badge>
        </button>
        <button
          type="button"
          class="rounded-full disabled:cursor-default"
          :disabled="Boolean(status?.permissions.screenRecording) || loading || running || !status?.available"
          aria-label="请求屏幕录制权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
            :class="!status?.permissions.screenRecording && status?.available ? 'cursor-pointer' : ''"
          >
            屏幕录制
            {{ screenRecordingPermissionLabel }}
          </Badge>
        </button>
      </div>
      <div class="mt-3 rounded-lg border border-border bg-background/70 px-3 py-3" aria-label="Computer Use 真实操作证据">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-body font-medium text-muted-foreground">真实操作证据</p>
            <p v-if="matchingOperationEvidence" class="mt-1 text-body font-medium">
              {{ matchingOperationEvidence.summary }}
            </p>
            <p v-else class="mt-1 text-body font-medium">
              {{ operationScopeMismatch ? 'Scope 不匹配' : '等待真实操作' }}
            </p>
            <p class="mt-1 text-body leading-5 text-muted-foreground">
              {{ operationEvidenceDetail }}
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
            <p class="text-body font-medium text-muted-foreground">下一步</p>
            <p class="mt-1 text-body font-medium">{{ primarySetupAction.label }}</p>
            <p class="mt-1 text-body leading-5 text-muted-foreground">
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
      class="mt-3 text-body leading-5 text-destructive"
    >
      {{ status.problem }}
    </p>
    <p
      v-else
      class="mt-3 text-body leading-5 text-muted-foreground"
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
        v-if="!permissionsReady"
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
  </div>
</template>

<style scoped>
.computer-use-panel {
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}
</style>
