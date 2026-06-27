import { useState, useRef, useEffect } from 'react'
import type { AppSettings } from '../types'
import { PROVIDERS } from '../types'

interface Props {
  settings: AppSettings | null
  onChangeModel: (provider: string, model: string) => void
  onOpenSettings: () => void
}

export function ModelSelector({ settings, onChangeModel, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!settings) return null

  const currentProvider = PROVIDERS.find(p => p.id === settings.active_provider)
  const label = settings.active_model || 'Select model'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#333] px-2 py-1 rounded-md hover:bg-[#eee] transition-colors"
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-white border border-[#e5e5e5] rounded-lg shadow-lg overflow-hidden z-50">
          <div className="max-h-64 overflow-y-auto">
            {PROVIDERS.map(p => {
              const providerConfig = settings.providers[p.id]
              const hasKey = providerConfig?.api_key && providerConfig.enabled
              return (
                <div key={p.id}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#999] bg-[#fafafa] flex items-center justify-between">
                    <span>{p.name}</span>
                    {!hasKey && <span className="text-[#ccc]">No key</span>}
                  </div>
                  {p.models.map(m => (
                    <button
                      key={m}
                      onClick={() => { onChangeModel(p.id, m); setOpen(false) }}
                      disabled={!hasKey}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        settings.active_provider === p.id && settings.active_model === m
                          ? 'bg-[#f0f0f0] font-medium'
                          : hasKey
                            ? 'hover:bg-[#f5f5f5]'
                            : 'text-[#ccc] cursor-not-allowed'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
          <div className="border-t border-[#eee]">
            <button
              onClick={() => { onOpenSettings(); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs text-[#888] hover:bg-[#f5f5f5] transition-colors"
            >
              Configure API keys...
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
