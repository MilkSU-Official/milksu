import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe2, RefreshCw, Smartphone, SquareTerminal } from 'lucide-react'
import { Badge, Button, Input } from '@/components/ui'
import { invokeCommand } from '@/desktop'
import { codingBrowserViewportSyncKey } from '@/lib/codingBrowserTabs'
import { useT } from '@/hooks/useUiLocale'
import type { EnvLease } from '@/envbroker'

export default function TargetLivePane({
  lease,
  conversationId,
}: {
  lease: EnvLease
  conversationId?: string
}) {
  const t = useT()
  const probe = useRef('')
  const probeError = useRef('')
  const viewport = useRef<HTMLElement | null>(null)
  const lastViewport = useRef('')
  const observer = useRef<ResizeObserver | null>(null)
  const [, setTick] = useState(0)

  const surface = () => String(lease.surface || 'browser')

  async function syncViewport() {
    const id = conversationId?.trim()
    const node = viewport.current
    if (!id || !node || surface() !== 'browser') return
    const rect = node.getBoundingClientRect()
    const geometry = {
      conversationId: id,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 8 && rect.height > 8,
    }
    const key = codingBrowserViewportSyncKey(geometry)
    if (key === lastViewport.current) return
    lastViewport.current = key
    try {
      await invokeCommand('set_coding_browser_viewport', geometry)
    } catch {
      // Packaged overlay is best-effort in tests and preview.
    }
  }

  async function openBrowser() {
    const id = conversationId?.trim()
    const address = lease.address?.trim()
    if (!id || !address) return
    const url = address.includes('://') ? address : `http://${address}`
    try {
      await invokeCommand('start_coding_browser', { conversationId: id, initialUrl: url })
      await syncViewport()
    } catch {
      // Renderer tests have no native browser view.
    }
  }

  async function runProbe() {
    probeError.current = ''
    try {
      probe.current = await invokeCommand<string>('probe_env_lease', {
        ownerKind: lease.ownerKind,
        ownerId: lease.ownerId,
      })
    } catch (reason) {
      probeError.current = reason instanceof Error ? reason.message : String(reason)
    }
    setTick(n => n + 1)
  }

  useEffect(() => {
    observer.current = new ResizeObserver(() => {
      void syncViewport()
    })
    if (viewport.current) observer.current.observe(viewport.current)
    if (surface() === 'browser') void openBrowser()
    if (surface() === 'shell') void runProbe()
    return () => {
      observer.current?.disconnect()
      const id = conversationId?.trim()
      if (id && surface() === 'browser') {
        void invokeCommand('set_coding_browser_viewport', {
          conversationId: id,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          visible: false,
        }).catch(() => undefined)
      }
    }
  }, [lease.address, lease.surface, conversationId])

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background" data-testid="target-surface" data-kind={lease.surface}>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {surface() === 'browser' ? (
          <>
            <Button variant="ghost" size="icon-sm" disabled><ArrowLeft className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled><ArrowRight className="size-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled><RefreshCw className="size-4" /></Button>
            <Input className="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption" value={lease.address ? `http://${lease.address}` : ''} readOnly />
          </>
        ) : surface() === 'shell' ? (
          <>
            <SquareTerminal className="ml-2 size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-caption">{lease.address} · bash</span>
          </>
        ) : (
          <>
            <Smartphone className="ml-2 size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-caption">{lease.address}</span>
          </>
        )}
        <Badge variant="secondary" className="mr-2">{t('当前靶', 'Current target')}</Badge>
      </header>

      {surface() === 'browser' ? (
        <div ref={node => { viewport.current = node }} className="relative min-h-0 flex-1 bg-white" data-coding-browser-viewport>
          <div className="absolute inset-0 grid place-items-center text-caption text-muted-foreground">
            {t('隔离浏览器贴在这个槽上。地址钉死租约。', 'Isolated browser is pinned to this slot. The address is locked to the lease.')}
          </div>
        </div>
      ) : surface() === 'shell' ? (
        <pre className="min-h-0 flex-1 overflow-auto bg-[#0e1012] px-4 py-4 font-mono text-caption text-[#d7d7d2]">{probeError.current || probe.current || `curl ${lease.address}`}</pre>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-[#0e1012] px-6 text-center">
          <div>
            <p className="text-body">{t('本机模拟器窗口已启动', 'Local emulator window is running')}</p>
            <p className="mt-2 font-mono text-caption text-muted-foreground">{lease.address}</p>
            <p className="mt-3 text-caption text-muted-foreground">{t('题目在这个设备上。Agent 用租约串口的 adb，不要打宿主机其它 App。', 'The challenge is on this device. The agent uses the lease serial adb and must not touch other host apps.')}</p>
          </div>
        </div>
      )}

      <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {surface() === 'browser' ? <Globe2 className="size-3.5" /> : surface() === 'shell' ? <SquareTerminal className="size-3.5" /> : <Smartphone className="size-3.5" />}
          {t('人和 Agent 共用这个靶', 'You and the agent share this target')}
        </span>
      </footer>
    </section>
  )
}
