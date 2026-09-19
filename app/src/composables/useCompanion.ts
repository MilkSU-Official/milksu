import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import type {
  CompanionArchive,
  CompanionBoardSnapshot,
  CompanionDispatchResult,
  CompanionMemorySnapshot,
  CompanionShellStatus,
  CompanionStatus,
  CompanionTranscriptCursor,
  CompanionTranscriptEntry,
  CompanionTranscriptPage,
} from '@/types'

const emptyBoard: CompanionBoardSnapshot = { sessions: [], todos: [] }
const emptyMemory: CompanionMemorySnapshot = { pending: [], approved: [] }

interface CompanionConfirm {
  action: string
  conversationId: string
  text: string
  idempotencyKey: string
  mode: string
  targetTitle: string
}

export function useCompanion() {
  const [status, setStatus] = useState<CompanionStatus>({
    ready: false,
    provider: '',
    model: '',
  })
  const [entries, setEntries] = useState<CompanionTranscriptEntry[]>([])
  const [prevCursor, setPrevCursor] = useState<CompanionTranscriptCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [board, setBoard] = useState<CompanionBoardSnapshot>(emptyBoard)
  const [memory, setMemory] = useState<CompanionMemorySnapshot>(emptyMemory)
  const [archives, setArchives] = useState<CompanionArchive[]>([])
  const [shell, setShell] = useState<CompanionShellStatus>({
    floating: false,
    wayland: false,
    tray: false,
  })
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<CompanionConfirm | null>(null)
  const loadingOlder = useRef(false)

  const refreshBoard = useCallback(async () => {
    if (!hasDesktopRuntime()) return
    setBoard(await invokeCommand<CompanionBoardSnapshot>('get_companion_board'))
  }, [])

  const refreshMemory = useCallback(async () => {
    if (!hasDesktopRuntime()) return
    setMemory(await invokeCommand<CompanionMemorySnapshot>('get_companion_memory'))
  }, [])

  const refreshArchives = useCallback(async () => {
    if (!hasDesktopRuntime()) return
    setArchives(await invokeCommand<CompanionArchive[]>('list_companion_archives'))
  }, [])

  const loadTail = useCallback(async () => {
    if (!hasDesktopRuntime()) return
    const page = await invokeCommand<CompanionTranscriptPage>('list_companion_transcript', {
      limit: 40,
      cursor: null,
      before: true,
    })
    setEntries(page.entries ?? [])
    setPrevCursor(page.prevCursor ?? null)
    setHasMore(Boolean(page.hasMore))
  }, [])

  const loadOlder = useCallback(async () => {
    if (!hasDesktopRuntime() || !prevCursor || loadingOlder.current) return
    loadingOlder.current = true
    try {
      const page = await invokeCommand<CompanionTranscriptPage>('list_companion_transcript', {
        limit: 40,
        cursor: prevCursor,
        before: true,
      })
      setEntries(current => [...(page.entries ?? []), ...current])
      setPrevCursor(page.prevCursor ?? null)
      setHasMore(Boolean(page.hasMore))
    } finally {
      loadingOlder.current = false
    }
  }, [prevCursor])

  useEffect(() => {
    if (!hasDesktopRuntime()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const next = await invokeCommand<CompanionStatus>('ensure_companion')
        if (cancelled) return
        setStatus(next)
        await Promise.all([loadTail(), refreshBoard(), refreshMemory(), refreshArchives()])
        setShell(await invokeCommand<CompanionShellStatus>('get_companion_shell_status'))
      } catch (reason) {
        if (!cancelled) setError(desktopErrorMessage(reason))
      }
      unlisten = await listenEvent<{
        type?: string
        text?: string
        notice?: string
        input?: string
        done?: boolean
      }>('companion-event', event => {
        const payload = event.payload
        if (payload?.type === 'assistant.delta' && payload.text) {
          setStreaming(current => current + payload.text)
          return
        }
        if (payload?.type === 'assistant.settled' || payload?.type === 'session.ready') {
          setStreaming('')
          setBusy(false)
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload?.type === 'companion.confirm' && payload.input) {
          try {
            const request = JSON.parse(payload.input) as CompanionConfirm
            setConfirm({
              action: request.action || 'stop',
              conversationId: request.conversationId,
              text: request.text || '',
              idempotencyKey: request.idempotencyKey,
              mode: request.mode || '',
              targetTitle: payload.notice || '',
            })
          } catch {
            // The host already returned needsConfirmation to the model.
          }
        }
        if (payload?.type === 'engine.error' && payload.text) {
          setError(payload.text)
          setBusy(false)
        }
      })
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [loadTail, refreshArchives, refreshBoard, refreshMemory])

  const send = useCallback(async () => {
    const prompt = draft.trim()
    if (!prompt || busy) return
    setBusy(true)
    setError('')
    setDraft('')
    try {
      await invokeCommand('send_companion_message', { prompt })
    } catch (reason) {
      setError(desktopErrorMessage(reason))
      setBusy(false)
    }
  }, [busy, draft])

  const archive = useCallback(async () => {
    await invokeCommand('archive_companion_transcript')
    await Promise.all([loadTail(), refreshArchives()])
  }, [loadTail, refreshArchives])

  const removeArchive = useCallback(async (name: string) => {
    await invokeCommand('delete_companion_archive', { name })
    await refreshArchives()
  }, [refreshArchives])

  const approveMemory = useCallback(async (id: string) => {
    await invokeCommand('approve_companion_memory', { id })
    await refreshMemory()
  }, [refreshMemory])

  const forgetMemory = useCallback(async (id: string) => {
    await invokeCommand('forget_companion_memory', { id })
    await refreshMemory()
  }, [refreshMemory])

  const resolveConfirm = useCallback(async (accepted: boolean) => {
    const pending = confirm
    setConfirm(null)
    if (!accepted || !pending) return
    const result = await invokeCommand<CompanionDispatchResult>('confirm_companion_dispatch', {
      action: pending.action,
      conversationId: pending.conversationId,
      text: pending.text,
      idempotencyKey: pending.idempotencyKey,
      mode: pending.mode,
    })
    if (result.error) setError(result.error)
    await refreshBoard()
  }, [confirm, refreshBoard])

  const setFloatEnabled = useCallback(async (enabled: boolean) => {
    setShell(await invokeCommand<CompanionShellStatus>('set_companion_float_enabled', { enabled }))
  }, [])

  const visibleEntries = useMemo(() => {
    if (!streaming) return entries
    return [
      ...entries,
      {
        id: 'streaming',
        type: 'message',
        timestamp: '',
        role: 'assistant',
        text: streaming,
      },
    ]
  }, [entries, streaming])

  return {
    status,
    entries: visibleEntries,
    hasMore,
    loadOlder,
    board,
    memory,
    archives,
    shell,
    draft,
    setDraft,
    busy,
    error,
    confirm,
    send,
    archive,
    removeArchive,
    approveMemory,
    forgetMemory,
    resolveConfirm,
    setFloatEnabled,
  }
}
