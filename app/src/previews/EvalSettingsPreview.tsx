import { useEffect } from 'react'
import { ArrowLeft, Box, Bug, Flag, Gauge } from 'lucide-react'
import { Button } from '@/components/ui'
import AppSidebar from '@/components/AppSidebar'
import EvalSettingsPanel from '@/components/EvalSettingsPanel'
import { applyThemeMode, type ThemeMode } from '@/lib/themeMode'
import { installAppModelSettings, installModelCatalog } from '@/modelCatalog'
import { useT } from '@/hooks/useUiLocale'
import { withAppSettingsDefaults, type AccountStatus, type AppSettings } from '@/types'
import type { EvalBoardSnapshot } from '@/evalTypes'

const theme = 'dark' as ThemeMode
applyThemeMode(theme)

const accountStatus: AccountStatus = {
  configured: false,
  authenticated: false,
  state: 'unconfigured',
}

const settings = withAppSettingsDefaults({
  active_model: 'grok-4.6',
  relay: { enabled: true, has_key: true, url: 'https://tokenflux.dev/v1' },
} as AppSettings)

const grok = { provider: 'tokenflux', model: 'grok-4.6' }
const claude = { provider: 'tokenflux', model: 'claude-sonnet-4.6' }

const suites = [
  { id: 'cybench', name: 'Cybench', purpose: 'CTF 题', runnable: true, taskN: 40 },
  { id: 'sec-bench', name: 'SEC-bench', purpose: '已知洞复现', runnable: true, taskN: 25 },
  { id: 'autopen', name: 'AutoPenBench', purpose: '授权渗透', runnable: true, taskN: 33 },
  { id: 'cybergym', name: 'CyberGym', purpose: '真实漏洞 PoC', runnable: false, taskN: 10 },
  { id: 'frontier-harness', name: 'FrontierHarness', purpose: 'Harness 工程任务', runnable: true, taskN: 30 },
]

const board: EvalBoardSnapshot = {
  suites,
  selected: 'cybench',
  models: [],
  all: [
    {
      suite: suites[0]!,
      models: [
        { model: grok, score: 100, rank: 1, solved: 1, total: 1, curve: [100] },
        { model: claude, score: null, rank: null, solved: null, total: 1 },
      ],
    },
    {
      suite: suites[1]!,
      models: [
        { model: grok, score: 100, rank: 1, solved: 1, total: 1, curve: [100] },
        { model: claude, score: null, rank: null, solved: null, total: 1 },
      ],
    },
    {
      suite: suites[2]!,
      models: [
        { model: grok, score: null, rank: null, solved: null, total: 1 },
        { model: claude, score: null, rank: null, solved: null, total: 1 },
      ],
    },
    {
      suite: suites[3]!,
      models: [],
    },
    {
      suite: suites[4]!,
      models: [
        { model: grok, score: 63, rank: 1, solved: 19, total: 30 },
        { model: grok, score: 60, rank: 2, solved: 18, total: 30 },
      ],
    },
  ],
}

installModelCatalog({
  provider: 'tokenflux',
  source: 'remote',
  credential_source: 'account',
  refreshed_at: '2026-08-24T00:00:00Z',
  models: [
    { id: 'grok-4.6', name: 'Grok 4.6', context_window: 500000, max_tokens: 32768, input: ['text'] },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', context_window: 200000, max_tokens: 16384, input: ['text'] },
  ],
  account_model_ids: ['grok-4.6', 'claude-sonnet-4.6'],
})
installAppModelSettings(settings)

Object.defineProperty(window, 'milksu', {
  configurable: true,
  value: {
    async invoke(method: string) {
      if (method === 'GetBuildTracking') {
        return {
          channel: 'stable',
          productName: 'MilkSU',
          appId: 'com.milksu.app',
          gitBranch: 'main',
          gitCommit: 'preview',
          dirty: false,
          buildTime: '',
          trackingId: 'preview',
          development: true,
        }
      }
      if (method === 'GetEvalBoard') return board
      if (method === 'StartEvalRun' || method === 'StopEvalRun') return board
      return undefined
    },
    onEvent() {
      return () => undefined
    },
  },
})

export default function EvalSettingsPreview() {
  const t = useT()
  const nav = [
    { value: 'general', label: t('通用', 'General'), icon: Box },
    { value: 'apikeys', label: t('模型', 'Models'), icon: Box },
    { value: 'ctf', label: 'CTF', icon: Flag },
    { value: 'cve', label: 'CVE', icon: Bug },
    { value: 'coding', label: 'Coding', icon: Box },
    { value: 'chats', label: t('归档聊天', 'Archived chats'), icon: Box },
    { value: 'browser', label: t('浏览器控制', 'Browser control'), icon: Box },
    { value: 'security-tools', label: t('安全工具', 'Security tools'), icon: Box },
    { value: 'eval', label: t('评测', 'Eval'), icon: Gauge },
  ] as const

  useEffect(() => {
    applyThemeMode('dark')
  }, [])

  return (
    <div className="flex h-screen min-h-[720px] min-w-0 overflow-hidden bg-background text-foreground">
      <AppSidebar
        activeSection="settings"
        accountStatus={accountStatus}
        activeConversationId={null}
        conversations={[]}
        ctfSection="catalog"
        themeMode={theme}
      />

      <main className="settings-page flex min-w-0 flex-1 flex-col bg-background">
        <header className="app-drag settings-page-header flex h-14 shrink-0 items-center border-b border-border bg-background px-5 text-foreground">
          <Button variant="ghost" size="icon-sm" className="app-no-drag mr-3" aria-label={t('返回', 'Back')}>
            <ArrowLeft className="size-4" />
          </Button>
          <p className="text-lg font-semibold tracking-[-0.02em]">{t('评测', 'Eval')}</p>
        </header>

        <div className="settings-layout flex min-h-0 flex-1">
          <nav className="settings-nav settings-nav-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" aria-label={t('设置分类', 'Settings categories')}>
            <div className="grid gap-0.5">
                {nav.map(item => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`settings-nav-item${item.value === 'eval' ? ' active' : ''}`}
                      aria-selected={item.value === 'eval'}
                    >
                      <Icon className="mr-3 size-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
            </div>
          </nav>

          <section className="page-scroll min-w-0 flex-1">
            <div className="page-column">
              <EvalSettingsPanel settings={settings} />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
