<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
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
  Bookmark,
  ClipboardList,
  ExternalLink,
  FileText,
  FolderOpen,
  Plus,
  Play,
  Search,
  Server,
  ShieldCheck,
  Star,
  Square,
  Workflow,
} from 'lucide-vue-next'
import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import WorkspaceSettingsButton from '@/components-vue/WorkspaceSettingsButton.vue'
import SessionHistoryPanel from '@/components-vue/SessionHistoryPanel.vue'
import VulnerabilityIntelSettingsPanel from '@/components-vue/VulnerabilityIntelSettingsPanel.vue'
import VulnerabilityLoopPanel from '@/components-vue/VulnerabilityLoopPanel.vue'
import { useVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import { invokeCommand } from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import type { VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import type { SessionHistorySearchResult } from '@/sessionIndexTypes'
import type { VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'
import type { VulnProjection } from '@/vulnTypes'

defineOptions({ name: 'VulnPage' })

const props = defineProps<{
  codingWorkspacePath?: string
}>()

const emit = defineEmits<{
  openSettings: []
  chooseCodingWorkspace: []
  startCodingTask: [task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void]
}>()
const dashboard = useVulnerabilityDashboard()

const sprintTasks = [
  '让 Coding Agent 读取公告、补丁和版本清单，产出影响判断草稿',
  '把用户确认的资产状态、学习笔记和参考材料固化为证据',
  '在授权仓库内做静态补丁理解或依赖版本检查',
]

const learningPath = [
  { label: '理解影响', detail: '看懂组件、受影响版本、利用成熟度和资产命中。' },
  { label: '收集证据', detail: '保留公告、补丁、版本清单、用户确认和处置记录。' },
  { label: '沉淀能力', detail: '把独立完成、提示依赖和 Agent 代做分开记录。' },
]

const safetyBoundaries = [
  '不批量扫描或攻击外部目标',
  '不自动运行 PoC、exploit 或漏洞触发输入',
  '不把情报状态等同于漏洞已经验证',
]
const researchSteps = [
  { id: 'snapshot', label: '固化情报快照', detail: '保存 CVE、公告、版本范围、资产命中和当前状态。' },
  { id: 'materials', label: '阅读材料与补丁', detail: '整理 NVD、厂商公告、补丁 Diff 和公开分析。' },
  { id: 'impact', label: '影响检查', detail: '在授权仓库或资产清单中只读核对组件与版本证据。' },
  { id: 'fix', label: '修复与缓解证据', detail: '记录升级版本、配置缓解、补丁或分流原因。' },
  { id: 'reflection', label: '学习复盘', detail: '沉淀根因、判断方法、提示依赖和用户贡献。' },
]

const showCustomForm = ref(false)
const customFormError = ref('')
const showIntelSettings = ref(false)
const showAssetForm = ref(false)
const assetFormError = ref('')
const assetFormNotice = ref('')
const assetWritebackBusy = ref(false)
const showCodingConclusionForm = ref(false)
const codingConclusionText = ref('')
const codingConclusionError = ref('')
const codingConclusionNotice = ref('')
const codingConclusionWritebackBusy = ref(false)
const historyNoteNotice = ref('')
const loopWorkspace = ref<HTMLElement | null>(null)
const practiceWorkspace = ref<HTMLElement | null>(null)
const researchWorkspace = ref<HTMLElement | null>(null)
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
  try {
    dashboard.addAssetRecord(selected.id, input)
    showAssetForm.value = false
    assetForm.value = { name: '', address: '', environment: '' }
  } catch (cause) {
    assetFormError.value = cause instanceof Error ? cause.message : String(cause)
    return
  }
  assetWritebackBusy.value = true
  try {
    const workspace = await invokeCommand<VulnProjection>('ensure_vuln_tracking_workspace', {
      request: {
        cveId: selected.id,
        title: selected.title,
        summary: selected.summary,
        referenceHref: selected.references[0]?.href || '',
      },
    })
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
    assetFormNotice.value = `已加入资产，并写入正式研究档案 ${projection.job.id}（${projection.assetVerifications.length} 条资产验证）。`
  } catch (cause) {
    assetFormError.value = `已保存到本机资产列表；正式研究档案写入失败：${cause instanceof Error ? cause.message : String(cause)}`
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
  const summary = raw
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*#\s]+/, '').trim())
    .find(Boolean)
    ?.slice(0, 240)
    || '已导入 Coding 研究结论，待继续核对。'
  const existing = dashboard.researchNoteFor.value
  const stamp = new Date().toLocaleString()
  const selected = dashboard.selected.value
  dashboard.updateResearchNote(selected.id, {
    keyFindings: existing.keyFindings.trim()
      ? `${existing.keyFindings.trim()}\n${summary}`
      : summary,
    notes: [
      existing.notes.trim(),
      `[${stamp}] Coding 结论回写（用户粘贴/确认）：\n${raw}`,
    ].filter(Boolean).join('\n\n'),
  })
  codingConclusionText.value = ''
  showCodingConclusionForm.value = false
  codingConclusionWritebackBusy.value = true
  try {
    const workspace = await invokeCommand<VulnProjection>('ensure_vuln_tracking_workspace', {
      request: {
        cveId: selected.id,
        title: selected.title,
        summary: selected.summary,
        referenceHref: selected.references[0]?.href || '',
      },
    })
    const projection = await invokeCommand<VulnProjection>('record_vuln_learning', {
      id: workspace.job.id,
      request: {
        kind: 'reflection',
        content: raw,
        concept: selected.id,
      },
    })
    dashboard.markResearchNoteWorkspace(selected.id, projection.job.id, projection.learning.length)
    codingConclusionNotice.value = `已导入到研究笔记，并写入正式研究档案 ${projection.job.id}（${projection.learning.length} 条学习记录）。`
  } catch (cause) {
    codingConclusionError.value = `已保存到本机研究笔记；正式研究档案写入失败：${cause instanceof Error ? cause.message : String(cause)}`
    codingConclusionNotice.value = '已导入到研究笔记；请保留可核对材料链接，避免把 Agent 推测当成事实。'
  } finally {
    codingConclusionWritebackBusy.value = false
  }
}

function sessionHistorySourceLabel(source = '') {
  if (source === 'milksu-ctf') return 'CTF'
  if (source === 'milksu-cve') return 'CVE'
  if (source === 'milksu-coding') return 'Coding'
  return source || '历史'
}

function trimHistoryField(value = '', maxLength = 600) {
  const redacted = redactProviderCredentials(value).trim()
  if (redacted.length <= maxLength) return redacted
  return `${redacted.slice(0, maxLength)}…`
}

function recordSessionHistoryAsNote(result: SessionHistorySearchResult) {
  const existing = dashboard.researchNoteFor.value
  const stamp = new Date().toLocaleString()
  const lines = [
    `- 会话：${trimHistoryField(result.sessionName, 160)}`,
    `- 来源：${sessionHistorySourceLabel(result.source)}`,
    result.timestamp ? `- 时间：${new Date(result.timestamp).toLocaleString()}` : '',
    result.skill ? `- 工具：${trimHistoryField(result.skill, 160)}` : '',
    `- 摘要：${trimHistoryField(result.snippet)}`,
  ].filter(Boolean)

  dashboard.updateResearchNote(dashboard.selected.value.id, {
    notes: [
      existing.notes.trim(),
      `[${stamp}] 相关历史（用户确认）：\n${lines.join('\n')}`,
    ].filter(Boolean).join('\n\n'),
  })
  historyNoteNotice.value = '已记入当前 CVE 笔记。'
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
  researchWorkspace.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}

async function scrollToWorkspace(target: HTMLElement | null) {
  await nextTick()
  target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
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
    <WorkspaceModuleTopBar module="cve" subtitle="追踪 CVE、资产命中与研究进度">
      <template #actions>
        <Button
          :variant="showCustomForm ? 'outline' : 'default'"
          size="sm"
          @click="showCustomForm = !showCustomForm"
        >
          <Plus class="size-4" />
          新增追踪
        </Button>
        <Button
          :variant="dashboard.watchOnly.value ? 'outline' : 'ghost'"
          size="sm"
          @click="dashboard.watchOnly.value = !dashboard.watchOnly.value"
        >
          <Bookmark class="size-4" />
          我的关注
        </Button>
        <WorkspaceSettingsButton
          label="打开设置"
          :active="showIntelSettings"
          @click="showIntelSettings = !showIntelSettings"
        />
      </template>

      <template #filters>
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

      <template #metrics>
      <div v-if="!showIntelSettings" class="grid gap-3 text-body sm:grid-cols-2 xl:grid-cols-4">
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

    <VulnerabilityIntelSettingsPanel
      v-if="showIntelSettings"
      class="min-h-0 flex-1 overflow-y-auto"
      :dashboard="dashboard"
      @close="showIntelSettings = false"
    />

    <div
      v-else
      class="grid min-h-0 flex-1 grid-cols-[minmax(560px,1.25fr)_minmax(360px,.75fr)] max-[1080px]:grid-cols-1"
    >
      <section class="min-h-0 overflow-auto border-r border-border max-[1080px]:border-b max-[1080px]:border-r-0">
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
              @click="dashboard.selectedId.value = item.id"
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

      <aside v-if="dashboard.selected.value" class="min-h-0 overflow-y-auto">
        <div class="px-6 py-6">
          <div class="flex items-center gap-2">
            <Badge variant="outline" font="mono">{{ dashboard.selected.value.id }}</Badge>
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto"
              @click="dashboard.toggleWatch(dashboard.selected.value.id)"
            >
              <Star
                class="size-4"
                :class="dashboard.watched.value.includes(dashboard.selected.value.id) ? 'fill-current' : ''"
              />
              {{ dashboard.watched.value.includes(dashboard.selected.value.id) ? '已关注' : '关注' }}
            </Button>
          </div>
          <WorkspaceDetailTitle class="mt-4" :title="dashboard.selected.value.title" />
          <div class="mt-3 flex flex-wrap gap-2">
            <Badge :variant="severityVariant(dashboard.selected.value.severity)">
              {{ dashboard.selected.value.cvss.toFixed(1) }} CVSS
            </Badge>
            <Badge v-if="dashboard.selected.value.kev" variant="destructive">CISA KEV</Badge>
            <Badge :variant="statusVariant(dashboard.selected.value.status)">{{ dashboard.selected.value.status }}</Badge>
          </div>
          <p class="mt-4 text-body leading-6 text-muted-foreground">{{ dashboard.selected.value.summary }}</p>
        </div>

        <dl class="grid grid-cols-[92px_1fr] gap-x-4 gap-y-3 border-y border-border px-6 py-5 text-body">
          <dt class="text-muted-foreground">受影响范围</dt>
          <dd class="leading-5">{{ dashboard.selected.value.affected }}</dd>
          <dt class="text-muted-foreground">利用成熟度</dt>
          <dd>{{ dashboard.selected.value.maturity }}</dd>
          <dt class="text-muted-foreground">参考链接</dt>
          <dd class="flex flex-wrap gap-2">
            <Button
              v-for="reference in dashboard.selected.value.references"
              :key="reference.href"
              as="a"
              :href="reference.href"
              target="_blank"
              rel="noreferrer"
              variant="link"
              size="text"
            >
              {{ reference.label }} <ExternalLink class="size-3" />
            </Button>
          </dd>
        </dl>

        <div ref="loopWorkspace">
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
            @start-coding-task="startSelectedCodingTask"
          />
        </div>

        <section class="border-b border-border px-6 py-5">
          <h3 class="text-label font-medium">学习路径</h3>
          <ol class="mt-3 space-y-3">
            <li
              v-for="(step, index) in learningPath"
              :key="step.label"
              class="grid grid-cols-[1.75rem_1fr] gap-3"
            >
              <span class="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-caption">
                {{ index + 1 }}
              </span>
              <span>
                <span class="block text-body font-medium">{{ step.label }}</span>
                <span class="mt-1 block text-caption leading-5 text-muted-foreground">{{ step.detail }}</span>
              </span>
            </li>
          </ol>
        </section>

        <SessionHistoryPanel
          module="cve"
          compact
          :default-query="dashboard.selected.value.id"
          confirm-action-label="记入笔记"
          @confirm-result="recordSessionHistoryAsNote"
        />

        <section ref="practiceWorkspace" class="border-b border-border px-6 py-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">隔离练习环境</h3>
            <Badge v-if="dashboard.practiceEnvironmentFor.value" variant="info">已匹配</Badge>
            <Badge v-else variant="outline">未匹配</Badge>
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
                <p class="text-caption font-medium text-muted-foreground">下一步交给 Coding Agent</p>
                <Button
                  v-if="dashboard.codingTaskForSelected.value"
                  variant="outline"
                  size="sm"
                  @click="startSelectedCodingTask(dashboard.codingTaskForSelected.value)"
                >
                  <Workflow class="size-4" />
                  交给 Coding
                </Button>
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

          <div v-else class="mt-4 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-4">
            <p class="text-body font-medium">暂未匹配到可直接练习的本地环境</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              继续保留情报、资产和笔记；后续 Vulhub catalog import 或用户手动绑定环境后，在这里显示确认启动入口。
            </p>
          </div>
        </section>

        <section ref="notesWorkspace" class="border-b border-border px-6 py-5">
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

        <section class="border-b border-border px-6 py-5">
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

        <section class="border-b border-border px-6 py-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">Coding 接力范围</h3>
            <Badge :variant="codingWorkspacePath ? 'success' : 'outline'">
              {{ codingWorkspacePath ? '已选择项目' : '临时工作区' }}
            </Badge>
          </div>
          <div class="mt-3 rounded-xl border border-border bg-card px-4 py-3">
            <p v-if="codingWorkspacePath" class="truncate font-mono text-caption text-muted-foreground">
              {{ codingWorkspacePath }}
            </p>
            <p v-else class="text-caption leading-5 text-muted-foreground">
              尚未选择授权项目；交给 Coding 后仍可先做公告阅读和启动前清单，但“项目影响检查”需要先选择目录。
            </p>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" @click="$emit('chooseCodingWorkspace')">
                <FolderOpen class="size-4" />
                {{ codingWorkspacePath ? '更换项目目录' : '选择项目目录' }}
              </Button>
              <Badge variant="outline">只读影响检查</Badge>
              <Badge variant="outline">不读取凭据</Badge>
            </div>
          </div>
        </section>

        <section ref="researchWorkspace" class="border-b border-border px-6 py-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">研究任务工作区</h3>
            <Badge v-if="dashboard.researchTaskFor.value" variant="info">已建立</Badge>
            <Badge v-else variant="outline">未建立</Badge>
          </div>
          <div v-if="dashboard.researchTaskFor.value" class="mt-4 space-y-4">
            <div class="rounded-xl border border-border bg-card px-4 py-3">
              <p class="flex items-center gap-2 text-body font-medium">
                <ClipboardList class="size-4 text-primary" />
                {{ dashboard.researchTaskFor.value.title }}
              </p>
              <dl class="mt-3 grid gap-2 text-caption leading-5">
                <div class="grid grid-cols-[4rem_1fr] gap-3">
                  <dt class="text-muted-foreground">目标</dt>
                  <dd>{{ dashboard.researchTaskFor.value.goal }}</dd>
                </div>
                <div class="grid grid-cols-[4rem_1fr] gap-3">
                  <dt class="text-muted-foreground">Scope</dt>
                  <dd>{{ dashboard.researchTaskFor.value.scope }}</dd>
                </div>
              </dl>
            </div>
            <div class="space-y-2">
              <div
                v-for="step in researchSteps"
                :key="step.id"
                class="rounded-lg border px-3 py-2"
                :class="dashboard.researchTaskFor.value.completedSteps.includes(step.id)
                  ? 'border-primary/25 bg-primary/5'
                  : 'border-border bg-muted/20'"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-body font-medium">{{ step.label }}</p>
                  <Badge
                    :variant="dashboard.researchTaskFor.value.completedSteps.includes(step.id) ? 'success' : 'outline'"
                  >
                    {{ dashboard.researchTaskFor.value.completedSteps.includes(step.id) ? '完成' : '待办' }}
                  </Badge>
                </div>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ step.detail }}</p>
              </div>
            </div>
            <div class="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <p class="flex items-center gap-2 text-caption font-medium text-muted-foreground">
                  <FileText class="size-4" />
                  下一步交给 Coding Agent
                </p>
                <Button
                  v-if="dashboard.codingTaskForSelected.value"
                  variant="outline"
                  size="sm"
                  @click="startSelectedCodingTask(dashboard.codingTaskForSelected.value)"
                >
                  <Workflow class="size-4" />
                  交给 Coding
                </Button>
              </div>
              <p class="mt-2 text-body leading-6">{{ dashboard.researchTaskFor.value.nextPrompt }}</p>
            </div>
          </div>
          <div v-else>
            <p class="mt-3 text-caption font-medium text-muted-foreground">Agent 可接手任务</p>
            <ul class="mt-2 space-y-2 text-body leading-5">
              <li
                v-for="task in sprintTasks"
                :key="task"
                class="rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                {{ task }}
              </li>
            </ul>
          </div>
        </section>

        <section class="border-b border-border px-6 py-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-label font-medium">研究笔记</h3>
            <div class="flex items-center gap-2">
              <Badge
                :variant="dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? 'success' : 'outline'"
              >
                {{ dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? '已记录' : '未记录' }}
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
              粘贴 Coding Agent 完成后的摘要、材料链接或影响检查结论；这里仅作为用户确认后的学习笔记，不自动提升用户能力画像。
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
                导入到笔记
              </Button>
              <Button type="button" variant="ghost" size="sm" :disabled="codingConclusionWritebackBusy" @click="showCodingConclusionForm = false">
                取消
              </Button>
            </div>
          </form>
          <p v-if="codingConclusionNotice" class="mt-3 text-caption text-primary">
            {{ codingConclusionNotice }}
          </p>
          <p v-if="historyNoteNotice" class="mt-3 text-caption text-primary">
            {{ historyNoteNotice }}
          </p>
          <p
            v-if="dashboard.researchNoteFor.value.workspaceJobId"
            class="mt-3 text-caption leading-5 text-muted-foreground"
          >
            正式研究档案：{{ dashboard.researchNoteFor.value.workspaceJobId }}
            · {{ dashboard.researchNoteFor.value.workspaceLearningCount ?? 0 }} 条学习记录
            <span v-if="dashboard.researchNoteFor.value.workspaceSyncedAt">
              · {{ new Date(dashboard.researchNoteFor.value.workspaceSyncedAt).toLocaleString() }}
            </span>
          </p>
          <div class="mt-4 space-y-3">
            <label class="block">
              <span class="text-caption font-medium text-muted-foreground">关键结论</span>
              <Textarea
                :model-value="dashboard.researchNoteFor.value.keyFindings"
                class="mt-2 min-h-20 resize-y"
                placeholder="例如：当前版本范围需要先对照厂商补丁；本项目暂未发现受影响组件。"
                aria-label="CVE 关键结论"
                @update:model-value="value => dashboard.updateResearchNote(dashboard.selected.value.id, { keyFindings: String(value) })"
              />
            </label>
            <label class="block">
              <span class="text-caption font-medium text-muted-foreground">学习笔记</span>
              <Textarea
                :model-value="dashboard.researchNoteFor.value.notes"
                class="mt-2 min-h-24 resize-y"
                placeholder="记录公告阅读、补丁理解、影响判断、提示依赖和下一步要交给 Coding Agent 的事项…"
                aria-label="CVE 学习笔记"
                @update:model-value="value => dashboard.updateResearchNote(dashboard.selected.value.id, { notes: String(value) })"
              />
            </label>
          </div>
          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            {{ dashboard.researchNoteFor.value.updatedAt ? `最近保存：${new Date(dashboard.researchNoteFor.value.updatedAt).toLocaleString()}` : '填写后自动保存到本机。' }}
          </p>
        </section>

        <section class="border-b border-border px-6 py-5">
          <h3 class="text-label font-medium">安全边界</h3>
          <ul class="mt-3 space-y-2 text-caption leading-5 text-muted-foreground">
            <li v-for="boundary in safetyBoundaries" :key="boundary" class="flex gap-2">
              <ShieldCheck class="mt-0.5 size-3.5 shrink-0" />
              <span>{{ boundary }}</span>
            </li>
          </ul>
        </section>

        <section class="px-6 py-5">
          <Button
            block
            @click="establishOrFocusResearchTask"
          >
            <ShieldCheck
              v-if="dashboard.researchTaskFor.value"
              class="size-4"
            />
            <Workflow v-else class="size-4" />
            {{ dashboard.researchTaskFor.value ? '查看研究任务' : '建立研究任务' }}
          </Button>
          <Button
            variant="ghost"
            block
            class="mt-2"
            @click="dashboard.advanceTask(dashboard.selected.value.id)"
          >
            记录下一步
          </Button>
          <p class="mt-3 text-center text-caption leading-5 text-muted-foreground">
            建立任务后固化情报快照、受影响资产与证据边界。
          </p>
        </section>
      </aside>
    </div>
  </main>
</template>
