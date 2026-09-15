import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  LoaderCircle,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from 'lucide-react'
import {
  hasDesktopRuntime,
  invokeCommand,
  listenEvent,
} from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import { useT } from '@/hooks/useUiLocale'
import type {
  CodingTerminalEvent,
  CodingTerminalSession,
} from '@/codingEnvironmentTypes'

const TERMINAL_STYLES = `
.coding-terminal-xterm .xterm { height: 100%; width: 100%; overflow: hidden; }
.coding-terminal-xterm .xterm-viewport { max-width: 100%; scrollbar-color: rgb(96 112 137 / 65%) transparent; }
.coding-terminal-xterm .xterm-screen,
.coding-terminal-xterm .xterm-helpers { max-width: 100%; }
.coding-terminal-xterm .xterm-screen canvas { image-rendering: auto; }
`

export default function CodingTerminalPanel({
  active,
  conversationId,
  workspacePath,
  className,
  onClose,
}: {
  active: boolean
  conversationId: string
  workspacePath: string
  className?: string
  onClose?: () => void
}) {
  const t = useT()
  const desktopRuntime = hasDesktopRuntime()
  const desktopRuntimeNotice = t('真实 Shell 仅在 MilkSU 桌面 App 中可用。', 'A real shell is only available in the MilkSU desktop app.')
  const shellContainer = useRef<HTMLDivElement | null>(null)
  const [terminalSessions, setTerminalSessions] = useState<CodingTerminalSession[]>([])
  const [selectedTerminalId, setSelectedTerminalId] = useState('')
  const [shellLoading, setShellLoading] = useState(false)
  const [closingTerminals, setClosingTerminals] = useState<string[]>([])
  const [shellError, setShellError] = useState('')
  const pendingOutput = useRef(new Map<string, string>())
  const terminalOrdinals = useRef(new Map<string, number>())
  const nextTerminalOrdinal = useRef(1)
  const hydratingShell = useRef(false)
  const terminalRef = useRef<XTerm | undefined>(undefined)
  const fitAddonRef = useRef<FitAddon | undefined>(undefined)
  const selectedTerminalIdRef = useRef('')
  const conversationIdRef = useRef(conversationId)
  const terminalWriteChain = useRef<Promise<void>>(Promise.resolve())
  selectedTerminalIdRef.current = selectedTerminalId
  conversationIdRef.current = conversationId

  const selectedTerminal = useMemo(() => (
    terminalSessions.find(session => session.id === selectedTerminalId)
  ), [terminalSessions, selectedTerminalId])
  const selectedTerminalRef = useRef(selectedTerminal)
  selectedTerminalRef.current = selectedTerminal
  const workspacePathRef = useRef(workspacePath)
  workspacePathRef.current = workspacePath
  const runningShells = terminalSessions.filter(session => session.status === 'running')
  const workspaceName = useMemo(() => {
    const value = workspacePath.replace(/\/+$/, '')
    return value.split('/').at(-1) || t('终端', 'Terminal')
  }, [workspacePath, t])

  function terminalStatusLabel(status: CodingTerminalSession['status']): string {
    if (status === 'running') return t('运行中', 'Running')
    if (status === 'exited') return t('已退出', 'Exited')
    if (status === 'stopped') return t('已停止', 'Stopped')
    return t('失败', 'Failed')
  }

  function errorMessage(reason: unknown, fallback: string) {
    return redactProviderCredentials(reason instanceof Error ? reason.message : fallback)
  }

  function rememberTerminal(session: CodingTerminalSession) {
    if (terminalOrdinals.current.has(session.id)) return
    terminalOrdinals.current.set(session.id, nextTerminalOrdinal.current)
    nextTerminalOrdinal.current += 1
  }

  function resetTerminalOrder() {
    terminalOrdinals.current.clear()
    nextTerminalOrdinal.current = 1
  }

  function terminalLabel(session: CodingTerminalSession): string {
    const ordinal = terminalOrdinals.current.get(session.id) ?? 1
    return ordinal === 1 ? workspaceName : `${workspaceName} ${ordinal}`
  }

  function upsertTerminal(session: CodingTerminalSession) {
    rememberTerminal(session)
    setTerminalSessions(current => {
      const existing = current.findIndex(candidate => candidate.id === session.id)
      if (existing < 0) return [...current, session]
      const updated = [...current]
      updated[existing] = session
      return updated
    })
  }

  function fitShell() {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon || !shellContainer.current) return
    try {
      fitAddon.fit()
    } catch {
      return
    }
  }

  function renderTerminalSession(session: CodingTerminalSession) {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.disableStdin = session.status !== 'running'
    terminal.reset()
    terminal.clear()
    if (session.outputTrimmed) {
      terminal.write(`\x1b[90m[${t('更早的终端输出已省略', 'Earlier terminal output omitted')}]\x1b[0m\r\n`)
    }
    if (session.output) terminal.write(session.output)
    if (session.status !== 'running') {
      const exit = session.exitCode === undefined ? '' : ` · exit ${session.exitCode}`
      terminal.write(`\r\n\x1b[90m[${terminalStatusLabel(session.status)}${exit}]\x1b[0m\r\n`)
    }
    queueMicrotask(() => {
      fitShell()
      terminalRef.current?.focus()
    })
  }

  function renderEmptyTerminal() {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.disableStdin = true
    terminal.reset()
    terminal.clear()
  }

  function selectTerminal(identifier: string) {
    const session = terminalSessions.find(item => item.id === identifier)
    if (!session) return
    setSelectedTerminalId(identifier)
    renderTerminalSession(session)
  }

  function terminalDimensions() {
    return {
      columns: Math.max(20, terminalRef.current?.cols ?? 100),
      rows: Math.max(5, terminalRef.current?.rows ?? 28),
    }
  }

  async function startShell() {
    if (!desktopRuntime || !conversationId || !workspacePath || shellLoading) return
    setShellLoading(true)
    setShellError('')
    try {
      fitShell()
      const size = terminalDimensions()
      const session = await invokeCommand<CodingTerminalSession>('start_coding_terminal', {
        conversationId,
        workspacePath,
        ...size,
      })
      upsertTerminal(session)
      setSelectedTerminalId(session.id)
      renderTerminalSession(session)
    } catch (reason) {
      setShellError(errorMessage(reason, t('无法启动项目 Shell。', 'Could not start the project shell.')))
    } finally {
      setShellLoading(false)
    }
  }

  async function hydrateShellSessions() {
    const terminal = terminalRef.current
    if (!terminal) return
    setShellError('')
    setTerminalSessions([])
    setSelectedTerminalId('')
    resetTerminalOrder()
    pendingOutput.current.clear()
    if (!desktopRuntime) {
      terminal.reset()
      terminal.clear()
      terminal.write(`\r\n\x1b[90m${t('请在桌面 App 中新建 Shell。', 'Create a new shell in the desktop app.')}\x1b[0m\r\n`)
      return
    }
    if (!conversationId || !workspacePath) {
      terminal.reset()
      terminal.clear()
      terminal.write(`\r\n\x1b[90m${t('正在准备项目目录…', 'Preparing the project directory…')}\x1b[0m\r\n`)
      return
    }
    hydratingShell.current = true
    try {
      const sessions = await invokeCommand<CodingTerminalSession[]>('list_coding_terminals', { conversationId })
      const orderedSessions = [...sessions].sort((left, right) => (
        left.startedAt - right.startedAt || left.id.localeCompare(right.id)
      ))
      for (const session of orderedSessions) rememberTerminal(session)
      setTerminalSessions(orderedSessions)
      const preferred = orderedSessions.find(session => session.status === 'running') ?? orderedSessions[0]
      if (preferred) {
        setSelectedTerminalId(preferred.id)
        renderTerminalSession(preferred)
      } else if (active) {
        await startShell()
      }
    } catch (reason) {
      setShellError(errorMessage(reason, t('无法读取项目 Shell。', 'Could not read project shells.')))
    } finally {
      hydratingShell.current = false
      const buffered = pendingOutput.current.get(selectedTerminalIdRef.current)
      if (buffered) terminal.write(buffered)
      pendingOutput.current.clear()
    }
  }

  function removeTerminalFromView(identifier: string) {
    setTerminalSessions(current => {
      const index = current.findIndex(item => item.id === identifier)
      if (index < 0) return current
      const updated = current.filter(item => item.id !== identifier)
      if (updated.length === 0) resetTerminalOrder()
      else terminalOrdinals.current.delete(identifier)
      if (selectedTerminalIdRef.current === identifier) {
        const next = updated[index] ?? updated[index - 1]
        setSelectedTerminalId(next?.id ?? '')
        if (next) renderTerminalSession(next)
        else renderEmptyTerminal()
      }
      return updated
    })
  }

  function handleTerminalEvent(event: CodingTerminalEvent) {
    if (event.conversationId !== conversationIdRef.current) return
    if (event.type === 'terminal.closed') {
      removeTerminalFromView(event.terminalId)
      return
    }
    if (event.session) {
      upsertTerminal(event.session)
      if (!selectedTerminalIdRef.current) setSelectedTerminalId(event.session.id)
    }
    if (event.type === 'terminal.output' && event.data) {
      if (hydratingShell.current) {
        pendingOutput.current.set(event.terminalId, (pendingOutput.current.get(event.terminalId) ?? '') + event.data)
      } else if (event.terminalId === selectedTerminalIdRef.current) {
        terminalRef.current?.write(event.data)
      }
    }
    if (event.type === 'terminal.exited' && event.session && event.terminalId === selectedTerminalIdRef.current) {
      if (terminalRef.current) terminalRef.current.options.disableStdin = true
      const exit = event.session.exitCode === undefined ? '' : ` · exit ${event.session.exitCode}`
      terminalRef.current?.write(`\r\n\x1b[90m[${terminalStatusLabel(event.session.status)}${exit}]\x1b[0m\r\n`)
    }
  }

  async function closeShell(session: CodingTerminalSession): Promise<boolean> {
    if (closingTerminals.includes(session.id)) return false
    setClosingTerminals(current => [...current, session.id])
    setShellError('')
    try {
      await invokeCommand<void>('close_coding_terminal', {
        conversationId,
        terminalId: session.id,
      })
      removeTerminalFromView(session.id)
      return true
    } catch (reason) {
      setShellError(errorMessage(reason, t('无法关闭项目 Shell。', 'Could not close the project shell.')))
      return false
    } finally {
      setClosingTerminals(current => current.filter(id => id !== session.id))
    }
  }

  async function restartShell() {
    const session = selectedTerminal
    if (!session || session.status === 'running' || shellLoading) return
    if (await closeShell(session)) await startShell()
  }

  function writeShell(data: string) {
    const session = selectedTerminalRef.current
    if (!desktopRuntime || !session || session.status !== 'running') return
    const currentConversationId = conversationIdRef.current
    const terminalId = session.id
    terminalWriteChain.current = terminalWriteChain.current
      .then(() => invokeCommand<void>('write_coding_terminal', {
        conversationId: currentConversationId,
        terminalId,
        data,
      }))
      .catch(reason => {
        setShellError(errorMessage(reason, t('无法写入项目 Shell。', 'Could not write to the project shell.')))
      })
  }

  useEffect(() => {
    const container = shellContainer.current
    if (!container) return
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.28,
      screenReaderMode: true,
      scrollback: 5000,
      theme: {
        background: '#111315',
        foreground: '#f8f8f5',
        cursor: '#22bbff',
        cursorAccent: '#111315',
        selectionBackground: 'rgba(34, 187, 255, 0.22)',
        black: '#111315',
        brightBlack: '#6e7167',
        green: '#46c47c',
        brightGreen: '#8ee0ad',
        cyan: '#5ce1e6',
        brightCyan: '#8ff7fa',
        red: '#ff6b6b',
        brightRed: '#ff8b8b',
        yellow: '#f2c94c',
        brightYellow: '#ffe37a',
        blue: '#6ea8fe',
        brightBlue: '#94c1ff',
        magenta: '#c084fc',
        brightMagenta: '#d7a8ff',
        white: '#dfe1d9',
        brightWhite: '#ffffff',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    const inputDisposable = terminal.onData(writeShell)
    const resizeObserver = new ResizeObserver(() => {
      fitShell()
      const session = selectedTerminal
      if (!desktopRuntime || !session || session.status !== 'running' || !terminal) return
      if (session.columns === terminal.cols && session.rows === terminal.rows) return
      void invokeCommand<CodingTerminalSession>('resize_coding_terminal', {
        conversationId,
        terminalId: session.id,
        columns: terminal.cols,
        rows: terminal.rows,
      }).then(upsertTerminal).catch(() => undefined)
    })
    resizeObserver.observe(container)
    let stopEvents: (() => void) | undefined
    void listenEvent<CodingTerminalEvent>('coding-terminal-event', event => handleTerminalEvent(event.payload))
      .then(stop => { stopEvents = stop })
    fitShell()
    void hydrateShellSessions()
    return () => {
      resizeObserver.disconnect()
      inputDisposable.dispose()
      stopEvents?.()
      terminal.dispose()
      terminalRef.current = undefined
      fitAddonRef.current = undefined
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      fitShell()
      terminalRef.current?.focus()
    })
  }, [active, conversationId, workspacePath])

  useEffect(() => {
    void hydrateShellSessions()
  }, [conversationId, workspacePath])

  return (
    <>
      <style>{TERMINAL_STYLES}</style>
      <section className={['flex h-full min-h-0 min-w-0 flex-col overflow-hidden', className].filter(Boolean).join(' ')}>
        <div className="flex h-10 shrink-0 items-center justify-between px-2">
          <div className="flex min-w-0 items-center gap-px overflow-x-auto">
            {terminalSessions.length ? terminalSessions.map(session => (
              <div
                key={session.id}
                className={`agent-chrome-tab${session.id === selectedTerminalId ? ' is-current' : ''}`}
              >
                <button
                  type="button"
                  data-terminal-id={session.id}
                  aria-label={terminalLabel(session)}
                  aria-pressed={session.id === selectedTerminalId}
                  title={`${redactProviderCredentials(session.shell)} · PID ${session.pid ?? '—'}`}
                  onClick={() => selectTerminal(session.id)}
                >
                  <SquareTerminal className="size-3.5 shrink-0" />
                  <span className="truncate">{terminalLabel(session)}</span>
                </button>
                <button
                  type="button"
                  className="agent-chrome-icon"
                  style={{ width: '1.5rem', height: '1.5rem' }}
                  disabled={closingTerminals.includes(session.id)}
                  aria-label={t(`关闭 ${terminalLabel(session)}`, `Close ${terminalLabel(session)}`)}
                  title={t(`关闭 ${terminalLabel(session)}`, `Close ${terminalLabel(session)}`)}
                  onClick={() => void closeShell(session)}
                >
                  {closingTerminals.includes(session.id) ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />}
                </button>
              </div>
            )) : (
              <button type="button" className="agent-chrome-tab is-current">
                <SquareTerminal className="size-3.5 shrink-0" />
                <span className="truncate px-2 py-1">{workspaceName}</span>
              </button>
            )}
            <button
              type="button"
              className="agent-chrome-icon"
              disabled={!desktopRuntime || !workspacePath || shellLoading || runningShells.length >= 4}
              aria-label={t('新建项目 Shell', 'New project shell')}
              title={t('新建项目 Shell', 'New project shell')}
              onClick={() => void startShell()}
            >
              {shellLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-4" />}
            </button>
            {selectedTerminal && selectedTerminal.status !== 'running' ? (
              <button
                type="button"
                className="agent-chrome-icon"
                disabled={shellLoading || closingTerminals.includes(selectedTerminal.id)}
                aria-label={t('重新启动当前 Shell', 'Restart this shell')}
                title={t('重新启动当前 Shell', 'Restart this shell')}
                onClick={() => void restartShell()}
              >
                <RefreshCw className="size-3.5" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="agent-chrome-icon"
            aria-label={t('关闭底部面板', 'Close bottom panel')}
            title={t('关闭底部面板', 'Close bottom panel')}
            onClick={() => onClose?.()}
          >
            <X className="size-4" />
          </button>
        </div>

        {!desktopRuntime ? (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-caption leading-5 text-amber-200">
            {desktopRuntimeNotice}
          </div>
        ) : null}

        <div className="coding-terminal-xterm flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ background: 'var(--agent-code-inset, var(--background))' }}>
          <div ref={shellContainer} className="box-border min-h-0 min-w-0 flex-1 overflow-hidden px-2 py-2" />
          {shellError ? (
            <p className="shrink-0 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-caption text-destructive">
              {shellError}
            </p>
          ) : null}
        </div>
      </section>
    </>
  )
}
