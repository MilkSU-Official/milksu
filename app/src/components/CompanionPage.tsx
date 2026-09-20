import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ChevronLeft, FileText, Plus, X } from 'lucide-react'
import companionIdle from '@/assets/companion/idle.png'
import { Button, Textarea } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { desktopErrorMessage, invokeCommand, listenEvent } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
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
import { companionChatVisibleText, explainCompanionError } from '@/lib/companionUserError'
import { isComposingKey } from '@/lib/imeComposition'
import type {
  AppSettings,
  CodingAttachment,
  CodingAttachmentImport,
  CodingAttachmentPreview,
  CompanionSkinResolved,
} from '@/types'

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

export default function CompanionPage({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const parentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToEnd = useRef(true)
  const [avatar, setAvatar] = useState(companionIdle)
  const [petName, setPetName] = useState('Milk')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [attachError, setAttachError] = useState('')
  const choosing = useRef(false)
  const olderOffset = companion.hasMore ? 1 : 0
  const typing = companion.busy && !companion.streaming
  const virtualizer = useVirtualizer({
    count: companion.entries.length + olderOffset,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
    getItemKey: index => {
      if (companion.hasMore && index === 0) return 'older'
      return companion.entries[index - olderOffset]?.id ?? index
    },
  })

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

  useEffect(() => {
    if (!stickToEnd.current || companion.entries.length === 0) return
    virtualizer.scrollToIndex(companion.entries.length + olderOffset - 1, {
      align: 'end',
    })
  }, [companion.entries, olderOffset, typing, virtualizer])

  return (
    <main className="companion-chat" data-testid="companion-chat">
      <header className="companion-chat-head">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="companion-chat-icon size-7"
          aria-label={t('关闭对话', 'Close chat')}
          title={t('关闭对话', 'Close chat')}
          onClick={() => void invokeCommand('hide_companion_chat_window', { locale })}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="companion-chat-identity">
          <img className="companion-chat-avatar" src={avatar} alt="" draggable={false} />
          <p className="companion-chat-title">{petName}</p>
        </div>
      </header>
      <div
        ref={parentRef}
        className="companion-chat-log"
        onScroll={event => {
          const node = event.currentTarget
          stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
          if (node.scrollTop < 48 && companion.hasMore) void companion.loadOlder()
        }}
      >
        {companion.entries.length === 0 ? null : (
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map(item => {
              if (companion.hasMore && item.index === 0) {
                return (
                  <div
                    key={item.key}
                    className="companion-chat-time absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {t('更早的对话', 'Earlier messages')}
                  </div>
                )
              }
              const entryIndex = item.index - olderOffset
              const entry = companion.entries[entryIndex]
              if (!entry) return null
              const previous = companion.entries[entryIndex - 1]
              const next = companion.entries[entryIndex + 1]
              const currentMs = companionChatTimestampMs(entry.timestamp)
              const nextMs = companionChatTimestampMs(next?.timestamp)
              const isLast = entryIndex === companion.entries.length - 1
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
              const raw = companionChatVisibleText(entry)
              const body = entry.error
                ? explainCompanionError(entry.error, {
                    provider: companion.status.provider,
                    model: companion.status.model,
                  })
                : raw
              const sent = entry.attachments ?? []
              if (!body && !sent.length) return null
              return (
                <article
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'companion-chat-row absolute left-0 top-0 w-full',
                    user ? 'companion-chat-row-user' : 'companion-chat-row-assistant',
                    !bubble && 'companion-chat-row-system',
                    continuesRun ? 'companion-chat-row-continue' : 'companion-chat-row-start',
                    !endsRun && 'companion-chat-row-open',
                    showDivider && 'companion-chat-row-divided',
                  )}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {showDivider && stamp ? <p className="companion-chat-time">{stamp}</p> : null}
                  {bubble ? (
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
                      {body ? <p className="companion-chat-bubble-text">{body}</p> : null}
                    </div>
                  ) : (
                    <p className="companion-chat-system">{body}</p>
                  )}
                  {showCaption && stamp ? <p className="companion-chat-stamp">{stamp}</p> : null}
                </article>
              )
            })}
          </div>
        )}
        {typing ? (
          <div className="companion-chat-row companion-chat-row-assistant companion-chat-row-start">
            <p className="companion-chat-bubble companion-chat-bubble-assistant companion-chat-typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </p>
            <span className="sr-only">{t('正在回复', 'Replying')}</span>
          </div>
        ) : null}
      </div>
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
              <p>
                {companion.confirm.action === 'stop'
                  ? t('终止这个会话的当前回合。', 'Stop the current turn in this conversation.')
                  : companion.confirm.text.trim() || companion.confirm.targetTitle.trim()
                    || t('把这条指令插入正在进行的回合。', 'Steer the current turn with this instruction.')}
              </p>
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
        {companion.error || attachError ? (
          <p className="companion-chat-error">{companion.error || attachError}</p>
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
            className="companion-chat-well"
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
              aria-label={t('桌宠输入', 'Companion message')}
            />
            <Button
              type="button"
              variant="brand"
              size="icon"
              className="companion-chat-send"
              disabled={companion.busy || (!companion.draft.trim() && !companion.attachments.length)}
              aria-label={companion.busy ? t('排队', 'Queue') : t('发送', 'Send')}
              title={companion.busy ? t('排队', 'Queue') : t('发送', 'Send')}
              onClick={() => void companion.send()}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
