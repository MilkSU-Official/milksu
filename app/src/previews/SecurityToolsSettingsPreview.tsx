import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  ArrowLeft,
  Binary,
  Bot,
  Braces,
  FileSearch,
  Info,
  Network,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { Button, Checkbox, Switch } from '@/components/ui'
import AppSidebar from '@/components/AppSidebar'
import { applyThemeMode, nextThemeMode, type ThemeMode } from '@/lib/themeMode'
import { useT } from '@/hooks/useUiLocale'
import type { AccountStatus } from '@/types'

type ToolId = 'ida' | 'burp' | 'capa' | 'codeql' | 'shannon'
type ToolTone = 'ready' | 'attention' | 'idle'
type HealthState = 'idle' | 'checking' | 'passed'

interface SecurityTool {
  id: ToolId
  name: string
  purpose: string
  icon: ComponentType<{ className?: string }>
  status: string
  tone: ToolTone
  available: boolean
  connection: string
  version: string
  permission: string
  runtime: string
  capabilities: string[]
  warning: string
  schema: string[]
}

const accountStatus: AccountStatus = {
  configured: false,
  authenticated: false,
  state: 'unconfigured',
}

export default function SecurityToolsSettingsPreview() {
  const t = useT()
  const tools = useMemo<SecurityTool[]>(() => [
    {
      id: 'ida',
      name: 'IDA Pro',
      purpose: t('交互式反汇编与二进制分析', 'Interactive disassembly and binary analysis'),
      icon: Binary,
      status: t('可用', 'Ready'),
      tone: 'ready',
      available: true,
      connection: 'idalib MCP',
      version: '9.1',
      permission: t('只读分析 + 注释', 'Read-only analysis + comments'),
      runtime: t('连接现有 IDA', 'Attach to an existing IDA'),
      capabilities: [
        t('读取函数与反编译结果', 'Read functions and decompilation'),
        t('读取交叉引用', 'Read cross-references'),
        t('重命名符号', 'Rename symbols'),
        t('写入注释', 'Write comments'),
      ],
      warning: t('不会开放二进制补丁或任意脚本执行', 'Does not expose binary patching or arbitrary script execution'),
      schema: ['read.functions', 'read.xrefs', 'symbol.rename', 'comment.write'],
    },
    {
      id: 'burp',
      name: 'Burp Suite',
      purpose: t('Web 安全测试与代理抓包', 'Web security testing and proxy capture'),
      icon: Network,
      status: t('可用', 'Ready'),
      tone: 'ready',
      available: true,
      connection: 'PortSwigger MCP',
      version: '2026.3',
      permission: t('只读历史', 'Read-only history'),
      runtime: t('连接现有 Burp', 'Attach to an existing Burp'),
      capabilities: [
        t('读取 Proxy 历史', 'Read Proxy history'),
        t('读取 Repeater 请求', 'Read Repeater requests'),
        t('查看请求与响应', 'View requests and responses'),
        t('引用到当前任务', 'Cite into the current job'),
      ],
      warning: t('发送、扫描与配置修改需要准确目标和单独确认', 'Send, scan, and config changes need an exact target and a separate confirmation'),
      schema: ['proxy.history.read', 'repeater.item.read', 'message.read', 'evidence.reference'],
    },
    {
      id: 'capa',
      name: 'capa',
      purpose: t('识别二进制能力与行为特征', 'Identify binary capabilities and behaviors'),
      icon: ScanSearch,
      status: t('可用', 'Ready'),
      tone: 'ready',
      available: true,
      connection: t('本地 CLI Adapter', 'Local CLI adapter'),
      version: '9.0',
      permission: t('工作区只读', 'Workspace read-only'),
      runtime: t('本地受限进程', 'Local confined process'),
      capabilities: [
        t('识别能力规则', 'Match capability rules'),
        t('输出匹配证据', 'Emit matching evidence'),
        t('读取样本元数据', 'Read sample metadata'),
        t('保存分析报告', 'Save an analysis report'),
      ],
      warning: t('只读取当前工作区内明确选择的样本', 'Only reads samples explicitly selected in the current workspace'),
      schema: ['capability.match', 'evidence.read', 'sample.metadata', 'report.write'],
    },
    {
      id: 'codeql',
      name: 'CodeQL',
      purpose: t('代码查询与漏洞分析', 'Code query and vulnerability analysis'),
      icon: Braces,
      status: t('未配置', 'Not configured'),
      tone: 'idle',
      available: false,
      connection: 'Taskflow CodeQL MCP',
      version: t('待检测', 'Pending detection'),
      permission: t('工作区只读', 'Workspace read-only'),
      runtime: t('本地数据库', 'Local database'),
      capabilities: [
        t('创建分析数据库', 'Create an analysis database'),
        t('运行固定查询', 'Run fixed queries'),
        t('读取发现结果', 'Read findings'),
        t('保存查询证据', 'Save query evidence'),
      ],
      warning: t('不上传仓库；执行查询前先固定工作区和数据库路径', 'Does not upload the repo. Pin the workspace and database path before running queries.'),
      schema: ['database.create', 'query.run', 'finding.read', 'evidence.write'],
    },
    {
      id: 'shannon',
      name: 'Shannon',
      purpose: t('授权目标的安全任务 Worker', 'Authorized-target security task worker'),
      icon: Bot,
      status: t('未配置', 'Not configured'),
      tone: 'idle',
      available: false,
      connection: t('受管 Worker', 'Managed worker'),
      version: t('待固定', 'Pending pin'),
      permission: t('显式目标 Scope', 'Explicit target scope'),
      runtime: t('隔离容器', 'Isolated container'),
      capabilities: [
        t('检查 Worker 健康', 'Check worker health'),
        t('启动授权任务', 'Start an authorized run'),
        t('读取任务状态', 'Read run status'),
        t('读取最终报告', 'Read the final report'),
      ],
      warning: t('仅允许本地或明确授权目标，不接受任意公网目标', 'Only local or explicitly authorized targets. Arbitrary internet targets are rejected.'),
      schema: ['worker.health', 'authorized_run.start', 'run.status', 'report.read'],
    },
  ], [t])

  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [selectedId, setSelectedId] = useState<ToolId>('ida')
  const [enabled, setEnabledMap] = useState<Record<ToolId, boolean>>({
    ida: true,
    burp: true,
    capa: true,
    codeql: false,
    shannon: false,
  })
  const [capabilityState, setCapabilityState] = useState<Record<string, boolean>>({})
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [healthState, setHealthState] = useState<HealthState>('idle')

  useEffect(() => {
    applyThemeMode(themeMode)
  }, [themeMode])

  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const tool of tools) {
      for (const capability of tool.capabilities) {
        next[`${tool.id}:${capability}`] = false
      }
    }
    setCapabilityState(next)
  }, [tools])

  const selectedTool = tools.find(tool => tool.id === selectedId) ?? tools[0]!
  const visibleStatus = healthState === 'checking'
    ? t('检测中', 'Checking')
    : healthState === 'passed'
      ? t('正常', 'Healthy')
      : selectedTool.status

  function selectTool(id: ToolId) {
    setSelectedId(id)
    setSchemaOpen(false)
    setHealthState('idle')
  }

  function setEnabled(value: boolean) {
    if (!selectedTool.available) return
    setEnabledMap(current => ({ ...current, [selectedTool.id]: value }))
  }

  function setCapability(capability: string, value: boolean) {
    setCapabilityState(current => ({ ...current, [`${selectedTool.id}:${capability}`]: value }))
  }

  function runHealthCheck() {
    if (!selectedTool.available || healthState === 'checking') return
    setHealthState('checking')
    window.setTimeout(() => {
      setHealthState('passed')
    }, 650)
  }

  function toggleTheme() {
    setThemeMode(mode => nextThemeMode(mode))
  }

  const navLabels = [
    t('通用', 'General'),
    t('模型', 'Models'),
    'CTF',
    'CVE',
    'Coding',
    t('浏览器控制', 'Browser control'),
    t('安全工具', 'Security tools'),
  ]

  return (
    <div className="security-tools-prototype flex h-screen min-h-[720px] min-w-0 overflow-hidden bg-background text-foreground">
      <AppSidebar
        activeSection="settings"
        accountStatus={accountStatus}
        activeConversationId={null}
        conversations={[]}
        ctfSection="catalog"
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
      />

      <main className="settings-page flex min-w-0 flex-1 flex-col bg-background">
        <header className="app-drag settings-page-header flex h-14 shrink-0 items-center border-b border-border bg-background px-5 text-foreground">
          <Button variant="ghost" size="icon-sm" className="app-no-drag mr-3" aria-label={t('返回', 'Back')}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <p className="text-lg font-semibold tracking-[-0.02em]">{t('设置', 'Settings')}</p>
            <p className="text-caption text-muted-foreground">{t('应用、Coding、账户与本地数据', 'App, Coding, account, and local data')}</p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="settings-nav settings-nav-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" aria-label={t('设置分类', 'Settings categories')}>
            {navLabels.map(label => (
              <button key={label} type="button" className="settings-nav-item">
                {label}
              </button>
            ))}
            <button type="button" className="settings-nav-item active" aria-current="page">{t('安全工具', 'Security tools')}</button>
          </nav>

          <section className="page-scroll min-w-0 flex-1" aria-labelledby="security-tools-title">
            <div className="page-column">
              <header className="mb-7">
                <p className="text-caption text-muted-foreground">Settings</p>
                <h1 id="security-tools-title" className="mt-1 text-4xl font-semibold tracking-tight">{t('安全工具', 'Security tools')}</h1>
                <p className="mt-2 text-control text-muted-foreground">{t('连接、授权并检查本地安全能力', 'Connect, authorize, and check local security capabilities')}</p>
              </header>

              <div className="tool-workbench grid min-h-[650px] grid-cols-[minmax(18rem,0.78fr)_minmax(25rem,1.22fr)] border-y border-border" data-testid="security-tool-workbench">
                <nav className="tool-index border-r border-border" aria-label={t('安全工具目录', 'Security tool catalog')}>
                  {tools.map(tool => {
                    const Icon = tool.icon
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        className={`tool-row${tool.id === selectedId ? ' is-selected' : ''}`}
                        aria-current={tool.id === selectedId ? 'true' : undefined}
                        data-testid={`security-tool-${tool.id}`}
                        onClick={() => selectTool(tool.id)}
                      >
                        <span className="tool-icon" aria-hidden="true"><Icon className="size-5" /></span>
                        <span className="min-w-0 flex-1 text-left">
                          <strong className="block truncate text-base font-semibold">{tool.name}</strong>
                          <small className="mt-0.5 block truncate text-caption text-muted-foreground">{tool.purpose}</small>
                        </span>
                        <span className="tool-status" data-tone={tool.tone}>{tool.status}</span>
                      </button>
                    )
                  })}
                </nav>

                <article className="tool-detail min-w-0 px-9 py-7" aria-labelledby={`tool-detail-${selectedTool.id}`} data-testid="security-tool-detail">
                  <header className="flex items-start justify-between gap-5 border-b border-border pb-5">
                    <div className="min-w-0">
                      <h2 id={`tool-detail-${selectedTool.id}`} className="text-3xl font-semibold tracking-tight">{selectedTool.name}</h2>
                      <p className="mt-1 text-control text-muted-foreground">{selectedTool.purpose}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 pt-1">
                      <span className="tool-status text-control" data-tone={selectedTool.tone} aria-live="polite">{visibleStatus}</span>
                      <Switch
                        checked={enabled[selectedTool.id]}
                        disabled={!selectedTool.available}
                        aria-label={`${t('启用', 'Enable')} ${selectedTool.name}`}
                        onCheckedChange={value => setEnabled(Boolean(value))}
                      />
                    </div>
                  </header>

                  <dl className="tool-facts grid grid-cols-[7rem_minmax(0,1fr)] gap-x-6 gap-y-3 border-b border-border py-5 text-control">
                    <dt>{t('连接', 'Connection')}</dt><dd>{selectedTool.connection}</dd>
                    <dt>{t('版本', 'Version')}</dt><dd>{selectedTool.version}</dd>
                    <dt>{t('权限', 'Permission')}</dt><dd>{selectedTool.permission}</dd>
                    <dt>{t('运行方式', 'Runtime')}</dt><dd>{selectedTool.runtime}</dd>
                  </dl>

                  <section className="py-5" aria-labelledby="allowed-capabilities">
                    <h3 id="allowed-capabilities" className="text-base font-semibold">{t('允许的能力', 'Allowed capabilities')}</h3>
                    <div className="mt-4 grid gap-3.5">
                      {selectedTool.capabilities.map(capability => (
                        <label key={capability} className="capability-row flex w-fit items-center gap-3 text-control">
                          <Checkbox
                            checked={Boolean(capabilityState[`${selectedTool.id}:${capability}`])}
                            disabled={!selectedTool.available}
                            aria-label={capability}
                            onCheckedChange={value => setCapability(capability, Boolean(value))}
                          />
                          <span>{capability}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <div className="scope-note flex items-start gap-3 border border-info-border px-4 py-3 text-control text-info">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <span>{selectedTool.warning}</span>
                  </div>

                  <div className="mt-7 flex flex-wrap items-center gap-4">
                    <Button
                      variant="outline"
                      className="health-check"
                      disabled={!selectedTool.available || healthState === 'checking'}
                      onClick={runHealthCheck}
                    >
                      <ShieldCheck className="size-4" />
                      {healthState === 'checking'
                        ? t('正在检查', 'Checking')
                        : healthState === 'passed'
                          ? t('检查通过', 'Passed')
                          : t('运行健康检查', 'Run health check')}
                    </Button>
                    <Button variant="ghost" className="schema-action" onClick={() => setSchemaOpen(open => !open)}>
                      <FileSearch className="size-4" />
                      {schemaOpen ? t('收起 MCP Schema', 'Hide MCP schema') : t('查看 MCP Schema', 'View MCP schema')}
                    </Button>
                  </div>

                  {schemaOpen ? (
                    <section className="schema-preview mt-5 border-l-2 border-info px-4 py-3" aria-label={t('MCP Schema 摘要', 'MCP schema summary')}>
                      <p className="text-caption text-muted-foreground">Reviewed tools</p>
                      <code className="mt-2 block whitespace-pre-wrap text-caption leading-6 text-muted-foreground">{selectedTool.schema.join('\n')}</code>
                    </section>
                  ) : null}
                </article>
              </div>
            </div>
          </section>
        </div>
      </main>

      <style>{`
.settings-nav-surface { border-color: var(--border); background-color: var(--background); }
.settings-nav-item { position: relative; display: flex; min-height: 2rem; width: 100%; align-items: center; border: 0; border-radius: 8px; background: transparent; padding: 0 0.5rem; color: var(--muted-foreground); text-align: left; cursor: pointer; }
.settings-nav-item:hover { color: var(--foreground); background: var(--hover-2); }
.settings-nav-item.active { color: var(--foreground); background: var(--hover-2); }
.tool-workbench { grid-template-columns: minmax(18rem, .78fr) minmax(25rem, 1.22fr); }
.tool-row { display: grid; min-height: 6.05rem; width: 100%; grid-template-columns: 2.75rem minmax(0, 1fr) auto; align-items: center; gap: .9rem; border-left: 4px solid transparent; padding: 1rem 1.25rem 1rem 1rem; color: var(--foreground); cursor: pointer; }
.tool-row:hover, .tool-row:focus-visible { background: var(--overlay-hover-light); outline: 0; }
.tool-row.is-selected { border-left-color: var(--foreground); background: var(--hover-2); }
.tool-icon { display: grid; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid var(--border-hairline); color: var(--foreground); }
.tool-status { color: var(--muted-foreground); font-size: var(--text-caption); white-space: nowrap; }
.tool-status[data-tone='ready'] { color: var(--success-foreground); }
.tool-status[data-tone='attention'] { color: var(--warning-foreground); }
.tool-facts dt { color: var(--muted-foreground); }
.tool-facts dd { min-width: 0; overflow-wrap: anywhere; }
.capability-row { min-height: 1.5rem; cursor: pointer; }
.capability-row:has([data-disabled]) { color: var(--muted-foreground); cursor: default; }
.scope-note { background: var(--info-soft); }
.health-check { border-color: var(--success-border); color: var(--success-foreground); }
.schema-action { color: var(--info-foreground); }
.schema-preview { background: var(--info-soft); }
.tool-detail [data-slot='switch'][data-state='checked'],
.tool-detail [data-slot='checkbox'][data-state='checked'] { background: var(--primary); color: var(--primary-foreground); }
@media (max-width: 1040px) {
  .tool-workbench { grid-template-columns: minmax(15rem, .72fr) minmax(22rem, 1.28fr); }
  .tool-detail { padding-inline: 1.5rem; }
}
@media (max-width: 820px) {
  .settings-nav { width: 10.5rem; }
  .tool-workbench { grid-template-columns: 1fr; }
  .tool-index { border-right: 0; border-bottom: 1px solid var(--border); }
  .tool-row { min-height: 4.75rem; }
}
@media (max-height: 820px) {
  .tool-workbench { min-height: 30rem; }
  .tool-row { min-height: 4.8rem; padding-block: .75rem; }
  .tool-detail { padding-block: 1.1rem; padding-inline: 1.5rem; }
  .tool-detail > header { padding-bottom: .8rem; }
  .tool-facts { row-gap: .32rem; padding-block: .8rem; }
  .tool-detail > section { padding-block: .8rem; }
  .tool-detail > section > div { margin-top: .6rem; gap: .5rem; }
  .scope-note { padding-block: .55rem; }
  .tool-detail > .mt-7 { margin-top: .8rem; }
}
      `}</style>
    </div>
  )
}
