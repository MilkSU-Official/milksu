import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import {
  companionChatHydrateEntry,
  companionChatIsVisibleEntry,
  companionChatPlainText,
  companionHostToolFailure,
  companionLooksLikeDebugPayload,
  companionCredentialMissing,
  companionMissingApiKey,
  companionSidecarDown,
  companionTurnCancelled,
  explainCompanionError,
} from '@/lib/companionUserError'
import {
  companionTurnHasProcess,
  emptyCompanionTurnProcess,
  patchProcessComponent,
  processComponent,
  finiteThinkingDurationMs,
  stampMeasuredThinkingDuration,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { COMPANION_COMPLETE_HOLD_MS } from '@/lib/companionPetMotion'
import {
  mergeCompanionTranscriptTail,
  transcriptHasOutgoing,
} from '@/lib/companionTranscriptTail'
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

function companionStartupQuiet(reason: unknown): boolean {
  return companionMissingApiKey(reason) || companionCredentialMissing(reason) || companionSidecarDown(reason)
}
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

interface CompanionEnginePayload {
  type?: string
  text?: string
  error?: string
  notice?: string
  input?: string
  requestId?: string
  toolName?: string
  toolCallId?: string
  bucket?: string
  durationMs?: number
  done?: boolean
  aborted?: boolean
}

/** Never leak `[object Object]` or structured blobs into tool row detail. */
export function companionToolUserText(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || companionLooksLikeDebugPayload(trimmed) || companionTurnCancelled(trimmed)) {
      return fallback
    }
    return trimmed
  }
  if (Array.isArray(value)) {
    const parts = value.map(item => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        return String((item as { text: string }).text).trim()
      }
      return ''
    }).filter(Boolean)
    return parts.join('\n').trim() || fallback
  }
  if (typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return companionToolUserText((value as { text: string }).text, fallback)
  }
  return fallback
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
  const [liveProcess, setLiveProcess] = useState<CompanionTurnProcess>(emptyCompanionTurnProcess)
  const [settledProcess, setSettledProcess] = useState<CompanionTurnProcess | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<CompanionConfirm | null>(null)
  const [complete, setComplete] = useState(false)
  const loadingOlder = useRef(false)
  const outgoing = useRef<{
    id: string
    prompt: string
    attachments: CodingAttachment[]
  } | null>(null)
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveProcessRef = useRef(liveProcess)
  liveProcessRef.current = liveProcess
  const measuredThinking = useRef<CompanionTurnProcess | null>(null)

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
    const hydrated = (page.entries ?? []).map(companionChatHydrateEntry).filter(companionChatIsVisibleEntry)
    setEntries(current => stampMeasuredThinkingDuration(
      mergeCompanionTranscriptTail(hydrated, current, outgoing.current),
      measuredThinking.current,
    ))
    measuredThinking.current = null
    setPrevCursor(page.prevCursor ?? null)
    setHasMore(Boolean(page.hasMore))
    // Transcript now owns settled thinking/tools; drop the live snapshot.
    setSettledProcess(null)
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
      setEntries(current => [
        ...(page.entries ?? []).map(companionChatHydrateEntry).filter(companionChatIsVisibleEntry),
        ...current,
      ])
      setPrevCursor(page.prevCursor ?? null)
      setHasMore(Boolean(page.hasMore))
    } finally {
      loadingOlder.current = false
    }
  }, [prevCursor])

  const applyLiveEvent = useCallback((payload: CompanionEnginePayload) => {
    const type = String(payload.type ?? '')
    if (type === 'assistant.thinking_started') {
      setLiveProcess(current => {
        const thinking = processComponent(current, 'thinking')
        return patchProcessComponent(current, {
          id: 'thinking',
          kind: 'thinking',
          title: '',
          detail: thinking?.detail ?? '',
          running: true,
          startedAt: Date.now(),
          durationMs: thinking?.durationMs,
        })
      })
      return
    }
    if (type === 'assistant.thinking_delta' && payload.text) {
      const delta = companionToolUserText(payload.text)
      if (!delta) return
      setLiveProcess(current => {
        const thinking = processComponent(current, 'thinking')
        return patchProcessComponent(current, {
          id: 'thinking',
          kind: 'thinking',
          title: '',
          detail: `${thinking?.detail ?? ''}${delta}`,
          running: true,
          startedAt: thinking?.startedAt ?? Date.now(),
          durationMs: thinking?.durationMs,
        })
      })
      return
    }
    if (type === 'assistant.thinking_completed') {
      setLiveProcess(current => {
        const thinking = processComponent(current, 'thinking')
        const segment = finiteThinkingDurationMs(payload.durationMs)
          ?? (thinking?.startedAt != null
            ? Math.max(0, Date.now() - thinking.startedAt)
            : undefined)
        const base = thinking?.running ? (thinking.durationMs ?? 0) : 0
        const total = base + (segment ?? 0)
        return patchProcessComponent(current, {
          id: 'thinking',
          kind: 'thinking',
          title: '',
          detail: companionToolUserText(payload.text, thinking?.detail ?? ''),
          running: false,
          durationMs: total > 0 ? total : thinking?.durationMs,
        })
      })
      return
    }
    if (type === 'assistant.delta' && payload.text) {
      setLiveProcess(current => ({
        ...current,
        reply: `${current.reply}${payload.text}`,
      }))
      return
    }
    if (type === 'decision.recorded') {
      const text = String(payload.text || '').trim()
      if (!text) return
      setLiveProcess(current => patchProcessComponent(current, {
        id: `decision:${payload.bucket || 'route'}`,
        kind: 'decision',
        title: '',
        detail: text,
        running: false,
      }))
      return
    }
    if (type === 'tool.started') {
      const id = String(payload.toolCallId || payload.toolName || `tool:${Date.now()}`)
      const name = String(payload.toolName || 'tool')
      setLiveProcess(current => patchProcessComponent(current, {
        id,
        kind: 'tool',
        title: name,
        detail: companionToolUserText(payload.text, name),
        running: true,
      }))
      return
    }
    if (type === 'tool.completed') {
      const id = String(payload.toolCallId || payload.toolName || '')
      const name = String(payload.toolName || 'tool')
      const detail = companionToolUserText(payload.text, name)
      const rawError = companionToolUserText(payload.error)
      const errorText = rawError ? explainCompanionError(rawError) || rawError : ''
      setLiveProcess(current => patchProcessComponent(current, {
        id: id || `tool:${current.components.length}`,
        kind: 'tool',
        title: name,
        detail: errorText || detail,
        running: false,
        error: errorText || undefined,
      }))
    }
  }, [])

  useEffect(() => {
    if (!hasDesktopRuntime()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      const route = { provider: '', model: '' }
      let ensured = false
      try {
        const next = await invokeCommand<CompanionStatus>('ensure_companion')
        if (cancelled) return
        route.provider = next.provider
        route.model = next.model
        setStatus(next)
        setError('')
        ensured = true
        setShell(await invokeCommand<CompanionShellStatus>('get_companion_shell_status'))
      } catch (reason) {
        const raw = desktopErrorMessage(reason)
        if (!cancelled && !companionStartupQuiet(raw)) {
          setError(explainCompanionError(raw))
        }
      }
      // The error line sits by the composer. A failed ensure must not skip
      // the transcript, or the red line replaces the history.
      if (!cancelled) {
        try {
          await Promise.all([loadTail(), refreshBoard(), refreshMemory(), refreshArchives()])
        } catch (reason) {
          if (ensured && !cancelled) {
            const raw = desktopErrorMessage(reason)
            if (!companionStartupQuiet(raw)) {
              setError(explainCompanionError(raw))
            }
          }
        }
      }
      unlisten = await listenEvent<CompanionEnginePayload>('companion-event', event => {
        const payload = event.payload
        if (!payload?.type) return
        if (
          payload.type === 'assistant.thinking_started'
          || payload.type === 'assistant.thinking_delta'
          || payload.type === 'assistant.thinking_completed'
          || payload.type === 'assistant.delta'
          || payload.type === 'tool.started'
          || payload.type === 'tool.progress'
          || payload.type === 'tool.completed'
          || payload.type === 'decision.recorded'
        ) {
          applyLiveEvent(payload)
          return
        }
        if (payload.type === 'user.message') {
          const text = companionToolUserText(payload.text)
          if (!text || companionLooksLikeDebugPayload(text)) return
          setBusy(true)
          setError('')
          setEntries(current => {
            const pending = outgoing.current
            if (pending && (pending.prompt === text || transcriptHasOutgoing(current, pending))) {
              return current
            }
            const last = current[current.length - 1]
            if (last?.role === 'user' && companionChatPlainText(last) === text) {
              return current
            }
            return [
              ...current,
              {
                id: `live-user:${Date.now()}`,
                type: 'message',
                timestamp: new Date().toISOString(),
                role: 'user',
                text,
              },
            ]
          })
          return
        }
        if (payload.type === 'companion.memory') {
          void refreshMemory()
          return
        }
        if (payload.type === 'memory.recorded') {
          const text = String(payload.text || '').trim()
          if (!text) return
          setEntries(current => {
            let index = -1
            for (let cursor = current.length - 1; cursor >= 0; cursor -= 1) {
              if (current[cursor]?.role === 'assistant') {
                index = cursor
                break
              }
            }
            if (index < 0) return current
            const entry = current[index]
            if (!entry) return current
            if ((entry.components ?? []).some(item => item.kind === 'memory' && item.detail === text)) {
              return current
            }
            const next = current.slice()
            next[index] = {
              ...entry,
              components: [...(entry.components ?? []), { id: 'memory', kind: 'memory', detail: text }],
            }
            return next
          })
          void refreshMemory()
          return
        }
        if (payload.type === 'assistant.settled') {
          const snapshot = liveProcessRef.current
          measuredThinking.current = companionTurnHasProcess(snapshot) ? snapshot : null
          setSettledProcess(measuredThinking.current)
          setLiveProcess(emptyCompanionTurnProcess())
          setBusy(false)
          setConfirm(null)
          if (payload.aborted) {
            // Recover/teardown abort has no user turn — keep the pet quiet.
            if (outgoing.current) {
              setError(explainCompanionError('Request aborted'))
            }
            setEntries(current => {
              const last = current[current.length - 1]
              if (last?.role === 'assistant') {
                const plain = companionChatPlainText(last)
                if (plain || last.error) return current
                return current.map((entry, index) => (
                  index === current.length - 1
                    ? { ...entry, error: 'Request aborted' }
                    : entry
                ))
              }
              return [
                ...current,
                {
                  id: `live-abort:${Date.now()}`,
                  type: 'message',
                  timestamp: new Date().toISOString(),
                  role: 'assistant',
                  error: 'Request aborted',
                },
              ]
            })
          } else {
            // Successful settle (including abort repair) must not leave a sticky
            // 「没法继续了」 that forces archive after the transcript is usable again.
            setError('')
          }
          flashComplete()
          outgoing.current = null
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload.type === 'session.ready') {
          // A settings save restarts the sidecar as the send begins. That
          // ready event used to reload the tail and clear busy, which dropped
          // the user line that had not been flushed yet.
          if (!outgoing.current) {
            setLiveProcess(emptyCompanionTurnProcess())
            setSettledProcess(null)
            setBusy(false)
            setError('')
          }
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload.type === 'companion.confirm' && payload.input) {
          setError('')
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
        if (payload.type === 'engine.error') {
          const rawError = String(payload.error || payload.text || '')
          const text = explainCompanionError(rawError, {
            provider: route.provider,
            model: route.model,
          })
          const working = companionTurnHasProcess(liveProcessRef.current)
          // Empty-reply noise while thinking/tools are visible is not a chat failure.
          const emptyWhileWorking = /这一轮没有回复|did not produce a reply|companion model returned no text/i
            .test(`${text}\n${rawError}`)
            && working
          // Host tool timeout/cancel is an error toolResult. Pi keeps looping;
          // do not clear busy or force Archive even if the tool row has not
          // projected yet.
          if (companionHostToolFailure(rawError) || emptyWhileWorking) {
            return
          }
          if (
            (companionMissingApiKey(rawError) || companionMissingApiKey(text) || companionSidecarDown(rawError) || companionSidecarDown(text))
            && !outgoing.current
          ) {
            setBusy(false)
            return
          }
          if (text) setError(text)
          setBusy(false)
          clearComplete()
          const pending = outgoing.current
          void loadTail().then(() => {
            if (!pending) return
            let restore = false
            setEntries(current => {
              if (transcriptHasOutgoing(current, pending)) {
                outgoing.current = null
                return current
              }
              restore = true
              outgoing.current = null
              return current.filter(entry => entry.id !== pending.id)
            })
            if (restore) {
              setDraft(pending.prompt)
              setAttachments(pending.attachments)
            }
          })
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
  }, [applyLiveEvent, clearComplete, flashComplete, loadTail, refreshArchives, refreshBoard, refreshMemory])

  const send = useCallback(async (override?: string) => {
    const prompt = String(override ?? draft).trim()
    const pending = [...attachments]
    if ((!prompt && !pending.length) || busy) return
    const outgoingId = `pending:${Date.now()}`
    outgoing.current = { id: outgoingId, prompt, attachments: pending }
    setBusy(true)
    setError('')
    setDraft('')
    setAttachments([])
    setLiveProcess(emptyCompanionTurnProcess())
    setSettledProcess(null)
    const outgoingEntry = {
      id: outgoingId,
      type: 'message',
      timestamp: new Date().toISOString(),
      role: 'user',
      text: prompt,
      attachments: pending,
    }
    clearComplete()
    try {
      // Do not ArchiveCompanionTranscript here: orphan tool history is repaired
      // in the sidecar before the next prompt. Forcing a new chat on every
      // recoverable break was wiping usable phone history.
      setEntries(current => [...current, outgoingEntry])
      await invokeCommand('send_companion_message', { prompt, attachments: pending })
    } catch (reason) {
      outgoing.current = null
      setEntries(current => current.filter(entry => entry.id !== outgoingId))
      setDraft(prompt)
      setAttachments(pending)
      setError(explainCompanionError(desktopErrorMessage(reason)))
      setBusy(false)
    }
  }, [attachments, busy, clearComplete, draft])

  const abort = useCallback(async () => {
    if (!busy && !confirm) return
    setConfirm(null)
    setError('')
    try {
      await invokeCommand('abort_companion_turn')
    } catch (reason) {
      setError(explainCompanionError(desktopErrorMessage(reason)))
      setBusy(false)
    }
  }, [busy, confirm])

  const archive = useCallback(async () => {
    try {
      await invokeCommand('archive_companion_transcript')
    } catch (reason) {
      const raw = desktopErrorMessage(reason)
      if (!/sidecar is not running|sidecar stopped|sidecar did not become ready/i.test(raw)) {
        setError(explainCompanionError(raw))
        return
      }
    }
    outgoing.current = null
    setError('')
    setBusy(false)
    setLiveProcess(emptyCompanionTurnProcess())
    setSettledProcess(null)
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
    if (result.error && accepted) setError(explainCompanionError(result.error))
    await refreshBoard()
  }, [confirm, refreshBoard])

  const setFloatEnabled = useCallback(async (enabled: boolean) => {
    setShell(await invokeCommand<CompanionShellStatus>('set_companion_float_enabled', { enabled }))
  }, [])

  const visibleEntries = useMemo(
    () => entries.map(companionChatHydrateEntry).filter(companionChatIsVisibleEntry),
    [entries],
  )
  const streaming = liveProcess.reply
  const liveActive = busy
    || companionTurnHasProcess(liveProcess)
    || Boolean(streaming.trim())

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
    liveProcess,
    settledProcess,
    liveActive,
    error,
    confirm,
    complete,
    send,
    abort,
    archive,
    removeArchive,
    approveMemory,
    forgetMemory,
    resolveConfirm,
    setFloatEnabled,
  }
}
