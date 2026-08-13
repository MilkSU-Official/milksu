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
  ChevronDown,
  Compass,
  KeyRound,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next'
import type {
  CodingComputerUsePermission,
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
  requestPermissions: [permission: CodingComputerUsePermission]
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
// Pre-release / ad-hoc builds must still allow the user to open macOS permission
// panes and attempt a real TCC grant. We never invent permissions, never auto-
// approve, and Start still requires Permissions.Ready from the Go probe.
// Unstable signing only changes diagnostics, not whether the user may act.
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
    return `${approvalLabel.value}：当前模式不会操作可见 App；切到 Go + 替我审批/完全访问后才会自动完成普通可见操作。`
  }
  if (props.approvalPolicy === 'ask') {
    return `${approvalLabel.value}：观察、点击或输入前会暂停确认，适合第一次验证高风险 GUI。`
  }
  return `${approvalLabel.value}：普通观察、点击和输入会自动执行；危险、越界或未锁定 Scope 的操作仍会停下。`
})

const guidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || 'Computer Use 当前不可用。'
  }
  if (missingPermissions.value.length) {
    const signingHint = signingDiagnostic.value || '开发期 ad-hoc 重签后，macOS 可能显示 MilkSU 已勾选但探针仍返回未授权。'
    if (permissionProbeMayBeStale.value) {
      return `${missingPermissions.value.join('、')} 缺少或尚未对当前构建生效；“App 管理”不能替代这两项。${signingHint} 仍可显式打开系统权限设置做首次授权；授权后必须回到本页“重新检测”，只有真实探针通过才能启动可见会话。若设置里已勾选但探针仍为 false，请退出并重新打开当前 App，或换用 Developer ID 签名版后再检测——不要伪造权限，也不要反复无意义点授权。`
    }
    return `${missingPermissions.value.join('、')} 缺少或尚未对当前构建生效；“App 管理”不能替代这两项。${signingHint}`
  }
  if (attachedToOtherTask.value) {
    return '可见会话正由另一个 Coding 任务使用；请回到该任务停止后再切换。'
  }
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return `当前任务锁定的是 ${effectiveTarget.value?.name || '另一个窗口'}，不属于 Computer Use 外部 App Scope；先停止当前 Scope，再选择正确窗口。`
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

const compactGuidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || 'Computer Use 当前不可用。'
  }
  if (missingPermissions.value.length) {
    return `还需授权${missingPermissions.value.join('和')}；完成后重新检测。`
  }
  if (attachedToOtherTask.value) {
    return '另一个 Coding 任务正在使用可见会话。'
  }
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return '当前任务锁定了其他类型的可见 Scope，请先停止后再切换。'
  }
  if (!effectiveTarget.value) {
    return '打开目标 App 后重新检测并选择窗口。'
  }
  if (readyForCurrentTask.value) {
    return `已锁定 ${effectiveTarget.value.name}；Agent 只能操作这个 App / PID / Window。`
  }
  return '启动后，此窗口会成为当前任务唯一的 Computer Use Scope。'
})

const primarySetupAction = computed<{
  label: string
  detail: string
  action: 'refresh' | 'start' | 'stop' | 'none'
  variant: 'default' | 'outline' | 'brand'
  disabled: boolean
}>(() => {
  if (props.status?.enabled && props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return {
      label: '停止当前其他 Scope',
      detail: `${effectiveTarget.value?.name || '当前窗口'} 不属于 Computer Use 外部 App Scope，停止后才能重新选择。`,
      action: 'stop',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (readyForCurrentTask.value) {
    return {
      label: '停止可见会话',
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
    return {
      label: '重新检测授权',
      detail: '两项权限分别完成后，回到这里重新检测。',
      action: 'refresh',
      variant: 'outline',
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
  if (primarySetupAction.value.action === 'start') emit('start')
  if (primarySetupAction.value.action === 'stop') emit('stop')
}
</script>

<template>
  <div :class="standalone ? '' : 'mt-5 border-t border-border pt-5'">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-body font-medium">外部 App</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          为当前任务锁定一个可见窗口。
        </p>
      </div>
      <Badge :variant="connectionVariant" class="shrink-0">
        {{ connectionLabel }}
      </Badge>
    </div>

    <div class="mt-4 rounded-xl border border-border bg-muted/25 p-3">
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

      <div class="flex items-start gap-3">
        <span
          class="mt-1.5 size-2 shrink-0 rounded-full"
          :class="readyForCurrentTask ? 'bg-primary' : 'bg-muted-foreground/60'"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-body font-medium">
            {{ effectiveTarget?.name || '尚未选择窗口' }}
          </p>
          <p
            v-if="effectiveTarget?.windowTitle"
            class="mt-0.5 truncate text-caption text-muted-foreground"
          >
            {{ effectiveTarget.windowTitle }}
          </p>
          <p
            v-if="effectiveTarget"
            class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            :title="`${effectiveTarget.bundleId} · PID ${effectiveTarget.pid} · Window ${effectiveTarget.windowId}`"
          >
            {{ effectiveTarget.bundleId }} · PID {{ effectiveTarget.pid }} · Window {{ effectiveTarget.windowId }}
          </p>
        </div>
      </div>

      <p
        class="mt-3 text-caption leading-5"
        :class="status?.problem ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ compactGuidance }}
      </p>

      <div v-if="status?.available && !permissionsReady" class="mt-3 grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="loading || running || Boolean(status.permissions.accessibility)"
          aria-label="打开辅助功能设置"
          @click="emit('requestPermissions', 'accessibility')"
        >
          <KeyRound class="size-3.5" />
          辅助功能设置
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="loading || running || Boolean(status.permissions.screenRecording)"
          aria-label="打开屏幕录制设置"
          @click="emit('requestPermissions', 'screen-recording')"
        >
          <KeyRound class="size-3.5" />
          屏幕录制设置
        </Button>
      </div>

      <Button
        :variant="primarySetupAction.variant"
        size="sm"
        class="mt-3 w-full"
        :disabled="primarySetupAction.disabled"
        aria-label="执行 Computer Use 下一步"
        @click="runPrimarySetupAction"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <Compass v-else-if="primarySetupAction.action === 'start'" class="size-3.5" />
        {{ primarySetupAction.label }}
      </Button>
    </div>

    <details class="group mt-3 rounded-lg border border-border bg-background/60">
      <summary
        class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-caption text-muted-foreground [&::-webkit-details-marker]:hidden"
        aria-label="Computer Use 运行详情"
      >
        <span class="font-medium text-foreground">运行详情</span>
        <span class="min-w-0 flex-1 truncate text-right">
          {{ matchingOperationEvidence ? '已记录真实操作' : permissionsReady ? '权限就绪' : `${missingPermissions.length} 项待授权` }}
        </span>
        <ChevronDown class="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div class="space-y-4 border-t border-border px-3 py-3">
        <div>
          <p class="text-caption font-medium text-muted-foreground">系统权限</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full disabled:cursor-default"
              :disabled="Boolean(status?.permissions.accessibility) || loading || running || !status?.available"
              aria-label="请求辅助功能权限"
              @click="emit('requestPermissions', 'accessibility')"
            >
              <Badge
                :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
                :class="!status?.permissions.accessibility && status?.available ? 'cursor-pointer' : ''"
              >
                辅助功能 {{ accessibilityPermissionLabel }}
              </Badge>
            </button>
            <button
              type="button"
              class="rounded-full disabled:cursor-default"
              :disabled="Boolean(status?.permissions.screenRecording) || loading || running || !status?.available"
              aria-label="请求屏幕录制权限"
              @click="emit('requestPermissions', 'screen-recording')"
            >
              <Badge
                :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
                :class="!status?.permissions.screenRecording && status?.available ? 'cursor-pointer' : ''"
              >
                屏幕录制 {{ screenRecordingPermissionLabel }}
              </Badge>
            </button>
          </div>
          <p
            v-if="signingDiagnostic"
            class="mt-2 break-words text-caption leading-5 text-muted-foreground"
          >
            {{ signingDiagnostic }}
          </p>
        </div>

        <div class="border-t border-border pt-3" aria-label="Computer Use 真实操作证据">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-caption font-medium text-muted-foreground">最近操作</p>
              <p class="mt-1 break-words text-caption leading-5 text-foreground">
                <template v-if="matchingOperationEvidence">
                  {{ matchingOperationEvidence.summary }}
                </template>
                <template v-else-if="operationScopeMismatch">
                  其他窗口的操作不会计入当前 Scope。
                </template>
                <template v-else>
                  暂无；observe 只表示看见窗口，click、type、key 或 scroll 才记为真实操作。
                </template>
              </p>
            </div>
            <Badge :variant="matchingOperationEvidence ? 'secondary' : 'outline'" class="shrink-0">
              {{ matchingOperationEvidence ? '已记录' : operationScopeMismatch ? '不匹配' : '暂无' }}
            </Badge>
          </div>
        </div>

        <p class="border-t border-border pt-3 text-caption leading-5 text-muted-foreground">
          {{ guidance }}
        </p>

        <div class="flex flex-wrap gap-2">
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
        </div>

        <p class="text-[11px] leading-4 text-muted-foreground">
          {{ approvalGuidance }} Driver {{ status?.driverVersion || '0.14.2' }} · prerelease。
        </p>
      </div>
    </details>
  </div>
</template>
