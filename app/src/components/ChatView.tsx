import { useState, useRef, useEffect } from 'react'
import type { Conversation, AppSettings, Message } from '../types'
import { ModelSelector } from './ModelSelector'

function ToolMessage({ name, content, status }: { name?: string; content: string; status?: Message['status'] }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.length > 200 ? content.slice(0, 200) + '...' : content

  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#fafafa] transition-colors"
      >
        {status === 'running' ? (
          <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
        ) : (
          <svg className="w-3 h-3 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
        <span className="text-xs font-medium text-[#555]">{name || 'tool'}</span>
        <svg className={`w-3 h-3 text-[#999] ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {expanded ? (
        <div className="px-3 pb-3 border-t border-[#eee]">
          <pre className="text-xs font-mono text-[#555] whitespace-pre-wrap mt-2 max-h-80 overflow-y-auto">{content}</pre>
        </div>
      ) : content ? (
        <div className="px-3 pb-2">
          <p className="text-xs text-[#999] font-mono truncate">{preview}</p>
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

const quickActions = [
  { label: 'Scan a target' },
  { label: 'Connect browser' },
  { label: 'Start a CTF' },
  { label: 'Generate report' },
]

export function ChatView({ conversation, onSend, onToggleOutput, settings, onChangeModel, onOpenSettings }: Props) {
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

  const hasMessages = conversation && conversation.messages.length > 0

  const modelSelector = (
    <ModelSelector
      settings={settings}
      onChangeModel={onChangeModel}
      onOpenSettings={onOpenSettings}
    />
  )

  if (!hasMessages) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-xl px-6">
            <h1 className="text-2xl font-medium text-center mb-8 text-[#1a1a1a]">What should we do?</h1>

            <div className="bg-[#f5f5f5] rounded-xl px-4 py-3 mb-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder="Type anything..."
                rows={1}
                className="w-full bg-transparent text-sm resize-none outline-none placeholder-[#999] min-h-[20px] max-h-[120px]"
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                {modelSelector}
                <button
                  onClick={handleSubmit}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-1">
              {quickActions.map(action => (
                <button
                  key={action.label}
                  onClick={() => onSend(action.label)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#555] hover:bg-[#f5f5f5] rounded-lg transition-colors text-left"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="h-14 flex items-center px-6 border-b border-[#e5e5e5]">
        <span className="text-sm font-medium flex-1 truncate">{conversation!.title}</span>
        <button
          onClick={onToggleOutput}
          className="text-xs text-[#888] hover:text-[#333] px-2 py-1 rounded transition-colors"
        >
          Output
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
          {conversation!.messages.map(msg => (
            <div key={msg.id}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-[#f0f0f0] rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%]">
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : msg.role === 'tool' ? (
                <ToolMessage name={msg.toolName} content={msg.content} status={msg.status} />
              ) : (
                <div className="max-w-[85%]">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  {msg.status === 'running' && (
                    <span className="inline-block mt-1 text-xs text-amber-500 animate-pulse">thinking...</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[#f5f5f5] rounded-xl px-4 py-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Send a message..."
              rows={1}
              className="w-full bg-transparent text-sm resize-none outline-none placeholder-[#999] min-h-[20px] max-h-[120px]"
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              {modelSelector}
              <button
                onClick={handleSubmit}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
