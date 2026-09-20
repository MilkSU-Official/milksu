import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import { explainCompanionError } from '@/lib/companionUserError'
import { COMPANION_COMPLETE_HOLD_MS } from '@/lib/companionPetMotion'
import type {
  CodingAttachment,
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
  hostRequestId: string
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
    hidden: true,
    wayland: false,
    tray: false,
  })
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<CodingAttachment[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<CompanionConfirm | null>(null)
  const [complete, setComplete] = useState(false)
  const loadingOlder = useRef(false)
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearComplete = useCallback(() => {
    if (completeTimer.current) {
      clearTimeout(completeTimer.current)
      completeTimer.current = null
    }
    setComplete(false)
  }, [])

  const flashComplete = useCallback(() => {
    if (completeTimer.current) clearTimeout(completeTimer.current)
    setComplete(true)
    completeTimer.current = setTimeout(() => {
      completeTimer.current = null
      setComplete(false)
    }, COMPANION_COMPLETE_HOLD_MS)
  }, [])

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
      const route = { provider: '', model: '' }
      try {
        const next = await invokeCommand<CompanionStatus>('ensure_companion')
        if (cancelled) return
        route.provider = next.provider
        route.model = next.model
        setStatus(next)
        await Promise.all([loadTail(), refreshBoard(), refreshMemory(), refreshArchives()])
        setShell(await invokeCommand<CompanionShellStatus>('get_companion_shell_status'))
      } catch (reason) {
        if (!cancelled) setError(explainCompanionError(desktopErrorMessage(reason)))
      }
      unlisten = await listenEvent<{
        type?: string
        text?: string
        error?: string
        notice?: string
        input?: string
        requestId?: string
        done?: boolean
      }>('companion-event', event => {
        const payload = event.payload
        if (payload?.type === 'assistant.delta' && payload.text) {
          setStreaming(current => current + payload.text)
          return
        }
        if (payload?.type === 'assistant.settled') {
          setStreaming('')
          setBusy(false)
          flashComplete()
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload?.type === 'session.ready') {
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
              hostRequestId: request.hostRequestId || payload.requestId || '',
              targetTitle: payload.notice || '',
            })
          } catch {
            // Confirmation is parked on the host until the user answers.
          }
        }
        if (payload?.type === 'engine.error') {
          const text = explainCompanionError(payload.error || payload.text, {
            provider: route.provider,
            model: route.model,
          })
          if (text) setError(text)
          setBusy(false)
          clearComplete()
        }
      })
    })()
    return () => {
      cancelled = true
      unlisten?.()
      if (completeTimer.current) {
        clearTimeout(completeTimer.current)
        completeTimer.current = null
      }
    }
  }, [clearComplete, flashComplete, loadTail, refreshArchives, refreshBoard, refreshMemory])

  const send = useCallback(async () => {
    const prompt = draft.trim()
    const pending = [...attachments]
    if ((!prompt && !pending.length) || busy) return
    setBusy(true)
    setError('')
    setDraft('')
    setAttachments([])
    clearComplete()
    try {
      await invokeCommand('send_companion_message', { prompt, attachments: pending })
    } catch (reason) {
      setDraft(prompt)
      setAttachments(pending)
      setError(explainCompanionError(desktopErrorMessage(reason)))
      setBusy(false)
    }
  }, [attachments, busy, clearComplete, draft])

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
    if (!pending) return
    const result = await invokeCommand<CompanionDispatchResult>('confirm_companion_dispatch', {
      action: pending.action,
      conversationId: pending.conversationId,
      text: pending.text,
      idempotencyKey: pending.idempotencyKey,
      mode: pending.mode,
      hostRequestId: pending.hostRequestId,
      accepted,
    })
    if (result.error && accepted) setError(result.error)
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
    attachments,
    setAttachments,
    busy,
    streaming,
    error,
    confirm,
    complete,
    send,
    archive,
    removeArchive,
    approveMemory,
    forgetMemory,
    resolveConfirm,
    setFloatEnabled,
  }
}
