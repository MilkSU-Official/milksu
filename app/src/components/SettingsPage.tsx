import { useState } from 'react'
import { invokeCommand } from '../tauri'
import type { AppSettings, ProviderConfig, Conversation } from '../types'
import { PROVIDERS } from '../types'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Settings, KeyRound, BarChart3, Info, ChevronLeft } from 'lucide-react'

type Category = 'general' | 'apikeys' | 'usage' | 'about'

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings className="size-4" /> },
  { id: 'apikeys', label: 'API Keys', icon: <KeyRound className="size-4" /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 className="size-4" /> },
  { id: 'about', label: 'About', icon: <Info className="size-4" /> },
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
      <div className="w-56 border-r border-border flex flex-col bg-sidebar max-sm:w-full max-sm:h-auto max-sm:border-r-0 max-sm:border-b">
        <div className="p-3 pt-4 max-sm:pt-3 max-sm:pb-1">
          <Button variant="ghost" size="sm" onClick={onClose} className="w-full justify-start gap-2 text-muted-foreground">
            <ChevronLeft className="size-4" />
            Back
          </Button>
        </div>

        <div className="px-3 mt-1 max-sm:hidden">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest px-3 mb-1.5">Settings</p>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 max-sm:flex max-sm:gap-1 max-sm:space-y-0 max-sm:overflow-x-auto max-sm:pb-3">
          {CATEGORIES.map(cat => (
            <Button
              key={cat.id}
              variant={category === cat.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCategory(cat.id)}
              className={`w-full justify-start gap-2.5 max-sm:w-auto max-sm:shrink-0 ${
                category === cat.id ? 'font-medium' : 'text-muted-foreground'
              }`}
            >
              {cat.icon}
              {cat.label}
            </Button>
          ))}
        </nav>

        <div className="p-3 border-t border-border max-sm:hidden">
          <div className="px-3 py-2">
            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">MilkSU v0.1.0</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 flex items-center justify-between px-8 border-b border-border max-sm:h-auto max-sm:px-4 max-sm:py-3 max-sm:gap-3">
          <h1 className="text-base font-medium">
            {CATEGORIES.find(c => c.id === category)?.label}
          </h1>
          {(category === 'general' || category === 'apikeys') && (
            <Button
              onClick={handleSave}
              disabled={saving}
              variant={saved ? 'outline' : 'default'}
              size="sm"
              className={saved ? 'border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-50' : ''}
            >
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </Button>
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
        <h2 className="text-sm font-medium mb-1">Default Provider</h2>
        <p className="text-sm text-muted-foreground mb-3">Select your primary LLM provider and model for new conversations.</p>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div>
            <Label className="mb-1.5">Provider</Label>
            <select
              value={settings.active_provider}
              onChange={e => {
                const provider = PROVIDERS.find(p => p.id === e.target.value)
                onUpdate({
                  active_provider: e.target.value,
                  active_model: provider?.models[0] ?? '',
                })
              }}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors cursor-pointer"
            >
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="mb-1.5">Model</Label>
            <select
              value={settings.active_model}
              onChange={e => onUpdate({ active_model: e.target.value })}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors cursor-pointer"
            >
              {activeProviderModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Available Providers</h2>
        <p className="text-sm text-muted-foreground mb-3">Providers with configured API keys.</p>
        <div className="space-y-2">
          {PROVIDERS.map(p => {
            const cfg = settings.providers[p.id]
            const hasKey = cfg?.api_key && cfg.enabled
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                  <span className="text-sm">{p.name}</span>
                </div>
                <span className="text-xs text-muted-foreground text-right shrink-0">
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        API keys are stored locally in your app config directory and passed to the agent process as environment variables. They are never sent elsewhere.
      </p>

      {PROVIDERS.map(p => {
        const config = getProvider(p.id)
        const isVisible = visibleKeys[p.id] ?? false
        const hasKey = !!config.api_key
        const isActive = config.enabled && hasKey

        return (
          <Card key={p.id} className={isActive ? 'border-emerald-200 bg-emerald-50/30' : ''}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                }`}>
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm">{p.name}</CardTitle>
                  <CardDescription className="text-[11px]">{p.envKey}</CardDescription>
                </div>
              </div>
              <CardAction>
                <Switch
                  id={`switch-${p.id}`}
                  checked={config.enabled}
                  onCheckedChange={(checked: boolean) => updateProvider(p.id, { enabled: checked })}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Input
                  type={isVisible ? 'text' : 'password'}
                  value={config.api_key}
                  onChange={e => updateProvider(p.id, { api_key: e.target.value })}
                  placeholder={p.placeholder}
                  className="font-mono pr-16"
                />
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setVisibleKeys({ ...visibleKeys, [p.id]: !isVisible })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {isVisible ? 'Hide' : 'Show'}
                </Button>
              </div>

              {(p.id === 'anthropic' || p.id === 'openai') && (
                <Input
                  type="text"
                  value={config.base_url ?? ''}
                  onChange={e => updateProvider(p.id, { base_url: e.target.value || undefined })}
                  placeholder="Base URL (optional, for proxy)"
                />
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}


function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent className="pt-4">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function UsageBar({ label, value, max, unit }: { label: string; value: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const color = pct > 80 ? 'bg-amber-400' : pct > 50 ? 'bg-blue-400' : 'bg-emerald-400'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value.toLocaleString()}{unit ? ` ${unit}` : ''} / {max.toLocaleString()}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
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
        <h2 className="text-sm font-medium mb-1">Session Overview</h2>
        <p className="text-sm text-muted-foreground mb-4">Counted from local conversation history.</p>
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <StatCard label="Conversations" value={totalConversations} />
          <StatCard label="Messages" value={totalMessages} sub={`${userMessages} sent, ${assistantMessages} received`} />
          <StatCard label="Tool Calls" value={toolCalls} />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Token Usage (Estimated)</h2>
        <p className="text-sm text-muted-foreground mb-4">
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
        <Card size="sm">
          <CardContent className="pt-4 space-y-4">
            <UsageBar label="User Messages" value={userMessages} max={totalMessages || 1} unit="msgs" />
            <UsageBar label="Assistant Messages" value={assistantMessages} max={totalMessages || 1} unit="msgs" />
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Real-time Metrics</h2>
        <p className="text-sm text-muted-foreground mb-4">
          These fields require usage data from the provider API.
          They will populate once the bridge reports token usage events.
        </p>
        <div className="space-y-1.5">
          {['Input Tokens', 'Output Tokens', 'Cache Read Tokens', 'Total Tokens (real)', 'Context Window Limit', 'Cost (USD)', 'Latency', 'Session Duration'].map(label => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5 bg-muted/50 rounded-lg">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-[11px] text-muted-foreground/50 italic">unavailable</span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Provider Status</h2>
        <p className="text-sm text-muted-foreground mb-4">Currently configured and available providers.</p>
        {configuredProviders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No providers configured yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Add API keys in the API Keys section.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {configuredProviders.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm flex-1">{p.name}</span>
                {p.id === activeProvider && (
                  <Badge variant="outline" className="border-emerald-200 text-emerald-600 bg-emerald-50">Active</Badge>
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
  const infoRows = [
    ['Version', '0.1.0'],
    ['Runtime', 'Tauri v2'],
    ['Agent Engine', 'Pi (earendil-works)'],
    ['Frontend', 'React + Vite'],
    ['Backend', 'Rust'],
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium mb-1">MilkSU</h2>
        <p className="text-sm text-muted-foreground mb-4">Pi agent harness extension for pluggable AI skills.</p>

        <Card size="sm">
          <CardContent className="pt-4 divide-y divide-border">
            {infoRows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-mono">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Architecture</h2>
        <p className="text-sm text-muted-foreground mb-4">Tauri IPC dual-channel with Pi subprocess bridge.</p>
        <Card size="sm">
          <CardContent className="pt-4 space-y-1 text-xs font-mono leading-relaxed">
            <p>User input</p>
            <p className="text-muted-foreground">  -&gt; React invoke("send_message")</p>
            <p className="text-muted-foreground">  -&gt; Rust: spawn bridge.js subprocess</p>
            <p className="text-muted-foreground">  -&gt; bridge.js: Pi createAgentSession()</p>
            <p className="text-muted-foreground">  -&gt; Pi agent streams JSON line events</p>
            <p className="text-muted-foreground">  -&gt; Rust: emit Tauri events to frontend</p>
            <p className="text-muted-foreground">  -&gt; React: render streaming response</p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">Storage</h2>
        <p className="text-sm text-muted-foreground mb-3">All data is stored locally on your machine.</p>
        <Card size="sm">
          <CardContent className="pt-4 space-y-2 text-xs">
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Settings:</span>
              <span className="font-mono truncate">~/Library/Application Support/com.milksu.app/settings.json</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Conversations:</span>
              <span className="font-mono truncate">~/Library/Application Support/com.milksu.app/conversations/</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
