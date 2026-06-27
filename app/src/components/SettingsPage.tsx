import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, ProviderConfig } from '../types'
import { PROVIDERS } from '../types'

interface Props {
  onClose: () => void
}

export function SettingsPage({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  useEffect(() => {
    invoke<AppSettings>('get_settings').then(setSettings)
  }, [])

  if (!settings) return null

  const getProvider = (id: string): ProviderConfig => {
    return settings.providers[id] ?? { api_key: '', enabled: false }
  }

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    const current = getProvider(id)
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [id]: { ...current, ...patch },
      },
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await invoke('save_settings_cmd', { newSettings: settings })
      setSaved(true)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    setSaving(false)
  }

  const activeProviderModels = PROVIDERS.find(p => p.id === settings.active_provider)?.models ?? []

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white">
      <div className="h-14 flex items-center px-6 border-b border-[#e5e5e5]">
        <button
          onClick={onClose}
          className="text-sm text-[#888] hover:text-[#333] mr-4 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-sm font-medium flex-1">Settings</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-4 py-1.5 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-6 py-8 space-y-8">

          <section>
            <h2 className="text-sm font-medium mb-4">Active Model</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#888] mb-1 block">Provider</label>
                <select
                  value={settings.active_provider}
                  onChange={e => {
                    const provider = PROVIDERS.find(p => p.id === e.target.value)
                    setSettings({
                      ...settings,
                      active_provider: e.target.value,
                      active_model: provider?.models[0] ?? '',
                    })
                    setSaved(false)
                  }}
                  className="w-full border border-[#ddd] rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-[#999] transition-colors"
                >
                  {PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#888] mb-1 block">Model</label>
                <select
                  value={settings.active_model}
                  onChange={e => {
                    setSettings({ ...settings, active_model: e.target.value })
                    setSaved(false)
                  }}
                  className="w-full border border-[#ddd] rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-[#999] transition-colors"
                >
                  {activeProviderModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium mb-4">API Keys</h2>
            <div className="space-y-4">
              {PROVIDERS.map(p => {
                const config = getProvider(p.id)
                const isVisible = visibleKeys[p.id] ?? false
                return (
                  <div key={p.id} className="border border-[#eee] rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        {config.api_key && config.enabled && (
                          <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Active</span>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-[#888]">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={e => updateProvider(p.id, { enabled: e.target.checked })}
                          className="rounded"
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="relative">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        value={config.api_key}
                        onChange={e => updateProvider(p.id, { api_key: e.target.value })}
                        placeholder={p.placeholder}
                        className="w-full border border-[#ddd] rounded-lg px-3 py-2 text-sm font-mono bg-[#fafafa] outline-none focus:border-[#999] transition-colors pr-16"
                      />
                      <button
                        onClick={() => setVisibleKeys({ ...visibleKeys, [p.id]: !isVisible })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#888] hover:text-[#333] px-2 py-1"
                      >
                        {isVisible ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {p.id === 'anthropic' || p.id === 'openai' ? (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={config.base_url ?? ''}
                          onChange={e => updateProvider(p.id, { base_url: e.target.value || undefined })}
                          placeholder="Base URL (optional, for proxy)"
                          className="w-full border border-[#ddd] rounded-lg px-3 py-2 text-sm bg-[#fafafa] outline-none focus:border-[#999] transition-colors"
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="text-xs text-[#999] pb-8">
            <p>API keys are stored locally in your app config directory.</p>
            <p>They are passed to the Pi agent process as environment variables and never sent elsewhere.</p>
          </section>

        </div>
      </div>
    </div>
  )
}
