import { useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Globe,
  MoreVertical,
  Pencil,
  Radio,
  ShieldAlert,
  Smartphone,
  SquareTerminal,
} from 'lucide-react'
import { isComposingKey } from '@/lib/imeComposition'
import ConversationDock from '@/components/ConversationDock'
import ResearchReportPanel from '@/components/ResearchReportPanel'
import WorkspaceCatalogActions, { type WorkspaceCatalogActionsHandle } from '@/components/WorkspaceCatalogActions'
import WorkspaceCatalogHistoryItem from '@/components/WorkspaceCatalogHistoryItem'
import WorkspaceImportDialog from '@/components/WorkspaceImportDialog'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
import { invokeCommand } from '@/desktop'
import { labScopeLabel, type LabJob, type LabScope } from '@/composables/useLabJobs'
import { useLabJobs } from '@/stores/labJobsStore'
import { toStripLease, useEnvLease } from '@/composables/useEnvLease'
import type { EnvChallenge, EnvLease, EnvPackage } from '@/envbroker'
import EnvironmentStrip from '@/components/lab-env/EnvironmentStrip'
import TargetLivePane from '@/components/lab-env/TargetLivePane'
import { useDossierSplit } from '@/lib/useDossierSplit'
import { groupLabPackages, type LabPackageCategory } from '@/lib/labPackageCategory'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import { useT } from '@/hooks/useUiLocale'
import type { Conversation } from '@/types'

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

function ModelListRow({
  label,
  meta,
  last,
  trailing,
  onClick,
}: {
  label: string
  meta?: string
  last?: boolean
  trailing?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-accent ${last ? '' : 'border-b border-border'}`}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {meta ? <span className="mt-0.5 block text-sm text-muted-foreground">{meta}</span> : null}
      </span>
      {trailing}
    </button>
  )
}

export default function LabPage({
  conversations: _conversations = [],
  conversation = null,
  running = false,
  aborting = false,
  abortStalled = false,
  settings = null,
  workspacePath = '',
  messageQueue,
  sessionReady = false,
  resumed = false,
  compacting = false,
  compactedAt,
  compactionError,
  turnStatus,
  ctfSession = false,
  vulnerabilitySession = false,
  ctfMode,
  ctfRole,
  modelMode,
  modelProvider,
  modelId,
  modelSourcePreference,
  executionMode,
  approvalPolicy,
  mcpServers = [],
  mcpConfigDigest,
  pendingComposerDraft = null,
  ensureConversation = () => '',
  chatMaximized = false,
  chatDockOpen = true,
  onEnter,
  onRun,
  onRename,
  onSend,
  onAbort,
  onSelectConversation,
  onCreateConversation: _onCreateConversation,
  onExpand,
  onCloseDock,
  onConsumePendingDraft,
  onCompactContext,
  onRewindContext,
  onHandoffContext,
  onControlGoal,
  onRespondApproval,
  onChangeModel,
  onChangeModelSource,
  onChangeCodingPolicy,
  onChangeMcpServers,
  onChooseWorkspace,
  onChooseWorkspaceForNewTask,
  onSelectWorkspace,
  onForgetWorkspace,
  onClearWorkspace,
  onCancelQueuedGuidance,
  onEditQueuedGuidance,
  onOpenSettings,
  onOpenLabSettings,
}: CodingAgentSurfaceBind & {
  conversations?: Conversation[]
  conversation?: Conversation | null
  ensureConversation?: (
    title?: string,
    options?: {
      conversationId?: string
      domainTaskContext?: Conversation['domainTaskContext']
    },
  ) => string
  chatMaximized?: boolean
  chatDockOpen?: boolean
  onEnter?: (job: LabJob) => void
  onRun?: (job: LabJob) => void
  onRename?: (id: string, title: string) => void
  onSend?: (...args: CodingAgentSendArgs) => void
  onAbort?: () => void
  onSelectConversation?: (id: string) => void
  onCreateConversation?: () => void
  onExpand?: () => void
  onCloseDock?: () => void
  onConsumePendingDraft?: () => void
  onCompactContext?: () => void
  onRewindContext?: () => void
  onHandoffContext?: () => void
  onControlGoal?: (action: 'pause' | 'resume' | 'clear') => void
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onChangeModel?: (mode: 'auto' | 'manual', provider?: string, model?: string) => void
  onChangeModelSource?: (preference: 'auto' | 'account' | 'personal') => void
  onChangeCodingPolicy?: (
    executionMode: NonNullable<CodingAgentSurfaceBind['executionMode']>,
    approvalPolicy: NonNullable<CodingAgentSurfaceBind['approvalPolicy']>,
  ) => void
  onChangeMcpServers?: (servers: string[], configDigest: string) => void
  onChooseWorkspace?: () => void
  onChooseWorkspaceForNewTask?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
  onCancelQueuedGuidance?: (index: number) => void
  onEditQueuedGuidance?: (index: number) => void
  onOpenSettings?: () => void
  onOpenLabSettings?: () => void
}) {
  const t = useT()
  const jobsStore = useLabJobs()
  const labJobs = jobsStore.jobs
  const selectedId = jobsStore.selectedId
  const selected = jobsStore.selected
  const lab = useStoreRuntime(() => {
    const env = useEnvLease(
      () => 'lab',
      () => jobsStore.selected?.id ?? '',
      () => jobsStore.selected?.packageId,
    )
    const split = useDossierSplit('milksu.lab-split.v1', 400)
    return {
      store: env.store,
      jobsStore,
      env,
      split,
      mount: env.mount,
      unmount: env.unmount,
    }
  })
  const envLease = lab.env.lease
  const envPackages = lab.env.packages
  const briefWidth = lab.split.width

  const [showNew, setShowNew] = useState(false)
  const catalogActions = useRef<WorkspaceCatalogActionsHandle | null>(null)
  const [draftScope, setDraftScope] = useState<LabScope>('local')
  const [draftRequest, setDraftRequest] = useState('')
  const [labTab, setLabTab] = useState<'jobs' | 'packages'>('packages')
  const [targetOpen, setTargetOpen] = useState(false)
  const [allLeases, setAllLeases] = useState<EnvLease[]>([])
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const renameInput = useRef<HTMLInputElement | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [selectedPackId, setSelectedPackId] = useState('')

  const scopeItems = useMemo(() => [
    { value: 'local' as const, label: t('本地', 'Local') },
    { value: 'remote' as const, label: t('远程', 'Remote') },
  ], [t])
  const labTabItems = useMemo(() => [
    { value: 'packages' as const, label: t('题目包', 'Packages') },
    { value: 'jobs' as const, label: t('自定义任务', 'Custom jobs') },
  ], [t])
  const customJobs = useMemo(() => labJobs.filter(job => !job.packageId), [labJobs])
  const historyJobs = useMemo(() => (
    [...labJobs].sort((left, right) => right.updatedAt - left.updatedAt)
  ), [labJobs])
  const packageGroups = useMemo(() => groupLabPackages(envPackages), [envPackages])
  const selectedPack = envPackages.find(item => item.id === selectedPackId) ?? null
  const boundPackage = envPackages.find(item => item.id === selected?.packageId) ?? null
  const boundChallenge = (() => {
    const id = selected?.challengeId
    if (!id) return null
    return boundPackage?.challenges?.find(item => item.id === id) ?? null
  })()
  const stripLease = selected?.packageId
    ? toStripLease(envLease, {
        name: boundPackage?.name || envLease.packageName,
        provider: boundPackage?.provider || envLease.provider,
      })
    : toStripLease({
        ...envLease,
        provider: 'user-attached',
        detail: t('用户自带靶。没有经纪生命周期。', 'User-attached target. No broker lifecycle.'),
      })
  const liveTargetVisible = targetOpen && envLease.state === 'ready'

  useEffect(() => {
    if (!selectedId) {
      setTargetOpen(false)
      setPendingOpen(false)
    }
  }, [selectedId])

  async function refreshAllLeases() {
    setAllLeases(await lab.env.listLeases())
  }

  useEffect(() => {
    void refreshAllLeases()
    const timer = setInterval(() => { void refreshAllLeases() }, 2000)
    return () => clearInterval(timer)
  }, [])

  function parseOccupyOwner(value?: string) {
    const raw = String(value || '')
    const index = raw.indexOf(':')
    if (index <= 0) return { kind: '', id: '' }
    return { kind: raw.slice(0, index), id: raw.slice(index + 1) }
  }

  function jobEnvDot(job: LabJob) {
    if (!job.packageId) return { className: 'bg-muted-foreground/40', title: t('未绑定', 'Unbound') }
    const lease = allLeases.find(item => item.ownerKind === 'lab' && item.ownerId === job.id)
    switch (lease?.state) {
      case 'ready':
        return { className: 'bg-primary', title: t('就绪', 'Ready') }
      case 'pulling':
        return { className: 'bg-accent', title: t('启动中', 'Starting') }
      case 'failed':
      case 'docker-down':
      case 'busy':
        return { className: 'bg-destructive', title: lease.state === 'busy' ? t('被占用', 'Occupied') : t('失败', 'Failed') }
      default:
        return { className: 'bg-muted-foreground/40', title: t('已停止', 'Stopped') }
    }
  }

  function occupyGo() {
    const occupy = parseOccupyOwner(envLease.occupyOwner)
    if (occupy.kind === 'lab' && occupy.id) {
      const job = labJobs.find(item => item.id === occupy.id)
      if (job) openJob(job)
    }
  }

  async function occupyStop() {
    const occupy = parseOccupyOwner(envLease.occupyOwner)
    if (!occupy.kind || !occupy.id) return
    await invokeCommand('stop_env_lease', { ownerKind: occupy.kind, ownerId: occupy.id }).catch(() => undefined)
    await lab.env.start(selected?.packageId || envLease.packageId)
  }

  function packSummary(pkg: EnvPackage) {
    if (pkg.difficulty && pkg.purpose) return `${pkg.difficulty} · ${pkg.purpose}`
    return pkg.detail || pkg.kindLabel
  }

  function packCategoryIcon(category: LabPackageCategory): ComponentType<{ className?: string }> {
    if (category === 'probe') return Radio
    if (category === 'web') return Globe
    if (category === 'linux') return SquareTerminal
    if (category === 'android') return Smartphone
    if (category === 'cve') return ShieldAlert
    return Box
  }

  function packIntro(pkg: EnvPackage) {
    return pkg.brief || pkg.detail
  }

  function packSubtitle(pkg: EnvPackage) {
    if (pkg.difficulty) return `${pkg.kindLabel} · ${pkg.difficulty}`
    return pkg.kindLabel
  }

  function packHostLine(pkg: EnvPackage) {
    if (pkg.provider === 'android-avd') {
      return pkg.id === 'android-lab'
        ? t('模拟器 MilkSU-Lab · 已预装 InjuredAndroid', 'Emulator MilkSU-Lab · InjuredAndroid preinstalled')
        : t('模拟器 MilkSU-Lab · 空白设备', 'Emulator MilkSU-Lab · blank device')
    }
    if (pkg.address) {
      return `${pkg.surface === 'shell' ? t('终端', 'Terminal') : t('浏览器', 'Browser')} · ${pkg.address}`
    }
    return pkg.detail
  }

  function jobForPackage(packageId: string) {
    return labJobs
      .filter(job => job.packageId === packageId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }

  function openNew() {
    catalogActions.current?.closeHistoryMenu()
    setShowNew(true)
    setDraftScope('local')
    setDraftRequest('')
  }

  function resumeFromHistory(job: LabJob) {
    catalogActions.current?.closeHistoryMenu()
    openJob(job)
  }

  function openPack(pkg: EnvPackage) {
    setShowNew(false)
    setLabTab('packages')
    setSelectedPackId(pkg.id)
  }

  function closePack() {
    setSelectedPackId('')
  }

  async function startPackage(pkg: EnvPackage, challenge?: EnvChallenge) {
    setShowNew(false)
    const focused = challenge || ((pkg.challenges?.length || 0) === 1 ? pkg.challenges?.[0] : undefined)
    const existing = jobForPackage(pkg.id)
    if (existing) {
      if (focused) lab.jobsStore.focusChallenge(existing.id, focused.id, focused.guidance)
      setSelectedPackId('')
      lab.jobsStore.selectedId = existing.id
      onEnter?.(existing)
      setPendingOpen(true)
      await lab.env.start(pkg.id)
      return
    }
    const job = lab.jobsStore.createJob({
      scope: 'local',
      request: focused?.guidance || packIntro(pkg),
      title: pkg.name,
      packageId: pkg.id,
      challengeId: focused?.id,
    })
    setSelectedPackId('')
    onEnter?.(job)
    setPendingOpen(true)
    await lab.env.start(pkg.id)
  }

  function selectChallenge(challenge: EnvChallenge) {
    if (!selected) return
    lab.jobsStore.focusChallenge(selected.id, challenge.id, challenge.guidance)
  }

  function openDocker() {
    void invokeCommand('open_docker_desktop').catch(() => undefined)
  }

  function openTarget() {
    if (envLease.state !== 'ready') return
    setTargetOpen(true)
    const conversationId = conversation?.id || ensureConversation?.(selected?.title)
    if (conversationId && envLease.surface === 'browser' && envLease.address) {
      void invokeCommand('start_coding_browser', {
        conversationId,
        initialUrl: `http://${envLease.address}`,
      }).catch(() => undefined)
    }
  }

  useEffect(() => {
    if (envLease.state === 'ready' && pendingOpen) {
      setPendingOpen(false)
      openTarget()
    }
  }, [envLease.state, pendingOpen])

  function submitNew(event: React.FormEvent) {
    event.preventDefault()
    const request = draftRequest.trim()
    if (!request) return
    const job = lab.jobsStore.createJob({
      scope: draftScope,
      request,
    })
    setShowNew(false)
    onRun?.(job)
  }

  function openJob(job: LabJob) {
    lab.jobsStore.selectedId = job.id
    onEnter?.(job)
  }

  function back() {
    const packId = selected?.packageId
    lab.jobsStore.selectedId = ''
    if (packId) {
      setLabTab('packages')
      setSelectedPackId(packId)
      return
    }
    setLabTab('jobs')
  }

  function openCoding() {
    const job = selected
    if (!job) return
    ensureConversation?.(job.title, {
      conversationId: `lab-job-${job.id}`,
      domainTaskContext: {
        kind: 'lab',
        jobId: job.id,
        title: job.title,
        scope: job.scope,
        request: job.request,
      },
    })
    onExpand?.()
  }

  function startRename(job: LabJob) {
    setEditingJobId(job.id)
    setEditingTitle(job.title)
    queueMicrotask(() => {
      renameInput.current?.focus()
      renameInput.current?.select()
    })
  }

  function finishRename(job: LabJob) {
    if (editingJobId !== job.id) return
    const title = editingTitle.trim().slice(0, 40)
    setEditingJobId(null)
    if (!title || title === job.title) return
    lab.jobsStore.rename(job.id, title)
    onRename?.(job.id, title)
  }

  function cancelRename() {
    setEditingJobId(null)
  }

  function submitRename(event: React.KeyboardEvent, job: LabJob) {
    if (isComposingKey(event.nativeEvent)) return
    event.preventDefault()
    finishRename(job)
  }

  function abortRename(event: React.KeyboardEvent) {
    if (isComposingKey(event.nativeEvent)) return
    event.preventDefault()
    cancelRename()
  }

  const dock = !chatMaximized && chatDockOpen ? (
    <ConversationDock
      conversation={conversation ?? null}
      running={running}
      aborting={aborting}
      abortStalled={abortStalled}
      settings={settings}
      workspacePath={workspacePath}
      messageQueue={messageQueue}
      sessionReady={sessionReady}
      resumed={resumed}
      compacting={compacting}
      compactedAt={compactedAt}
      compactionError={compactionError}
      turnStatus={turnStatus}
      ctfSession={ctfSession}
      vulnerabilitySession={vulnerabilitySession}
      ctfMode={ctfMode}
      ctfRole={ctfRole}
      modelMode={modelMode}
      modelProvider={modelProvider}
      modelId={modelId}
      modelSourcePreference={modelSourcePreference}
      executionMode={executionMode}
      approvalPolicy={approvalPolicy}
      mcpServers={mcpServers}
      mcpConfigDigest={mcpConfigDigest}
      ensureConversation={ensureConversation}
      pendingComposerDraft={pendingComposerDraft}
      onSend={(...args: CodingAgentSendArgs) => onSend?.(...args)}
      onAbort={onAbort}
      onSelect={onSelectConversation}
      onClose={onCloseDock}
      onExpand={onExpand}
      onConsumePendingDraft={onConsumePendingDraft}
      onCompactContext={onCompactContext}
      onRewindContext={onRewindContext}
      onHandoffContext={onHandoffContext}
      onControlGoal={onControlGoal}
      onRespondApproval={onRespondApproval}
      onChangeModel={onChangeModel}
      onChangeModelSource={onChangeModelSource}
      onChangeCodingPolicy={onChangeCodingPolicy}
      onChangeMcpServers={onChangeMcpServers}
      onChooseWorkspace={onChooseWorkspace}
      onChooseWorkspaceForNewTask={onChooseWorkspaceForNewTask}
      onSelectWorkspace={onSelectWorkspace}
      onForgetWorkspace={onForgetWorkspace}
      onClearWorkspace={onClearWorkspace}
      onCancelQueuedGuidance={onCancelQueuedGuidance}
      onEditQueuedGuidance={onEditQueuedGuidance}
      onOpenSettings={onOpenSettings}
    />
  ) : null

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {!selected ? (
        <>
          <WorkspaceModuleTopBar
            module="lab"
            title={selectedPack ? selectedPack.name : t('实验室', 'Lab')}
            subtitle={selectedPack ? packSubtitle(selectedPack) : ''}
            leading={selectedPack ? (
              <Button variant="ghost" size="icon-sm" aria-label={t('返回题目包', 'Back to packages')} onClick={closePack}>
                <ArrowLeft className="size-4" />
              </Button>
            ) : undefined}
            actions={!selectedPack ? (
              <WorkspaceCatalogActions
                ref={catalogActions}
                historyCount={historyJobs.length}
                historyAriaLabel={t('打开任务历史', 'Open job history')}
                historyMenuLabel={t('任务历史', 'Job history')}
                action="create"
                actionAriaLabel={t('创建自定义任务', 'Create a custom job')}
                onAction={openNew}
                history={historyJobs.map(job => (
                  <WorkspaceCatalogHistoryItem
                    key={job.id}
                    title={job.title}
                    subtitle={job.packageId ? t('题目包', 'Package') : labScopeLabel(job.scope)}
                    time={job.updatedAt}
                    current={selectedId === job.id}
                    onSelect={() => resumeFromHistory(job)}
                  />
                ))}
              />
            ) : undefined}
            filters={!selectedPack ? (
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
            ) : undefined}
          />

          {labTab === 'packages' && selectedPack ? (
            <section className="page-scroll flex-1 bg-background" aria-label={t('靶机', 'Target')}>
              <div className="page-column page-stack">
                <SettingsSection title={t('简介', 'Overview')} data-testid="lab-pack-intro">
                  {selectedPack.source ? <SettingsRow label={t('来源', 'Source')} description={selectedPack.source} /> : null}
                  {selectedPack.purpose ? <SettingsRow label={t('用途', 'Purpose')} description={selectedPack.purpose} /> : null}
                  {selectedPack.difficulty ? <SettingsRow label={t('难度', 'Difficulty')} description={selectedPack.difficulty} /> : null}
                  <SettingsRow stack="always" label={t('说明', 'Notes')} description={packIntro(selectedPack)} divider={false} />
                </SettingsSection>
                <SettingsSection title={t('靶机', 'Target')} data-testid="lab-machine-card">
                  <SettingsRow
                    label={selectedPack.name}
                    description={packHostLine(selectedPack)}
                    divider={false}
                    trailing={<Button size="sm" variant="brand" onClick={() => { void startPackage(selectedPack) }}>{t('启动', 'Start')}</Button>}
                  >
                    {selectedPack.provider === 'android-avd' ? <Smartphone className="size-4" /> : <Box className="size-4" />}
                  </SettingsRow>
                </SettingsSection>
                {(selectedPack.challenges?.length || 0) > 1 ? (
                  <SettingsSection title={t('题目', 'Challenges')}>
                    {selectedPack.challenges?.map((challenge, index) => (
                      <div key={challenge.id} className="contents" data-testid="lab-flag-row">
                        <ModelListRow
                          label={challenge.title}
                          meta={`${challenge.kind} · ${challenge.guidance}`}
                          last={index === (selectedPack.challenges?.length || 0) - 1}
                          onClick={() => { void startPackage(selectedPack, challenge) }}
                          trailing={<ChevronRight className="size-4 text-muted-foreground" />}
                        />
                      </div>
                    ))}
                  </SettingsSection>
                ) : null}
              </div>
            </section>
          ) : labTab === 'packages' ? (
            <section className="page-scroll flex-1 bg-background" aria-label={t('题目包', 'Packages')}>
              <div className="page-column page-stack">
                {packageGroups.map(group => {
                  const Icon = packCategoryIcon(group.category)
                  return (
                    <section key={group.category} data-testid="lab-pack-group" aria-label={group.label}>
                      <h2 className="mb-3 flex items-baseline gap-2 text-label font-medium text-muted-foreground">
                        <span>{group.label}</span>
                        <span className="font-mono text-caption">{group.packages.length}</span>
                      </h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {group.packages.map(item => (
                          <ActionCard
                            key={item.id}
                            data-testid="lab-pack-card"
                            title={item.name}
                            description={packSummary(item)}
                            icon={<Icon />}
                            onClick={() => openPack(item)}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            </section>
          ) : (
            <section className="min-h-0 flex-1 overflow-auto bg-card" aria-label={t('自定义任务', 'Custom jobs')}>
              {!customJobs.length ? (
                <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <p className="text-body text-muted-foreground">{t('还没有自定义任务。', 'No custom jobs.')}</p>
                  <Button size="sm" variant="brand" onClick={() => setLabTab('packages')}>{t('看题目包', 'Browse packages')}</Button>
                </div>
              ) : (
                <div className="min-w-[720px]">
                  <div className="grid h-12 grid-cols-[minmax(200px,1fr)_80px_56px_120px_40px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                    <span>{t('任务', 'Job')}</span><span>{t('范围', 'Scope')}</span><span>{t('环境', 'Environment')}</span><span>{t('最近', 'Recent')}</span><span className="sr-only">{t('操作', 'Actions')}</span><span className="sr-only">{t('打开', 'Open')}</span>
                  </div>
                  {customJobs.map(job => (
                    <article
                      key={job.id}
                      className="grid min-h-[72px] w-full grid-cols-[minmax(200px,1fr)_80px_56px_120px_40px_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-accent"
                      data-testid="catalog-row"
                    >
                      {editingJobId === job.id ? (
                        <Input
                          ref={renameInput}
                          value={editingTitle}
                          onChange={event => setEditingTitle(event.target.value)}
                          className="h-8 min-w-0"
                          aria-label={t('编辑任务标题', 'Edit job title')}
                          maxLength={40}
                          onKeyDown={event => {
                            if (event.key === 'Enter') submitRename(event, job)
                            if (event.key === 'Escape') abortRename(event)
                          }}
                          onBlur={() => finishRename(job)}
                        />
                      ) : (
                        <span
                          className="truncate text-control font-medium select-text"
                          data-testid="lab-job-title"
                          onDoubleClick={() => startRename(job)}
                        >{job.title}</span>
                      )}
                      <span className="text-body">{labScopeLabel(job.scope)}</span>
                      <span
                        className={`inline-block size-2 rounded-full ${jobEnvDot(job).className}`}
                        title={jobEnvDot(job).title}
                        data-testid="lab-env-dot"
                      />
                      <span className="text-caption text-muted-foreground">{new Date(job.updatedAt).toLocaleDateString()}</span>
                      {editingJobId !== job.id ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={t('任务操作', 'Job actions')} onClick={event => event.stopPropagation()}>
                              <MoreVertical className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={4} className="w-40">
                            <DropdownMenuItem aria-label={t('重命名任务', 'Rename job')} onSelect={() => startRename(job)}>
                              <Pencil className="size-4" />{t('重命名', 'Rename')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="size-8" aria-hidden="true" />
                      )}
                      <Button size="sm" variant="outline" data-testid="open-item" onClick={() => openJob(job)}>{t('打开', 'Open')}</Button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          <footer className="flex h-14 shrink-0 items-center border-t border-border px-6">
            {labTab === 'packages' && selectedPack ? (
              <span className="text-caption text-muted-foreground">
                {t('1 台靶机', '1 target')}{(selectedPack.challenges?.length || 0) > 1 ? <> · {t(`${selectedPack.challenges?.length} 题`, `${selectedPack.challenges?.length} challenges`)}</> : null}
              </span>
            ) : labTab === 'packages' ? (
              <span className="text-caption text-muted-foreground">{t(`${envPackages.length} 个题目包`, `${envPackages.length} packages`)}</span>
            ) : (
              <span className="text-caption text-muted-foreground">{t(`共 ${customJobs.length} 条`, `${customJobs.length} items`)}</span>
            )}
          </footer>
        </>
      ) : (
        <>
          <WorkspaceModuleTopBar
            module="lab"
            title={selected.title}
            subtitle={labScopeLabel(selected.scope)}
            leading={(
              <Button variant="ghost" size="icon-sm" aria-label={t('返回实验室', 'Back to Lab')} onClick={back}>
                <ArrowLeft className="size-4" />
              </Button>
            )}
            actions={<Button variant="outline" size="sm" onClick={openCoding}>{t('最大化对话', 'Maximize chat')}</Button>}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
            <div
              className={`flex min-h-0 min-w-0 flex-col ${liveTargetVisible ? '' : 'flex-1'}`}
              style={liveTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined}
            >
              <div className="page-scroll flex-1">
                <div className={`page-stack ${liveTargetVisible ? 'page-stack--flush' : 'page-column'}`}>
                  <SettingsSection title={t('题面', 'Brief')}>
                    {boundPackage?.source ? <SettingsRow label={t('来源', 'Source')} description={boundPackage.source} /> : null}
                    {boundPackage?.purpose ? <SettingsRow label={t('用途', 'Purpose')} description={boundPackage.purpose} /> : null}
                    {boundPackage?.difficulty ? <SettingsRow label={t('难度', 'Difficulty')} description={boundPackage.difficulty} /> : null}
                    {boundPackage ? (
                      <SettingsRow stack="always" label={t('说明', 'Notes')} description={packIntro(boundPackage)} />
                    ) : null}
                    {(boundPackage?.challenges?.length || 0) > 1 ? boundPackage?.challenges?.map((challenge, index) => (
                      <div key={challenge.id} className="contents" data-testid="lab-flag-row">
                        <ModelListRow
                          label={challenge.title}
                          meta={`${challenge.kind} · ${challenge.guidance}`}
                          last={index === (boundPackage?.challenges?.length || 0) - 1}
                          onClick={() => selectChallenge(challenge)}
                          trailing={<ChevronRight className="size-4 text-muted-foreground" />}
                        />
                      </div>
                    )) : null}
                    <SettingsRow
                      stack="always"
                      label={t('当前', 'Current')}
                      description={boundChallenge?.guidance || selected.request}
                      divider={false}
                      data-testid="lab-challenges"
                    />
                  </SettingsSection>
                  <EnvironmentStrip
                    lease={stripLease}
                    onStart={() => { void lab.env.start(selected.packageId || envLease.packageId) }}
                    onStop={() => { void lab.env.stop() }}
                    onReset={() => { void lab.env.reset() }}
                    onOpenTarget={openTarget}
                    onRetry={() => { void lab.env.start(selected.packageId || envLease.packageId) }}
                    onOpenDocker={openDocker}
                    onOccupyGo={occupyGo}
                    onOccupyStop={() => { void occupyStop() }}
                    onOpenLabSettings={onOpenLabSettings}
                  />
                  <SettingsSection title={t('报告', 'Report')}>
                    <ResearchReportPanel
                      className="px-4 py-3 text-body leading-6"
                      workspacePath={workspacePath || conversation?.workspacePath || ''}
                      refreshKey={running ? 'run' : conversation?.messages.length}
                    />
                  </SettingsSection>
                </div>
              </div>
            </div>
            {liveTargetVisible ? (
              <div className="relative flex min-h-0 min-w-0 flex-1">
                <div
                  className="dossier-split-handle app-no-drag"
                  role="separator"
                  aria-orientation="vertical"
                  data-testid="dossier-split"
                  aria-label={t('调节题面宽度', 'Resize the brief pane')}
                  onPointerDown={event => lab.split.startResize(event.nativeEvent)}
                />
                <TargetLivePane lease={envLease} conversationId={conversation?.id} />
              </div>
            ) : null}
          </div>
        </>
      )}
      {dock}
      <WorkspaceImportDialog
        open={showNew}
        onOpenChange={setShowNew}
        title={t('创建', 'Create')}
        description={t('范围和要求', 'Scope and request')}
      >
        <SettingsSection title={t('自定义任务', 'Custom job')}>
          <form className="grid gap-4 px-4 py-4" onSubmit={submitNew}>
            <div>
              <p className="mb-2 text-caption text-muted-foreground">{t('范围', 'Scope')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('范围', 'Scope')}>
                {scopeItems.map(item => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={draftScope === item.value ? 'default' : 'outline'}
                    aria-pressed={draftScope === item.value}
                    onClick={() => setDraftScope(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <label className="text-caption text-muted-foreground">{t('要求', 'Request')}
              <textarea
                value={draftRequest}
                onChange={event => setDraftRequest(event.target.value)}
                className="mt-1 min-h-32 w-full resize-y rounded-md border border-border px-3 py-2 text-body outline-none"
                aria-label={t('要求', 'Request')}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>{t('取消', 'Cancel')}</Button>
              <Button type="submit" variant="brand" disabled={!draftRequest.trim()}>{t('开始', 'Start')}</Button>
            </div>
          </form>
        </SettingsSection>
      </WorkspaceImportDialog>
      <style>{`
        .dossier-split-handle { position: absolute; inset: 0 auto 0 0; z-index: 2; width: 8px; margin-left: -3px; cursor: col-resize; touch-action: none; border: 0; padding: 0; background: transparent; }
        .dossier-split-handle::after { position: absolute; inset: 0 3px; background: transparent; content: ''; }
        .dossier-split-handle:hover::after,
        .dossier-split-handle:focus-visible::after { background: var(--brand); opacity: .55; }
      `}</style>
    </main>
  )
}
