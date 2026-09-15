import { useMemo } from 'react'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  ChevronDown,
  Compass,
  KeyRound,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
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
import { useT } from '@/hooks/useUiLocale'

export default function CodingComputerUsePanel({
  status,
  targets,
  selectedTargetKey,
  loading,
  running,
  ownedByCurrentTask,
  executionMode,
  approvalPolicy,
  operationEvidence,
  standalone = false,
  activeTargetMatchesScope = true,
  onSelectedTargetKeyChange,
  onRequestPermissions,
  onRefresh,
  onStart,
  onStop,
}: {
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
  onSelectedTargetKeyChange?: (value: string) => void
  onRequestPermissions?: (permission: CodingComputerUsePermission) => void
  onRefresh?: () => void
  onStart?: () => void
  onStop?: () => void
}) {
  const t = useT()
  const selectedTarget = useMemo(() => resolveSelectedComputerUseTarget(targets, selectedTargetKey), [targets, selectedTargetKey])
  const sessionTarget = status?.conversationId ? status.target : null
  const effectiveTarget = sessionTarget ?? selectedTarget
  const matchingOperationEvidence = useMemo(() => {
    if (!effectiveTarget || !operationEvidence) return null
    return operationEvidence.bundleId === effectiveTarget.bundleId
      && operationEvidence.pid === effectiveTarget.pid
      && operationEvidence.windowId === effectiveTarget.windowId
      ? operationEvidence
      : null
  }, [effectiveTarget, operationEvidence])
  const operationScopeMismatch = Boolean(operationEvidence && effectiveTarget && !matchingOperationEvidence)
  const permissionsReady = Boolean(status?.permissions.accessibility && status.permissions.screenRecording)
  const signingStatus = status?.signing ?? null
  const windowsUserSession = signingStatus?.signature === 'windows-user-session'
  const linuxPortalSession = signingStatus?.signature === 'linux-portal'
  const signingIdentityLabel = (() => {
    const signing = signingStatus
    if (!signing) return t('当前构建身份：未检测', 'Current build identity: not detected')
    if (windowsUserSession) return t('当前环境：Windows 普通用户会话', 'Current environment: Windows user session')
    if (linuxPortalSession) return t('当前环境：GNOME 桌面共享', 'Current environment: GNOME desktop sharing')
    const signature = signing.signature === 'adhoc'
      ? 'ad-hoc'
      : signing.signature === 'signed'
        ? t('已签名', 'signed')
        : signing.signature || t('未知签名', 'unknown signature')
    const team = signing.teamIdentifier && signing.teamIdentifier !== 'not set'
      ? signing.teamIdentifier
      : t('未设置', 'not set')
    return t(`当前构建身份：${signature} · Team ${team}`, `Current build identity: ${signature} · Team ${team}`)
  })()
  const signingDiagnostic = (() => {
    const signing = signingStatus
    if (!signing) return ''
    if (windowsUserSession) {
      return t('Windows 使用当前登录用户的 UI Automation、输入与窗口捕获能力；不会申请 macOS 权限或管理员权限。', 'Windows uses the signed-in user’s UI Automation, input, and window capture. It does not request macOS or administrator permissions.')
    }
    if (linuxPortalSession) {
      return t('GNOME 会弹出系统桌面共享授权。授权后可截屏、按坐标点击和打字。这是整桌面级输入，不是单个窗口。停止或崩溃后键鼠仍归你。', 'GNOME shows a system desktop-sharing prompt. After you allow it, MilkSU can screenshot, click coordinates, and type. This is display-level input, not a single window. Keyboard and mouse stay yours after stop or crash.')
    }
    if (signing.stableIdentity) {
      return t(`${signingIdentityLabel}，权限应绑定到稳定 App 身份。`, `${signingIdentityLabel}. Permissions should bind to a stable app identity.`)
    }
    return t(`${signingIdentityLabel}；${signing.problem || t('macOS 可能无法稳定复用辅助功能/屏幕录制授权。', 'macOS may not reuse Accessibility / Screen Recording grants reliably.')}`, `${signingIdentityLabel}; ${signing.problem || t('macOS 可能无法稳定复用辅助功能/屏幕录制授权。', 'macOS may not reuse Accessibility / Screen Recording grants reliably.')}`)
  })()
  const signingUnstable = Boolean(signingStatus && !signingStatus.stableIdentity)
  const permissionProbeMayBeStale = Boolean(signingUnstable && !permissionsReady)
  const accessibilityPermissionLabel = status?.permissions.accessibility ? t('已授权', 'Authorized') : t('未授权', 'Not authorized')
  const screenRecordingPermissionLabel = status?.permissions.screenRecording ? t('已授权', 'Authorized') : t('未授权', 'Not authorized')
  const readyForCurrentTask = Boolean(status?.enabled && ownedByCurrentTask && activeTargetMatchesScope !== false)
  const attachedToOtherTask = Boolean(status?.conversationId && !ownedByCurrentTask)
  const canStart = Boolean(!loading && !running && status?.available && permissionsReady && selectedTarget && !status?.conversationId)
  const missingPermissions = [
    ...(!status?.permissions.accessibility ? [t('辅助功能', 'Accessibility')] : []),
    ...(!status?.permissions.screenRecording ? [t('屏幕录制', 'Screen Recording')] : []),
  ]
  const connectionLabel = readyForCurrentTask
    ? t('已接入当前任务', 'Attached to this task')
    : ownedByCurrentTask && activeTargetMatchesScope === false
      ? t('已接入其他 Scope', 'Attached to another scope')
      : attachedToOtherTask
        ? t('其他任务正在使用', 'In use by another task')
        : !status?.available
          ? t('不可用', 'Unavailable')
          : !permissionsReady
            ? t('缺系统权限', 'Missing system permissions')
            : !effectiveTarget
              ? t('待选择窗口', 'Choose a window')
              : t('可启动', 'Ready to start')

  function executionModeLabel(mode: CodingExecutionMode) {
    return mode === 'plan' ? 'Plan' : 'Go'
  }
  function approvalPolicyLabel(policy: CodingApprovalPolicy) {
    if (policy === 'full-auto') return t('完全访问', 'Full access')
    if (policy === 'workspace-auto') return t('替我审批', 'Approve for me')
    if (policy === 'ask') return t('逐次审批', 'Ask each time')
    return t('只读', 'Read-only')
  }
  const approvalLabel = `${executionModeLabel(executionMode)} / ${approvalPolicyLabel(approvalPolicy)}`
  const approvalGuidance = executionMode !== 'go' || approvalPolicy === 'read-only'
    ? t(`${approvalLabel}：当前模式不能操作外部 App。`, `${approvalLabel}: this mode cannot operate external apps.`)
    : approvalPolicy === 'ask'
      ? t(`${approvalLabel}：操作前会确认。`, `${approvalLabel}: confirm before acting.`)
      : t(`${approvalLabel}：普通操作自动执行，越界仍会停下。`, `${approvalLabel}: ordinary actions run automatically; out-of-scope work still pauses.`)

  const guidance = (() => {
    if (!status?.available) return status?.problem || t('Computer Use 当前不可用。', 'Computer Use is unavailable.')
    if (missingPermissions.length) {
      const base = t(`${missingPermissions.join(t('、', ' and '))} 未授权`, `${missingPermissions.join(' and ')} not authorized`)
      if (permissionProbeMayBeStale) {
        return t(`${base}。授权后请重新检测；若仍失败可重启 App。`, `${base}. Recheck after granting; restart the app if it still fails.`)
      }
      return base
    }
    if (attachedToOtherTask) return t('可见会话正由另一个任务使用。', 'The visible session is in use by another task.')
    if (ownedByCurrentTask && activeTargetMatchesScope === false) {
      return t(`当前锁定的是 ${effectiveTarget?.name || t('另一个窗口', 'another window')}，请停止后重选。`, `Currently locked to ${effectiveTarget?.name || t('另一个窗口', 'another window')}. Stop it and choose again.`)
    }
    if (!targets.length && !status?.target) return t('没有可选窗口，请打开目标 App 后重新检测。', 'No windows to choose. Open the target app and recheck.')
    if (!effectiveTarget) return t('请选择一个可见窗口。', 'Choose a visible window.')
    if (readyForCurrentTask) return t(`已锁定到当前任务。${approvalGuidance}`, `Locked to this task. ${approvalGuidance}`)
    return t('权限与窗口已就绪，可启动可见会话。', 'Permissions and window are ready. You can start a visible session.')
  })()

  const compactGuidance = (() => {
    if (!status?.available) return status?.problem || t('Computer Use 当前不可用。', 'Computer Use is unavailable.')
    if (missingPermissions.length) return t(`还需授权${missingPermissions.join(t('和', ' and '))}；完成后重新检测。`, `Still need ${missingPermissions.join(' and ')}. Recheck after granting.`)
    if (attachedToOtherTask) return t('另一个 Coding 任务正在使用可见会话。', 'Another Coding task is using the visible session.')
    if (ownedByCurrentTask && activeTargetMatchesScope === false) return t('当前任务锁定了其他类型的可见 Scope，请先停止后再切换。', 'This task is locked to a different visible scope. Stop it before switching.')
    if (!effectiveTarget) return targets.length ? '' : t('没有可选窗口', 'No windows to choose')
    if (readyForCurrentTask) return t(`已锁定 ${effectiveTarget.name}`, `Locked to ${effectiveTarget.name}`)
    return ''
  })()

  const primarySetupAction = (() => {
    if (status?.enabled && ownedByCurrentTask && activeTargetMatchesScope === false) {
      return {
        label: t('停止当前其他 Scope', 'Stop the other current scope'),
        detail: t(`${effectiveTarget?.name || t('当前窗口', 'the current window')} 不属于 Computer Use 外部 App Scope，停止后才能重新选择。`, `${effectiveTarget?.name || t('当前窗口', 'the current window')} is not a Computer Use external-app scope. Stop it before choosing again.`),
        action: 'stop' as const,
        variant: 'outline' as const,
        disabled: loading || running,
      }
    }
    if (readyForCurrentTask) {
      return {
        label: t('停止可见会话', 'Stop visible session'),
        detail: effectiveTarget
          ? matchingOperationEvidence
            ? t(`最近真实操作：${matchingOperationEvidence.summary}`, `Latest real action: ${matchingOperationEvidence.summary}`)
            : t(`已锁定 ${effectiveTarget.name} · PID ${effectiveTarget.pid} · Window ${effectiveTarget.windowId}；下一步需要 Agent 对该窗口执行一次可见操作并保留工具结果。`, `Locked to ${effectiveTarget.name} · PID ${effectiveTarget.pid} · Window ${effectiveTarget.windowId}. Next, the agent needs to perform one visible action on this window and keep the tool result.`)
          : t('已锁定当前 Coding 任务。', 'Locked to the current Coding task.'),
        action: 'stop' as const,
        variant: 'outline' as const,
        disabled: loading || running,
      }
    }
    if (!status?.available) {
      return {
        label: t('重新检测 Computer Use', 'Recheck Computer Use'),
        detail: status?.problem || t('当前运行时不可用。', 'The runtime is unavailable.'),
        action: 'refresh' as const,
        variant: 'outline' as const,
        disabled: loading || running,
      }
    }
    if (!permissionsReady) {
      return {
        label: t('重新检测授权', 'Recheck authorization'),
        detail: t('两项权限分别完成后，回到这里重新检测。', 'After both permissions are granted, come back here and recheck.'),
        action: 'refresh' as const,
        variant: 'outline' as const,
        disabled: loading || running,
      }
    }
    if (attachedToOtherTask) {
      return {
        label: t('等待其他任务释放', 'Waiting for another task'),
        detail: t('当前可见会话已经被另一个 Coding 任务占用。', 'The visible session is already used by another Coding task.'),
        action: 'none' as const,
        variant: 'outline' as const,
        disabled: true,
      }
    }
    if (!effectiveTarget) {
      return {
        label: t('重新检测可见窗口', 'Recheck visible windows'),
        detail: t('打开目标 App 窗口后重新检测，再选择要锁定的 App / PID / Window。', 'Open the target app window, recheck, then choose the App / PID / Window to lock.'),
        action: 'refresh' as const,
        variant: 'outline' as const,
        disabled: loading || running,
      }
    }
    return {
      label: t('启动可见会话', 'Start visible session'),
      detail: t(`${effectiveTarget.name} 将被锁定为当前任务 Scope；${approvalGuidance}`, `${effectiveTarget.name} will be locked as this task’s scope. ${approvalGuidance}`),
      action: 'start' as const,
      variant: 'brand' as const,
      disabled: !canStart,
    }
  })()

  function runPrimarySetupAction() {
    if (primarySetupAction.disabled) return
    if (primarySetupAction.action === 'refresh') onRefresh?.()
    if (primarySetupAction.action === 'start') onStart?.()
    if (primarySetupAction.action === 'stop') onStop?.()
  }

  return (
    <div className={standalone ? '' : 'mt-5 border-t border-border pt-5'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium">{t('外部 App', 'External app')}</p>
          <p className="mt-1 text-caption leading-5 text-muted-foreground">
            {t('为当前任务锁定一个可见窗口。', 'Lock a visible window to this task.')}
          </p>
        </div>
        <Badge
          variant={readyForCurrentTask ? 'success' : attachedToOtherTask || !status?.available ? 'secondary' : 'warning'}
          className="shrink-0"
        >
          {connectionLabel}
        </Badge>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3">
        {!ownedByCurrentTask ? (
          <div className="mb-3">
            <Select
              value={selectedTargetKey || undefined}
              disabled={loading || running || Boolean(status?.conversationId)}
              onValueChange={value => onSelectedTargetKeyChange?.(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('选择可见 App 窗口', 'Choose a visible app window')} />
              </SelectTrigger>
              <SelectContent>
                {targets.map(target => (
                  <SelectItem key={computerUseTargetKey(target)} value={computerUseTargetKey(target)}>
                    {target.name}
                    {target.windowTitle ? <span> · {target.windowTitle}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex items-start gap-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${readyForCurrentTask ? 'bg-primary' : 'bg-muted-foreground/60'}`} />
          <div className="min-w-0 flex-1">
            {effectiveTarget?.name ? <p className="truncate text-body font-medium">{effectiveTarget.name}</p> : null}
            {effectiveTarget?.windowTitle ? (
              <p className="mt-0.5 truncate text-caption text-muted-foreground">{effectiveTarget.windowTitle}</p>
            ) : null}
            {effectiveTarget ? (
              <p
                className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                title={`${effectiveTarget.bundleId} · PID ${effectiveTarget.pid} · Window ${effectiveTarget.windowId}`}
              >
                {effectiveTarget.bundleId} · PID {effectiveTarget.pid} · Window {effectiveTarget.windowId}
              </p>
            ) : null}
          </div>
        </div>

        {compactGuidance ? (
          <p className={`mt-3 text-caption leading-5 ${status?.problem ? 'text-destructive' : 'text-muted-foreground'}`}>
            {compactGuidance}
          </p>
        ) : null}

        {status?.available && !permissionsReady ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || running || Boolean(status.permissions.accessibility)}
              aria-label={t('打开辅助功能设置', 'Open Accessibility settings')}
              onClick={() => onRequestPermissions?.('accessibility')}
            >
              <KeyRound className="size-3.5" />
              {t('辅助功能设置', 'Accessibility settings')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || running || Boolean(status.permissions.screenRecording)}
              aria-label={t('打开屏幕录制设置', 'Open Screen Recording settings')}
              onClick={() => onRequestPermissions?.('screen-recording')}
            >
              <KeyRound className="size-3.5" />
              {t('屏幕录制设置', 'Screen Recording settings')}
            </Button>
          </div>
        ) : null}

        <Button
          variant={primarySetupAction.variant}
          size="sm"
          className="mt-3 w-full"
          disabled={primarySetupAction.disabled}
          aria-label={t('执行 Computer Use 下一步', 'Run the next Computer Use step')}
          onClick={runPrimarySetupAction}
        >
          {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : primarySetupAction.action === 'start' ? <Compass className="size-3.5" /> : null}
          {primarySetupAction.label}
        </Button>
      </div>

      <details className="group mt-3 rounded-lg border border-border bg-background/60">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-caption text-muted-foreground [&::-webkit-details-marker]:hidden"
          aria-label={t('Computer Use 运行详情', 'Computer Use run details')}
        >
          <span className="font-medium text-foreground">{t('运行详情', 'Run details')}</span>
          <span className="min-w-0 flex-1 truncate text-right">
            {matchingOperationEvidence
              ? t('已记录真实操作', 'Real action recorded')
              : permissionsReady
                ? t('权限就绪', 'Permissions ready')
                : t(`${missingPermissions.length} 项待授权`, `${missingPermissions.length} pending`)}
          </span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-4 border-t border-border px-3 py-3">
          <div>
            <p className="text-caption font-medium text-muted-foreground">{t('系统权限', 'System permissions')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full disabled:cursor-default"
                disabled={Boolean(status?.permissions.accessibility) || loading || running || !status?.available}
                aria-label={t('请求辅助功能权限', 'Request Accessibility permission')}
                onClick={() => onRequestPermissions?.('accessibility')}
              >
                <Badge
                  variant={status?.permissions.accessibility ? 'secondary' : 'outline'}
                  className={!status?.permissions.accessibility && status?.available ? 'cursor-pointer' : ''}
                >
                  {t(`辅助功能 ${accessibilityPermissionLabel}`, `Accessibility ${accessibilityPermissionLabel}`)}
                </Badge>
              </button>
              <button
                type="button"
                className="rounded-full disabled:cursor-default"
                disabled={Boolean(status?.permissions.screenRecording) || loading || running || !status?.available}
                aria-label={t('请求屏幕录制权限', 'Request Screen Recording permission')}
                onClick={() => onRequestPermissions?.('screen-recording')}
              >
                <Badge
                  variant={status?.permissions.screenRecording ? 'secondary' : 'outline'}
                  className={!status?.permissions.screenRecording && status?.available ? 'cursor-pointer' : ''}
                >
                  {t(`屏幕录制 ${screenRecordingPermissionLabel}`, `Screen Recording ${screenRecordingPermissionLabel}`)}
                </Badge>
              </button>
            </div>
            {signingDiagnostic ? (
              <p className="mt-2 break-words text-caption leading-5 text-muted-foreground">{signingDiagnostic}</p>
            ) : null}
          </div>

          <div className="border-t border-border pt-3" aria-label={t('Computer Use 真实操作证据', 'Computer Use real-action evidence')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-caption font-medium text-muted-foreground">{t('最近操作', 'Latest action')}</p>
                <p className="mt-1 break-words text-caption leading-5 text-foreground">
                  {matchingOperationEvidence
                    ? matchingOperationEvidence.summary
                    : operationScopeMismatch
                      ? t('最近操作来自其他窗口。', 'The latest action came from another window.')
                      : null}
                </p>
              </div>
              <Badge variant={matchingOperationEvidence ? 'secondary' : 'outline'} className="shrink-0">
                {matchingOperationEvidence ? t('已记录', 'Recorded') : operationScopeMismatch ? t('不匹配', 'Mismatch') : t('暂无', 'None')}
              </Badge>
            </div>
          </div>

          <p className="border-t border-border pt-3 text-caption leading-5 text-muted-foreground">{guidance}</p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={loading || running} onClick={() => onRefresh?.()}>
              {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t('重新检测', 'Recheck')}
            </Button>
          </div>

          <p className="text-[11px] leading-4 text-muted-foreground">
            {t(`${approvalGuidance} Driver ${status?.driverVersion || '0.27.0'} · prerelease。`, `${approvalGuidance} Driver ${status?.driverVersion || '0.27.0'} · prerelease.`)}
          </p>
        </div>
      </details>
    </div>
  )
}
