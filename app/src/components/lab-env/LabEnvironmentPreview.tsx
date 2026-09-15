import { useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Box, Maximize2, RotateCcw, Smartphone } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import WorkspaceCatalogActions from '@/components/WorkspaceCatalogActions'
import WorkspaceImportDialog from '@/components/WorkspaceImportDialog'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
import WorkspaceRail from '@/components/WorkspaceRail'
import EnvironmentStrip from '@/components/lab-env/EnvironmentStrip'
import TargetSurfacePreview from '@/components/lab-env/TargetSurfacePreview'
import type { EnvironmentLease, TargetSurfaceKind } from '@/lib/environmentTypes'
import type { AccountStatus } from '@/types'
import type { ThemeMode } from '@/lib/themeMode'
import { groupLabPackages } from '@/lib/labPackageCategory'
import { useDossierSplit } from '@/lib/useDossierSplit'
import type { AppSection, WorkspaceSection } from '@/lib/workspaceNavigation'
import { useT } from '@/hooks/useUiLocale'

type LabTab = 'jobs' | 'packages'
type SourceKind = 'local' | 'remote'
type PreviewScreen =
  | 'lab-packages'
  | 'lab-job'
  | 'cve-ready'
  | 'cve-none'
  | 'cve-live'
  | 'cve-shell'
  | 'cve-emulator'
  | 'cve-agent'
  | 'coding-from-cve'
  | 'docker-down'

function ActionCard({
  title,
  description,
  icon,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string
  description?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="flex min-h-[4.5rem] w-full items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
      onClick={onClick}
      {...props}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-5">{icon}</span> : null}
      <span className="min-w-0">
        <strong className="block text-control font-medium">{title}</strong>
        {description ? <small className="mt-0.5 block text-caption text-muted-foreground">{description}</small> : null}
      </span>
    </button>
  )
}

const dockerReadyDetail = (t: (zh: string, en: string) => string) => t('Docker · 无出网', 'Docker · no outbound network')

function juiceReadyLease(t: (zh: string, en: string) => string): EnvironmentLease {
  return {
    provider: 'docker',
    state: 'ready',
    packageName: 'OWASP Juice Shop',
    address: '127.0.0.1:3000',
    detail: dockerReadyDetail(t),
  }
}

export default function LabEnvironmentPreview() {
  const t = useT()
  const split = useStoreRuntime(() => useDossierSplit('milksu.preview-split.v1', 400))
  const briefWidth = split.width

  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [section, setSection] = useState<AppSection>('lab')
  const [labTab, setLabTab] = useState<LabTab>('packages')
  const [labJobId, setLabJobId] = useState('')
  const [cveId, setCveId] = useState('')
  const [codingFrom, setCodingFrom] = useState<'lab' | 'cve'>('cve')
  const [showNew, setShowNew] = useState(false)
  const [showReproAsk, setShowReproAsk] = useState(false)
  const [newSource, setNewSource] = useState<SourceKind>('local')
  const [dockerOk, setDockerOk] = useState(true)
  const [targetOpen, setTargetOpen] = useState(false)
  const [agentDriving, setAgentDriving] = useState(false)
  const [targetKind, setTargetKind] = useState<TargetSurfaceKind>('browser')
  const [juiceLease, setJuiceLease] = useState<EnvironmentLease>(() => ({
    provider: 'docker',
    state: 'stopped',
    packageName: 'OWASP Juice Shop',
    detail: dockerReadyDetail(t),
  }))

  const accountStatus = useMemo<AccountStatus>(() => ({
    configured: true,
    authenticated: true,
    state: 'active',
    user: { githubLogin: 'preview', displayName: t('交互稿', 'Preview'), avatarUrl: '' },
  }), [t])

  const packages = useMemo(() => [
    { id: 'juice-shop', name: 'OWASP Juice Shop', kind: 'Web', kindLabel: 'Web', category: 'web', provider: 'docker' as const, surface: 'browser' as const, port: ':3000', size: t('约 400MB', 'About 400MB') },
    { id: 'webgoat', name: 'WebGoat', kind: 'Web', kindLabel: 'Web', category: 'web', provider: 'docker' as const, surface: 'browser' as const, port: ':8080', size: t('约 800MB', 'About 800MB') },
    { id: 'activemq', name: 'Vulhub ActiveMQ', kind: 'Linux', kindLabel: 'Linux', category: 'linux', provider: 'docker' as const, surface: 'shell' as const, port: ':61616', size: t('约 350MB', 'About 350MB') },
    { id: 'avd-34', name: 'Android API 34', kind: t('模拟器', 'Emulator'), kindLabel: t('安卓', 'Android'), category: 'android', provider: 'android-avd' as const, surface: 'emulator' as const, port: 'adb', size: t('本机 AVD', 'Local AVD') },
  ], [t])
  const packageGroups = useMemo(() => groupLabPackages(packages), [packages])

  const sourceItems = useMemo(() => [
    { value: 'local' as const, label: t('本地', 'Local') },
    { value: 'remote' as const, label: t('远程', 'Remote') },
  ], [t])
  const labTabItems = useMemo(() => [
    { value: 'packages' as const, label: t('题目包', 'Packages') },
    { value: 'jobs' as const, label: t('自定义任务', 'Custom jobs') },
  ], [t])
  const screenItems = useMemo(() => [
    { value: 'lab-packages' as const, label: t('实验室·包', 'Lab · packages') },
    { value: 'lab-job' as const, label: t('实验室·作业', 'Lab · job') },
    { value: 'cve-ready' as const, label: t('CVE·有包', 'CVE · with package') },
    { value: 'cve-live' as const, label: t('网页靶', 'Web target') },
    { value: 'cve-shell' as const, label: t('终端靶', 'Terminal target') },
    { value: 'cve-emulator' as const, label: t('模拟器', 'Emulator') },
    { value: 'cve-agent' as const, label: t('Agent 操作', 'Agent driving') },
    { value: 'cve-none' as const, label: t('CVE·无包', 'CVE · no package') },
    { value: 'coding-from-cve' as const, label: t('展开 Coding', 'Expand Coding') },
    { value: 'docker-down' as const, label: t('Docker 未运行', 'Docker is not running') },
  ], [t])
  const cveStatusOptions = useMemo(() => [
    { value: '研究中', label: t('研究中', 'In research') },
    { value: '想研究', label: t('想研究', 'Want to research') },
  ], [t])

  const sidebarSection = section === 'chat' ? 'chat' : section
  const screen: PreviewScreen = (() => {
    if (!dockerOk && section !== 'chat') return 'docker-down'
    if (section === 'chat') return 'coding-from-cve'
    if (section === 'vuln' && cveId === 'CVE-2024-3400') return 'cve-none'
    if (section === 'vuln' && targetOpen) {
      if (agentDriving) return 'cve-agent'
      if (targetKind === 'shell') return 'cve-shell'
      if (targetKind === 'emulator') return 'cve-emulator'
      return 'cve-live'
    }
    if (section === 'vuln') return 'cve-ready'
    if (labJobId) return 'lab-job'
    return labTab === 'packages' ? 'lab-packages' : 'lab-job'
  })()

  const noneLease = useMemo<EnvironmentLease>(() => ({
    provider: 'none',
    state: 'none',
    detail: t('没有匹配的练习包。仍可按公开描述写报告。', 'No matching practice package. You can still write a report from the public description.'),
  }), [t])
  const dockerDownLease = useMemo<EnvironmentLease>(() => ({
    provider: 'docker',
    state: 'docker-down',
    packageName: 'OWASP Juice Shop',
    detail: t('打开 Docker Desktop 后再试。', 'Open Docker Desktop and try again.'),
  }), [t])
  const userTargetLease = useMemo<EnvironmentLease>(() => ({
    provider: 'user-attached',
    state: 'ready',
    packageName: t('用户自带靶', 'User-attached target'),
    address: 'http://127.0.0.1:8081',
    detail: t('本机地址 · 不由 MilkSU 启动', 'Local address · not started by MilkSU'),
  }), [t])

  const cveLease = !dockerOk
    ? dockerDownLease
    : cveId === 'CVE-2024-3400'
      ? noneLease
      : juiceLease
  const labLease = !dockerOk
    ? dockerDownLease
    : labJobId === 'url-job'
      ? userTargetLease
      : juiceLease
  const codingLease = codingFrom === 'lab' ? labLease : cveLease

  function applyScreen(next: PreviewScreen) {
    setDockerOk(next !== 'docker-down')
    setShowNew(false)
    setShowReproAsk(false)
    setTargetOpen(next === 'cve-live' || next === 'cve-shell' || next === 'cve-emulator' || next === 'cve-agent')
    setAgentDriving(next === 'cve-agent')
    setTargetKind(next === 'cve-shell' ? 'shell' : next === 'cve-emulator' ? 'emulator' : 'browser')
    if (next === 'docker-down') {
      setSection('vuln')
      setCveId('CVE-2023-46604')
      setJuiceLease(current => ({ ...current, state: 'stopped', address: undefined }))
      return
    }
    if (next === 'lab-packages') {
      setSection('lab')
      setLabTab('packages')
      setLabJobId('')
      return
    }
    if (next === 'lab-job') {
      setSection('lab')
      setLabTab('jobs')
      setLabJobId('juice-job')
      setJuiceLease(juiceReadyLease(t))
      return
    }
    if (next === 'cve-none') {
      setSection('vuln')
      setCveId('CVE-2024-3400')
      return
    }
    if (next === 'cve-live' || next === 'cve-shell' || next === 'cve-emulator' || next === 'cve-agent') {
      setSection('vuln')
      setCveId('CVE-2023-46604')
      if (next === 'cve-shell') {
        setJuiceLease({
          provider: 'docker',
          state: 'ready',
          packageName: 'Vulhub ActiveMQ',
          address: '127.0.0.1:61616',
          detail: dockerReadyDetail(t),
        })
      } else if (next === 'cve-emulator') {
        setJuiceLease({
          provider: 'avd',
          state: 'ready',
          packageName: 'Android API 34',
          address: 'emulator-5554',
          detail: t('本机 AVD · 受限 adb', 'Local AVD · restricted adb'),
        })
      } else {
        setJuiceLease(juiceReadyLease(t))
      }
      return
    }
    if (next === 'coding-from-cve') {
      setSection('chat')
      setCodingFrom('cve')
      setCveId('CVE-2023-46604')
      setJuiceLease(juiceReadyLease(t))
      return
    }
    setSection('vuln')
    setCveId('CVE-2023-46604')
    setJuiceLease(juiceReadyLease(t))
  }

  function navigate(value: WorkspaceSection) {
    if (value === 'ctf') return
    setSection(value)
    if (value === 'lab') {
      setLabTab('packages')
      setLabJobId('')
      setTargetOpen(false)
      setAgentDriving(false)
    }
    if (value === 'vuln') {
      setCveId('')
      setTargetOpen(false)
      setAgentDriving(false)
    }
  }

  function startJuice() {
    setJuiceLease(juiceReadyLease(t))
  }

  function stopJuice() {
    setJuiceLease({
      provider: 'docker',
      state: 'stopped',
      packageName: 'OWASP Juice Shop',
      detail: dockerReadyDetail(t),
    })
    setTargetOpen(false)
    setAgentDriving(false)
  }

  function openTarget() {
    if (juiceLease.state !== 'ready' && dockerOk) startJuice()
    setTargetOpen(true)
  }

  function retryDocker() {
    setDockerOk(true)
    startJuice()
  }

  function openPackage(id: string) {
    startJuice()
    setLabTab('jobs')
    if (id === 'avd-34') {
      setTargetKind('emulator')
      setJuiceLease({
        provider: 'avd',
        state: 'ready',
        packageName: 'Android API 34',
        address: 'emulator-5554',
        detail: t('本机 AVD · 受限 adb', 'Local AVD · restricted adb'),
      })
      setLabJobId('avd-job')
      setTargetOpen(true)
      return
    }
    if (id === 'activemq') {
      setTargetKind('shell')
      setJuiceLease({
        provider: 'docker',
        state: 'ready',
        packageName: 'Vulhub ActiveMQ',
        address: '127.0.0.1:61616',
        detail: dockerReadyDetail(t),
      })
      setLabJobId('mq-job')
      setTargetOpen(true)
      return
    }
    setTargetKind('browser')
    setLabJobId('juice-job')
  }

  function submitNew(event: React.FormEvent) {
    event.preventDefault()
    setShowNew(false)
    setLabJobId('url-job')
  }

  function startRepro() {
    if (cveId === 'CVE-2023-46604' && juiceLease.state !== 'ready' && dockerOk) {
      setShowReproAsk(true)
      return
    }
    if (cveLease.state === 'ready') {
      setTargetOpen(true)
      setAgentDriving(true)
    }
  }

  function confirmStartAndRepro() {
    setShowReproAsk(false)
    startJuice()
    setTargetOpen(true)
    setAgentDriving(true)
  }

  function expandToCoding(from: 'lab' | 'cve') {
    setCodingFrom(from)
    setSection('chat')
  }

  function returnFromCoding() {
    setSection(codingFrom === 'lab' ? 'lab' : 'vuln')
  }

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '') as PreviewScreen
    if (screenItems.some(item => item.value === hash)) applyScreen(hash)
    // Hash bootstrap once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const labTargetVisible = Boolean(targetOpen && labLease.address)
  const cveTargetVisible = Boolean(targetOpen && cveLease.address)
  const dockVisible = section !== 'chat' && ((section === 'lab' && Boolean(labJobId)) || (section === 'vuln' && Boolean(cveId)))
  const dockAddress = section === 'lab' ? labLease.address : cveLease.address

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground" data-testid="lab-env-preview">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-caption">
        <span className="text-muted-foreground">{t('交互稿 · 真组件 · 不写后端', 'Preview · live components · no backend')}</span>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5" role="tablist" aria-label={t('画面', 'Screen')}>
          {screenItems.map(item => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={screen === item.value ? 'default' : 'outline'}
              role="tab"
              aria-pressed={screen === item.value}
              aria-selected={screen === item.value}
              onClick={() => applyScreen(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkspaceRail
          activeSection={sidebarSection}
          accountStatus={accountStatus}
          themeMode={themeMode}
          collapsed
          onNavigate={navigate}
          onToggleTheme={() => setThemeMode(mode => (mode === 'dark' ? 'light' : 'dark'))}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {section === 'lab' && !labJobId ? (
            <>
              <WorkspaceModuleTopBar
                module="lab"
                title={t('实验室', 'Lab')}
                actions={(
                  <WorkspaceCatalogActions
                    historyCount={0}
                    historyAriaLabel={t('打开任务历史', 'Open job history')}
                    historyMenuLabel={t('任务历史', 'Job history')}
                    action="create"
                    actionAriaLabel={t('创建自定义任务', 'Create a custom job')}
                    onAction={() => setShowNew(true)}
                  />
                )}
                filters={(
                  <div className="flex min-w-0 items-center gap-2" role="tablist" aria-label={t('实验室分段', 'Lab sections')}>
                    {labTabItems.map(item => (
                      <Button
                        key={item.value}
                        size="sm"
                        variant={labTab === item.value ? 'default' : 'outline'}
                        role="tab"
                        aria-pressed={labTab === item.value}
                        aria-selected={labTab === item.value}
                        onClick={() => setLabTab(item.value)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                )}
              />

              {labTab === 'packages' ? (
                <section className="page-scroll flex-1 bg-background" aria-label={t('题目包', 'Packages')}>
                  <div className="page-column page-stack">
                    {packageGroups.map(group => (
                      <section key={group.category} data-testid="lab-pack-group" aria-label={group.label}>
                        <h2 className="mb-3 flex items-baseline gap-2 text-label font-medium text-muted-foreground">
                          <span>{group.label}</span>
                          <span className="font-mono text-caption">{group.packages.length}</span>
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {group.packages.map(item => (
                            <ActionCard
                              key={item.id}
                              data-testid="package-row"
                              title={item.name}
                              description={`${item.kind} · ${item.port}`}
                              icon={item.id === 'avd-34' ? <Smartphone /> : <Box />}
                              onClick={() => openPackage(item.id)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="min-h-0 flex-1 overflow-auto bg-card" aria-label={t('自定义任务', 'Custom jobs')}>
                  <div className="min-w-[720px]">
                    <div className="grid h-12 grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                      <span>{t('任务', 'Job')}</span>
                      <span>{t('范围', 'Scope')}</span>
                      <span>{t('环境', 'Environment')}</span>
                      <span className="sr-only">{t('打开', 'Open')}</span>
                    </div>
                    <article className="grid min-h-[72px] grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 px-6 hover:bg-accent">
                      <span className="truncate text-control font-medium">{t('本机 8081 探测', 'Local 8081 probe')}</span>
                      <span className="text-body">{t('本地', 'Local')}</span>
                      <span className="text-caption">{t('用户目标', 'User target')}</span>
                      <Button size="sm" variant="outline" onClick={() => setLabJobId('url-job')}>{t('打开', 'Open')}</Button>
                    </article>
                  </div>
                </section>
              )}
            </>
          ) : section === 'lab' ? (
            <>
              <WorkspaceModuleTopBar
                module="lab"
                title={labJobId === 'url-job' ? t('本机 8081 探测', 'Local 8081 probe') : t('Juice Shop 练习', 'Juice Shop practice')}
                subtitle={t('本地', 'Local')}
                leading={(
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('返回实验室', 'Back to Lab')}
                    onClick={() => {
                      setLabJobId('')
                      setTargetOpen(false)
                      setAgentDriving(false)
                    }}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                actions={<Button variant="outline" size="sm" onClick={() => expandToCoding('lab')}>{t('进入 Coding', 'Open in Coding')}</Button>}
              />
              <div className="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
                <div
                  className={`page-scroll min-w-0${labTargetVisible ? '' : ' flex-1'}`}
                  style={labTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined}
                >
                  <div className={`page-stack ${labTargetVisible ? 'page-stack--flush' : 'page-column'}`}>
                    <SettingsSection title={t('题面', 'Brief')}>
                      <SettingsRow
                        stack="always"
                        description={labJobId === 'url-job' ? t('扫一下本机 8081。', 'Probe local port 8081.') : t('对 Juice Shop 做一轮授权练习，过程写入报告。', 'Run an authorized Juice Shop practice round and write the process into the report.')}
                        divider={false}
                      />
                    </SettingsSection>
                    <EnvironmentStrip
                      lease={labLease}
                      onStart={startJuice}
                      onStop={stopJuice}
                      onOpenTarget={openTarget}
                      onRetry={retryDocker}
                    />
                    <SettingsSection title={t('报告', 'Report')}>
                      <SettingsRow stack="always" description={t('摘要、范围、当前状况、步骤会写在 report.md。', 'Summary, scope, current status, and steps are written to report.md.')} divider={false} />
                    </SettingsSection>
                  </div>
                </div>
                {labTargetVisible ? (
                  <div className="relative flex min-h-0 min-w-0 flex-1">
                    <div
                      className="dossier-split-handle app-no-drag"
                      role="separator"
                      aria-orientation="vertical"
                      data-testid="dossier-split"
                      aria-label={t('调节题面宽度', 'Resize the brief pane')}
                      onPointerDown={event => split.startResize(event.nativeEvent)}
                    />
                    <TargetSurfacePreview
                      kind={targetKind}
                      address={labLease.address ?? ''}
                      driving={agentDriving}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : section === 'vuln' && !cveId ? (
            <>
              <WorkspaceModuleTopBar
                module="cve"
                title="CVE"
                actions={(
                  <WorkspaceCatalogActions
                    historyCount={0}
                    historyAriaLabel={t('打开研究历史', 'Open research history')}
                    historyMenuLabel={t('研究历史', 'Research history')}
                    actionAriaLabel={t('导入 CVE', 'Import CVE')}
                  />
                )}
              />
              <section className="min-h-0 flex-1 overflow-auto bg-card" aria-label={t('CVE 列表', 'CVE list')}>
                <div className="min-w-[720px]">
                  <div className="grid h-12 grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                    <span>CVE</span>
                    <span>{t('标题', 'Title')}</span>
                    <span>{t('状态', 'Status')}</span>
                    <span className="sr-only">{t('打开', 'Open')}</span>
                  </div>
                  <article className="grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6 hover:bg-accent" data-testid="cve-row">
                    <span className="font-mono text-body">CVE-2023-46604</span>
                    <span className="truncate text-control font-medium">Apache ActiveMQ OpenWire RCE</span>
                    <Badge variant="warning">{t('研究中', 'In research')}</Badge>
                    <Button size="sm" variant="outline" data-testid="open-cve-ready" onClick={() => setCveId('CVE-2023-46604')}>{t('打开', 'Open')}</Button>
                  </article>
                  <article className="grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6 hover:bg-accent">
                    <span className="font-mono text-body">CVE-2024-3400</span>
                    <span className="truncate text-control font-medium">{t('PAN-OS GlobalProtect 命令注入', 'PAN-OS GlobalProtect command injection')}</span>
                    <Badge variant="outline">{t('想研究', 'Want to research')}</Badge>
                    <Button size="sm" variant="outline" data-testid="open-cve-none" onClick={() => setCveId('CVE-2024-3400')}>{t('打开', 'Open')}</Button>
                  </article>
                </div>
              </section>
            </>
          ) : section === 'vuln' ? (
            <>
              <WorkspaceModuleTopBar
                module="cve"
                title={cveId}
                subtitle={cveId === 'CVE-2024-3400' ? t('PAN-OS GlobalProtect 命令注入', 'PAN-OS GlobalProtect command injection') : 'Apache ActiveMQ OpenWire RCE'}
                leading={(
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('返回漏洞列表', 'Back to CVE list')}
                    onClick={() => {
                      setCveId('')
                      setTargetOpen(false)
                      setAgentDriving(false)
                    }}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                actions={(
                  <>
                    <NativeSelect defaultValue="研究中" className="h-8 w-32" aria-label={t('状态', 'Status')}>
                      {cveStatusOptions.map(option => (
                        <NativeSelectOption key={option.value} value={option.value}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Button variant="brand" size="sm" data-testid="start-repro" onClick={startRepro}>{t('开始复现', 'Start reproduction')}</Button>
                  </>
                )}
              />
              <div className="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
                <div
                  className={`page-scroll min-w-0${cveTargetVisible ? '' : ' flex-1'}`}
                  style={cveTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined}
                >
                  <div className={`page-stack ${cveTargetVisible ? 'page-stack--flush' : 'page-column'}`}>
                    <SettingsSection title={t('摘要', 'Summary')}>
                      <SettingsRow
                        stack="always"
                        description={cveId === 'CVE-2024-3400'
                          ? t('公开描述可在档案里复现阅读。当前切片没有匹配的练习包。', 'The public description can be reread in the dossier. This slice has no matching practice package.')
                          : t('OpenWire 反序列化导致远程代码执行。有白名单练习包时可在本机拉起。', 'OpenWire deserialization leads to remote code execution. An allowlisted practice package can be started locally.')}
                        divider={false}
                      />
                    </SettingsSection>
                    <EnvironmentStrip
                      lease={cveLease}
                      onStart={startJuice}
                      onStop={stopJuice}
                      onOpenTarget={openTarget}
                      onRetry={retryDocker}
                    />
                    <SettingsSection title={t('报告', 'Report')}>
                      <SettingsRow stack="always" description={t('环境就绪不等于复现成功。过程写入 report.md。', 'A ready environment is not a successful reproduction. The process is written to report.md.')} divider={false} />
                    </SettingsSection>
                  </div>
                </div>
                {cveTargetVisible ? (
                  <div className="relative flex min-h-0 min-w-0 flex-1">
                    <div
                      className="dossier-split-handle app-no-drag"
                      role="separator"
                      aria-orientation="vertical"
                      data-testid="dossier-split"
                      aria-label={t('调节档案宽度', 'Resize the dossier pane')}
                      onPointerDown={event => split.startResize(event.nativeEvent)}
                    />
                    <TargetSurfacePreview
                      kind={targetKind}
                      address={cveLease.address ?? ''}
                      driving={agentDriving}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : section === 'chat' ? (
            <>
              <WorkspaceModuleTopBar
                module="coding"
                title="Coding"
                subtitle={codingFrom === 'lab' ? t('来自实验室', 'From Lab') : t('来自 CVE', 'From CVE')}
                actions={(
                  <Button variant="outline" size="sm" data-testid="return-domain" onClick={returnFromCoding}>
                    <RotateCcw className="size-3.5" />
                    {codingFrom === 'lab' ? t('返回实验室', 'Back to Lab') : t('返回 CVE', 'Back to CVE')}
                  </Button>
                )}
              />
              <div className="flex min-h-0 flex-1">
                <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card" aria-label={t('任务信息', 'Job info')}>
                  <header className="flex h-12 items-center gap-2 px-4 text-control font-medium">
                    {codingFrom === 'lab' ? t('来自实验室', 'From Lab') : t('来自 CVE', 'From CVE')}
                  </header>
                  <div className="space-y-3 px-4 py-4 text-body">
                    <p className="font-medium">{codingFrom === 'lab' ? t('Juice Shop 练习', 'Juice Shop practice') : 'CVE-2023-46604'}</p>
                    <p className="text-caption text-muted-foreground">{t('同一会话 · 展开不算离开作业', 'Same session · expanding is not leaving the job')}</p>
                    <EnvironmentStrip compact lease={codingLease} onStart={startJuice} onStop={stopJuice} onOpenTarget={() => setTargetOpen(true)} onRetry={retryDocker} />
                  </div>
                </aside>
                <section className="flex min-w-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 px-6 py-6 text-body text-muted-foreground">
                    {t('Coding 大窗。Agent 只打 Scope 里的当前靶。实验室不嵌整页 Agent。', 'Coding full window. The agent only hits the current target in Scope. Lab does not embed a full-page agent.')}
                  </div>
                  <div className="border-t border-border px-6 py-3">
                    {codingLease.address ? (
                      <p className="mb-2 text-caption" data-testid="coding-target-chip">{t(`当前靶 ${codingLease.address}`, `Current target ${codingLease.address}`)}</p>
                    ) : null}
                    <Input disabled placeholder={t('对话仍是同一条 Coding 会话', 'Chat is still the same Coding session')} />
                  </div>
                </section>
              </div>
            </>
          ) : null}
        </main>
      </div>

      {dockVisible ? (
        <aside
          className="pointer-events-auto fixed bottom-5 right-5 z-40 w-80 rounded-xl border border-border bg-card shadow-xl"
          data-testid="preview-dock"
        >
          <header className="flex h-9 items-center gap-2 border-b border-border px-3 text-caption">
            <strong className="text-control">{t('对话', 'Chat')}</strong>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('引用 Coding', 'Cite Coding')}</span>
            {dockAddress ? (
              <span className="truncate text-caption">
                {t(`当前靶 ${dockAddress}`, `Current target ${dockAddress}`)}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('进入 Coding', 'Open Coding')}
              data-testid="expand-coding"
              onClick={() => expandToCoding(section === 'lab' ? 'lab' : 'cve')}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </header>
          <p className="px-3 py-3 text-caption text-muted-foreground">{t('小窗就是 Coding 循环。需要终端或 Git 再展开。', 'The small pane is the Coding loop. Expand when you need a terminal or Git.')}</p>
        </aside>
      ) : null}

      <WorkspaceImportDialog
        open={showNew}
        title={t('创建', 'Create')}
        description={t('范围和要求', 'Scope and request')}
        onOpenChange={setShowNew}
      >
        <SettingsSection title={t('自定义任务', 'Custom job')}>
          <form className="grid gap-4 px-4 py-4" onSubmit={submitNew}>
            <div>
              <p className="mb-2 text-caption text-muted-foreground">{t('范围', 'Scope')}</p>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('范围', 'Scope')}>
                {sourceItems.map(item => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={newSource === item.value ? 'default' : 'outline'}
                    role="tab"
                    aria-pressed={newSource === item.value}
                    aria-selected={newSource === item.value}
                    onClick={() => setNewSource(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <label className="text-caption text-muted-foreground">
              {t('要求', 'Request')}
              <textarea className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-body" aria-label={t('要求', 'Request')} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>{t('取消', 'Cancel')}</Button>
              <Button type="submit" variant="brand">{t('启动并打开', 'Start and open')}</Button>
            </div>
          </form>
        </SettingsSection>
      </WorkspaceImportDialog>

      <Dialog open={showReproAsk} onOpenChange={setShowReproAsk}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('这个洞有练习包。先启动？', 'This CVE has a practice package. Start it first?')}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowReproAsk(false)}>{t('只写报告', 'Report only')}</Button>
            <Button variant="brand" data-testid="start-and-repro" onClick={confirmStartAndRepro}>{t('启动并复现', 'Start and reproduce')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        .dossier-split-handle {
          position: absolute;
          inset: 0 auto 0 0;
          z-index: 2;
          width: 8px;
          margin-left: -3px;
          cursor: col-resize;
          touch-action: none;
          border: 0;
          padding: 0;
          background: transparent;
        }
        .dossier-split-handle::after {
          position: absolute;
          inset: 0 3px;
          background: transparent;
          content: '';
        }
        .dossier-split-handle:hover::after,
        .dossier-split-handle:focus-visible::after {
          background: var(--brand);
          opacity: .55;
        }
      `}</style>
    </div>
  )
}
