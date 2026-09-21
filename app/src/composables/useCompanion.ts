import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import {
  companionChatHydrateEntry,
  companionChatNeedsNewConversation,
  explainCompanionError,
} from '@/lib/companionUserError'
import {
  companionTurnHasProcess,
  emptyCompanionTurnProcess,
  type CompanionProcessTool,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
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

function attachmentKeys(attachments: CodingAttachment[] | undefined) {
  return (attachments ?? [])
    .map(item => `${item.sha256 || item.id}:${item.name}`)
    .filter(Boolean)
    .sort()
    .join('|')
}

function transcriptHasOutgoing(
  entries: CompanionTranscriptEntry[],
  pending: { id: string; prompt: string; attachments: CodingAttachment[] },
) {
  return entries.some(entry => {
    if (entry.id === pending.id || entry.role !== 'user') return entry.id === pending.id
    if (pending.attachments.length && attachmentKeys(entry.attachments) === attachmentKeys(pending.attachments)) {
      return true
    }
    return Boolean(pending.prompt) && String(entry.text ?? '').includes(pending.prompt)
  })
}

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
  durationMs?: number
  done?: boolean
}

function upsertTool(
  tools: CompanionProcessTool[],
  next: CompanionProcessTool,
): CompanionProcessTool[] {
  const index = tools.findIndex(item => item.id === next.id)
  if (index < 0) return [...tools, next]
  const copy = tools.slice()
  copy[index] = { ...copy[index], ...next }
  return copy
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
    setEntries((page.entries ?? []).map(companionChatHydrateEntry))
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
      setEntries(current => [...(page.entries ?? []).map(companionChatHydrateEntry), ...current])
      setPrevCursor(page.prevCursor ?? null)
      setHasMore(Boolean(page.hasMore))
    } finally {
      loadingOlder.current = false
    }
  }, [prevCursor])

  const applyLiveEvent = useCallback((payload: CompanionEnginePayload) => {
    const type = String(payload.type ?? '')
    if (type === 'assistant.thinking_started') {
      setLiveProcess(current => ({ ...current, thinkingRunning: true }))
      return
    }
    if (type === 'assistant.thinking_delta' && payload.text) {
      setLiveProcess(current => ({
        ...current,
        thinking: `${current.thinking}${payload.text}`,
        thinkingRunning: true,
      }))
      return
    }
    if (type === 'assistant.thinking_completed') {
      setLiveProcess(current => ({
        ...current,
        thinking: String(payload.text ?? current.thinking),
        thinkingRunning: false,
        thinkingDurationMs: payload.durationMs ?? current.thinkingDurationMs,
      }))
      return
    }
    if (type === 'assistant.delta' && payload.text) {
      setLiveProcess(current => ({
        ...current,
        reply: `${current.reply}${payload.text}`,
      }))
      return
    }
    if (type === 'tool.started') {
      const id = String(payload.toolCallId || payload.toolName || `tool:${Date.now()}`)
      const name = String(payload.toolName || 'tool')
      setLiveProcess(current => ({
        ...current,
        thinkingRunning: false,
        tools: upsertTool(current.tools, {
          id,
          name,
          detail: String(payload.text || name),
          running: true,
        }),
      }))
      return
    }
    if (type === 'tool.completed') {
      const id = String(payload.toolCallId || payload.toolName || '')
      setLiveProcess(current => ({
        ...current,
        tools: upsertTool(current.tools, {
          id: id || `tool:${current.tools.length}`,
          name: String(payload.toolName || 'tool'),
          detail: String(payload.text || payload.toolName || 'tool'),
          running: false,
          error: payload.error,
        }),
      }))
    }
  }, [])

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
        ) {
          applyLiveEvent(payload)
          return
        }
        if (payload.type === 'assistant.settled') {
          const snapshot = liveProcessRef.current
          setSettledProcess(companionTurnHasProcess(snapshot) ? snapshot : null)
          setLiveProcess(emptyCompanionTurnProcess())
          setBusy(false)
          flashComplete()
          outgoing.current = null
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload.type === 'session.ready') {
          setLiveProcess(emptyCompanionTurnProcess())
          setSettledProcess(null)
          setBusy(false)
          void loadTail()
          void refreshBoard()
          void refreshMemory()
          return
        }
        if (payload.type === 'companion.confirm' && payload.input) {
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
          const text = explainCompanionError(payload.error || payload.text, {
            provider: route.provider,
            model: route.model,
          })
          // Empty-reply noise while thinking/tools are visible is not a chat failure.
          const emptyWhileWorking = /这一轮没有回复|did not produce a reply|companion model returned no text/i
            .test(`${text}\n${payload.error || ''}`)
            && companionTurnHasProcess(liveProcessRef.current)
          if (text && !emptyWhileWorking) setError(text)
          if (emptyWhileWorking) {
            return
          }
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

  const send = useCallback(async () => {
    const prompt = draft.trim()
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
      if (companionChatNeedsNewConversation(error)) {
        await invokeCommand('archive_companion_transcript')
      }
      setEntries(current => companionChatNeedsNewConversation(error)
        ? [outgoingEntry]
        : [...current, outgoingEntry])
      await invokeCommand('send_companion_message', { prompt, attachments: pending })
    } catch (reason) {
      outgoing.current = null
      setEntries(current => current.filter(entry => entry.id !== outgoingId))
      setDraft(prompt)
      setAttachments(pending)
      setError(explainCompanionError(desktopErrorMessage(reason)))
      setBusy(false)
    }
  }, [attachments, busy, clearComplete, draft, error])

  const archive = useCallback(async () => {
    await invokeCommand('archive_companion_transcript')
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
    if (result.error && accepted) setError(result.error)
    await refreshBoard()
  }, [confirm, refreshBoard])

  const setFloatEnabled = useCallback(async (enabled: boolean) => {
    setShell(await invokeCommand<CompanionShellStatus>('set_companion_float_enabled', { enabled }))
  }, [])

  const visibleEntries = useMemo(() => entries.map(companionChatHydrateEntry), [entries])
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
    archive,
    removeArchive,
    approveMemory,
    forgetMemory,
    resolveConfirm,
    setFloatEnabled,
  }
}
