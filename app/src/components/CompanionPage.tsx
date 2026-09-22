import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronLeft, FileText, Plus, Square, X } from 'lucide-react'
import ProgressiveBlur from 'react-progressive-blur'
import companionIdle from '@/assets/companion/idle.png'
import CompanionTurnProcessView from '@/components/CompanionTurnProcessView'
import CompanionPhoneStatusBar from '@/components/CompanionPhoneStatusBar'
import CompanionSettingsPanel from '@/components/CompanionSettingsPanel'
import MarkdownContent from '@/components/MarkdownContent'
import { Button, Textarea } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import { toastError } from '@/lib/appToast'
import { companionChatPieces, type CompanionChatPiece } from '@/lib/companionChatPieces'
import {
  companionChatContinuesRun,
  companionChatEndsRun,
  companionChatIsBubble,
  companionChatIsUser,
  companionChatShowsTimeCaption,
  companionChatShowsTimeDivider,
  companionChatTimestampMs,
  formatCompanionChatStamp,
} from '@/lib/companionChatLayout'
import { cn } from '@/lib/cn'
import {
  companionChatIsVisibleEntry,
  companionChatNeedsNewConversation,
  companionChatPlainText,
  companionMissingApiKey,
  companionTurnCancelled,
  explainCompanionError,
} from '@/lib/companionUserError'
import {
  companionChatRowFingerprint,
  useCompanionChatListMotion,
  type CompanionChatMotionKind,
} from '@/lib/companionChatMotion'
import {
  companionEntryHasProcess,
  companionEntryIsProcessOnly,
  companionTurnHasProcess,
  processFromCompanionEntry,
  withThinkingDuration,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { isComposingKey } from '@/lib/imeComposition'
import {
  companionAttentionText,
  companionPetShowsError,
  resolveCompanionIsland,
} from '@/lib/companionPetMotion'
import {
  encodePickerSelection,
  installAppModelSettings,
  loadModelCatalog,
  useLiveModelCatalog,
} from '@/modelCatalog'
import { applyUiFonts } from '@/lib/uiFonts'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import {
  normalizeCompanionReplyStyle,
  withAppSettingsDefaults,
  type AppSettings,
  type CodingAttachment,
  type CodingAttachmentImport,
  type CodingAttachmentPreview,
  type CompanionSkinResolved,
  type CompanionTranscriptEntry,
} from '@/types'

type CompanionPhoneScreen = 'chat' | 'settings'

type CompanionLogRow = {
  key: string
  fingerprint: string
  kind: CompanionChatMotionKind
  entry?: CompanionTranscriptEntry
  index?: number
  process?: CompanionTurnProcess
  stream?: string
}

function companionChatPreviewEntries(
  t: (zh: string, en: string) => string,
): CompanionTranscriptEntry[] {
  return [
    {
      id: 'preview-user-1',
      type: 'message',
      timestamp: '2026-09-21T14:00:00.000Z',
      role: 'user',
      text: t('下午一起看这段对话动效', 'Let us look at this chat motion this afternoon'),
    },
    {
      id: 'preview-asst-1',
      type: 'message',
      timestamp: '2026-09-21T14:00:08.000Z',
      role: 'assistant',
      text: t(
        '好。新消息会淡入，旧气泡会滑到新位置，不会整表跳切。',
        'Okay. New messages fade in, and older bubbles slide to their new place instead of jumping.',
      ),
    },
    {
      id: 'preview-user-2',
      type: 'message',
      timestamp: '2026-09-21T14:01:00.000Z',
      role: 'user',
      text: t('刷新的时候也不要瞬间消失。', 'Do not vanish instantly when the list refreshes.'),
    },
    {
      id: 'preview-asst-2',
      type: 'message',
      timestamp: '2026-09-21T14:01:10.000Z',
      role: 'assistant',
      text: t(
        '同一条消息更新不会重播入场。离开的气泡会淡出。',
        'Updating the same message does not replay enter. Leaving bubbles fade out.',
      ),
    },
  ]
}

function cloneSettings(value: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(withAppSettingsDefaults(value))) as AppSettings
}

function fitComposer(node: HTMLTextAreaElement | null) {
  if (!node) return
  node.style.height = '0px'
  node.style.height = `${Math.min(Math.max(node.scrollHeight, 22), 72)}px`
}

function attachmentKey(attachment: CodingAttachment) {
  return `${attachment.id}:${attachment.name}`
}

function isImageAttachment(attachment: CodingAttachment) {
  return attachment.mediaType.startsWith('image/')
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function companionConfirmLine(
  confirm: { action: string; text: string; targetTitle: string },
  t: (zh: string, en: string) => string,
) {
  switch (confirm.action) {
    case 'stop':
      return t('终止这个会话的当前回合。', 'Stop the current turn in this conversation.')
    case 'quit':
      return t('退出 MilkSU。', 'Quit MilkSU.')
    case 'relaunch':
      return t('重启 MilkSU。', 'Relaunch MilkSU.')
    case 'patch_settings':
      return confirm.text.trim()
        ? t(`更改这些设置：${confirm.text.trim()}`, `Change these settings: ${confirm.text.trim()}`)
        : t('更改这些设置。', 'Change these settings.')
    case 'speak_many':
      return confirm.text.trim()
        ? t(`把这句插进这些会话：${confirm.text.trim()}`, `Steer these conversations: ${confirm.text.trim()}`)
        : t('把同一句发给这些会话。', 'Send the same instruction to these conversations.')
    default:
      return confirm.text.trim() || confirm.targetTitle.trim()
        || t('把这条指令插入正在进行的回合。', 'Steer the current turn with this instruction.')
  }
}

export default function CompanionPage({
  embedded = false,
  thinkStartedAt = null,
}: {
  embedded?: boolean
  thinkStartedAt?: number | null
}) {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const island = resolveCompanionIsland({
    confirm: Boolean(companion.confirm),
    error: companionPetShowsError(companion.error),
    streaming: Boolean(companion.streaming),
    busy: companion.busy,
    complete: companion.complete,
  })
  const attention = companionAttentionText({
    confirm: companion.confirm,
    error: companion.error,
    t,
  })
  const parentRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsHeadRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToEnd = useRef(true)
  const [screen, setScreen] = useState<CompanionPhoneScreen>('chat')
  const [phoneSettings, setPhoneSettings] = useState<AppSettings | null>(null)
  const [replyStyle, setReplyStyle] = useState<'markdown' | 'chat'>('markdown')
  const [avatar, setAvatar] = useState(companionIdle)
  const [petName, setPetName] = useState('Milk')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [attachError, setAttachError] = useState('')
  const [previewPulse, setPreviewPulse] = useState(false)
  const choosing = useRef(false)
  const previewChat = import.meta.env.DEV && !hasDesktopRuntime()
  const modelCatalog = useLiveModelCatalog(() => ({
    providers: phoneSettings?.providers ?? {},
    relay: phoneSettings?.relay,
  }))
  const modelGroups: SearchableModelGroup[] = modelCatalog.pickerGroups.map(group => ({
    key: group.key,
    label: group.label,
    models: group.models.map(model => ({
      value: encodePickerSelection(group.providerId, model, group.source),
      label: modelCatalog.pickerModelLabel(group, model),
      model,
    })),
  }))
  const liveWorking = companionTurnHasProcess(companion.liveProcess)
  const heldStream = useRef('')
  if (companion.streaming) heldStream.current = companion.streaming
  const streamAbsorbed = companion.entries.some(entry => (
    entry.role === 'assistant'
    && Boolean(heldStream.current)
    && companionChatPlainText(entry) === heldStream.current
  ))
  const streamText = streamAbsorbed ? '' : (companion.streaming || heldStream.current)
  if (streamAbsorbed) heldStream.current = ''
  const typing = (companion.busy && !streamText && !liveWorking) || previewPulse
  const transcript = companion.entries.length || !previewChat
    ? companion.entries
    : companionChatPreviewEntries(t)
  const emptyReplyLabel = t('这一轮没有回复。', 'This turn did not produce a reply.')
  // Only the live error gates 「开新对话」. Historical transcript rows may still
  // carry a past broken-history errorMessage after sidecar repair; scanning them
  // would thrash the archive button forever and push users to wipe usable chat.
  const needsNewChat = companionChatNeedsNewConversation(companion.error)
  const userHasSpoken = companion.entries.some(entry => companionChatIsUser(entry.role))
  const chatError = companionMissingApiKey(companion.error) && !userHasSpoken
    ? ''
    : companion.error
  const logRows = useMemo<CompanionLogRow[]>(() => {
    const rows: CompanionLogRow[] = []
    if (companion.hasMore) {
      rows.push({
        key: 'older',
        fingerprint: companionChatRowFingerprint({ kind: 'older' }),
        kind: 'older',
      })
    }
    transcript.forEach((entry, index) => {
      if (!companionChatIsVisibleEntry(entry)) return
      rows.push({
        key: entry.id,
        fingerprint: companionChatRowFingerprint({
          kind: 'entry',
          role: entry.role,
          text: companionChatPlainText(entry) || entry.error || '',
          processOnly: companionEntryIsProcessOnly(entry),
        }),
        kind: 'entry',
        entry,
        index,
      })
    })
    if (liveWorking) {
      rows.push({
        key: 'live:process',
        fingerprint: companionChatRowFingerprint({ kind: 'live-process' }),
        kind: 'live-process',
        process: companion.liveProcess,
      })
    }
    if (streamText) {
      rows.push({
        key: 'live:stream',
        fingerprint: companionChatRowFingerprint({
          kind: 'live-stream',
          role: 'assistant',
          text: streamText,
        }),
        kind: 'live-stream',
        stream: streamText,
      })
    }
    if (companion.settledProcess && !companion.busy && !liveWorking) {
      rows.push({
        key: 'live:settled',
        fingerprint: companionChatRowFingerprint({ kind: 'live-settled' }),
        kind: 'live-settled',
        process: companion.settledProcess,
      })
    }
    if (typing) {
      rows.push({
        key: 'live:typing',
        fingerprint: companionChatRowFingerprint({ kind: 'live-typing' }),
        kind: 'live-typing',
      })
    }
    return rows
  }, [
    companion.busy,
    companion.hasMore,
    companion.liveProcess,
    companion.settledProcess,
    liveWorking,
    streamText,
    transcript,
    typing,
  ])
  const motionItems = useMemo(
    () => logRows.map(row => ({ key: row.key, fingerprint: row.fingerprint })),
    [logRows],
  )
  const layoutEpoch = [
    companion.confirm ? 'confirm' : '',
    String((companion.memory.pending ?? []).length),
    chatError || attachError || (needsNewChat ? 'new' : ''),
    String(companion.attachments.length),
  ].join(':')
  const listMotion = useCompanionChatListMotion(parentRef, motionItems, layoutEpoch, stickToEnd)
  const rowSnap = useRef(new Map<string, CompanionLogRow>())
  for (const row of logRows) rowSnap.current.set(row.key, row)
  const renderRows: CompanionLogRow[] = [
    ...logRows,
    ...listMotion.leaving
      .map(item => rowSnap.current.get(item.key))
      .filter((row): row is CompanionLogRow => {
        if (!row) return false
        return !logRows.some(live => live.key === row.key)
      }),
  ]

  useEffect(() => {
    if (!previewChat) return undefined
    const onPulse = () => setPreviewPulse(value => !value)
    window.addEventListener('milksu-companion-chat-preview-pulse', onPulse)
    return () => window.removeEventListener('milksu-companion-chat-preview-pulse', onPulse)
  }, [previewChat])

  useEffect(() => {
    if (embedded) return undefined
    document.documentElement.classList.add('companion-chat-surface')
    document.body.classList.add('companion-chat-surface')
    return () => {
      document.documentElement.classList.remove('companion-chat-surface')
      document.body.classList.remove('companion-chat-surface')
    }
  }, [embedded])

  useEffect(() => {
    let cancelled = false
    async function loadSkin(id?: string) {
      try {
        const settings = await invokeCommand<AppSettings>('get_settings')
        const resolved = await invokeCommand<CompanionSkinResolved>('get_companion_skin', {
          id: id || settings.companion_skin_id || 'default',
        })
        const src = resolved?.frames.idle || resolved?.frames.talk || companionIdle
        const name = locale === 'en'
          ? String(resolved?.name?.en || resolved?.name?.zh || 'Milk').trim()
          : String(resolved?.name?.zh || resolved?.name?.en || 'Milk').trim()
        if (!cancelled) {
          setAvatar(src)
          setPetName(name || 'Milk')
        }
      } catch {
        if (!cancelled) {
          setAvatar(companionIdle)
          setPetName('Milk')
        }
      }
    }
    void loadSkin()
    let stop: (() => void) | undefined
    void listenEvent<{ id?: string }>('companion-skin.changed', event => {
      void loadSkin(event.payload?.id)
    }).then(unlisten => {
      stop = unlisten
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [locale])

  useEffect(() => {
    if (!hasDesktopRuntime()) return undefined
    let cancelled = false
    async function loadReplyStyle() {
      try {
        const value = await invokeCommand<AppSettings>('get_settings')
        if (!cancelled) setReplyStyle(normalizeCompanionReplyStyle(value.companion_reply_style))
      } catch {
        // Markdown stays the default until settings load.
      }
    }
    void loadReplyStyle()
    const onFocus = () => { void loadReplyStyle() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (screen !== 'settings') return undefined
    let cancelled = false
    void (async () => {
      try {
        await loadModelCatalog()
        const value = await invokeCommand<AppSettings>('get_settings')
        if (cancelled) return
        const next = cloneSettings(value)
        setPhoneSettings(next)
        setReplyStyle(normalizeCompanionReplyStyle(next.companion_reply_style))
        installAppModelSettings(next)
      } catch (reason) {
        if (!cancelled) {
          toastError(reason, t('设置暂时打不开。', 'Settings could not be opened.'))
          setScreen('chat')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [screen, t])

  useLayoutEffect(() => {
    const chat = chatRef.current
    const title = titleRef.current
    if (!chat || !title) return undefined
    const syncFade = () => {
      const chatTop = chat.getBoundingClientRect().top
      const titleBox = title.getBoundingClientRect()
      // Cover through Milk: mask is shallow at capsule, already strong by avatar.
      chat.style.setProperty('--companion-fade-end', `${Math.max(0, Math.round(titleBox.bottom - chatTop))}px`)
      chat.style.setProperty('--companion-log-pad', `${Math.max(96, Math.round(titleBox.bottom - chatTop + 8))}px`)
    }
    syncFade()
    const observer = new ResizeObserver(syncFade)
    observer.observe(chat)
    observer.observe(title)
    return () => observer.disconnect()
  }, [petName, embedded, screen])

  useLayoutEffect(() => {
    const root = settingsRef.current
    const head = settingsHeadRef.current
    if (!root || !head) return undefined
    const syncFade = () => {
      const chrome = Math.max(0, Math.round(head.getBoundingClientRect().bottom - root.getBoundingClientRect().top))
      root.style.setProperty('--companion-settings-chrome', `${chrome}px`)
      root.style.setProperty('--companion-settings-fade-end', `${chrome + 36}px`)
    }
    syncFade()
    const observer = new ResizeObserver(syncFade)
    observer.observe(root)
    observer.observe(head)
    return () => observer.disconnect()
  }, [screen])

  useEffect(() => {
    fitComposer(inputRef.current)
  }, [companion.draft])

  useEffect(() => {
    const images = new Map<string, CodingAttachment>()
    for (const attachment of companion.attachments) {
      if (isImageAttachment(attachment)) images.set(attachmentKey(attachment), attachment)
    }
    for (const entry of companion.entries) {
      for (const attachment of entry.attachments ?? []) {
        if (isImageAttachment(attachment)) images.set(attachmentKey(attachment), attachment)
      }
    }
    if (!images.size) {
      setThumbs({})
      return
    }
    let cancelled = false
    void Promise.all([...images.values()].map(async attachment => {
      try {
        const preview = await invokeCommand<CodingAttachmentPreview>('preview_coding_attachment', {
          attachment,
        })
        if (preview.kind === 'image' && preview.dataUrl) {
          return [attachmentKey(attachment), preview.dataUrl] as const
        }
      } catch {
        // Keep the filename chip when the stored image cannot be read.
      }
      return null
    })).then(rows => {
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const row of rows) {
        if (row) next[row[0]] = row[1]
      }
      setThumbs(next)
    })
    return () => {
      cancelled = true
    }
  }, [companion.attachments, companion.entries])

  function mergeAttachments(selected: CodingAttachment[]) {
    const merged = new Map(companion.attachments.map(value => [attachmentKey(value), value]))
    for (const attachment of selected) merged.set(attachmentKey(attachment), attachment)
    if (merged.size > 8) {
      setAttachError(t('每条消息最多添加 8 个附件。', 'Each message can have at most 8 attachments.'))
      return
    }
    setAttachError('')
    companion.setAttachments([...merged.values()])
  }

  async function chooseAttachments() {
    if (companion.busy || choosing.current) return
    choosing.current = true
    try {
      mergeAttachments(await invokeCommand<CodingAttachment[]>('choose_coding_attachments'))
    } catch (reason) {
      setAttachError(desktopErrorMessage(reason) || t('暂时无法添加附件。', 'Attachments cannot be added right now.'))
    } finally {
      choosing.current = false
    }
  }

  async function persistPhoneSettings() {
    if (!phoneSettings) return
    const submitted = cloneSettings(phoneSettings)
    setReplyStyle(normalizeCompanionReplyStyle(submitted.companion_reply_style))
    setPhoneSettings(submitted)
    try {
      await invokeCommand('save_settings_cmd', { newSettings: submitted })
      const refreshed = await invokeCommand<AppSettings>('get_settings')
      const next = cloneSettings(refreshed)
      setPhoneSettings(next)
      setReplyStyle(normalizeCompanionReplyStyle(next.companion_reply_style))
      installAppModelSettings(next)
      applyUiFonts({
        uiFont: next.ui_font,
        conversationFont: next.conversation_font,
        uiFontSize: next.ui_font_size,
        conversationFontSize: next.conversation_font_size,
      })
    } catch (reason) {
      toastError(reason, t('设置未保存', 'Settings were not saved'))
      try {
        const refreshed = await invokeCommand<AppSettings>('get_settings')
        setPhoneSettings(cloneSettings(refreshed))
      } catch {
        // Keep the in-memory draft if refresh also fails.
      }
    }
  }

  async function importFiles(files: File[]) {
    if (!files.length || companion.busy) return
    if (companion.attachments.length + files.length > 8) {
      setAttachError(t('每条消息最多添加 8 个附件。', 'Each message can have at most 8 attachments.'))
      return
    }
    try {
      const payloads: CodingAttachmentImport[] = await Promise.all(files.map(async (file, index) => ({
        name: file.name.trim() || `${t('粘贴附件', 'Pasted attachment')}-${index + 1}`,
        mediaType: file.type || 'application/octet-stream',
        dataBase64: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error(t('读取附件失败', 'Failed to read the attachment')))
          reader.onload = () => {
            const result = String(reader.result ?? '')
            const separator = result.indexOf(',')
            if (separator < 0) reject(new Error(t('读取附件失败', 'Failed to read the attachment')))
            else resolve(result.slice(separator + 1))
          }
          reader.readAsDataURL(file)
        }),
      })))
      mergeAttachments(await invokeCommand<CodingAttachment[]>('import_coding_attachments', { payloads }))
    } catch (reason) {
      setAttachError(desktopErrorMessage(reason) || t('暂时无法添加附件。', 'Attachments cannot be added right now.'))
    }
  }

  useLayoutEffect(() => {
    const footer = footerRef.current
    const root = chatRef.current
    const log = parentRef.current
    if (!footer || !root) return
    const apply = () => {
      root.style.setProperty('--companion-footer-space', `${footer.offsetHeight + 12}px`)
      if (log && stickToEnd.current) log.scrollTop = log.scrollHeight
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(footer)
    return () => observer.disconnect()
  }, [screen, layoutEpoch])

  const settingsOpen = screen === 'settings'

  return (
    <main ref={chatRef} className="companion-chat" data-testid="companion-chat" data-reply={replyStyle}>
      <div className="companion-chat-stage" inert={settingsOpen ? true : undefined}>
      <div
        ref={parentRef}
        className="companion-chat-log companion-chat-log-flow"
        onScroll={event => {
          const node = event.currentTarget
          stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
          if (node.scrollTop < 48 && companion.hasMore) void companion.loadOlder()
        }}
      >
        {renderRows.map(row => {
          const motion = listMotion.motionFor(row.key)
          const rowProps = {
            ref: listMotion.bindRow(row.key),
            'data-chat-key': row.key,
            'data-chat-motion': motion,
          }
          if (row.kind === 'older') {
            return (
              <div key={row.key} {...rowProps} className="companion-chat-row">
                <p className="companion-chat-time">{t('更早的对话', 'Earlier messages')}</p>
              </div>
            )
          }
          if (row.kind === 'live-process' && row.process) {
            return (
              <div
                key={row.key}
                {...rowProps}
                className="companion-chat-row companion-chat-row-assistant companion-chat-row-start"
              >
                <CompanionTurnProcessView process={row.process} />
              </div>
            )
          }
          if (row.kind === 'live-stream' && row.stream) {
            return (
              <div
                key={row.key}
                {...rowProps}
                className="companion-chat-row companion-chat-row-assistant companion-chat-row-start"
              >
                <CompanionAssistantBody
                  text={row.stream}
                  replyStyle={replyStyle}
                  streaming
                  t={t}
                />
              </div>
            )
          }
          if (row.kind === 'live-settled' && row.process) {
            return (
              <div
                key={row.key}
                {...rowProps}
                className="companion-chat-row companion-chat-row-assistant companion-chat-row-start"
              >
                <CompanionTurnProcessView
                  process={row.process}
                  foldable
                  defaultOpen={false}
                />
              </div>
            )
          }
          if (row.kind === 'live-typing') {
            return (
              <div
                key={row.key}
                {...rowProps}
                className="companion-chat-row companion-chat-row-assistant companion-chat-row-start"
              >
                <p className="companion-chat-bubble companion-chat-bubble-assistant companion-chat-typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </p>
                <span className="sr-only">{t('正在回复', 'Replying')}</span>
              </div>
            )
          }
          if (!row.entry || row.index == null) return null
          return (
            <CompanionChatEntryArticle
              key={row.key}
              rowProps={rowProps}
              entry={row.entry}
              entryIndex={row.index}
              entries={transcript}
              locale={locale}
              emptyReplyLabel={emptyReplyLabel}
              thumbs={thumbs}
              provider={companion.status.provider}
              model={companion.status.model}
              replyStyle={replyStyle}
              t={t}
            />
          )
        })}
      </div>
      <div className="companion-chat-fade" aria-hidden="true">
        <ProgressiveBlur
          className="companion-chat-fade-progressive"
          position="top"
          intensity={100}
        />
      </div>
      <div className="companion-chat-fade companion-chat-fade-bottom" aria-hidden="true">
        <ProgressiveBlur
          className="companion-chat-fade-progressive"
          position="bottom"
          intensity={100}
        />
      </div>
      <div className="companion-chat-chrome">
        <CompanionPhoneStatusBar
          island={island}
          attention={attention}
          thinkStartedAt={thinkStartedAt}
        />
        <header className="companion-chat-head">
          <button
            type="button"
            className="companion-chat-icon companion-glass"
            aria-label={t('关闭对话', 'Close chat')}
            title={t('关闭对话', 'Close chat')}
            onClick={() => void invokeCommand('hide_companion_chat_window', { locale })}
          >
            <ChevronLeft className="size-5" strokeWidth={2.4} />
          </button>
          <div className="companion-chat-identity">
            <button
              type="button"
              className="companion-chat-avatar-btn"
              aria-label={t('看板娘设置', 'Companion settings')}
              title={t('看板娘设置', 'Companion settings')}
              onClick={() => setScreen('settings')}
            >
              <img key={avatar} className="companion-chat-avatar" src={avatar} alt="" draggable={false} />
            </button>
            <button
              ref={titleRef}
              type="button"
              className="companion-chat-title companion-glass"
              aria-label={t('看板娘设置', 'Companion settings')}
              title={t('看板娘设置', 'Companion settings')}
              onClick={() => setScreen('settings')}
            >
              {petName}
            </button>
          </div>
        </header>
      </div>
      <div ref={footerRef} className="companion-chat-footer">
      {(companion.memory.pending ?? []).length || companion.confirm ? (
        <div className="companion-chat-dock">
          {(companion.memory.pending ?? []).map(item => (
            <div key={item.id} className="companion-chat-memory">
              <p>{item.title}</p>
              <Button size="sm" className="h-7" onClick={() => void companion.approveMemory(item.id)}>
                {t('批准', 'Approve')}
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => void companion.forgetMemory(item.id)}>
                {t('忘掉', 'Forget')}
              </Button>
            </div>
          ))}
          {companion.confirm ? (
            <div className="companion-chat-confirm">
              <p>{companionConfirmLine(companion.confirm, t)}</p>
              <div className="companion-chat-confirm-actions">
                <Button size="sm" variant="outline" className="h-7" onClick={() => void companion.resolveConfirm(false)}>
                  {t('取消', 'Cancel')}
                </Button>
                <Button size="sm" className="h-7" onClick={() => void companion.resolveConfirm(true)}>
                  {t('确认', 'Confirm')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="companion-chat-composer">
        {chatError || attachError || needsNewChat ? (
          <div className="companion-chat-error-row">
            <p className="companion-chat-error">
              {chatError || attachError || t('这段对话没法继续了。', 'This chat can\'t continue.')}
            </p>
            {needsNewChat ? (
              <Button
                type="button"
                size="sm"
                className="h-7 shrink-0"
                disabled={companion.busy}
                onClick={() => void companion.archive().catch(reason => {
                  setAttachError(explainCompanionError(desktopErrorMessage(reason)))
                })}
              >
                {t('开新对话', 'New chat')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {companion.attachments.length ? (
          <div className="companion-chat-attach-list" aria-label={t('待发送附件', 'Attachments to send')}>
            {companion.attachments.map(attachment => {
              const key = attachmentKey(attachment)
              const thumb = thumbs[key]
              return (
                <span key={key} className="companion-chat-attach-chip" title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}>
                  {isImageAttachment(attachment) && thumb ? (
                    <img src={thumb} alt={attachment.name} />
                  ) : (
                    <>
                      <FileText className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{attachment.name}</span>
                    </>
                  )}
                  <button
                    type="button"
                    className="companion-chat-attach-remove"
                    aria-label={t(`移除 ${attachment.name}`, `Remove ${attachment.name}`)}
                    onClick={() => companion.setAttachments(
                      companion.attachments.filter(item => attachmentKey(item) !== key),
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )
            })}
          </div>
        ) : null}
        <div className="companion-chat-compose-row">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="companion-chat-attach"
            disabled={companion.busy}
            aria-label={t('添加附件', 'Add attachment')}
            title={t('添加本机文件或图片', 'Add a local file or image')}
            onClick={() => void chooseAttachments()}
          >
            <Plus className="size-4" />
          </Button>
          <div
            className="companion-chat-well companion-glass companion-glass-field"
            onDragOver={event => {
              if (![...event.dataTransfer.types].includes('Files')) return
              event.preventDefault()
            }}
            onDrop={event => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              void importFiles([...event.dataTransfer.files])
            }}
          >
            <Textarea
              ref={inputRef}
              className="companion-chat-input min-h-0 max-h-[72px] flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-transparent"
              value={companion.draft}
              placeholder={t('发消息', 'Message')}
              onChange={event => companion.setDraft(event.target.value)}
              onPaste={event => {
                const files = [...event.clipboardData.files]
                if (!files.length) return
                event.preventDefault()
                void importFiles(files)
              }}
              onKeyDown={event => {
                if (isComposingKey(event.nativeEvent)) return
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void companion.send()
                }
              }}
              aria-label={t('看板娘输入', 'Companion message')}
            />
            <Button
              type="button"
              variant={companion.busy ? 'destructive' : 'brand'}
              size="icon"
              className="companion-chat-send"
              disabled={!companion.busy && (!companion.draft.trim() && !companion.attachments.length)}
              aria-label={companion.busy ? t('停止', 'Stop') : t('发送', 'Send')}
              title={companion.busy ? t('停止当前回合', 'Stop this turn') : t('发送', 'Send')}
              onClick={() => {
                if (companion.busy) {
                  void companion.abort()
                  return
                }
                void companion.send()
              }}
            >
              {companion.busy
                ? <Square className="size-3.5 fill-current" />
                : <ArrowUp className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
      </div>
      </div>
      <div
        ref={settingsRef}
        className={cn('companion-phone-settings', settingsOpen && 'is-open')}
        data-testid="companion-phone-settings"
        inert={settingsOpen ? undefined : true}
        aria-hidden={settingsOpen ? undefined : true}
      >
        <div className="companion-phone-settings-sheet">
          <div className="companion-phone-settings-pane" aria-hidden="true" />
          <div className="companion-phone-settings-scroll">
            <CompanionSettingsPanel
              settings={phoneSettings}
              groups={modelGroups}
              presentation="phone"
              onPersist={() => void persistPhoneSettings()}
            />
          </div>
          <div className="companion-chat-fade" aria-hidden="true">
            <ProgressiveBlur
              className="companion-chat-fade-progressive"
              position="top"
              intensity={100}
            />
            <div className="companion-settings-fade-hold" />
          </div>
          <div className="companion-chat-chrome">
            <CompanionPhoneStatusBar
              island={island}
              attention={attention}
              thinkStartedAt={thinkStartedAt}
            />
            <header ref={settingsHeadRef} className="companion-phone-settings-head">
              <button
                type="button"
                className="companion-chat-icon companion-glass"
                aria-label={t('返回对话', 'Back to chat')}
                title={t('返回对话', 'Back to chat')}
                onClick={() => setScreen('chat')}
              >
                <ChevronLeft className="size-5" strokeWidth={2.4} />
              </button>
              <p className="companion-phone-settings-title">
                {t('看板娘设置', 'Companion settings')}
              </p>
            </header>
          </div>
        </div>
      </div>
    </main>
  )
}

function CompanionChatNote({ title, text }: { title: string; text: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const preview = text.replace(/^#{1,6}\s+/gm, '').trim()
  return (
    <div className="companion-chat-note">
      <button
        type="button"
        className="companion-chat-note-toggle active:scale-[0.97]"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-[length:var(--text-caption)] text-muted-foreground">
          {open ? t('收起', 'Hide') : t('展开', 'Show')}
        </span>
      </button>
      {open ? (
        <MarkdownContent className="companion-chat-note-body" content={text} compact />
      ) : (
        <p className="companion-chat-note-preview">{preview}</p>
      )}
    </div>
  )
}

function CompanionAssistantBody({
  text,
  replyStyle,
  streaming = false,
  t,
}: {
  text: string
  replyStyle: 'markdown' | 'chat'
  streaming?: boolean
  t: (zh: string, en: string) => string
}) {
  const pieces = companionChatPieces(text, replyStyle)
  if (replyStyle !== 'chat' || pieces.length === 0) {
    return (
      <div className="companion-chat-bubble companion-chat-bubble-assistant">
        <MarkdownContent
          className="companion-chat-bubble-text"
          content={text}
          compact
          streaming={streaming}
        />
      </div>
    )
  }
  return (
    <div className="companion-chat-stack">
      {pieces.map((piece, index) => (
        <CompanionChatPieceView key={`${piece.kind}:${index}`} piece={piece} streaming={streaming} t={t} />
      ))}
    </div>
  )
}

function CompanionChatPieceView({
  piece,
  streaming,
  t,
}: {
  piece: CompanionChatPiece
  streaming?: boolean
  t: (zh: string, en: string) => string
}) {
  if (piece.kind === 'note') {
    return <CompanionChatNote title={piece.title || t('笔记', 'Note')} text={piece.text} />
  }
  return (
    <div className="companion-chat-bubble companion-chat-bubble-assistant">
      <MarkdownContent
        className="companion-chat-bubble-text"
        content={piece.text}
        compact
        streaming={streaming}
      />
    </div>
  )
}

function CompanionChatEntryArticle({
  rowProps,
  entry,
  entryIndex,
  entries,
  locale,
  emptyReplyLabel,
  thumbs,
  provider,
  model,
  replyStyle,
  t,
}: {
  rowProps: {
    ref: (node: HTMLElement | null) => void
    'data-chat-key': string
    'data-chat-motion': 'enter' | 'leave' | undefined
  }
  entry: CompanionTranscriptEntry
  entryIndex: number
  entries: CompanionTranscriptEntry[]
  locale: 'zh' | 'en'
  emptyReplyLabel: string
  thumbs: Record<string, string>
  provider?: string
  model?: string
  replyStyle: 'markdown' | 'chat'
  t: (zh: string, en: string) => string
}) {
  const previous = entries[entryIndex - 1]
  const next = entries[entryIndex + 1]
  const currentMs = companionChatTimestampMs(entry.timestamp)
  const nextMs = companionChatTimestampMs(next?.timestamp)
  const isLast = entryIndex === entries.length - 1
  const showDivider = companionChatShowsTimeDivider(
    currentMs,
    companionChatTimestampMs(previous?.timestamp),
  )
  const continuesRun = companionChatContinuesRun(entry, previous)
  const endsRun = companionChatEndsRun({
    currentMs,
    nextMs,
    currentRole: entry.role,
    nextRole: next?.role,
    isLast,
  })
  const showCaption = companionChatShowsTimeCaption({
    currentMs,
    nextMs,
    currentRole: entry.role,
    nextRole: next?.role,
    showDivider,
    isLast,
  })
  const stamp = formatCompanionChatStamp(entry.timestamp, locale)
  const user = companionChatIsUser(entry.role)
  const bubble = companionChatIsBubble(entry.role)
  const processOnly = companionEntryIsProcessOnly(entry)
  const timed = withThinkingDuration(entry, companionChatTimestampMs(previous?.timestamp) || undefined)
  const entryProcess = companionEntryHasProcess(timed)
    ? processFromCompanionEntry(timed)
    : null
  const plain = companionChatPlainText(entry)
  const errorContext = { provider, model }
  const abortSource = entry.error || entry.text
  const showEmptyReply = entry.role === 'assistant'
    && !plain
    && !processOnly
    && !(entry.attachments?.length)
    && (!entry.error || /companion model returned no text/i.test(entry.error))
    && !companionTurnCancelled(abortSource)
  const body = companionTurnCancelled(abortSource) && !processOnly
    ? explainCompanionError(abortSource || 'Request aborted', errorContext)
    : entry.error && !showEmptyReply && !processOnly
      ? explainCompanionError(entry.error, errorContext)
      : (plain || (showEmptyReply ? emptyReplyLabel : ''))
  const sent = entry.attachments ?? []
  const visibleBody = body || (
    entry.role === 'assistant' && !processOnly && !sent.length
      ? emptyReplyLabel
      : ''
  )
  const chatBody = !user
    && replyStyle === 'chat'
    && Boolean(visibleBody)
    && !entry.error
    && !showEmptyReply
    && !companionTurnCancelled(abortSource)
  if (processOnly) {
    return (
      <article
        {...rowProps}
        className="companion-chat-row companion-chat-row-assistant companion-chat-row-start"
      >
        <CompanionTurnProcessView
          process={entryProcess!}
          foldable
          defaultOpen={false}
        />
      </article>
    )
  }
  if (!visibleBody && !sent.length) return null
  return (
    <article
      {...rowProps}
      className={cn(
        'companion-chat-row',
        user ? 'companion-chat-row-user' : 'companion-chat-row-assistant',
        !bubble && 'companion-chat-row-system',
        continuesRun ? 'companion-chat-row-continue' : 'companion-chat-row-start',
        !endsRun && 'companion-chat-row-open',
        showDivider && 'companion-chat-row-divided',
      )}
    >
      {showDivider && stamp ? <p className="companion-chat-time">{stamp}</p> : null}
      {entryProcess && entry.role === 'assistant' ? (
        <CompanionTurnProcessView
          process={entryProcess}
          foldable
          defaultOpen={false}
        />
      ) : null}
      {chatBody ? (
        <div className="companion-chat-stack">
          {sent.length ? (
            <div className="companion-chat-bubble-attach" aria-label={t('消息附件', 'Message attachments')}>
              {sent.map(attachment => {
                const key = attachmentKey(attachment)
                const thumb = thumbs[key]
                return (
                  <span
                    key={key}
                    className="companion-chat-bubble-file"
                    title={`${attachment.name}${attachment.size ? ` · ${formatAttachmentSize(attachment.size)}` : ''}`}
                  >
                    {isImageAttachment(attachment) && thumb ? (
                      <img src={thumb} alt={attachment.name} />
                    ) : (
                      <>
                        <FileText className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{attachment.name}</span>
                      </>
                    )}
                  </span>
                )
              })}
            </div>
          ) : null}
          <CompanionAssistantBody text={visibleBody} replyStyle="chat" t={t} />
        </div>
      ) : bubble ? (
        <div className={cn(
          'companion-chat-bubble',
          user ? 'companion-chat-bubble-user' : 'companion-chat-bubble-assistant',
          sent.length && 'companion-chat-bubble-files',
        )}>
          {sent.length ? (
            <div className="companion-chat-bubble-attach" aria-label={t('消息附件', 'Message attachments')}>
              {sent.map(attachment => {
                const key = attachmentKey(attachment)
                const thumb = thumbs[key]
                return (
                  <span
                    key={key}
                    className="companion-chat-bubble-file"
                    title={`${attachment.name}${attachment.size ? ` · ${formatAttachmentSize(attachment.size)}` : ''}`}
                  >
                    {isImageAttachment(attachment) && thumb ? (
                      <img src={thumb} alt={attachment.name} />
                    ) : (
                      <>
                        <FileText className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{attachment.name}</span>
                      </>
                    )}
                  </span>
                )
              })}
            </div>
          ) : null}
          {visibleBody ? (
            entry.error || showEmptyReply || companionTurnCancelled(abortSource) ? (
              <p className="companion-chat-bubble-text companion-chat-bubble-text-plain">{visibleBody}</p>
            ) : (
              <MarkdownContent
                className="companion-chat-bubble-text"
                content={visibleBody}
                compact
              />
            )
          ) : null}
        </div>
      ) : (
        <p className="companion-chat-system">{visibleBody}</p>
      )}
      {showCaption && stamp ? <p className="companion-chat-stamp">{stamp}</p> : null}
    </article>
  )
}
