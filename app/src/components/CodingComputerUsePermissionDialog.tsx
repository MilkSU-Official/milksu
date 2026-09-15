import { useEffect, useMemo, useRef } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui'
import {
  Accessibility,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
} from 'lucide-react'
import permissionGuide from '@/assets/computer-use-permissions-guide.png'
import type {
  CodingComputerUsePermission,
  CodingComputerUseStatus,
} from '@/codingEnvironmentTypes'
import { useT } from '@/hooks/useUiLocale'

const DIALOG_STYLES = `
.computer-use-permission-dialog { border-radius: 0.5rem; }
.permission-guide,
.permission-list { border-radius: 0.35rem; }
.permission-row {
  display: flex;
  min-height: 6.5rem;
  align-items: center;
  gap: 1rem;
  padding: 1.15rem 1.25rem;
}
.permission-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--primary) 70%, transparent);
  border-radius: 0.35rem;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
}
.permission-icon--recording { border-radius: 9999px; }
@media (max-width: 640px) {
  .permission-row { align-items: flex-start; flex-wrap: wrap; }
  .permission-row > :last-child { margin-left: 3.75rem; }
}
`

export default function CodingComputerUsePermissionDialog({
  open,
  status,
  requesting = null,
  error = '',
  pollIntervalMs = 1200,
  onOpenChange,
  onRequestPermissions,
  onPoll,
  onComplete,
}: {
  open: boolean
  status: CodingComputerUseStatus | null
  requesting?: CodingComputerUsePermission | null
  error?: string
  pollIntervalMs?: number
  onOpenChange?: (open: boolean) => void
  onRequestPermissions?: (permission: CodingComputerUsePermission) => void
  onPoll?: () => void
  onComplete?: () => void
}) {
  const t = useT()
  const pollTimer = useRef<number | null>(null)
  const completionEmitted = useRef(false)

  const permissionsReady = Boolean(
    status?.permissions.accessibility && status.permissions.screenRecording,
  )
  const grantedCount = Number(Boolean(status?.permissions.accessibility))
    + Number(Boolean(status?.permissions.screenRecording))
  const componentDescription = useMemo(() => {
    if (!status?.available) {
      return status?.problem || t('正在检查本地组件。', 'Checking local components.')
    }
    if (permissionsReady) return t('运行正常，系统授权已完整生效。', 'Running. System authorization is fully in effect.')
    return t('运行正常，等待系统授权。', 'Running. Waiting for system authorization.')
  }, [status, permissionsReady, t])

  function stopPolling() {
    if (pollTimer.current === null) return
    window.clearInterval(pollTimer.current)
    pollTimer.current = null
  }

  function startPolling() {
    stopPolling()
    onPoll?.()
    pollTimer.current = window.setInterval(() => onPoll?.(), pollIntervalMs)
  }

  useEffect(() => {
    if (open) {
      completionEmitted.current = false
      startPolling()
      return stopPolling
    }
    stopPolling()
    return undefined
  }, [open, pollIntervalMs])

  useEffect(() => {
    if (!open || !permissionsReady || completionEmitted.current) return
    completionEmitted.current = true
    stopPolling()
    onComplete?.()
  }, [open, permissionsReady, onComplete])

  useEffect(() => stopPolling, [])

  return (
    <>
      <style>{DIALOG_STYLES}</style>
      <Dialog open={open} onOpenChange={value => onOpenChange?.(value)}>
        <DialogContent className="agent-floating computer-use-permission-dialog max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-card p-0 text-foreground shadow-2xl sm:max-w-[min(72rem,calc(100vw-3rem))]">
          <div className="px-6 pb-4 pt-6 sm:px-9 sm:pt-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  Computer Use Setup
                </p>
                <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t('开启 Computer Use', 'Turn on Computer Use')}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t('完成两项 macOS 系统授权后，MilkSU 会自动继续当前任务。', 'After both macOS system authorizations are granted, MilkSU continues this task automatically.')}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground" aria-live="polite">
                {!permissionsReady ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4 text-primary" />}
                <span>{permissionsReady ? t('授权已完成', 'Authorization complete') : t('持续检测中', 'Still checking')}</span>
                <span className="font-mono text-foreground">{grantedCount} / 2</span>
              </div>
            </div>

            <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(17rem,0.78fr)_minmax(25rem,1.22fr)]">
              <figure className="permission-guide min-w-0 overflow-hidden border border-border bg-muted/20">
                <img
                  src={permissionGuide}
                  alt={t('在 macOS 系统设置中为 MilkSU 开启权限的示意图', 'Illustration of turning on MilkSU permissions in macOS System Settings')}
                  className="aspect-square w-full object-cover"
                />
                <figcaption className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
                  {t('在系统设置中找到 MilkSU 并开启对应权限', 'Find MilkSU in System Settings and turn on the matching permissions')}
                </figcaption>
              </figure>

              <section className="permission-list min-w-0 border border-border bg-muted/15" aria-label={t('Computer Use 系统授权', 'Computer Use system authorization')}>
                <div className="permission-row">
                  <div className="permission-icon">
                    <Accessibility className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('辅助功能', 'Accessibility')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t('允许 MilkSU 点击、输入和滚动所选 App。', 'Allow MilkSU to click, type, and scroll in the selected app.')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`hidden items-center gap-1.5 text-xs sm:flex ${status?.permissions.accessibility ? 'text-primary' : 'text-amber-500'}`}>
                      {status?.permissions.accessibility ? <CheckCircle2 className="size-3.5" /> : <CircleDot className="size-3.5" />}
                      {status?.permissions.accessibility ? t('已授权', 'Authorized') : t('待授权', 'Needs authorization')}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(status?.permissions.accessibility) || requesting === 'accessibility'}
                      aria-label={t('打开辅助功能系统设置', 'Open Accessibility settings')}
                      onClick={() => onRequestPermissions?.('accessibility')}
                    >
                      {requesting === 'accessibility' ? <LoaderCircle className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                      {status?.permissions.accessibility ? t('已完成', 'Done') : t('打开设置', 'Open Settings')}
                    </Button>
                  </div>
                </div>

                <div className="permission-row border-t border-border">
                  <div className="permission-icon permission-icon--recording">
                    <CircleDot className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('屏幕录制', 'Screen Recording')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t('允许 MilkSU 识别所选窗口的可见内容。', 'Allow MilkSU to see the selected window.')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`hidden items-center gap-1.5 text-xs sm:flex ${status?.permissions.screenRecording ? 'text-primary' : 'text-amber-500'}`}>
                      {status?.permissions.screenRecording ? <CheckCircle2 className="size-3.5" /> : <CircleDot className="size-3.5" />}
                      {status?.permissions.screenRecording ? t('已授权', 'Authorized') : t('待授权', 'Needs authorization')}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(status?.permissions.screenRecording) || requesting === 'screen-recording'}
                      aria-label={t('打开屏幕录制系统设置', 'Open Screen Recording settings')}
                      onClick={() => onRequestPermissions?.('screen-recording')}
                    >
                      {requesting === 'screen-recording' ? <LoaderCircle className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                      {status?.permissions.screenRecording ? t('已完成', 'Done') : t('打开设置', 'Open Settings')}
                    </Button>
                  </div>
                </div>

                <div className="permission-row border-t border-border">
                  <div className="permission-icon">
                    <PackageCheck className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('Computer Use 组件', 'Computer Use component')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{componentDescription}</p>
                  </div>
                  <div className={`flex shrink-0 items-center gap-1.5 text-xs ${status?.available ? 'text-primary' : 'text-muted-foreground'}`}>
                    {status?.available ? <CheckCircle2 className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
                    {status?.available ? t('运行正常', 'Running') : t('检测中', 'Checking')}
                  </div>
                </div>
              </section>
            </div>

            {error ? (
              <p className="mt-4 border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs leading-5 text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-primary/25 bg-muted/15 px-6 py-4 sm:px-9">
            <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
              {!permissionsReady ? <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" /> : <CheckCircle2 className="size-4 shrink-0 text-primary" />}
              <span>
                {permissionsReady
                  ? t('授权完成，正在恢复当前任务。', 'Authorization complete. Resuming this task.')
                  : t('正在轮询系统权限；返回 MilkSU 后状态会自动更新。', 'Polling system permissions. Status updates automatically when you return to MilkSU.')}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange?.(false)}>
              {t('稍后处理', 'Do this later')}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  )
}
