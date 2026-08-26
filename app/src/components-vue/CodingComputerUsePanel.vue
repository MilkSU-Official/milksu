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
import { t } from '@/lib/uiLocale'

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
const windowsUserSession = computed(() => (
  signingStatus.value?.signature === 'windows-user-session'
))
const linuxPortalSession = computed(() => (
  signingStatus.value?.signature === 'linux-portal'
))
const signingIdentityLabel = computed(() => {
  const signing = signingStatus.value
  if (!signing) return t('当前构建身份：未检测', 'Current build identity: not detected')
  if (windowsUserSession.value) return t('当前环境：Windows 普通用户会话', 'Current environment: Windows user session')
  if (linuxPortalSession.value) return t('当前环境：GNOME 桌面共享', 'Current environment: GNOME desktop sharing')
  const signature = signing.signature === 'adhoc'
    ? 'ad-hoc'
    : signing.signature === 'signed'
      ? t('已签名', 'signed')
      : signing.signature || t('未知签名', 'unknown signature')
  const team = signing.teamIdentifier && signing.teamIdentifier !== 'not set'
    ? signing.teamIdentifier
    : t('未设置', 'not set')
  return t(`当前构建身份：${signature} · Team ${team}`, `Current build identity: ${signature} · Team ${team}`)
})
const signingDiagnostic = computed(() => {
  const signing = signingStatus.value
  if (!signing) return ''
  if (windowsUserSession.value) {
    return t('Windows 使用当前登录用户的 UI Automation、输入与窗口捕获能力；不会申请 macOS 权限或管理员权限。', 'Windows uses the signed-in user’s UI Automation, input, and window capture. It does not request macOS or administrator permissions.')
  }
  if (linuxPortalSession.value) {
    return t('GNOME 会弹出系统桌面共享授权。授权后可截屏、按坐标点击和打字。这是整桌面级输入，不是单个窗口。停止或崩溃后键鼠仍归你。', 'GNOME shows a system desktop-sharing prompt. After you allow it, MilkSU can screenshot, click coordinates, and type. This is display-level input, not a single window. Keyboard and mouse stay yours after stop or crash.')
  }
  if (signing.stableIdentity) {
    return t(`${signingIdentityLabel.value}，权限应绑定到稳定 App 身份。`, `${signingIdentityLabel.value}. Permissions should bind to a stable app identity.`)
  }
  return t(`${signingIdentityLabel.value}；${signing.problem || t('macOS 可能无法稳定复用辅助功能/屏幕录制授权。', 'macOS may not reuse Accessibility / Screen Recording grants reliably.')}`, `${signingIdentityLabel.value}; ${signing.problem || t('macOS 可能无法稳定复用辅助功能/屏幕录制授权。', 'macOS may not reuse Accessibility / Screen Recording grants reliably.')}`)
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
  props.status?.permissions.accessibility ? t('已授权', 'Authorized') : t('未授权', 'Not authorized')
))
const screenRecordingPermissionLabel = computed(() => (
  props.status?.permissions.screenRecording ? t('已授权', 'Authorized') : t('未授权', 'Not authorized')
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
  if (!props.status?.permissions.accessibility) missing.push(t('辅助功能', 'Accessibility'))
  if (!props.status?.permissions.screenRecording) missing.push(t('屏幕录制', 'Screen Recording'))
  return missing
})
const connectionLabel = computed(() => {
  if (readyForCurrentTask.value) return t('已接入当前任务', 'Attached to this task')
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) return t('已接入其他 Scope', 'Attached to another scope')
  if (attachedToOtherTask.value) return t('其他任务正在使用', 'In use by another task')
  if (!props.status?.available) return t('不可用', 'Unavailable')
  if (!permissionsReady.value) return t('缺系统权限', 'Missing system permissions')
  if (!effectiveTarget.value) return t('待选择窗口', 'Choose a window')
  return t('可启动', 'Ready to start')
})
function executionModeLabel(mode: CodingExecutionMode) {
  return mode === 'plan' ? 'Plan' : 'Go'
}

function approvalPolicyLabel(policy: CodingApprovalPolicy) {
  if (policy === 'full-auto') return t('完全访问', 'Full access')
  if (policy === 'workspace-auto') return t('替我审批', 'Approve for me')
  if (policy === 'ask') return t('逐次审批', 'Ask each time')
  return t('只读', 'Read-only')
}

const approvalLabel = computed(() => (
  `${executionModeLabel(props.executionMode)} / ${approvalPolicyLabel(props.approvalPolicy)}`
))

const approvalGuidance = computed(() => {
  if (props.executionMode !== 'go' || props.approvalPolicy === 'read-only') {
    return t(`${approvalLabel.value}：当前模式不能操作外部 App。`, `${approvalLabel.value}: this mode cannot operate external apps.`)
  }
  if (props.approvalPolicy === 'ask') {
    return t(`${approvalLabel.value}：操作前会确认。`, `${approvalLabel.value}: confirm before acting.`)
  }
  return t(`${approvalLabel.value}：普通操作自动执行，越界仍会停下。`, `${approvalLabel.value}: ordinary actions run automatically; out-of-scope work still pauses.`)
})

const guidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || t('Computer Use 当前不可用。', 'Computer Use is unavailable.')
  }
  if (missingPermissions.value.length) {
    const base = t(`${missingPermissions.value.join(t('、', ' and '))} 未授权`, `${missingPermissions.value.join(' and ')} not authorized`)
    if (permissionProbeMayBeStale.value) {
      return t(`${base}。授权后请重新检测；若仍失败可重启 App。`, `${base}. Recheck after granting; restart the app if it still fails.`)
    }
    return base
  }
  if (attachedToOtherTask.value) {
    return t('可见会话正由另一个任务使用。', 'The visible session is in use by another task.')
  }
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return t(`当前锁定的是 ${effectiveTarget.value?.name || t('另一个窗口', 'another window')}，请停止后重选。`, `Currently locked to ${effectiveTarget.value?.name || t('另一个窗口', 'another window')}. Stop it and choose again.`)
  }
  if (!props.targets.length && !props.status?.target) {
    return t('没有可选窗口，请打开目标 App 后重新检测。', 'No windows to choose. Open the target app and recheck.')
  }
  if (!effectiveTarget.value) {
    return t('请选择一个可见窗口。', 'Choose a visible window.')
  }
  if (readyForCurrentTask.value) {
    return t(`已锁定到当前任务。${approvalGuidance.value}`, `Locked to this task. ${approvalGuidance.value}`)
  }
  return t('权限与窗口已就绪，可启动可见会话。', 'Permissions and window are ready. You can start a visible session.')
})

const compactGuidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || t('Computer Use 当前不可用。', 'Computer Use is unavailable.')
  }
  if (missingPermissions.value.length) {
    return t(`还需授权${missingPermissions.value.join(t('和', ' and '))}；完成后重新检测。`, `Still need ${missingPermissions.value.join(' and ')}. Recheck after granting.`)
  }
  if (attachedToOtherTask.value) {
    return t('另一个 Coding 任务正在使用可见会话。', 'Another Coding task is using the visible session.')
  }
  if (props.ownedByCurrentTask && props.activeTargetMatchesScope === false) {
    return t('当前任务锁定了其他类型的可见 Scope，请先停止后再切换。', 'This task is locked to a different visible scope. Stop it before switching.')
  }
  if (!effectiveTarget.value) {
    return props.targets.length ? '' : t('没有可选窗口', 'No windows to choose')
  }
  if (readyForCurrentTask.value) {
    return t(`已锁定 ${effectiveTarget.value.name}`, `Locked to ${effectiveTarget.value.name}`)
  }
  return ''
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
      label: t('停止当前其他 Scope', 'Stop the other current scope'),
      detail: t(`${effectiveTarget.value?.name || t('当前窗口', 'the current window')} 不属于 Computer Use 外部 App Scope，停止后才能重新选择。`, `${effectiveTarget.value?.name || t('当前窗口', 'the current window')} is not a Computer Use external-app scope. Stop it before choosing again.`),
      action: 'stop',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (readyForCurrentTask.value) {
    return {
      label: t('停止可见会话', 'Stop visible session'),
      detail: effectiveTarget.value
        ? matchingOperationEvidence.value
          ? t(`最近真实操作：${matchingOperationEvidence.value.summary}`, `Latest real action: ${matchingOperationEvidence.value.summary}`)
          : t(`已锁定 ${effectiveTarget.value.name} · PID ${effectiveTarget.value.pid} · Window ${effectiveTarget.value.windowId}；下一步需要 Agent 对该窗口执行一次可见操作并保留工具结果。`, `Locked to ${effectiveTarget.value.name} · PID ${effectiveTarget.value.pid} · Window ${effectiveTarget.value.windowId}. Next, the agent needs to perform one visible action on this window and keep the tool result.`)
        : t('已锁定当前 Coding 任务。', 'Locked to the current Coding task.'),
      action: 'stop',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (!props.status?.available) {
    return {
      label: t('重新检测 Computer Use', 'Recheck Computer Use'),
      detail: props.status?.problem || t('当前运行时不可用。', 'The runtime is unavailable.'),
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (!permissionsReady.value) {
    return {
      label: t('重新检测授权', 'Recheck authorization'),
      detail: t('两项权限分别完成后，回到这里重新检测。', 'After both permissions are granted, come back here and recheck.'),
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  if (attachedToOtherTask.value) {
    return {
      label: t('等待其他任务释放', 'Waiting for another task'),
      detail: t('当前可见会话已经被另一个 Coding 任务占用。', 'The visible session is already used by another Coding task.'),
      action: 'none',
      variant: 'outline',
      disabled: true,
    }
  }
  if (!effectiveTarget.value) {
    return {
      label: t('重新检测可见窗口', 'Recheck visible windows'),
      detail: t('打开目标 App 窗口后重新检测，再选择要锁定的 App / PID / Window。', 'Open the target app window, recheck, then choose the App / PID / Window to lock.'),
      action: 'refresh',
      variant: 'outline',
      disabled: props.loading || props.running,
    }
  }
  return {
    label: t('启动可见会话', 'Start visible session'),
    detail: t(`${effectiveTarget.value.name} 将被锁定为当前任务 Scope；${approvalGuidance.value}`, `${effectiveTarget.value.name} will be locked as this task’s scope. ${approvalGuidance.value}`),
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
        <p class="text-body font-medium">{{ t('外部 App', 'External app') }}</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          {{ t('为当前任务锁定一个可见窗口。', 'Lock a visible window to this task.') }}
        </p>
      </div>
      <span
        class="ak-status ak-status--compact shrink-0"
        :class="readyForCurrentTask
          ? ''
          : attachedToOtherTask || !status?.available
            ? 'ak-status--offline'
            : 'ak-status--warning'"
      >
        <span class="ak-status__signal" />
        <span class="ak-status__label">SCOPE</span>
        <span class="ak-status__detail">{{ connectionLabel }}</span>
      </span>
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
            <SelectValue :placeholder="t('选择可见 App 窗口', 'Choose a visible app window')" />
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
          <p v-if="effectiveTarget?.name" class="truncate text-body font-medium">
            {{ effectiveTarget.name }}
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
        v-if="compactGuidance"
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
          :aria-label="t('打开辅助功能设置', 'Open Accessibility settings')"
          @click="emit('requestPermissions', 'accessibility')"
        >
          <KeyRound class="size-3.5" />
          {{ t('辅助功能设置', 'Accessibility settings') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="loading || running || Boolean(status.permissions.screenRecording)"
          :aria-label="t('打开屏幕录制设置', 'Open Screen Recording settings')"
          @click="emit('requestPermissions', 'screen-recording')"
        >
          <KeyRound class="size-3.5" />
          {{ t('屏幕录制设置', 'Screen Recording settings') }}
        </Button>
      </div>

      <Button
        :variant="primarySetupAction.variant"
        size="sm"
        class="mt-3 w-full"
        :disabled="primarySetupAction.disabled"
        :aria-label="t('执行 Computer Use 下一步', 'Run the next Computer Use step')"
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
        :aria-label="t('Computer Use 运行详情', 'Computer Use run details')"
      >
        <span class="font-medium text-foreground">{{ t('运行详情', 'Run details') }}</span>
        <span class="min-w-0 flex-1 truncate text-right">
          {{ matchingOperationEvidence ? t('已记录真实操作', 'Real action recorded') : permissionsReady ? t('权限就绪', 'Permissions ready') : t(`${missingPermissions.length} 项待授权`, `${missingPermissions.length} pending`) }}
        </span>
        <ChevronDown class="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div class="space-y-4 border-t border-border px-3 py-3">
        <div>
          <p class="text-caption font-medium text-muted-foreground">{{ t('系统权限', 'System permissions') }}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full disabled:cursor-default"
              :disabled="Boolean(status?.permissions.accessibility) || loading || running || !status?.available"
              :aria-label="t('请求辅助功能权限', 'Request Accessibility permission')"
              @click="emit('requestPermissions', 'accessibility')"
            >
              <Badge
                :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
                :class="!status?.permissions.accessibility && status?.available ? 'cursor-pointer' : ''"
              >
                {{ t(`辅助功能 ${accessibilityPermissionLabel}`, `Accessibility ${accessibilityPermissionLabel}`) }}
              </Badge>
            </button>
            <button
              type="button"
              class="rounded-full disabled:cursor-default"
              :disabled="Boolean(status?.permissions.screenRecording) || loading || running || !status?.available"
              :aria-label="t('请求屏幕录制权限', 'Request Screen Recording permission')"
              @click="emit('requestPermissions', 'screen-recording')"
            >
              <Badge
                :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
                :class="!status?.permissions.screenRecording && status?.available ? 'cursor-pointer' : ''"
              >
                {{ t(`屏幕录制 ${screenRecordingPermissionLabel}`, `Screen Recording ${screenRecordingPermissionLabel}`) }}
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

        <div class="border-t border-border pt-3" :aria-label="t('Computer Use 真实操作证据', 'Computer Use real-action evidence')">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-caption font-medium text-muted-foreground">{{ t('最近操作', 'Latest action') }}</p>
              <p class="mt-1 break-words text-caption leading-5 text-foreground">
                <template v-if="matchingOperationEvidence">
                  {{ matchingOperationEvidence.summary }}
                </template>
                <template v-else-if="operationScopeMismatch">
                  {{ t('最近操作来自其他窗口。', 'The latest action came from another window.') }}
                </template>
                <template v-else />
              </p>
            </div>
            <Badge :variant="matchingOperationEvidence ? 'secondary' : 'outline'" class="shrink-0">
              {{ matchingOperationEvidence ? t('已记录', 'Recorded') : operationScopeMismatch ? t('不匹配', 'Mismatch') : t('暂无', 'None') }}
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
            {{ t('重新检测', 'Recheck') }}
          </Button>
        </div>

        <p class="text-[11px] leading-4 text-muted-foreground">
          {{ t(`${approvalGuidance} Driver ${status?.driverVersion || '0.14.2'} · prerelease。`, `${approvalGuidance} Driver ${status?.driverVersion || '0.14.2'} · prerelease.`) }}
        </p>
      </div>
    </details>
  </div>
</template>
