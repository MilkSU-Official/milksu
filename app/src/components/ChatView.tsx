import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, Conversation, Message } from '../types'
import { ModelSelector } from './ModelSelector'

function ToolMessage({ name, content, status }: { name?: string; content: string; status?: Message['status'] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const preview = content.length > 200 ? `${content.slice(0, 200)}...` : content

  return (
    <div className="overflow-hidden rounded-lg border border-[#e5e5e5]">
      <button
        onClick={() => setExpanded(previous => !previous)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#fafafa]"
      >
        {status === 'running' ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        ) : (
          <svg className="size-3 shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        <span className="text-xs font-medium text-[#555]">{name || t('chat.tool')}</span>
        <svg className={`ml-auto size-3 text-[#999] transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {expanded ? (
        <div className="border-t border-[#eee] px-3 pb-3">
          <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-[#555]">{content}</pre>
        </div>
      ) : content ? (
        <div className="px-3 pb-2">
          <p className="truncate font-mono text-xs text-[#999]">{preview}</p>
        </div>
      ) : null}
    </div>
  )
}

interface Props {
  conversation: Conversation | null
  onSend: (text: string) => void
  onToggleOutput: () => void
  settings: AppSettings | null
  onChangeModel: (provider: string, model: string) => void
  onOpenSettings: () => void
}

export function ChatView({
  conversation,
  onSend,
  onToggleOutput,
  settings,
  onChangeModel,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [conversation?.id])

  const handleSubmit = () => {
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }

  const composer = (placeholder: string) => (
    <div className="rounded-xl bg-[#f5f5f5] px-4 py-3">
      <textarea
        ref={inputRef}
        value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            handleSubmit()
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="min-h-5 max-h-[120px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-[#999]"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <ModelSelector
          settings={settings}
          onChangeModel={onChangeModel}
          onOpenSettings={onOpenSettings}
        />
        <button
          onClick={handleSubmit}
          aria-label={t('chat.send')}
          title={t('chat.send')}
          className="flex size-7 items-center justify-center rounded-full bg-[#1a1a1a] text-white transition-colors hover:bg-[#333]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )

  if (!conversation?.messages.length) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xl px-6">
            <h1 className="mb-6 text-center text-2xl font-medium text-[#1a1a1a]">{t('chat.welcome')}</h1>
            {composer(t('chat.placeholder'))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-[#e5e5e5] px-6">
        <span className="flex-1 truncate text-sm font-medium">{conversation.title}</span>
        <button
          onClick={onToggleOutput}
          className="rounded px-2 py-1 text-xs text-[#888] transition-colors hover:text-[#333]"
        >
          {t('chat.output')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
          {conversation.messages.map(message => (
            <div key={message.id}>
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#f0f0f0] px-4 py-2.5">
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                  </div>
                </div>
              ) : message.role === 'tool' ? (
                <ToolMessage name={message.toolName} content={message.content} status={message.status} />
              ) : (
                <div className="max-w-[85%]">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  {message.status === 'running' && (
                    <span className="mt-1 inline-block animate-pulse text-xs text-amber-500">{t('chat.thinking')}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] p-4">
        <div className="mx-auto max-w-2xl">
          {composer(t('chat.sendMessage'))}
        </div>
      </div>
    </div>
  )
}
