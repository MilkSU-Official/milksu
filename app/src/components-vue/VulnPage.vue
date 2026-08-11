<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@felinic/ui'
import {
  ArrowLeft,
  Bookmark,
  ClipboardList,
  ExternalLink,
  FolderOpen,
  Plus,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Star,
  Square,
} from 'lucide-vue-next'
import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import VulnerabilityLoopPanel from '@/components-vue/VulnerabilityLoopPanel.vue'
import { useVulnerabilityDashboard, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import type { VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import type { VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'
import type { VulnProjection } from '@/vulnTypes'

defineOptions({ name: 'VulnPage' })

const props = defineProps<{
  dashboard?: VulnerabilityDashboard
  codingWorkspacePath?: string
  navigationEpoch?: number
}>()

const emit = defineEmits<{
  chooseCodingWorkspace: []
  startCodingTask: [task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void]
}>()
const dashboard = props.dashboard ?? useVulnerabilityDashboard()

const showCustomForm = ref(false)
const customFormError = ref('')
const cveView = ref<'list' | 'research'>('list')
const showAssetForm = ref(false)
const assetFormError = ref('')
const assetFormNotice = ref('')
const assetWritebackBusy = ref(false)
const showCodingConclusionForm = ref(false)
const codingConclusionText = ref('')
const codingConclusionError = ref('')
const codingConclusionNotice = ref('')
const codingConclusionWritebackBusy = ref(false)
const researchDraftWritebackBusy = ref(false)
const researchDraftError = ref('')
const researchDraftNotice = ref('')
const archiveLoadError = ref('')
const selectedIntelNotice = ref('')
const selectedIntelError = ref('')
const selectedIntelSyncing = ref('')
const loopWorkspace = ref<HTMLElement | null>(null)
const practiceWorkspace = ref<HTMLElement | null>(null)
const notesWorkspace = ref<HTMLElement | null>(null)
const customForm = ref({
  id: '',
  title: '',
  vendor: '',
  product: '',
  affected: '',
  summary: '',
  referenceHref: '',
  learningGoal: '',
})
const assetForm = ref({
  name: '',
  address: '',
  environment: '',
})

async function ensureSelectedRuntimeProjection() {
  const selected = dashboard.selected.value
  const projection = await invokeCommand<VulnProjection>('ensure_vuln_tracking_workspace', {
    request: {
      cveId: selected.id,
      title: selected.title,
      summary: selected.summary,
      referenceHref: selected.references[0]?.href || '',
    },
  })
  dashboard.setRuntimeProjection(selected.id, projection)
  return projection
}

async function openCveResearch(id: string) {
  dashboard.selectedId.value = id
  cveView.value = 'research'
  archiveLoadError.value = ''
  if (!hasDesktopRuntime()) return
  try {
    await ensureSelectedRuntimeProjection()
  } catch (cause) {
    archiveLoadError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function returnToCveList() {
  cveView.value = 'list'
}

watch(
  () => props.navigationEpoch,
  () => {
    cveView.value = 'list'
  },
)

watch(
  () => dashboard.selected.value.id,
  () => {
    selectedIntelNotice.value = ''
    selectedIntelError.value = ''
    selectedIntelSyncing.value = ''
  },
)

function addCustomTrackingItem() {
  customFormError.value = ''
  try {
    dashboard.addTrackingItem(customForm.value)
    showCustomForm.value = false
    customForm.value = {
      id: '',
      title: '',
      vendor: '',
      product: '',
      affected: '',
      summary: '',
      referenceHref: '',
      learningGoal: '',
    }
  } catch (cause) {
    customFormError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function addSelectedAssetRecord() {
  assetFormError.value = ''
  assetFormNotice.value = ''
  const selected = dashboard.selected.value
  const input = {
    name: assetForm.value.name.trim(),
    address: redactProviderCredentials(assetForm.value.address).trim(),
    environment: assetForm.value.environment.trim(),
  }
  if (!input.name && !input.address) {
    assetFormError.value = '至少填写资产名称或地址。'
    return
  }
  assetWritebackBusy.value = true
  try {
    const workspace = await ensureSelectedRuntimeProjection()
    const projection = await invokeCommand<VulnProjection>('record_vuln_asset_verification', {
      id: workspace.job.id,
      request: {
        name: input.name || input.address,
        address: input.address || 'unspecified',
        environment: input.environment || 'unspecified',
        status: 'needs_review',
        summary: '用户确认该资产进入影响检查；本记录不声明已复现或可被利用。',
      },
    })
    dashboard.setRuntimeProjection(selected.id, projection)
    showAssetForm.value = false
    assetForm.value = { name: '', address: '', environment: '' }
    assetFormNotice.value = `已写入正式研究档案 ${projection.job.id}（${projection.assetVerifications.length} 条资产验证）。`
  } catch (cause) {
    assetFormError.value = `资产未保存：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    assetWritebackBusy.value = false
  }
}

async function importCodingConclusion() {
  codingConclusionError.value = ''
  codingConclusionNotice.value = ''
  const raw = codingConclusionText.value.trim()
  if (!raw) {
    codingConclusionError.value = '请先粘贴已经由用户核对过的 Coding 结论。'
    return
  }
  const selected = dashboard.selected.value
  codingConclusionWritebackBusy.value = true
  try {
    const workspace = await ensureSelectedRuntimeProjection()
    const projection = await invokeCommand<VulnProjection>('record_vuln_learning', {
      id: workspace.job.id,
      request: {
        kind: 'reflection',
        content: raw,
        concept: selected.id,
      },
    })
    dashboard.setRuntimeProjection(selected.id, projection)
    codingConclusionText.value = ''
    showCodingConclusionForm.value = false
    codingConclusionNotice.value = `已写入正式研究档案 ${projection.job.id}（${projection.learning.length} 条学习记录）。`
  } catch (cause) {
    codingConclusionError.value = `结论未保存：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    codingConclusionWritebackBusy.value = false
  }
}

async function submitResearchDraft() {
  researchDraftError.value = ''
  researchDraftNotice.value = ''
  const selected = dashboard.selected.value
  const draft = dashboard.researchNoteFor.value
  const content = [
    draft.keyFindings.trim() ? `关键结论：\n${draft.keyFindings.trim()}` : '',
    draft.notes.trim() ? `学习笔记：\n${draft.notes.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  if (!content) {
    researchDraftError.value = '请先填写要提交的关键结论或学习笔记。'
    return
  }
  researchDraftWritebackBusy.value = true
  try {
    const workspace = await ensureSelectedRuntimeProjection()
    const projection = await invokeCommand<VulnProjection>('record_vuln_learning', {
      id: workspace.job.id,
      request: { kind: 'reflection', content, concept: selected.id },
    })
    dashboard.setRuntimeProjection(selected.id, projection)
    dashboard.updateResearchNote(selected.id, { keyFindings: '', notes: '' })
    researchDraftNotice.value = `已提交到正式研究档案 ${projection.job.id}。`
  } catch (cause) {
    researchDraftError.value = `草稿未提交：${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    researchDraftWritebackBusy.value = false
  }
}

type SelectedIntelSyncResult = Awaited<ReturnType<VulnerabilityDashboard['syncSelectedNvdCve']>>

function formatSelectedIntelNotice(sourceName: string, result: SelectedIntelSyncResult) {
  return `已同步 ${sourceName}：新增 ${result.imported}、更新 ${result.updated}`
    + (result.skipped ? `，跳过 ${result.skipped}` : '')
    + `；${result.format}，${result.itemCount} 条，${result.cacheState} ${result.digest}`
    + (result.errors.length ? `；${result.errors.length} 条格式需人工处理` : '')
}

async function syncSelectedIntelSource(
  sourceName: string,
  runner: () => Promise<SelectedIntelSyncResult>,
) {
  selectedIntelError.value = ''
  selectedIntelNotice.value = ''
  selectedIntelSyncing.value = sourceName
  try {
    selectedIntelNotice.value = formatSelectedIntelNotice(sourceName, await runner())
  } catch (cause) {
    selectedIntelError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    selectedIntelSyncing.value = ''
  }
}

async function syncSelectedNvdCve() {
  await syncSelectedIntelSource('NVD', () => dashboard.syncSelectedNvdCve())
}

async function syncSelectedFirstEPSS() {
  await syncSelectedIntelSource('FIRST EPSS', () => dashboard.syncSelectedFirstEPSS())
}

async function syncSelectedOsvCve() {
  await syncSelectedIntelSource('OSV', () => dashboard.syncSelectedOsvCve())
}

async function syncSelectedGitHubAdvisories() {
  await syncSelectedIntelSource('GitHub Advisory', () => dashboard.syncSelectedGitHubAdvisories())
}

async function syncSelectedCisaKevFeed() {
  await syncSelectedIntelSource('CISA KEV', () => dashboard.syncCisaKevFeed())
}

async function syncSelectedCveIntel() {
  selectedIntelError.value = ''
  selectedIntelNotice.value = ''
  selectedIntelSyncing.value = 'all'
  const sources = [
    { name: 'NVD', run: () => dashboard.syncSelectedNvdCve() },
    { name: 'FIRST EPSS', run: () => dashboard.syncSelectedFirstEPSS() },
    { name: 'OSV', run: () => dashboard.syncSelectedOsvCve() },
    { name: 'GitHub Advisory', run: () => dashboard.syncSelectedGitHubAdvisories() },
    { name: 'CISA KEV', run: () => dashboard.syncCisaKevFeed() },
  ]
  const results = await Promise.allSettled(sources.map(source => source.run()))
  const failures: string[] = []
  let successCount = 0
  for (const [index, settled] of results.entries()) {
    const sourceName = sources[index].name
    if (settled.status === 'fulfilled') {
      successCount += 1
    } else {
      failures.push(`${sourceName} 同步失败：${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`)
    }
  }
  selectedIntelNotice.value = `此 CVE 情报同步完成：${successCount}/${sources.length} 个来源成功`
    + (failures.length ? `；${failures.length} 个来源失败，已保留可用证据。` : '。')
  selectedIntelError.value = failures.join('；')
  selectedIntelSyncing.value = ''
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function startSelectedCodingTask(task: VulnerabilityCodingTask) {
  const cveId = dashboard.selected.value.id
  emit('startCodingTask', task, workspacePath => {
    dashboard.recordCodingHandoff(cveId, task, workspacePath)
  })
}

async function establishOrFocusResearchTask() {
  dashboard.establishResearchTask(dashboard.selected.value.id)
  await nextTick()
  loopWorkspace.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}

async function scrollToWorkspace(target: HTMLElement | null) {
  await nextTick()
  target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}

async function ensureResearchView() {
  if (cveView.value !== 'research') {
    cveView.value = 'research'
    await nextTick()
  }
}

const selectedNextActionCta = computed(() => {
  const label = dashboard.selectedNextAction.value.label
  if (label === '建立研究任务') return '建立'
  if (label === '确认练习计划') return '确认'
  if (label === '选择本地目录') return '选择目录'
  if (label === '启动本地练习') return '启动'
  if (label === '启动中') return '查看状态'
  if (label === '观察/停止练习') return '查看状态'
  if (label === '交给 Coding') return '交给 Coding'
  if (label === '补用户笔记') return '去写笔记'
  return '查看摘要'
})

async function runSelectedNextAction() {
  await ensureResearchView()
  const label = dashboard.selectedNextAction.value.label
  if (label === '建立研究任务') {
    await establishOrFocusResearchTask()
    return
  }
  if (label === '确认练习计划') {
    dashboard.confirmPracticeEnvironment(dashboard.selected.value.id)
    await scrollToWorkspace(practiceWorkspace.value)
    return
  }
  if (label === '选择本地目录') {
    await chooseSelectedPracticeDirectory()
    await scrollToWorkspace(practiceWorkspace.value)
    return
  }
  if (label === '启动本地练习') {
    await startSelectedPracticeRuntime()
    await scrollToWorkspace(practiceWorkspace.value)
    return
  }
  if (label === '启动中' || label === '观察/停止练习') {
    await scrollToWorkspace(practiceWorkspace.value)
    return
  }
  if (label === '交给 Coding' && dashboard.codingTaskForSelected.value) {
    startSelectedCodingTask(dashboard.codingTaskForSelected.value)
    return
  }
  if (label === '补用户笔记') {
    await scrollToWorkspace(notesWorkspace.value)
    return
  }
  await scrollToWorkspace(loopWorkspace.value)
}

const selectedPracticeState = computed(() => dashboard.practiceSessionFor.value?.state ?? 'unconfirmed')
const selectedPracticeBadge = computed(() => {
  const state = selectedPracticeState.value
  if (state === 'running') return { label: '运行中', variant: 'success' as const }
  if (state === 'starting') return { label: '启动中', variant: 'info' as const }
  if (state === 'failed') return { label: '启动失败', variant: 'destructive' as const }
  if (state === 'confirmed') return { label: '已确认计划', variant: 'success' as const }
  if (state === 'stopped') return { label: '已停止', variant: 'secondary' as const }
  return { label: '待确认', variant: 'outline' as const }
})

async function chooseSelectedPracticeDirectory() {
  try {
    await dashboard.choosePracticeDirectory(dashboard.selected.value.id)
  } catch {
    // The composable keeps the user-facing error; the button remains available for retry.
  }
}

async function startSelectedPracticeRuntime() {
  try {
    await dashboard.startPracticeRuntime(dashboard.selected.value.id)
  } catch {
    // The composable keeps the user-facing error; do not hide the failed state.
  }
}

async function refreshSelectedPracticeRuntime() {
  try {
    await dashboard.refreshPracticeRuntime(dashboard.selected.value.id)
  } catch {
    // The composable keeps the user-facing error.
  }
}

async function stopSelectedPracticeRuntime() {
  try {
    await dashboard.stopPracticeRuntime(dashboard.selected.value.id, true)
  } catch {
    // The composable keeps the user-facing error.
  }
}

function severityVariant(severity: VulnerabilitySeverity) {
  return severity === 'critical' ? 'destructive' : severity === 'high' ? 'warning' : 'info'
}

function statusVariant(status: VulnerabilityStatus) {
  if (status === '已验证') return 'success'
  if (status === '研究中') return 'info'
  if (status === '待复现') return 'warning'
  return 'secondary'
}

</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-background">
    <WorkspaceModuleTopBar
      module="cve"
      :subtitle="cveView === 'list' ? '追踪 CVE、资产命中与研究进度' : '单个 CVE 研究台 · 情报、练习、资产与学习证据'"
    >
      <template v-if="cveView === 'research'" #leading>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回 CVE 列表"
          @click="returnToCveList"
        >
          <ArrowLeft class="size-4" />
        </Button>
      </template>
      <template #actions>
        <Button
          v-if="cveView === 'list'"
          :variant="showCustomForm ? 'outline' : 'default'"
          size="sm"
          @click="showCustomForm = !showCustomForm"
        >
          <Plus class="size-4" />
          新增追踪
        </Button>
        <Button
          v-if="cveView === 'list'"
          :variant="dashboard.watchOnly.value ? 'outline' : 'ghost'"
          size="sm"
          @click="dashboard.watchOnly.value = !dashboard.watchOnly.value"
        >
          <Bookmark class="size-4" />
          我的关注
        </Button>
      </template>

      <template v-if="cveView === 'list'" #filters>
      <div class="flex flex-wrap items-center gap-3">
        <label class="relative min-w-64 flex-1 max-w-md">
          <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="dashboard.query.value" size="sm" class="pl-9" placeholder="搜索 CVE、产品或厂商" />
        </label>
        <NativeSelect v-model="dashboard.severity.value" size="sm">
          <NativeSelectOption
            v-for="filter in dashboard.severityFilters"
            :key="filter.value"
            :value="filter.value"
          >
            {{ filter.label }}
          </NativeSelectOption>
        </NativeSelect>
      </div>
      </template>

      <template v-if="cveView === 'list'" #metrics>
      <div class="grid gap-3 text-body sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">追踪条目</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.trackedCount.value }}</p>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {{ dashboard.watched.value.length }} 关注中
          </p>
        </div>
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">研究任务</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.researchTasks.value.length }}</p>
        </div>
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">练习环境</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.practiceEnvironmentCount.value }} 匹配</p>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {{ dashboard.confirmedPracticeSessionCount.value }} 已确认计划
          </p>
        </div>
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-caption text-muted-foreground">当前下一步</p>
            <Badge :variant="dashboard.selectedNextAction.value.variant">
              {{ dashboard.selected.value.id }}
            </Badge>
          </div>
          <p class="mt-1 truncate text-body font-medium">{{ dashboard.selectedNextAction.value.label }}</p>
          <p class="mt-0.5 line-clamp-2 text-caption leading-5 text-muted-foreground">
            {{ dashboard.selectedNextAction.value.detail }}
          </p>
          <Button
            class="mt-3 w-full"
            variant="outline"
            size="sm"
            aria-label="执行当前 CVE 下一步"
            @click="runSelectedNextAction"
          >
            {{ selectedNextActionCta }}
          </Button>
        </div>
      </div>
      </template>
    </WorkspaceModuleTopBar>

    <section
      v-if="cveView === 'list'"
      class="min-h-0 flex-1 overflow-auto"
      aria-label="CVE 追踪列表"
    >
        <form
          v-if="showCustomForm"
          class="border-b border-border bg-card/70 px-6 py-5"
          @submit.prevent="addCustomTrackingItem"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-label font-medium">新增本地 CVE 追踪</h2>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                不连接实时 Feed；先把你关心的 CVE、材料和学习目标存成本机追踪项。
              </p>
            </div>
            <Badge variant="outline">本地</Badge>
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <Input v-model="customForm.id" size="sm" placeholder="CVE-2024-12345" />
            <Input v-model="customForm.product" size="sm" placeholder="组件 / 产品，例如 nginx" />
            <Input v-model="customForm.vendor" size="sm" placeholder="厂商 / 项目，例如 F5" />
            <Input v-model="customForm.affected" size="sm" placeholder="受影响版本范围" />
            <Input v-model="customForm.title" size="sm" class="sm:col-span-2" placeholder="漏洞标题或学习主题" />
            <Input v-model="customForm.referenceHref" size="sm" class="sm:col-span-2" placeholder="公告、补丁或学习材料 URL（可选）" />
            <Input v-model="customForm.learningGoal" size="sm" class="sm:col-span-2" placeholder="这次想学会什么 / 要确认什么" />
            <Input v-model="customForm.summary" size="sm" class="sm:col-span-2" placeholder="一句话背景（可选）" />
          </div>
          <p v-if="customFormError" class="mt-3 text-caption text-destructive">{{ customFormError }}</p>
          <div class="mt-4 flex items-center gap-2">
            <Button type="submit" size="sm">
              <Plus class="size-4" />
              加入追踪
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="showCustomForm = false">
              取消
            </Button>
          </div>
        </form>
        <Table>
          <TableHeader class="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead class="pl-6">CVE</TableHead>
              <TableHead>漏洞</TableHead>
              <TableHead>CVSS</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>闭环</TableHead>
              <TableHead>资产</TableHead>
              <TableHead class="pr-6">更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="item in dashboard.filtered.value"
              :key="item.id"
              class="cursor-pointer"
              :data-state="item.id === dashboard.selectedId.value ? 'selected' : undefined"
              @click="openCveResearch(item.id)"
            >
              <TableCell class="pl-6 font-mono text-body">
                <span class="flex items-center gap-2">
                  <Star v-if="dashboard.watched.value.includes(item.id)" class="size-3 fill-current" />
                  {{ item.id }}
                </span>
              </TableCell>
              <TableCell class="max-w-72 whitespace-normal">
                <p class="text-body font-medium leading-5">{{ item.title }}</p>
                <p class="mt-1 text-caption text-muted-foreground">{{ item.vendor }}</p>
              </TableCell>
              <TableCell>
                <Badge :variant="severityVariant(item.severity)" font="mono">{{ item.cvss.toFixed(1) }}</Badge>
              </TableCell>
              <TableCell><Badge :variant="statusVariant(item.status)">{{ item.status }}</Badge></TableCell>
              <TableCell class="max-w-56">
                <div class="flex flex-wrap gap-1.5" :aria-label="`${item.id} CVE 闭环状态`">
                  <Badge
                    v-for="badge in dashboard.loopBadgesFor(item.id)"
                    :key="`${item.id}-${badge.label}`"
                    :variant="badge.variant"
                  >
                    {{ badge.label }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell class="font-mono text-body">{{ item.assetCount }}</TableCell>
              <TableCell class="pr-6 text-caption text-muted-foreground">{{ item.updated }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div v-if="!dashboard.filtered.value.length" class="px-6 py-16 text-center text-body text-muted-foreground">
          没有匹配的漏洞情报
        </div>
    </section>

    <section
      v-else-if="dashboard.selected.value"
      class="min-h-0 flex-1 overflow-y-auto"
      aria-label="单个 CVE 研究台"
    >
      <div class="mx-auto w-full max-w-7xl px-6 py-6">
        <div class="rounded-2xl border border-border bg-card px-5 py-5">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline" font="mono">{{ dashboard.selected.value.id }}</Badge>
                <Badge :variant="severityVariant(dashboard.selected.value.severity)">
                  {{ dashboard.selected.value.cvss.toFixed(1) }} CVSS
                </Badge>
                <Badge variant="secondary">{{ dashboard.selected.value.epss.toFixed(1) }}% EPSS</Badge>
                <Badge v-if="dashboard.selected.value.kev" variant="destructive">CISA KEV</Badge>
                <Badge :variant="statusVariant(dashboard.selected.value.status)">{{ dashboard.selected.value.status }}</Badge>
              </div>
              <WorkspaceDetailTitle class="mt-4" :title="dashboard.selected.value.title" />
              <p class="mt-3 max-w-5xl text-body leading-6 text-muted-foreground">{{ dashboard.selected.value.summary }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                @click="dashboard.toggleWatch(dashboard.selected.value.id)"
              >
                <Star
                  class="size-4"
                  :class="dashboard.watched.value.includes(dashboard.selected.value.id) ? 'fill-current' : ''"
                />
                {{ dashboard.watched.value.includes(dashboard.selected.value.id) ? '已关注' : '关注' }}
              </Button>
              <Button
                v-if="dashboard.selectedNextAction.value.label !== '交给 Coding'"
                size="sm"
                aria-label="执行当前 CVE 下一步"
                @click="runSelectedNextAction"
              >
                {{ selectedNextActionCta }}
              </Button>
            </div>
          </div>
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-3">
          <article class="rounded-xl border border-border bg-background px-4 py-4">
            <p class="text-caption text-muted-foreground">受影响范围</p>
            <p class="mt-2 text-body leading-6">{{ dashboard.selected.value.affected }}</p>
          </article>
          <article class="rounded-xl border border-border bg-background px-4 py-4">
            <p class="text-caption text-muted-foreground">利用成熟度</p>
            <p class="mt-2 text-body leading-6">{{ dashboard.selected.value.maturity }}</p>
          </article>
          <article class="rounded-xl border border-border bg-background px-4 py-4">
            <p class="text-caption text-muted-foreground">当前下一步</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Badge :variant="dashboard.selectedNextAction.value.variant">
                {{ dashboard.selectedNextAction.value.label }}
              </Badge>
              <span class="text-caption leading-5 text-muted-foreground">
                {{ dashboard.selectedNextAction.value.detail }}
              </span>
            </div>
          </article>
        </div>

        <div class="mt-5 rounded-xl border border-border bg-background px-4 py-4">
          <p class="text-label font-medium">参考链接</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              v-for="reference in dashboard.selected.value.references"
              :key="reference.href"
              as="a"
              :href="reference.href"
              target="_blank"
              rel="noreferrer"
              variant="outline"
              size="sm"
            >
              {{ reference.label }} <ExternalLink class="size-3" />
            </Button>
          </div>
        </div>

        <section class="mt-5 rounded-xl border border-border bg-background px-5 py-4" aria-label="当前 CVE 情报证据">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-label font-medium">情报证据</h3>
                <Badge variant="info">{{ dashboard.selectedSourceEvidence.value.length }} 条</Badge>
              </div>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                同步和查看 {{ dashboard.selected.value.id }} 的来源快照；情报证据不等于本地验证结果。
              </p>
            </div>
            <div class="flex flex-wrap justify-start gap-2 md:justify-end">
              <Button
                size="sm"
                aria-label="同步此 CVE 的 NVD、FIRST EPSS、OSV、GitHub Advisory 和 CISA KEV"
                :loading="selectedIntelSyncing === 'all'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedCveIntel"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'all' ? 'animate-spin' : ''" />
                同步全部
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="同步此 CVE 的 NVD 2.0"
                :loading="selectedIntelSyncing === 'NVD'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedNvdCve"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'NVD' ? 'animate-spin' : ''" />
                NVD
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="同步此 CVE 的 FIRST EPSS"
                :loading="selectedIntelSyncing === 'FIRST EPSS'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedFirstEPSS"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'FIRST EPSS' ? 'animate-spin' : ''" />
                EPSS
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="同步此 CVE 的 OSV"
                :loading="selectedIntelSyncing === 'OSV'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedOsvCve"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'OSV' ? 'animate-spin' : ''" />
                OSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="同步此 CVE 的 GitHub Advisory"
                :loading="selectedIntelSyncing === 'GitHub Advisory'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedGitHubAdvisories"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'GitHub Advisory' ? 'animate-spin' : ''" />
                GHSA
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="同步 CISA KEV Feed 并匹配此 CVE"
                :loading="selectedIntelSyncing === 'CISA KEV'"
                :disabled="Boolean(selectedIntelSyncing)"
                @click="syncSelectedCisaKevFeed"
              >
                <RefreshCw class="size-4" :class="selectedIntelSyncing === 'CISA KEV' ? 'animate-spin' : ''" />
                KEV
              </Button>
            </div>
          </div>
          <p v-if="selectedIntelNotice" class="mt-3 text-caption text-primary">{{ selectedIntelNotice }}</p>
          <p v-if="selectedIntelError" class="mt-3 text-caption text-destructive">{{ selectedIntelError }}</p>
          <div v-if="dashboard.selectedSourceEvidence.value.length" class="mt-3 grid gap-2 lg:grid-cols-2">
            <article
              v-for="evidence in dashboard.selectedSourceEvidence.value.slice(0, 4)"
              :key="`${evidence.sourceId}-${evidence.digest}`"
              class="rounded-lg border border-border bg-muted/20 px-3 py-3 text-caption leading-5"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-body font-medium">{{ evidence.sourceName }} · {{ evidence.format }}</p>
                <Badge variant="outline">{{ evidence.cacheState }}</Badge>
              </div>
              <p class="mt-1 text-muted-foreground">
                获取 {{ new Date(evidence.retrievedAt).toLocaleString() }}；导入 {{ new Date(evidence.importedAt).toLocaleString() }}
                <template v-if="evidence.publishedAt">；发布时间 {{ evidence.publishedAt }}</template>
                <template v-if="evidence.lastModifiedAt">；更新时间 {{ evidence.lastModifiedAt }}</template>
              </p>
              <p class="mt-1 font-mono text-muted-foreground">{{ evidence.digest }}</p>
              <p v-if="evidence.snapshotPath" class="mt-1 break-all font-mono text-muted-foreground">
                原始快照 {{ evidence.snapshotSizeBytes ?? 0 }} bytes · {{ evidence.snapshotPath }}
              </p>
              <p v-if="evidence.snapshotSha256" class="mt-1 break-all font-mono text-muted-foreground">
                sha256 {{ evidence.snapshotSha256 }}
              </p>
              <Button
                v-if="isHttpUrl(evidence.sourceUrl)"
                as="a"
                :href="evidence.sourceUrl"
                target="_blank"
                rel="noreferrer"
                variant="link"
                size="text"
                class="mt-1"
              >
                查看来源 <ExternalLink class="size-3" />
              </Button>
            </article>
          </div>
          <div v-else class="mt-3 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3">
            <p class="text-caption leading-5 text-muted-foreground">
              暂无该 CVE 的来源快照；可先同步一个公开源，或在设置中导入 Feed。
            </p>
          </div>
        </section>

        <div ref="loopWorkspace" class="mt-5">
          <VulnerabilityLoopPanel
            :item="dashboard.selected.value"
            :research-task="dashboard.researchTaskFor.value"
            :research-note="dashboard.researchNoteFor.value"
            :practice-environment="dashboard.practiceEnvironmentFor.value"
            :practice-session="dashboard.practiceSessionFor.value"
            :coding-handoff="dashboard.codingHandoffFor.value"
            :coding-workspace-path="codingWorkspacePath"
            :coding-task="dashboard.codingTaskForSelected.value"
            @establish-task="establishOrFocusResearchTask"
            @confirm-practice="dashboard.confirmPracticeEnvironment(dashboard.selected.value.id)"
            @choose-workspace="$emit('chooseCodingWorkspace')"
            @start-coding-task="startSelectedCodingTask"
          />
        </div>

        <section
          v-if="dashboard.practiceEnvironmentFor.value"
          ref="practiceWorkspace"
          class="mt-5 rounded-xl border border-border bg-background px-5 py-5"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">隔离练习环境</h3>
            <Badge variant="info">已匹配</Badge>
          </div>

          <div v-if="dashboard.practiceEnvironmentFor.value" class="mt-4 rounded-xl border border-border bg-card px-4 py-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-body font-medium">{{ dashboard.practiceEnvironmentFor.value.title }}</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  {{ dashboard.practiceEnvironmentFor.value.matchReason }}
                </p>
              </div>
              <Badge :variant="selectedPracticeBadge.variant">
                {{ selectedPracticeBadge.label }}
              </Badge>
            </div>

            <dl class="mt-4 grid gap-2 text-caption leading-5">
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">来源</dt>
                <dd>
                  <Button
                    as="a"
                    :href="dashboard.practiceEnvironmentFor.value.source.href"
                    target="_blank"
                    rel="noreferrer"
                    variant="link"
                    size="text"
                  >
                    {{ dashboard.practiceEnvironmentFor.value.source.label }} <ExternalLink class="size-3" />
                  </Button>
                  <span class="ml-2 text-muted-foreground">
                    {{ dashboard.practiceEnvironmentFor.value.source.revision }}
                  </span>
                </dd>
              </div>
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">目录</dt>
                <dd class="font-mono">{{ dashboard.practiceEnvironmentFor.value.directory }}</dd>
              </div>
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">端口</dt>
                <dd>{{ dashboard.practiceEnvironmentFor.value.ports.join('；') }}</dd>
              </div>
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">资源</dt>
                <dd>{{ dashboard.practiceEnvironmentFor.value.resources }}</dd>
              </div>
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">网络</dt>
                <dd>{{ dashboard.practiceEnvironmentFor.value.network }}</dd>
              </div>
              <div class="grid grid-cols-[4.5rem_1fr] gap-3">
                <dt class="text-muted-foreground">清理</dt>
                <dd>{{ dashboard.practiceEnvironmentFor.value.cleanup }}</dd>
              </div>
            </dl>

            <ul class="mt-4 space-y-2 rounded-lg bg-muted/30 px-3 py-3 text-caption leading-5 text-muted-foreground">
              <li
                v-for="rule in dashboard.practiceEnvironmentFor.value.safety"
                :key="rule"
                class="flex gap-2"
              >
                <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
                <span>{{ rule }}</span>
              </li>
            </ul>

            <div
              v-if="dashboard.practiceSessionFor.value"
              class="mt-4 rounded-lg border border-border bg-muted/20 px-3 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-caption font-medium text-muted-foreground">启动前任务</p>
              </div>
              <p class="mt-2 text-body leading-6">{{ dashboard.practiceSessionFor.value.nextPrompt }}</p>
              <dl class="mt-3 grid gap-1.5 text-caption leading-5">
                <div class="grid grid-cols-[5.5rem_1fr] gap-3">
                  <dt class="text-muted-foreground">本地目录</dt>
                  <dd class="break-all font-mono">
                    {{ dashboard.practiceSessionFor.value.localDirectory || '未选择' }}
                  </dd>
                </div>
                <div
                  v-if="dashboard.practiceSessionFor.value.projectName"
                  class="grid grid-cols-[5.5rem_1fr] gap-3"
                >
                  <dt class="text-muted-foreground">Compose</dt>
                  <dd class="break-all font-mono">{{ dashboard.practiceSessionFor.value.projectName }}</dd>
                </div>
                <div
                  v-if="dashboard.practiceSessionFor.value.evidencePath"
                  class="grid grid-cols-[5.5rem_1fr] gap-3"
                >
                  <dt class="text-muted-foreground">证据</dt>
                  <dd class="break-all font-mono">{{ dashboard.practiceSessionFor.value.evidencePath }}</dd>
                </div>
                <div class="grid grid-cols-[5.5rem_1fr] gap-3">
                  <dt class="text-muted-foreground">更新时间</dt>
                  <dd>{{ new Date(dashboard.practiceSessionFor.value.updatedAt).toLocaleString() }}</dd>
                </div>
              </dl>
              <p
                v-if="dashboard.practiceSessionFor.value.lastError || dashboard.practiceRuntimeError.value"
                class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption leading-5 text-destructive"
              >
                {{ dashboard.practiceSessionFor.value.lastError || dashboard.practiceRuntimeError.value }}
              </p>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button
                v-if="!dashboard.practiceSessionFor.value"
                size="sm"
                @click="dashboard.confirmPracticeEnvironment(dashboard.selected.value.id)"
              >
                <Play class="size-4" />
                确认练习计划
              </Button>
              <Button
                v-if="dashboard.practiceSessionFor.value && !dashboard.practiceSessionFor.value.localDirectory"
                variant="outline"
                size="sm"
                :disabled="dashboard.practiceRuntimeBusy.value"
                @click="chooseSelectedPracticeDirectory"
              >
                <FolderOpen class="size-4" />
                选择本地目录
              </Button>
              <Button
                v-if="dashboard.practiceSessionFor.value?.localDirectory && selectedPracticeState !== 'running'"
                size="sm"
                :disabled="dashboard.practiceRuntimeBusy.value || selectedPracticeState === 'starting'"
                @click="startSelectedPracticeRuntime"
              >
                <Play class="size-4" />
                启动本地练习
              </Button>
              <Button
                v-if="selectedPracticeState === 'running'"
                variant="outline"
                size="sm"
                :disabled="dashboard.practiceRuntimeBusy.value"
                @click="refreshSelectedPracticeRuntime"
              >
                刷新状态
              </Button>
              <Button
                v-if="selectedPracticeState === 'running'"
                variant="outline"
                size="sm"
                :disabled="dashboard.practiceRuntimeBusy.value"
                @click="stopSelectedPracticeRuntime"
              >
                <Square class="size-4" />
                停止并清理
              </Button>
              <Button
                v-if="dashboard.practiceSessionFor.value"
                variant="ghost"
                size="sm"
                @click="dashboard.clearPracticeSession(dashboard.selected.value.id)"
              >
                清除记录
              </Button>
            </div>
          </div>

        </section>

        <section ref="notesWorkspace" class="mt-5 rounded-xl border border-border bg-background px-5 py-5">
          <p v-if="archiveLoadError" class="mb-3 text-caption text-destructive">
            正式研究档案读取失败：{{ archiveLoadError }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">受影响资产（{{ dashboard.selected.value.assets.length }}）</h3>
            <Button
              variant="outline"
              size="sm"
              @click="showAssetForm = !showAssetForm"
            >
              <Plus class="size-4" />
              新增资产
            </Button>
          </div>
          <form
            v-if="showAssetForm"
            class="mt-3 rounded-lg border border-border bg-muted/20 p-3"
            @submit.prevent="addSelectedAssetRecord"
          >
            <div class="grid gap-2 sm:grid-cols-3">
              <Input v-model="assetForm.name" size="sm" aria-label="CVE 资产名称" placeholder="资产名称" />
              <Input v-model="assetForm.address" size="sm" aria-label="CVE 资产地址" placeholder="地址 / 仓库 / 服务" />
              <Input v-model="assetForm.environment" size="sm" aria-label="CVE 资产环境" placeholder="环境，例如生产 / 本地" />
            </div>
            <p v-if="assetFormError" class="mt-2 text-caption text-destructive">{{ assetFormError }}</p>
            <div class="mt-3 flex items-center gap-2">
              <Button type="submit" size="sm" :disabled="assetWritebackBusy">
                {{ assetWritebackBusy ? '写入中…' : '加入资产' }}
              </Button>
              <Button type="button" variant="ghost" size="sm" @click="showAssetForm = false">
                取消
              </Button>
            </div>
          </form>
          <p v-if="assetFormNotice" class="mt-3 text-caption text-success">{{ assetFormNotice }}</p>
          <div class="mt-3 overflow-hidden rounded-lg border border-border">
            <div
              v-for="asset in dashboard.selected.value.assets"
              :key="asset.id"
              class="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <Server class="size-4 text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-body font-medium">{{ asset.name }}</span>
                <span class="mt-1 block font-mono text-caption text-muted-foreground">{{ asset.address }} · {{ asset.environment }}</span>
              </span>
              <Badge variant="outline">{{ asset.status }}</Badge>
            </div>
          </div>
        </section>

        <section class="mt-5 rounded-xl border border-border bg-background px-5 py-5">
          <h3 class="text-label font-medium">追踪时间线</h3>
          <div class="mt-3 space-y-3">
            <div
              v-for="event in dashboard.selected.value.timeline"
              :key="`${dashboard.selected.value.id}-${event.label}`"
              class="flex gap-3"
            >
              <span
                class="mt-1 size-2.5 rounded-full"
                :class="event.state === 'done'
                  ? 'bg-success'
                  : event.state === 'active'
                    ? 'bg-primary'
                    : 'bg-muted-foreground/30'"
              />
              <span class="min-w-0">
                <span class="block text-body font-medium">{{ event.label }}</span>
                <span class="mt-0.5 block text-caption text-muted-foreground">{{ event.detail }}</span>
              </span>
            </div>
          </div>
        </section>

        <section class="mt-5 rounded-xl border border-border bg-background px-5 py-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">研究笔记</h3>
            <div class="flex items-center gap-2">
              <Badge
                :variant="dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? 'success' : 'outline'"
              >
                {{ dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? '有未提交草稿' : '无草稿' }}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                @click="showCodingConclusionForm = !showCodingConclusionForm"
              >
                <ClipboardList class="size-4" />
                导入 Coding 结论
              </Button>
            </div>
          </div>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            只记录你确认过的材料、判断和学习收获；不要把 Agent 猜测当成事实。
          </p>
          <form
            v-if="showCodingConclusionForm"
            class="mt-4 rounded-lg border border-border bg-muted/20 p-3"
            aria-label="导入 Coding 研究结论"
            @submit.prevent="importCodingConclusion"
          >
            <p class="text-caption leading-5 text-muted-foreground">
              粘贴 Coding Agent 完成后的摘要、材料链接或影响检查结论；用户确认后直接写入 Runtime 正式学习记录，不自动提升用户能力画像。
            </p>
            <Textarea
              v-model="codingConclusionText"
              class="mt-3 min-h-28 resize-y"
              aria-label="Coding 结论回写"
              placeholder="例如：已核对厂商公告和补丁，当前授权仓库未发现受影响组件；仍需用户确认生产资产版本。"
            />
            <p v-if="codingConclusionError" class="mt-2 text-caption text-destructive">{{ codingConclusionError }}</p>
            <div class="mt-3 flex items-center gap-2">
              <Button type="submit" size="sm" :loading="codingConclusionWritebackBusy">
                写入正式档案
              </Button>
              <Button type="button" variant="ghost" size="sm" :disabled="codingConclusionWritebackBusy" @click="showCodingConclusionForm = false">
                取消
              </Button>
            </div>
          </form>
          <p v-if="codingConclusionNotice" class="mt-3 text-caption text-primary">
            {{ codingConclusionNotice }}
          </p>
          <p
            v-if="dashboard.runtimeProjectionFor.value"
            class="mt-3 text-caption leading-5 text-muted-foreground"
          >
            正式研究档案：{{ dashboard.runtimeProjectionFor.value.job.id }}
            · {{ dashboard.runtimeProjectionFor.value.learning.length }} 条学习记录
            · {{ dashboard.runtimeProjectionFor.value.assetVerifications.length }} 条资产验证
          </p>
          <div
            v-if="dashboard.runtimeProjectionFor.value?.learning.length"
            class="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3"
          >
            <p class="text-caption font-medium text-muted-foreground">正式学习记录</p>
            <p
              v-for="record in dashboard.runtimeProjectionFor.value.learning"
              :key="record.id"
              class="whitespace-pre-wrap text-caption leading-5"
            >
              {{ record.content }}
            </p>
          </div>
          <div class="mt-4 space-y-3">
            <label class="block">
              <span class="text-caption font-medium text-muted-foreground">关键结论草稿</span>
              <Textarea
                :model-value="dashboard.researchNoteFor.value.keyFindings"
                class="mt-2 min-h-20 resize-y"
                placeholder="例如：当前版本范围需要先对照厂商补丁；本项目暂未发现受影响组件。"
                aria-label="CVE 关键结论"
                @update:model-value="value => dashboard.updateResearchNote(dashboard.selected.value.id, { keyFindings: String(value) })"
              />
            </label>
            <label class="block">
              <span class="text-caption font-medium text-muted-foreground">学习笔记草稿</span>
              <Textarea
                :model-value="dashboard.researchNoteFor.value.notes"
                class="mt-2 min-h-24 resize-y"
                placeholder="记录公告阅读、补丁理解、影响判断、提示依赖和下一步要交给 Coding Agent 的事项…"
                aria-label="CVE 学习笔记"
                @update:model-value="value => dashboard.updateResearchNote(dashboard.selected.value.id, { notes: String(value) })"
              />
            </label>
          </div>
          <p v-if="researchDraftError" class="mt-3 text-caption text-destructive">{{ researchDraftError }}</p>
          <p v-if="researchDraftNotice" class="mt-3 text-caption text-success">{{ researchDraftNotice }}</p>
          <Button
            class="mt-3"
            size="sm"
            :loading="researchDraftWritebackBusy"
            @click="submitResearchDraft"
          >
            提交草稿到正式档案
          </Button>
          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            {{ dashboard.researchNoteFor.value.updatedAt ? `本机草稿最近保存：${new Date(dashboard.researchNoteFor.value.updatedAt).toLocaleString()}` : '输入只作为未提交草稿保存在本机；正式结论以 Runtime 档案为准。' }}
          </p>
        </section>

      </div>
    </section>
  </main>
</template>
