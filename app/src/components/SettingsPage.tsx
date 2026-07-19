import { useState } from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { invokeCommand } from '../desktop'
import type { AppSettings, ProviderConfig, RelayConfig, Conversation } from '../types'
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

const CATEGORIES: { id: Category; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'general', labelKey: 'settings.general', icon: <Settings className="size-4" /> },
  { id: 'apikeys', labelKey: 'settings.apiKeys', icon: <KeyRound className="size-4" /> },
  { id: 'usage', labelKey: 'settings.usage', icon: <BarChart3 className="size-4" /> },
  { id: 'about', labelKey: 'settings.about', icon: <Info className="size-4" /> },
]

interface Props {
  settings: AppSettings | null
  onSettingsChange: (s: AppSettings) => void
  onClose: () => void
  conversations: Conversation[]
}

export function SettingsPage({ settings, onSettingsChange, onClose, conversations }: Props) {
  const { t } = useTranslation()
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
            {t('settings.back')}
          </Button>
        </div>

        <div className="px-3 mt-1 max-sm:hidden">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest px-3 mb-1.5">{t('settings.title')}</p>
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
              {t(cat.labelKey)}
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
            {t(CATEGORIES.find(c => c.id === category)?.labelKey ?? 'settings.general')}
          </h1>
          {(category === 'general' || category === 'apikeys') && (
            <Button
              onClick={handleSave}
              disabled={saving}
              variant={saved ? 'outline' : 'default'}
              size="sm"
              className={saved ? 'border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-50' : ''}
            >
              {saving ? t('settings.saving') : saved ? t('settings.saved') : t('settings.saveChanges')}
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
                relay={localSettings.relay ?? { enabled: false, url: '', key: '' }}
                onRelayChange={(relay) => {
                  setLocalSettings({ ...localSettings, relay })
                  setSaved(false)
                }}
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
  const { t } = useTranslation()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium mb-1">{t('settings.defaultProvider')}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.defaultProviderDesc')}</p>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <div>
            <Label className="mb-1.5">{t('settings.provider')}</Label>
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
            <Label className="mb-1.5">{t('settings.model')}</Label>
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

      <div>
        <h2 className="text-sm font-medium mb-1">{t('settings.language')}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.languageDesc')}</p>
        <select
          value={settings.locale ?? (i18next.resolvedLanguage === 'zh' ? 'zh' : 'en')}
          onChange={e => {
            const locale = e.target.value as AppSettings['locale']
            onUpdate({ locale })
            void i18next.changeLanguage(locale)
          }}
          className="flex h-9 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 transition-colors cursor-pointer"
        >
          <option value="en">{t('settings.english')}</option>
          <option value="zh">{t('settings.chinese')}</option>
        </select>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">{t('settings.availableProviders')}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.availableProvidersDesc')}</p>
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
                  {hasKey ? t('settings.models', { count: p.models.length }) : t('settings.notConfigured')}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function ApiKeysSection({ relay, onRelayChange, getProvider, updateProvider, visibleKeys, setVisibleKeys }: {
  relay: RelayConfig
  onRelayChange: (relay: RelayConfig) => void
  getProvider: (id: string) => ProviderConfig
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  visibleKeys: Record<string, boolean>
  setVisibleKeys: (v: Record<string, boolean>) => void
}) {
  const { t } = useTranslation()
  const relayKeyVisible = visibleKeys['__relay'] ?? false

  return (
    <div className="space-y-4">
      <Card className={relay.enabled ? 'border-blue-200 bg-blue-50/30' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
              relay.enabled ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'
            }`}>
              R
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm">{t('settings.relay')}</CardTitle>
              <CardDescription className="text-[11px]">
                {t('settings.relayDesc')}
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <Switch
              id="switch-relay"
              aria-label={t('settings.relayToggle')}
              checked={relay.enabled}
              onCheckedChange={(checked: boolean) => onRelayChange({ ...relay, enabled: checked })}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="mb-1.5 text-xs">{t('settings.relayUrl')}</Label>
            <Input
              type="text"
              value={relay.url}
              onChange={e => onRelayChange({ ...relay, url: e.target.value })}
              placeholder="https://api.example.com/v1"
              disabled={!relay.enabled}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-xs">{t('settings.relayKey')}</Label>
            <div className="relative">
              <Input
                type={relayKeyVisible ? 'text' : 'password'}
                value={relay.key}
                onChange={e => onRelayChange({ ...relay, key: e.target.value })}
                placeholder="sk-..."
                className="font-mono pr-16"
                disabled={!relay.enabled}
              />
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setVisibleKeys({ ...visibleKeys, '__relay': !relayKeyVisible })}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {relayKeyVisible ? t('settings.hide') : t('settings.show')}
              </Button>
            </div>
          </div>
          {relay.enabled && (
            <p className="text-[11px] text-muted-foreground">
              {t('settings.relayHint')}
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      <p className="text-sm text-muted-foreground">
        {relay.enabled
          ? t('settings.relayActiveHint')
          : t('settings.directKeysHint')}
      </p>

      {PROVIDERS.map(p => {
        const config = getProvider(p.id)
        const isVisible = visibleKeys[p.id] ?? false
        const hasKey = !!config.api_key
        const isActive = config.enabled && hasKey
        const dimmed = relay.enabled

        return (
          <Card key={p.id} className={`${isActive && !dimmed ? 'border-emerald-200 bg-emerald-50/30' : ''} ${dimmed ? 'opacity-50' : ''}`}>
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
                aria-label={t('settings.providerToggle', { provider: p.name })}
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
                  {isVisible ? t('settings.hide') : t('settings.show')}
                </Button>
              </div>

              {(p.id === 'anthropic' || p.id === 'openai') && (
                <Input
                  type="text"
                  value={config.base_url ?? ''}
                  onChange={e => updateProvider(p.id, { base_url: e.target.value || undefined })}
                  placeholder={t('settings.baseUrl')}
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
  const { t } = useTranslation()
  const metricLabels = [
    t('usage.inputTokens'),
    t('usage.outputTokens'),
    t('usage.cacheReadTokens'),
    t('usage.totalTokensReal'),
    t('usage.contextWindowLimit'),
    t('usage.costUsd'),
    t('usage.latency'),
    t('usage.sessionDuration'),
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium mb-1">{t('usage.sessionOverview')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('usage.sessionOverviewDesc')}</p>
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <StatCard label={t('usage.conversations')} value={totalConversations} />
          <StatCard label={t('usage.messages')} value={totalMessages} sub={t('usage.messagesSub', { sent: userMessages, received: assistantMessages })} />
          <StatCard label={t('usage.toolCalls')} value={toolCalls} />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">{t('usage.tokenUsageEstimated')}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('usage.tokenUsageDesc')}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-5 max-sm:grid-cols-1">
          <StatCard label={t('usage.estimatedTokens')} value={`~${estimatedTokens.toLocaleString()}`} sub={t('usage.characterEstimate')} />
          <StatCard
            label={t('usage.activeModel')}
            value={activeModel}
            sub={PROVIDERS.find(p => p.id === activeProvider)?.name ?? activeProvider}
          />
        </div>
        <Card size="sm">
          <CardContent className="pt-4 space-y-4">
            <UsageBar label={t('usage.userMessages')} value={userMessages} max={totalMessages || 1} unit={t('usage.messageUnit')} />
            <UsageBar label={t('usage.assistantMessages')} value={assistantMessages} max={totalMessages || 1} unit={t('usage.messageUnit')} />
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">{t('usage.realTimeMetrics')}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('usage.realTimeMetricsDesc')}
        </p>
        <div className="space-y-1.5">
          {metricLabels.map(label => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5 bg-muted/50 rounded-lg">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-[11px] text-muted-foreground/50 italic">{t('usage.unavailable')}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">{t('usage.providerStatus')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('usage.providerStatusDesc')}</p>
        {configuredProviders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('usage.noProvidersConfigured')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('usage.configuredNote')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {configuredProviders.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm flex-1">{p.name}</span>
                {p.id === activeProvider && (
                  <Badge variant="outline" className="border-emerald-200 text-emerald-600 bg-emerald-50">{t('usage.active')}</Badge>
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
  const { t } = useTranslation()
  const infoRows = [
    [t('about.version'), '0.1.0'],
    [t('about.runtime'), 'Tauri v2'],
    [t('about.agentEngine'), 'Pi (earendil-works)'],
    [t('about.frontend'), 'React + Vite'],
    [t('about.backend'), 'Rust'],
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-medium mb-1">{t('about.title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('about.description')}</p>

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
        <h2 className="text-sm font-medium mb-1">{t('about.architecture')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('about.architectureDesc')}</p>
        <Card size="sm">
          <CardContent className="pt-4 space-y-1 text-xs font-mono leading-relaxed">
            <p>{t('about.flow.userInput')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.reactInvoke')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.rustBridge')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.bridgeSession')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.piEvents')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.tauriEvents')}</p>
            <p className="text-muted-foreground">  -&gt; {t('about.flow.renderResponse')}</p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div>
        <h2 className="text-sm font-medium mb-1">{t('about.storage')}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t('about.storageDesc')}</p>
        <Card size="sm">
          <CardContent className="pt-4 space-y-2 text-xs">
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">{t('about.settingsPath')}:</span>
              <span className="font-mono truncate">~/Library/Application Support/com.milksu.app/settings.json</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">{t('about.conversationsPath')}:</span>
              <span className="font-mono truncate">~/Library/Application Support/com.milksu.app/conversations/</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
