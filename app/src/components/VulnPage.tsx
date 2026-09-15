import { useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Search,
} from 'lucide-react'
import CollectionPicker from '@/components/CollectionPicker'
import CollectionViewFilter from '@/components/CollectionViewFilter'
import ConversationDock from '@/components/ConversationDock'
import RelatedCvePanel from '@/components/RelatedCvePanel'
import ResearchReportPanel from '@/components/ResearchReportPanel'
import WorkspaceCatalogActions, { type WorkspaceCatalogActionsHandle } from '@/components/WorkspaceCatalogActions'
import WorkspaceCatalogHistoryItem from '@/components/WorkspaceCatalogHistoryItem'
import WorkspaceImportDialog from '@/components/WorkspaceImportDialog'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
import EnvironmentStrip from '@/components/lab-env/EnvironmentStrip'
import TargetLivePane from '@/components/lab-env/TargetLivePane'
import { invokeCommand } from '@/desktop'
import { toStripLease, useEnvLease } from '@/composables/useEnvLease'
import type { EnvPackage } from '@/envbroker'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask, type VulnerabilityDashboard, type VulnerabilitySearchCandidate } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import { vulnerabilityStatusLabel, type VulnerabilityIntel, type VulnerabilitySeverity, type VulnerabilityStatus } from '@/vulnerabilityIntel'
import { ALL_COLLECTIONS_ID, createItemCollectionStore } from '@/lib/itemCollections'
import { conversationActivityAt } from '@/lib/workspaceSessionRouting'
import { presentVulnerabilityVendorProduct } from '@/lib/vulnerabilityFeedImport'
import { useDossierSplit } from '@/lib/useDossierSplit'
import { useT } from '@/hooks/useUiLocale'

export default function VulnPage({
  dashboard: dashboardProp,
  codingWorkspacePath: _codingWorkspacePath = '',
  navigationEpoch = 0,
  conversations = [],
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
  onChooseCodingWorkspace: _onChooseCodingWorkspace,
  onStartCodingTask: _onStartCodingTask,
  onOpenCodingConversation: _onOpenCodingConversation,
  onEnter,
  onRun,
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
  dashboard?: VulnerabilityDashboard
  codingWorkspacePath?: string
  navigationEpoch?: number
  conversations?: Conversation[]
  conversation?: Conversation | null
  ensureConversation?: (title?: string) => string
  chatMaximized?: boolean
  chatDockOpen?: boolean
  onChooseCodingWorkspace?: () => void
  onStartCodingTask?: (task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void) => void
  onOpenCodingConversation?: (id: string) => void
  onEnter?: (item: VulnerabilityIntel) => void
  onRun?: (item: VulnerabilityIntel) => void
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
  const localDashboard = useStoreRuntime(() => useVulnerabilityDashboard())
  const dashboard = dashboardProp ?? localDashboard
  const tracked = dashboard.tracked
  const query = dashboard.query
  const severity = dashboard.severity
  const selectedId = dashboard.selectedId
  const watched = dashboard.watched
  const sourceRefreshSummary = dashboard.sourceRefreshSummary
  const env = useStoreRuntime(() => {
    let ownerId = ''
    let packageId: string | undefined
    const lease = useEnvLease(() => 'cve', () => ownerId, () => packageId)
    const split = useDossierSplit('milksu.cve-split.v1', 400)
    return {
      store: lease.store,
      get ownerId() { return ownerId },
      set ownerId(value: string) { ownerId = value },
      get packageId() { return packageId },
      set packageId(value: string | undefined) { packageId = value },
      lease,
      split,
      mount: lease.mount,
      unmount: lease.unmount,
    }
  })
  const envLease = env.lease.lease
  const briefWidth = env.split.width
  const cveCollections = useStoreRuntime(() => createItemCollectionStore('milksu.cve.collections.v1'))
  void cveCollections.revision

  const [showImport, setShowImport] = useState(false)
  const catalogActions = useRef<WorkspaceCatalogActionsHandle | null>(null)
  const conversationDock = useRef<{ revealAndFocus: () => Promise<void> } | null>(null)
  const [cveSearchQuery, setCveSearchQuery] = useState('')
  const [cveSearchError, setCveSearchError] = useState('')
  const [cveSearchLoading, setCveSearchLoading] = useState(false)
  const [cveSearchResults, setCveSearchResults] = useState<VulnerabilitySearchCandidate[]>([])
  const [cveSearchAttempted, setCveSearchAttempted] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const [importError, setImportError] = useState('')
  const [importSyncing, setImportSyncing] = useState(false)
  const [collectionView, setCollectionView] = useState(ALL_COLLECTIONS_ID)
  const [statusFilter, setStatusFilter] = useState<'all' | VulnerabilityStatus>('all')
  const [kevFilter, setKevFilter] = useState<'all' | 'kev' | 'other'>('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [page, setPage] = useState(1)
  const [targetOpen, setTargetOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [showStartEnv, setShowStartEnv] = useState(false)
  const [cveBoundPackage, setCveBoundPackage] = useState<EnvPackage | undefined>(undefined)
  const pageSize = 20

  const statusOptions = useMemo(() => [
    { value: '待复现' as const, label: t('想研究', 'Want to research') },
    { value: '研究中' as const, label: t('研究中', 'In research') },
    { value: '已验证' as const, label: t('已验证', 'Verified') },
    { value: '已分流' as const, label: t('已归档', 'Archived') },
  ], [t])

  function presentVendorProduct(item: VulnerabilityIntel) {
    return presentVulnerabilityVendorProduct({
      vendor: item.vendor,
      product: item.product,
      title: item.title,
      summary: item.summary,
    })
  }

  const vendorOptions = useMemo(() => (
    [...new Set(tracked.map(item => presentVendorProduct(item).vendor).filter(Boolean))].sort((left, right) => (
      left.localeCompare(right, 'zh-CN')
    ))
  ), [tracked])
  const yearOptions = useMemo(() => (
    [...new Set(tracked.map(item => item.id.match(/^CVE-(\d{4})-/i)?.[1] ?? '').filter(Boolean))].sort((left, right) => (
      right.localeCompare(left)
    ))
  ), [tracked])
  const filteredItems = useMemo(() => {
    const allowed = collectionView === ALL_COLLECTIONS_ID
      ? null
      : new Set(cveCollections.itemKeysFor(collectionView))
    return tracked.filter(item => (
      (statusFilter === 'all' || item.status === statusFilter)
      && (kevFilter === 'all' || (kevFilter === 'kev' ? item.kev : !item.kev))
      && (!vendorFilter || presentVendorProduct(item).vendor === vendorFilter)
      && (!yearFilter || item.id.toUpperCase().startsWith(`CVE-${yearFilter}-`))
      && (!allowed || allowed.has(item.id))
    ))
  }, [tracked, collectionView, statusFilter, kevFilter, vendorFilter, yearFilter, cveCollections])
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const visibleItems = filteredItems.slice((page - 1) * pageSize, page * pageSize)
  const directCveId = cveSearchQuery.trim().toUpperCase()
  const canAddDirectCve = cveSearchAttempted
    && !cveSearchLoading
    && !cveSearchResults.length
    && /^CVE-\d{4}-\d{4,}$/.test(directCveId)
    && !watched.includes(directCveId)

  useEffect(() => { setPage(1) }, [query, statusFilter, severity, kevFilter, vendorFilter, yearFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  useEffect(() => {
    if (!selectedId) return
    if (!filteredItems.some(item => item.id === selectedId)) {
      dashboard.selectedId = ''
    }
  }, [filteredItems, selectedId, dashboard])

  function relatedConversations(cveId: string) {
    return conversations.filter(item => (
      item.domainTaskContext?.kind === 'cve'
      && item.domainTaskContext.cveId === cveId
    )).sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left))
  }

  const cveHistory = useMemo(() => {
    const seen = new Set<string>()
    return conversations
      .filter(item => item.domainTaskContext?.kind === 'cve')
      .sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left))
      .flatMap(item => {
        if (item.domainTaskContext?.kind !== 'cve') return []
        const cveId = item.domainTaskContext.cveId.trim()
        if (!cveId || seen.has(cveId)) return []
        seen.add(cveId)
        return [{
          cveId,
          title: item.domainTaskContext.title || item.title,
          at: conversationActivityAt(item),
        }]
      })
  }, [conversations])

  const selectedItem = tracked.find(item => item.id === selectedId) ?? null
  const stripLease = toStripLease(envLease, cveBoundPackage
    ? { name: cveBoundPackage.name, provider: cveBoundPackage.provider }
    : undefined)
  const liveTargetVisible = targetOpen && envLease.state === 'ready'
  const cvePackageId = env.packageId

  function selectItem(id: string) {
    const item = tracked.find(candidate => candidate.id === id)
    if (!item) return
    dashboard.selectedId = id
  }

  useEffect(() => {
    env.ownerId = selectedItem?.id ?? ''
    setTargetOpen(false)
    setPendingOpen(false)
    setShowStartEnv(false)
    if (!selectedItem) return
    onEnter?.(selectedItem)
    void invokeCommand<{ found: boolean; package: EnvPackage }>('get_env_package_for_cve', { cveId: selectedItem.id })
      .then(lookup => {
        setCveBoundPackage(lookup.found ? lookup.package : undefined)
        env.packageId = lookup.found ? lookup.package.id : undefined
      })
      .catch(() => {
        setCveBoundPackage(undefined)
        env.packageId = undefined
      })
  }, [selectedItem?.id])

  function clearSelection() {
    dashboard.selectedId = ''
  }

  useEffect(() => {
    if (navigationEpoch) clearSelection()
  }, [navigationEpoch])

  function parseOccupyOwner(value?: string) {
    const raw = String(value || '')
    const index = raw.indexOf(':')
    if (index <= 0) return { kind: '', id: '' }
    return { kind: raw.slice(0, index), id: raw.slice(index + 1) }
  }

  function occupyGo() {
    const occupy = parseOccupyOwner(envLease.occupyOwner)
    if (occupy.kind === 'cve' && occupy.id) selectItem(occupy.id)
  }

  async function occupyStop() {
    const occupy = parseOccupyOwner(envLease.occupyOwner)
    if (!occupy.kind || !occupy.id) return
    await invokeCommand('stop_env_lease', { ownerKind: occupy.kind, ownerId: occupy.id }).catch(() => undefined)
    await env.lease.start(cvePackageId || envLease.packageId)
  }

  function openTarget() {
    if (envLease.state !== 'ready') return
    setTargetOpen(true)
    const conversationId = conversation?.id || ensureConversation?.(selectedItem?.id)
    if (conversationId && envLease.surface === 'browser' && envLease.address) {
      void invokeCommand('start_coding_browser', {
        conversationId,
        initialUrl: `http://${envLease.address}`,
      }).catch(() => undefined)
    }
  }

  function openDocker() {
    void invokeCommand('open_docker_desktop').catch(() => undefined)
  }

  async function revealConversationComposer() {
    await conversationDock.current?.revealAndFocus()
  }

  function startReproduction() {
    const item = selectedItem
    if (!item) return
    if (cvePackageId && envLease.state !== 'ready' && envLease.state !== 'pulling') {
      setShowStartEnv(true)
      return
    }
    setPendingOpen(true)
    if (envLease.state === 'ready') openTarget()
    onRun?.(item)
    void revealConversationComposer()
  }

  function confirmStartEnv() {
    const item = selectedItem
    setShowStartEnv(false)
    if (!item) return
    setPendingOpen(true)
    void env.lease.start(cvePackageId)
    onRun?.(item)
    void revealConversationComposer()
  }

  function reportOnly() {
    const item = selectedItem
    setShowStartEnv(false)
    if (!item) return
    onRun?.(item)
    void revealConversationComposer()
  }

  useEffect(() => {
    if (envLease.state === 'ready' && pendingOpen) {
      setPendingOpen(false)
      openTarget()
    }
  }, [envLease.state, pendingOpen])

  function setStatus(id: string, event: React.ChangeEvent<HTMLSelectElement>) {
    const status = statusOptions.find(option => option.value === event.target.value)?.value
    if (!status) return
    dashboard.setStatus(id, status)
  }

  function severityVariant(value: VulnerabilitySeverity) {
    if (value === 'critical' || value === 'high') return 'destructive' as const
    if (value === 'medium') return 'warning' as const
    return 'secondary' as const
  }

  function statusVariant(status: VulnerabilityStatus) {
    if (status === '研究中') return 'warning' as const
    if (status === '待复现') return 'destructive' as const
    return 'secondary' as const
  }

  function recentResearch(item: VulnerabilityIntel) {
    const latest = relatedConversations(item.id)[0]
    if (!latest) return item.updated
    const date = new Date(latest.createdAt)
    if (Number.isNaN(date.getTime())) return item.updated
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return t(
        `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      )
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }

  function referenceOrganization(href: string) {
    try {
      const hostname = new URL(href).hostname.replace(/^www\./, '')
      const parts = hostname.split('.')
      return parts.length > 2 ? parts.slice(-2).join('.') : hostname
    } catch {
      return href
    }
  }

  function referenceLabel(label: string, href: string) {
    const organization = referenceOrganization(href)
    const knownLabels: Record<string, string> = {
      'nist.gov': 'NVD',
      'cisa.gov': 'CISA',
      'redhat.com': 'Red Hat',
      'github.com': 'GitHub',
      'openwall.com': 'Openwall',
      'debian.org': 'Debian',
      'ubuntu.com': 'Ubuntu',
    }
    if (knownLabels[organization]) return knownLabels[organization]
    if (label.includes('@') || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(label)) return organization
    return label
  }

  function keyReferences(item: VulnerabilityIntel) {
    const seen = new Set<string>()
    return item.references.filter(reference => {
      const organization = referenceOrganization(reference.href)
      if (seen.has(organization)) return false
      seen.add(organization)
      return true
    }).slice(0, 4)
  }

  function openImport() {
    catalogActions.current?.closeHistoryMenu()
    setShowImport(true)
    setCveSearchError('')
    setCveSearchResults([])
    setCveSearchAttempted(false)
    setCveSearchQuery('')
    setImportNotice('')
    setImportError('')
  }

  function resumeFromHistory(cveId: string) {
    catalogActions.current?.closeHistoryMenu()
    selectItem(cveId)
  }

  async function syncPublicSources() {
    setImportNotice('')
    setImportError('')
    setImportSyncing(true)
    try {
      const failures: string[] = []
      try {
        await dashboard.syncCisaKevFeed()
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause))
      }
      try {
        await dashboard.syncVulhubPracticeCatalog()
      } catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause))
      }
      if (failures.length) {
        setImportError(failures.join(t('；', '; ')))
        return
      }
      setImportNotice(t('已同步公开源。', 'Public sources synced.'))
    } finally {
      setImportSyncing(false)
    }
  }

  function readableCveSearchError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/HTTP\s*(429|502|503|504)|timeout|timed out|deadline exceeded|network|fetch failed/i.test(message)) {
      return t('公开 CVE 服务暂时繁忙，请稍后重试。', 'Public CVE service is busy. Try again later.')
    }
    if (/请输入至少 2 个字符/.test(message)) return t('请至少输入 2 个字符。', 'Enter at least 2 characters.')
    return t('暂时无法读取公开 CVE，请稍后重试。', 'Unable to load public CVEs. Try again later.')
  }

  async function searchCves(event: React.FormEvent) {
    event.preventDefault()
    setCveSearchError('')
    setCveSearchResults([])
    setCveSearchAttempted(true)
    setCveSearchLoading(true)
    try {
      const results = await dashboard.searchNvdCves(cveSearchQuery)
      setCveSearchResults(results)
      if (!results.length) setCveSearchError(t('没有找到匹配的公开 CVE。', 'No matching public CVE found.'))
    } catch (cause) {
      setCveSearchError(readableCveSearchError(cause))
    } finally {
      setCveSearchLoading(false)
    }
  }

  function addDirectCve() {
    setCveSearchError('')
    try {
      dashboard.addTrackingItem({
        id: directCveId,
        title: t(`${directCveId} · 待补公开资料`, `${directCveId} · public details pending`),
        vendor: '',
        product: '',
        affected: '',
        summary: t('NVD 暂未返回公开记录；已按 CVE 编号加入。', 'NVD has no public record yet. Added by CVE ID.'),
      })
      setShowImport(false)
    } catch (cause) {
      setCveSearchError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function addSearchResult(candidate: VulnerabilitySearchCandidate) {
    setCveSearchError('')
    try {
      dashboard.addNvdSearchResult(candidate)
      dashboard.query = ''
      setStatusFilter('all')
      setShowImport(false)
    } catch (cause) {
      setCveSearchError(readableCveSearchError(cause))
    }
  }

  const dock = !chatMaximized && chatDockOpen ? (
    <ConversationDock
      ref={conversationDock}
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
    <>
      {!selectedItem ? (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <WorkspaceModuleTopBar
            module="cve"
            title={t('漏洞', 'CVE')}
            actions={(
              <WorkspaceCatalogActions
                ref={catalogActions}
                historyCount={cveHistory.length}
                historyAriaLabel={t('打开研究历史', 'Open research history')}
                historyMenuLabel={t('研究历史', 'Research history')}
                actionAriaLabel={t('导入 CVE', 'Import CVE')}
                onAction={openImport}
                history={cveHistory.map(entry => (
                  <WorkspaceCatalogHistoryItem
                    key={entry.cveId}
                    title={entry.cveId}
                    subtitle={entry.title}
                    time={entry.at}
                    titleMono
                    current={selectedId === entry.cveId}
                    onSelect={() => resumeFromHistory(entry.cveId)}
                  />
                ))}
              />
            )}
            filters={(
              <div className="flex flex-col gap-3">
                <CollectionViewFilter modelValue={collectionView} store={cveCollections} onModelValueChange={setCollectionView} />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="relative min-w-64 flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={event => { dashboard.query = event.target.value }}
                      className="pl-9"
                      placeholder={t('搜索我添加的 CVE…', 'Search CVEs I added…')}
                      aria-label={t('搜索 CVE', 'Search CVE')}
                    />
                  </label>
                  <NativeSelect value={statusFilter} className="w-40" aria-label={t('按我的状态筛选', 'Filter by my status')} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
                    <NativeSelectOption value="all">{t('我的状态：全部', 'My status: all')}</NativeSelectOption>
                    {statusOptions.map(option => (
                      <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <NativeSelect value={severity} className="w-40" aria-label={t('严重性', 'Severity')} onChange={event => { dashboard.severity = event.target.value as typeof severity }}>
                    <NativeSelectOption value="all">{t('严重性：全部', 'Severity: all')}</NativeSelectOption>
                    <NativeSelectOption value="critical">{t('严重', 'Critical')}</NativeSelectOption>
                    <NativeSelectOption value="high">{t('高', 'High')}</NativeSelectOption>
                    <NativeSelectOption value="medium">{t('中', 'Medium')}</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect value={kevFilter} className="w-40" aria-label={t('KEV', 'KEV')} onChange={event => setKevFilter(event.target.value as typeof kevFilter)}>
                    <NativeSelectOption value="all">{t('KEV：全部', 'KEV: all')}</NativeSelectOption>
                    <NativeSelectOption value="kev">{t('在 KEV', 'In KEV')}</NativeSelectOption>
                    <NativeSelectOption value="other">{t('不在 KEV', 'Not in KEV')}</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect value={vendorFilter} className="w-44" aria-label={t('厂商', 'Vendor')} onChange={event => setVendorFilter(event.target.value)}>
                    <NativeSelectOption value="">{t('厂商：全部', 'Vendor: all')}</NativeSelectOption>
                    {vendorOptions.map(vendor => (
                      <NativeSelectOption key={vendor} value={vendor}>{vendor}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect value={yearFilter} className="w-36" aria-label={t('年份', 'Year')} onChange={event => setYearFilter(event.target.value)}>
                    <NativeSelectOption value="">{t('年份：全部', 'Year: all')}</NativeSelectOption>
                    {yearOptions.map(year => (
                      <NativeSelectOption key={year} value={year}>{year}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            )}
          />

          <WorkspaceImportDialog
            open={showImport}
            onOpenChange={setShowImport}
            description={t('同步公开源，或按编号、产品名查找 CVE。', 'Sync public sources, or find a CVE by ID or product name.')}
          >
            <SettingsSection title={t('同步公开源', 'Public sources')}>
              <SettingsRow
                label={t('CISA KEV / Vulhub', 'CISA KEV / Vulhub')}
                description={sourceRefreshSummary.label}
                divider={false}
                trailing={(
                  <Button variant="outline" size="sm" disabled={importSyncing} aria-label={t('同步公开源', 'Sync public sources')} onClick={() => { void syncPublicSources() }}>
                    {importSyncing ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('同步', 'Sync')}
                  </Button>
                )}
              />
              {importNotice ? <p className="px-4 pb-3 text-caption text-muted-foreground">{importNotice}</p> : null}
              {importError ? <p className="px-4 pb-3 text-caption text-destructive" role="alert">{importError}</p> : null}
            </SettingsSection>
            <SettingsSection title={t('查找公开 CVE', 'Find public CVE')}>
              <div className="grid gap-3 px-4 py-4">
                <form className="flex gap-2" onSubmit={searchCves}>
                  <label className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={cveSearchQuery}
                      onChange={event => setCveSearchQuery(event.target.value)}
                      className="pl-9"
                      autoFocus
                      aria-label={t('搜索公开 CVE', 'Search public CVE')}
                      placeholder={t('例如 CVE-2024-3400、ActiveMQ、Android deserialization', 'e.g. CVE-2024-3400, ActiveMQ, Android deserialization')}
                    />
                  </label>
                  <Button type="submit" variant="brand" disabled={cveSearchLoading || cveSearchQuery.trim().length < 2}>
                    {cveSearchLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {t('搜索', 'Search')}
                  </Button>
                </form>
                {cveSearchError ? <p className="text-caption text-destructive" role="alert">{cveSearchError}</p> : null}
                {canAddDirectCve ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/30 px-4 py-3">
                    <p className="font-mono text-caption">{directCveId}</p>
                    <Button size="sm" variant="outline" onClick={addDirectCve}>{t('仅按编号加入', 'Add by ID only')}</Button>
                  </div>
                ) : null}
                {cveSearchResults.length ? (
                  <div className="cve-search-results divide-y divide-border border border-border" aria-label={t('公开 CVE 搜索结果', 'Public CVE search results')}>
                    {cveSearchResults.map(candidate => (
                      <article key={candidate.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="font-mono text-control text-primary">{candidate.id}</strong>
                            {candidate.cvss > 0 ? <Badge variant={severityVariant(candidate.severity)}>{candidate.cvss.toFixed(1)}</Badge> : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-body font-medium">{candidate.title}</p>
                          <p className="mt-1 text-caption text-muted-foreground">{candidate.updated || t('NVD 公开记录', 'NVD public record')}</p>
                        </div>
                        <Button size="sm" disabled={watched.includes(candidate.id)} onClick={() => addSearchResult(candidate)}>
                          {watched.includes(candidate.id) ? t('已在列表', 'Already listed') : t('加入研究', 'Add to research')}
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            </SettingsSection>
          </WorkspaceImportDialog>

          <section className="min-h-0 flex-1 overflow-auto bg-background" aria-label={t('CVE 列表', 'CVE list')}>
            <div className="min-w-[1120px]">
              <div className="grid h-12 grid-cols-[170px_minmax(240px,1.2fr)_minmax(160px,.9fr)_88px_132px_42px_minmax(7rem,1fr)_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                <span className="whitespace-nowrap">CVE</span>
                <span className="whitespace-nowrap">{t('漏洞', 'Title')}</span>
                <span className="whitespace-nowrap">{t('厂商/产品', 'Vendor / product')}</span>
                <span className="whitespace-nowrap">{t('严重性', 'Severity')}</span>
                <span className="whitespace-nowrap">{t('我的状态', 'My status')}</span>
                <span className="sr-only">{t('收藏', 'Collection')}</span>
                <span className="whitespace-nowrap">{t('最近研究', 'Recent research')}</span>
                <span className="sr-only">{t('打开', 'Open')}</span>
              </div>
              {visibleItems.map(item => (
                <article
                  key={item.id}
                  className="vuln-row grid min-h-[72px] w-full grid-cols-[170px_minmax(240px,1.2fr)_minmax(160px,.9fr)_88px_132px_42px_minmax(7rem,1fr)_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-accent"
                  data-testid="catalog-row"
                >
                  <span className="font-mono text-body select-text">{item.id}</span>
                  <span className="min-w-0 truncate text-control font-medium select-text">{item.title}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-body">{presentVendorProduct(item).vendor}</span>
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground">{presentVendorProduct(item).product}</span>
                  </span>
                  <Badge variant={severityVariant(item.severity)}>{item.cvss.toFixed(1)}</Badge>
                  <Badge variant={statusVariant(item.status)}>{vulnerabilityStatusLabel(item.status)}</Badge>
                  <CollectionPicker itemKey={item.id} store={cveCollections} />
                  <span className="text-caption text-muted-foreground">{recentResearch(item)}</span>
                  <Button size="sm" variant="outline" data-testid="open-item" onClick={() => selectItem(item.id)}>{t('打开', 'Open')}</Button>
                </article>
              ))}
              {!visibleItems.length ? (
                <div className="grid min-h-64 place-items-center px-8 text-center">
                  <div>
                    {tracked.length ? <p className="text-control font-medium">{t('没有匹配的 CVE', 'No matching CVE')}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
          <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
            <span className="text-caption text-muted-foreground">{t(`共 ${filteredItems.length} 条`, `${filteredItems.length} items`)}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" disabled={page <= 1} aria-label={t('上一页', 'Previous page')} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-4" /></Button>
              <Button variant="outline" size="icon-sm">{page}</Button>
              <Button variant="ghost" size="icon-sm" disabled={page >= pageCount} aria-label={t('下一页', 'Next page')} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-4" /></Button>
            </div>
          </footer>
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <WorkspaceModuleTopBar
            module="cve"
            title={selectedItem.id}
            subtitle={selectedItem.title}
            leading={(
              <Button variant="ghost" size="icon-sm" aria-label={t('返回漏洞列表', 'Back to CVE list')} onClick={clearSelection}>
                <ArrowLeft className="size-4" />
              </Button>
            )}
            actions={<Button variant="brand" size="sm" onClick={startReproduction}>{t('开始复现', 'Start reproduction')}</Button>}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
            <div
              className={`flex min-h-0 min-w-0 flex-col ${liveTargetVisible ? '' : 'flex-1'}`}
              style={liveTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined}
            >
              <div className="page-scroll flex-1">
                <div className={`page-stack ${liveTargetVisible ? 'page-stack--flush' : 'page-column'}`}>
                  <SettingsSection title={t('摘要', 'Summary')}>
                    <p className="px-4 py-3 text-body leading-6">{selectedItem.summary}</p>
                    {selectedItem.references.length ? (
                      <SettingsRow
                        label={t('原文', 'Source')}
                        trailing={(
                          <div className="flex min-w-0 flex-col items-end gap-1">
                            {keyReferences(selectedItem).map(reference => (
                              <Button key={reference.href} asChild variant="link" size="text">
                                <a href={reference.href} target="_blank" rel="noreferrer">
                                  {referenceLabel(reference.label, reference.href)}
                                  <ExternalLink className="size-3" />
                                </a>
                              </Button>
                            ))}
                          </div>
                        )}
                      />
                    ) : null}
                    <SettingsRow
                      label={t('状态', 'Status')}
                      divider={false}
                      trailing={(
                        <NativeSelect
                          value={selectedItem.status}
                          className="w-32"
                          aria-label={t(`${selectedItem.id} 状态`, `${selectedItem.id} status`)}
                          onChange={event => setStatus(selectedItem.id, event)}
                        >
                          {statusOptions.map(option => (
                            <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                          ))}
                        </NativeSelect>
                      )}
                    />
                  </SettingsSection>
                  <EnvironmentStrip
                    lease={stripLease}
                    onStart={() => { void env.lease.start(cvePackageId || envLease.packageId) }}
                    onStop={() => { void env.lease.stop() }}
                    onReset={() => { void env.lease.reset() }}
                    onOpenTarget={openTarget}
                    onRetry={() => { void env.lease.start(cvePackageId || envLease.packageId) }}
                    onOpenDocker={openDocker}
                    onOccupyGo={occupyGo}
                    onOccupyStop={() => { void occupyStop() }}
                    onOpenLabSettings={onOpenLabSettings}
                  />
                  <SettingsSection title={t('关联 CVE', 'Related CVE')}>
                    <RelatedCvePanel
                      className="px-4 py-3 text-body leading-6"
                      workspacePath={conversation?.workspacePath ?? workspacePath}
                      refreshKey={running ? 'run' : conversation?.messages.length}
                    />
                  </SettingsSection>
                  <SettingsSection title={t('报告', 'Report')}>
                    <ResearchReportPanel
                      className="px-4 py-3 text-body leading-6"
                      workspacePath={conversation?.workspacePath ?? ''}
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
                  aria-label={t('调节档案宽度', 'Resize the dossier pane')}
                  onPointerDown={event => env.split.startResize(event.nativeEvent)}
                />
                <TargetLivePane lease={envLease} conversationId={conversation?.id} />
              </div>
            ) : null}
          </div>
          <Dialog open={showStartEnv} onOpenChange={setShowStartEnv}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('这个洞有练习包。先启动？', 'This CVE has a practice package. Start it first?')}</DialogTitle>
                <DialogDescription>{t('启动后右侧打开活靶面。也可以只写报告。', 'Starting opens the live target on the right. You can also write the report only.')}</DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" data-testid="repro-report-only" onClick={reportOnly}>{t('只写报告', 'Report only')}</Button>
                <Button type="button" variant="brand" data-testid="repro-start-env" onClick={confirmStartEnv}>{t('启动并复现', 'Start and reproduce')}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      )}
      {dock}
      <style>{`
        .vuln-row { position: relative; cursor: default; transition: background-color 140ms ease; }
        .vuln-row-selected { background: var(--hover-2); }
        .cve-search-dialog { max-height: min(760px, calc(100vh - 3rem)); overflow: hidden; }
        .cve-search-results { max-height: min(470px, calc(100vh - 17rem)); overflow: auto; }
        .dossier-split-handle { position: absolute; inset: 0 auto 0 0; z-index: 2; width: 8px; margin-left: -3px; cursor: col-resize; touch-action: none; border: 0; padding: 0; background: transparent; }
        .dossier-split-handle::after { position: absolute; inset: 0 3px; background: transparent; content: ''; }
        .dossier-split-handle:hover::after,
        .dossier-split-handle:focus-visible::after { background: var(--brand); opacity: .55; }
      `}</style>
    </>
  )
}
