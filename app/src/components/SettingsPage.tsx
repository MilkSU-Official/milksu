import React, { useState } from 'react'
import { invokeCommand } from '../tauri'
import type { AppSettings, ProviderConfig, Conversation } from '../types'
import { PROVIDERS } from '../types'

type Category = 'general' | 'apikeys' | 'usage' | 'about'

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
      </svg>
    ),
  },
  {
    id: 'usage',
    label: 'Usage',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20V10"/>
        <path d="M12 20V4"/>
        <path d="M6 20v-6"/>
      </svg>
    ),
  },
  {
    id: 'about',
    label: 'About',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    ),
  },
]

interface Props {
  settings: AppSettings | null
  onSettingsChange: (s: AppSettings) => void
  onClose: () => void
  conversations: Conversation[]
}

export function SettingsPage({ settings, onSettingsChange, onClose, conversations }: Props) {
  const [category, setCategory] = useState<Category>('general')
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  if (!localSettings) return null

  const getProvider = (id: string): ProviderConfig => {
    return localSettings.providers[id] ?? { api_key: '', enabled: false }
  }

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    const current = getProvider(id)
    setLocalSettings({
      ...localSettings,
      providers: {
        ...localSettings.providers,
        [id]: { ...current, ...patch },
      },
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await invokeCommand('save_settings_cmd', { newSettings: localSettings })
      onSettingsChange(localSettings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    setSaving(false)
  }

  const activeProviderModels = PROVIDERS.find(p => p.id === localSettings.active_provider)?.models ?? []

  const totalMessages = conversations.reduce((sum, c) => sum + c.messages.length, 0)
  const totalConversations = conversations.length
  const userMessages = conversations.reduce((sum, c) => sum + c.messages.filter(m => m.role === 'user').length, 0)
  const assistantMessages = conversations.reduce((sum, c) => sum + c.messages.filter(m => m.role === 'assistant').length, 0)
  const toolCalls = conversations.reduce((sum, c) => sum + c.messages.filter(m => m.role === 'tool').length, 0)

  const configuredProviders = PROVIDERS.filter(p => {
    const cfg = getProvider(p.id)
    return cfg.api_key && cfg.enabled
  })

  const estimatedTokens = conversations.reduce((sum, c) => {
    return sum + c.messages.reduce((mSum, m) => mSum + Math.ceil(m.content.length / 4), 0)
  }, 0)

  return (
    <div className="flex w-full h-full max-sm:flex-col">
      <div className="w-56 border-r border-[#e5e5e5] flex flex-col bg-[#fafafa] max-sm:w-full max-sm:h-auto max-sm:border-r-0 max-sm:border-b">
        <div className="p-3 pt-4 max-sm:pt-3 max-sm:pb-1">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#666] hover:text-[#333] hover:bg-[#eee] rounded-lg transition-colors w-full"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        </div>

        <div className="px-3 mt-1 max-sm:hidden">
          <p className="text-[10px] font-medium text-[#aaa] uppercase tracking-widest px-3 mb-1.5">Settings</p>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 max-sm:flex max-sm:gap-1 max-sm:space-y-0 max-sm:overflow-x-auto max-sm:pb-3">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors max-sm:w-auto max-sm:shrink-0 ${
                category === cat.id
                  ? 'bg-[#e8e8e8] text-[#1a1a1a] font-medium'
                  : 'text-[#555] hover:bg-[#f0f0f0]'
              }`}
            >
              <span className={category === cat.id ? 'text-[#333]' : 'text-[#999]'}>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-[#e5e5e5] max-sm:hidden">
          <div className="px-3 py-2">
            <p className="text-[10px] text-[#bbb] uppercase tracking-wider">MilkSU v0.1.0</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 flex items-center justify-between px-8 border-b border-[#e5e5e5] max-sm:h-auto max-sm:px-4 max-sm:py-3 max-sm:gap-3">
          <h1 className="text-base font-medium">
            {CATEGORIES.find(c => c.id === category)?.label}
          </h1>
          {(category === 'general' || category === 'apikeys') && (
            <button
              onClick={handleSave}
              disabled={saving}
              className={`text-sm px-5 py-1.5 rounded-lg transition-all max-sm:px-3 max-sm:shrink-0 ${
                saved
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-[#1a1a1a] text-white hover:bg-[#333]'
              } disabled:opacity-50`}
            >
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 max-sm:px-4 max-sm:py-6">
            {category === 'general' && (
              <GeneralSection
                settings={localSettings}
                onUpdate={(patch) => {
                  setLocalSettings({ ...localSettings, ...patch })
                  setSaved(false)
                }}
                activeProviderModels={activeProviderModels}
              />
            )}
            {category === 'apikeys' && (
              <ApiKeysSection
                getProvider={getProvider}
                updateProvider={updateProvider}
                visibleKeys={visibleKeys}
                setVisibleKeys={setVisibleKeys}
              />
            )}
            {category === 'usage' && (
              <UsageSection
                totalConversations={totalConversations}
                totalMessages={totalMessages}
                userMessages={userMessages}
                assistantMessages={assistantMessages}
                toolCalls={toolCalls}
                estimatedTokens={estimatedTokens}
                configuredProviders={configuredProviders}
                activeProvider={localSettings.active_provider}
                activeModel={localSettings.active_model}
              />
            )}
            {category === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  )
}


function GeneralSection({ settings, onUpdate, activeProviderModels }: {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
  activeProviderModels: string[]
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Default Provider</h2>
        <p className="text-xs text-[#999] mb-3">Select your primary LLM provider and model for new conversations.</p>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div>
            <label className="text-xs font-medium text-[#666] mb-1.5 block">Provider</label>
            <select
              value={settings.active_provider}
              onChange={e => {
                const provider = PROVIDERS.find(p => p.id === e.target.value)
                onUpdate({
                  active_provider: e.target.value,
                  active_model: provider?.models[0] ?? '',
                })
              }}
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:border-[#bbb] focus:ring-1 focus:ring-[#e0e0e0] transition-all cursor-pointer"
            >
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[#666] mb-1.5 block">Model</label>
            <select
              value={settings.active_model}
              onChange={e => onUpdate({ active_model: e.target.value })}
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:border-[#bbb] focus:ring-1 focus:ring-[#e0e0e0] transition-all cursor-pointer"
            >
              {activeProviderModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Available Providers</h2>
        <p className="text-xs text-[#999] mb-3">Providers with configured API keys.</p>
        <div className="space-y-2">
          {PROVIDERS.map(p => {
            const cfg = settings.providers[p.id]
            const hasKey = cfg?.api_key && cfg.enabled
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#fafafa]">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-[#ddd]'}`} />
                  <span className="text-sm">{p.name}</span>
                </div>
                <span className="text-xs text-[#bbb] text-right shrink-0">
                  {hasKey ? `${p.models.length} models` : 'Not configured'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function ApiKeysSection({ getProvider, updateProvider, visibleKeys, setVisibleKeys }: {
  getProvider: (id: string) => ProviderConfig
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  visibleKeys: Record<string, boolean>
  setVisibleKeys: (v: Record<string, boolean>) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-[#999] mb-5">
          API keys are stored locally in your app config directory and passed to the agent process as environment variables. They are never sent elsewhere.
        </p>
      </div>

      {PROVIDERS.map(p => {
        const config = getProvider(p.id)
        const isVisible = visibleKeys[p.id] ?? false
        const hasKey = !!config.api_key

        return (
          <div
            key={p.id}
            className={`rounded-xl border transition-all ${
              config.enabled && hasKey
                ? 'border-emerald-200 bg-emerald-50/30'
                : 'border-[#eee] bg-white'
            }`}
          >
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  config.enabled && hasKey
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-[#f0f0f0] text-[#999]'
                }`}>
                  {p.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-[#bbb]">{p.envKey}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={e => updateProvider(p.id, { enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#ddd] rounded-full peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>

            <div className="px-5 pb-4 space-y-3">
              <div className="relative">
                <input
                  type={isVisible ? 'text' : 'password'}
                  value={config.api_key}
                  onChange={e => updateProvider(p.id, { api_key: e.target.value })}
                  placeholder={p.placeholder}
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2.5 text-sm font-mono bg-white outline-none focus:border-[#bbb] focus:ring-1 focus:ring-[#e0e0e0] transition-all pr-16"
                />
                <button
                  onClick={() => setVisibleKeys({ ...visibleKeys, [p.id]: !isVisible })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] text-[#aaa] hover:text-[#555] px-2.5 py-1.5 rounded-md hover:bg-[#f5f5f5] transition-colors"
                >
                  {isVisible ? 'Hide' : 'Show'}
                </button>
              </div>

              {(p.id === 'anthropic' || p.id === 'openai') && (
                <input
                  type="text"
                  value={config.base_url ?? ''}
                  onChange={e => updateProvider(p.id, { base_url: e.target.value || undefined })}
                  placeholder="Base URL (optional, for proxy)"
                  className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:border-[#bbb] focus:ring-1 focus:ring-[#e0e0e0] transition-all"
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#fafafa] rounded-xl px-5 py-4">
      <p className="text-[11px] font-medium text-[#aaa] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-semibold text-[#1a1a1a] tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[#bbb] mt-0.5">{sub}</p>}
    </div>
  )
}

function UsageBar({ label, value, max, unit }: { label: string; value: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const color = pct > 80 ? 'bg-amber-400' : pct > 50 ? 'bg-blue-400' : 'bg-emerald-400'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[#666]">{label}</span>
        <span className="text-xs tabular-nums text-[#999]">
          {value.toLocaleString()}{unit ? ` ${unit}` : ''} / {max.toLocaleString()}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="h-2 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}


function UnavailableValue({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-[#fafafa] rounded-lg">
      <span className="text-xs text-[#888]">{label}</span>
      <span className="text-[11px] text-[#ccc] italic">unavailable</span>
    </div>
  )
}

function UsageSection({ totalConversations, totalMessages, userMessages, assistantMessages, toolCalls, estimatedTokens, configuredProviders, activeProvider, activeModel }: {
  totalConversations: number
  totalMessages: number
  userMessages: number
  assistantMessages: number
  toolCalls: number
  estimatedTokens: number
  configuredProviders: { id: string; name: string }[]
  activeProvider: string
  activeModel: string
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Session Overview</h2>
        <p className="text-xs text-[#999] mb-4">Counted from local conversation history.</p>
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <StatCard label="Conversations" value={totalConversations} />
          <StatCard label="Messages" value={totalMessages} sub={`${userMessages} sent, ${assistantMessages} received`} />
          <StatCard label="Tool Calls" value={toolCalls} />
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Token Usage (Estimated)</h2>
        <p className="text-xs text-[#999] mb-4">
          Rough estimate based on message character count (~4 chars per token).
          Real token counts from provider API are not yet available.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-5 max-sm:grid-cols-1">
          <StatCard label="Estimated Tokens" value={`~${estimatedTokens.toLocaleString()}`} sub="character-based estimate" />
          <StatCard
            label="Active Model"
            value={activeModel}
            sub={PROVIDERS.find(p => p.id === activeProvider)?.name ?? activeProvider}
          />
        </div>
        <div className="space-y-4 bg-[#fafafa] rounded-xl p-5">
          <UsageBar
            label="User Messages"
            value={userMessages}
            max={totalMessages || 1}
            unit="msgs"
          />
          <UsageBar
            label="Assistant Messages"
            value={assistantMessages}
            max={totalMessages || 1}
            unit="msgs"
          />
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Real-time Metrics</h2>
        <p className="text-xs text-[#999] mb-4">
          These fields require usage data from the provider API.
          They will populate once the bridge reports token usage events.
        </p>
        <div className="space-y-1.5">
          <UnavailableValue label="Input Tokens" />
          <UnavailableValue label="Output Tokens" />
          <UnavailableValue label="Cache Read Tokens" />
          <UnavailableValue label="Total Tokens (real)" />
          <UnavailableValue label="Context Window Limit" />
          <UnavailableValue label="Cost (USD)" />
          <UnavailableValue label="Latency" />
          <UnavailableValue label="Session Duration" />
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Provider Status</h2>
        <p className="text-xs text-[#999] mb-4">Currently configured and available providers.</p>
        {configuredProviders.length === 0 ? (
          <div className="text-center py-8 bg-[#fafafa] rounded-xl">
            <p className="text-sm text-[#bbb]">No providers configured yet.</p>
            <p className="text-xs text-[#ccc] mt-1">Add API keys in the API Keys section.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {configuredProviders.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-[#fafafa] rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm">{p.name}</span>
                {p.id === activeProvider && (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full ml-auto">Active</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


function AboutSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">MilkSU</h2>
        <p className="text-xs text-[#999] mb-4">Pi agent harness extension for pluggable AI skills.</p>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] rounded-lg">
            <span className="text-sm text-[#666]">Version</span>
            <span className="text-sm font-mono">0.1.0</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] rounded-lg">
            <span className="text-sm text-[#666]">Runtime</span>
            <span className="text-sm font-mono">Tauri v2</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] rounded-lg">
            <span className="text-sm text-[#666]">Agent Engine</span>
            <span className="text-sm font-mono">Pi (earendil-works)</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] rounded-lg">
            <span className="text-sm text-[#666]">Frontend</span>
            <span className="text-sm font-mono">React + Vite</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] rounded-lg">
            <span className="text-sm text-[#666]">Backend</span>
            <span className="text-sm font-mono">Rust</span>
          </div>
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Architecture</h2>
        <p className="text-xs text-[#999] mb-4">Tauri IPC dual-channel with Pi subprocess bridge.</p>
        <div className="bg-[#fafafa] rounded-xl p-5 space-y-3 text-xs text-[#666] font-mono leading-relaxed">
          <p>User input</p>
          <p className="text-[#bbb]">  -&gt; React invoke("send_message")</p>
          <p className="text-[#bbb]">  -&gt; Rust: spawn bridge.js subprocess</p>
          <p className="text-[#bbb]">  -&gt; bridge.js: Pi createAgentSession()</p>
          <p className="text-[#bbb]">  -&gt; Pi agent streams JSON line events</p>
          <p className="text-[#bbb]">  -&gt; Rust: emit Tauri events to frontend</p>
          <p className="text-[#bbb]">  -&gt; React: render streaming response</p>
        </div>
      </div>

      <hr className="border-[#f0f0f0]" />

      <div>
        <h2 className="text-sm font-medium text-[#333] mb-1">Storage</h2>
        <p className="text-xs text-[#999] mb-3">All data is stored locally on your machine.</p>
        <div className="space-y-2 text-xs">
          <div className="flex gap-2 px-4 py-2.5 bg-[#fafafa] rounded-lg">
            <span className="text-[#999] shrink-0">Settings:</span>
            <span className="font-mono text-[#666] truncate">~/Library/Application Support/com.milksu.app/settings.json</span>
          </div>
          <div className="flex gap-2 px-4 py-2.5 bg-[#fafafa] rounded-lg">
            <span className="text-[#999] shrink-0">Conversations:</span>
            <span className="font-mono text-[#666] truncate">~/Library/Application Support/com.milksu.app/conversations/</span>
          </div>
        </div>
      </div>
    </div>
  )
}
