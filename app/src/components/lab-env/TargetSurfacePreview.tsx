import { ArrowLeft, ArrowRight, Globe2, RefreshCw, Smartphone, SquareTerminal } from 'lucide-react'
import { Badge, Button, Input } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import type { TargetSurfaceKind } from '@/lib/environmentTypes'

export default function TargetSurfacePreview({
  kind,
  address,
  driving,
}: {
  kind: TargetSurfaceKind
  address: string
  driving?: boolean
}) {
  const t = useT()
  const kindLabel = ({
    browser: t('浏览器', 'Browser'),
    shell: t('终端', 'Terminal'),
    emulator: t('模拟器', 'Emulator'),
    device: t('真机', 'Device'),
  })[kind]
  const drivingText = !driving
    ? t('人和 Agent 共用这个靶', 'You and the agent share this target')
    : kind === 'shell'
      ? t('Agent 正在敲命令，你看见同一份终端', 'The agent is typing commands. You see the same terminal.')
      : kind === 'emulator' || kind === 'device'
        ? t('Agent 正在点屏幕，你看见同一台设备', 'The agent is tapping the screen. You see the same device.')
        : t('Agent 正在点页面，你看见同一页', 'The agent is clicking the page. You see the same view.')

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background" data-testid="target-surface" data-kind={kind}>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {kind === 'browser' ? (
          <>
            <Button variant="ghost" size="icon-sm" disabled aria-label={t('后退', 'Back')}><ArrowLeft className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled aria-label={t('前进', 'Forward')}><ArrowRight className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled aria-label={t('重新加载', 'Reload')}><RefreshCw className="size-4" /></Button>
            <Input
              className="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption"
              value={`http://${address}`}
              aria-label={t('靶地址', 'Target address')}
              readOnly
            />
          </>
        ) : kind === 'shell' ? (
          <>
            <SquareTerminal className="ml-2 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-caption">{address} · bash</span>
          </>
        ) : (
          <>
            <Smartphone className="ml-2 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-caption">{address}</span>
          </>
        )}
        <Badge variant="secondary" className="mr-2">{t('当前靶', 'Current target')} · {kindLabel}</Badge>
      </header>

      {kind === 'browser' ? (
        <div className="relative min-h-0 flex-1 bg-white text-[#171a1d]">
          <div className="absolute inset-0 overflow-auto px-10 py-8">
            <p className="text-xs tracking-[0.2em] text-[#888]">OWASP JUICE SHOP</p>
            <h1 className="mt-2 text-2xl font-semibold">Login</h1>
            <label className="mt-6 block text-sm">Email
              <input className="mt-1 h-9 w-full rounded border border-[#d0d0d0] px-3" defaultValue="admin@juice-sh.op" readOnly />
            </label>
            <label className="mt-3 block text-sm">Password
              <input className="mt-1 h-9 w-full rounded border border-[#d0d0d0] px-3" defaultValue="••••••••" readOnly />
            </label>
            <button type="button" className="relative mt-5 rounded bg-[#5460c0] px-4 py-2 text-sm text-white">
              Log in
              {driving ? <span className="pointer-events-none absolute -inset-1 rounded ring-2 ring-[var(--signal-gold)] ring-offset-2" /> : null}
            </button>
          </div>
        </div>
      ) : kind === 'shell' ? (
        <div className="relative min-h-0 flex-1 bg-[#0e1012] px-4 py-4 font-mono text-caption text-[#d7d7d2]" data-testid="target-shell">
          <p className="text-muted-foreground">milksu-env 127.0.0.1:61616</p>
          <p className="mt-2">$ nmap -p 61616 127.0.0.1</p>
          <p>61616/tcp open  activemq</p>
          <p className="mt-2">$ nc 127.0.0.1 61616</p>
          <p className={driving ? 'text-[var(--signal-gold)]' : ''}>OpenWire handshake …</p>
          {driving ? <p className="mt-2 text-[var(--signal-gold)]">█</p> : null}
        </div>
      ) : (
        <div className="relative grid min-h-0 flex-1 place-items-center bg-[#0e1012]" data-testid="target-emulator">
          <div className="relative h-[78%] aspect-[9/19] rounded-[1.6rem] border border-border bg-[#111] p-2 shadow-xl">
            <div className="flex h-full flex-col overflow-hidden rounded-[1.2rem] bg-[#1a1c1e]">
              <p className="px-3 py-2 text-center text-[10px] text-muted-foreground">Android API 34</p>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="text-body">{t('设置', 'Settings')}</p>
                <button type="button" className="relative rounded-md border border-border px-3 py-1.5 text-caption">
                  {t('关于手机', 'About phone')}
                  {driving ? <span className="pointer-events-none absolute -inset-1 rounded ring-2 ring-[var(--signal-gold)]" /> : null}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {driving ? (
        <p
          className="pointer-events-none absolute bottom-12 left-3 z-10 rounded-md border border-border bg-card px-3 py-1.5 text-caption"
          data-testid="agent-driving"
        >
          {drivingText}
        </p>
      ) : null}

      <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {kind === 'browser' ? <Globe2 className="size-3.5" /> : kind === 'shell' ? <SquareTerminal className="size-3.5" /> : <Smartphone className="size-3.5" />}
          {kind === 'browser' ? t('隔离 profile · 只打 Scope', 'Isolated profile · Scope only') : kind === 'shell' ? t('受管终端 · 只打租约', 'Managed terminal · lease only') : t('本机模拟器 · 受限 adb', 'Local emulator · restricted adb')}
        </span>
        <span>{driving ? t('Agent 在操作，你也可以动手', 'The agent is driving. You can still act.') : t('人和 Agent 共用这个靶', 'You and the agent share this target')}</span>
      </footer>
    </section>
  )
}
