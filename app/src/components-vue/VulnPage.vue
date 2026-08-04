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
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Star,
  Square,
  Workflow,
} from 'lucide-vue-next'
import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import VulnerabilityLoopPanel from '@/components-vue/VulnerabilityLoopPanel.vue'
import { useVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import type { VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'

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
const showImportForm = ref(false)
const showPracticeImportForm = ref(false)
const importText = ref('')
const importNotice = ref('')
const importError = ref('')
const lastImportedIds = ref<string[]>([])
const practiceImportText = ref('')
const practiceImportNotice = ref('')
const practiceImportError = ref('')
const lastImportedPracticeIds = ref<string[]>([])
const showAssetForm = ref(false)
const assetFormError = ref('')
const feedImportCopyNotice = ref('')
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

function addSelectedAssetRecord() {
  assetFormError.value = ''
  try {
    dashboard.addAssetRecord(dashboard.selected.value.id, assetForm.value)
    showAssetForm.value = false
    assetForm.value = { name: '', address: '', environment: '' }
  } catch (cause) {
    assetFormError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function importLocalIntelJSON() {
  importError.value = ''
  importNotice.value = ''
  lastImportedIds.value = []
  const result = dashboard.importTrackingJSON(importText.value)
  if (result.errors.length && !result.imported) {
    importError.value = result.errors.join('；')
    return
  }
  lastImportedIds.value = result.importedIds
  importNotice.value = `已导入 ${result.imported} 条本地 CVE 追踪`
    + (result.skipped ? `，跳过 ${result.skipped} 条已存在记录` : '')
    + (result.errors.length ? `；${result.errors.length} 条格式需人工处理` : '')
  importText.value = ''
  showImportForm.value = false
}

function undoLastImport() {
  const removed = dashboard.removeLocalTrackingItems(lastImportedIds.value)
  importNotice.value = removed
    ? `已撤销本次导入的 ${removed} 条本地 CVE 追踪`
    : '没有可撤销的本地导入记录'
  lastImportedIds.value = []
}

function importPracticeCatalogJSON() {
  practiceImportError.value = ''
  practiceImportNotice.value = ''
  lastImportedPracticeIds.value = []
  const result = dashboard.importPracticeCatalogJSON(practiceImportText.value)
  if (result.errors.length && !result.imported) {
    practiceImportError.value = result.errors.join('；')
    return
  }
  lastImportedPracticeIds.value = result.importedIds
  practiceImportNotice.value = `已导入 ${result.imported} 个本地练习环境匹配`
    + (result.skipped ? `，跳过 ${result.skipped} 个已存在匹配` : '')
    + (result.errors.length ? `；${result.errors.length} 条需人工处理` : '')
  practiceImportText.value = ''
  showPracticeImportForm.value = false
}

function undoLastPracticeImport() {
  const removed = dashboard.removeLocalPracticeEnvironments(lastImportedPracticeIds.value)
  practiceImportNotice.value = removed
    ? `已撤销本次导入的 ${removed} 个本地练习环境匹配`
    : '没有可撤销的本地练习环境匹配'
  lastImportedPracticeIds.value = []
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
  if (label === '交给 Coding') return '交给 Coding'
  if (label === '补用户笔记') return '去写笔记'
  return '查看摘要'
})

const feedImportPrompt = computed(() => [
  '继续 MilkSU M3 产品闭环冲刺，补 CVE 情报源的只读导入纵切。',
  '',
  '目标：把 CVE 工作台从内置快照推进到可复核的只读 Feed/Catalog 导入计划或最小实现；不要做红队 Agent、批量打靶、自动 PoC 或外部目标攻击。',
  '',
  '范围建议：',
  '1. 先读取当前 git 状态、product-loop-sprint.md、objective-coverage-ledger.md 和 CVE 相关代码。',
  '2. 固定 NVD、CISA KEV、FIRST EPSS、OSV、GitHub Advisory 或 Vulhub catalog 的来源、样本日期、revision/digest、失败原因和缓存位置。',
  '3. 如果实现代码，只做只读导入/解析/展示；不拉起 Docker、不开放端口、不发送漏洞触发输入、不访问未经授权目标。',
  '4. UI 必须继续区分“内置快照 / 用户材料 / 待接入 Feed / 已导入样本”，不能把 EPSS/KEV/情报命中写成 Judge 或真实资产验证。',
  '5. 相邻问题只登记到覆盖台账，不深挖；完成后跑相关窄测、npm --prefix app run build、Browser preview，并更新 product-loop-sprint-acceptance.md。',
  '6. git diff --check，通过后 commit 并 push 当前 MilkSU 私有分支。',
  '',
  '边界：不要读取、输出或迁移 Provider/API Key；不要接入外部漏洞目标；不要把 UI 架子或 smoke 写成完整 CVE 能力。',
].join('\n'))

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

async function copyFeedImportPrompt() {
  feedImportCopyNotice.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(feedImportPrompt.value)
    feedImportCopyNotice.value = '已复制'
  } catch {
    feedImportCopyNotice.value = '复制失败，请手动选择导入计划'
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
          :variant="showImportForm ? 'outline' : 'ghost'"
          size="sm"
          @click="showImportForm = !showImportForm"
        >
          <ClipboardList class="size-4" />
          导入 JSON
        </Button>
        <Button
          :variant="showPracticeImportForm ? 'outline' : 'ghost'"
          size="sm"
          @click="showPracticeImportForm = !showPracticeImportForm"
        >
          <Play class="size-4" />
          导入练习
        </Button>
        <Button
          :variant="dashboard.watchOnly.value ? 'outline' : 'ghost'"
          size="sm"
          @click="dashboard.watchOnly.value = !dashboard.watchOnly.value"
        >
          <Bookmark class="size-4" />
          我的关注
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="刷新 CVE 本机快照" @click="dashboard.refreshSources">
          <RefreshCw class="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="设置" @click="$emit('openSettings')">
          <Settings class="size-4" />
        </Button>
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
        <span class="ml-auto text-caption text-muted-foreground">
          {{ dashboard.sourceRefreshSummary.value.label }} · {{ dashboard.intelSources.length }} 源口径
        </span>
      </div>
      </template>

      <template #metrics>
      <div class="grid gap-3 text-body sm:grid-cols-2 xl:grid-cols-5">
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
          <p class="text-caption text-muted-foreground">情报源</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.intelSources.length }}</p>
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

    <div class="grid min-h-0 flex-1 grid-cols-[minmax(560px,1.25fr)_minmax(360px,.75fr)] max-[1080px]:grid-cols-1">
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
        <form
          v-if="showImportForm"
          class="border-b border-border bg-card/70 px-6 py-5"
          aria-label="导入本地 CVE JSON"
          @submit.prevent="importLocalIntelJSON"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-label font-medium">导入本地 CVE JSON</h2>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                粘贴 NVD/OSV/GHSA 摘要或你整理的数组；只解析成本机追踪项，不联网同步、不启动 Docker、不运行 PoC。
              </p>
            </div>
            <Badge variant="outline">只读导入</Badge>
          </div>
          <Textarea
            v-model="importText"
            class="mt-4 min-h-32 font-mono text-caption"
            aria-label="本地 CVE JSON"
            placeholder='[{"id":"CVE-2026-42424","title":"Example issue","vendor":"Example","product":"demo","affected":"1.x","summary":"本地学习追踪摘要","references":[{"label":"Advisory","href":"https://example.test/advisory"}]}]'
          />
          <p class="mt-2 text-caption leading-5 text-muted-foreground">
            支持对象、数组，或包含 items / vulnerabilities / cves / results 的对象；重复 CVE 会跳过并保留现有记录。
          </p>
          <p v-if="importError" class="mt-3 text-caption text-destructive">{{ importError }}</p>
          <p v-if="importNotice" class="mt-3 text-caption text-primary">{{ importNotice }}</p>
          <div class="mt-4 flex items-center gap-2">
            <Button type="submit" size="sm">
              <ClipboardList class="size-4" />
              导入为本地追踪
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="showImportForm = false">
              取消
            </Button>
          </div>
        </form>
        <form
          v-if="showPracticeImportForm"
          class="border-b border-border bg-card/70 px-6 py-5"
          aria-label="导入本地 CVE 练习 Catalog JSON"
          @submit.prevent="importPracticeCatalogJSON"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-label font-medium">导入本地练习 Catalog</h2>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                粘贴 Vulhub 或你整理的 CVE → Docker Compose 目录映射；只绑定启动前计划，不拉镜像、不启动容器、不运行触发输入。
              </p>
            </div>
            <Badge variant="outline">只读练习匹配</Badge>
          </div>
          <Textarea
            v-model="practiceImportText"
            class="mt-4 min-h-32 font-mono text-caption"
            aria-label="本地 CVE 练习 Catalog JSON"
            placeholder='[{"cveId":"CVE-2024-3400","title":"Vulhub · PAN-OS CVE-2024-3400","directory":"pan-os/CVE-2024-3400","sourceHref":"https://github.com/example/catalog/tree/main/pan-os/CVE-2024-3400","revision":"catalog commit abc123","ports":["8080/tcp · local lab"],"network":"仅本机 loopback"}]'
          />
          <p class="mt-2 text-caption leading-5 text-muted-foreground">
            支持对象、数组，或包含 items / vulnerabilities / cves / results 的对象；CVE 必须已在追踪列表中，重复匹配会跳过。
          </p>
          <p v-if="practiceImportError" class="mt-3 text-caption text-destructive">{{ practiceImportError }}</p>
          <p v-if="practiceImportNotice" class="mt-3 text-caption text-primary">{{ practiceImportNotice }}</p>
          <div class="mt-4 flex items-center gap-2">
            <Button type="submit" size="sm">
              <Play class="size-4" />
              导入练习匹配
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="showPracticeImportForm = false">
              取消
            </Button>
          </div>
        </form>
        <div
          v-if="importNotice && !showImportForm"
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-6 py-3"
          role="status"
          aria-label="CVE 导入结果"
        >
          <p class="text-caption text-primary">{{ importNotice }}</p>
          <Button
            v-if="lastImportedIds.length"
            type="button"
            variant="outline"
            size="sm"
            @click="undoLastImport"
          >
            撤销本次导入
          </Button>
        </div>
        <div
          v-if="practiceImportNotice && !showPracticeImportForm"
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-6 py-3"
          role="status"
          aria-label="CVE 练习 Catalog 导入结果"
        >
          <p class="text-caption text-primary">{{ practiceImportNotice }}</p>
          <Button
            v-if="lastImportedPracticeIds.length"
            type="button"
            variant="outline"
            size="sm"
            @click="undoLastPracticeImport"
          >
            撤销本次导入
          </Button>
        </div>
        <section class="border-b border-border bg-card/35 px-6 py-5" aria-label="CVE 情报源接入状态">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-label font-medium">情报源接入状态</h2>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                当前是可验收的学习/追踪骨架：区分内置快照、用户材料和待接入 Feed，不把排序信号当成 Judge。
              </p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                {{ dashboard.sourceRefreshSummary.value.detail }}
              </p>
            </div>
            <Badge variant="outline">非实时同步</Badge>
          </div>
          <div
            class="mt-4 rounded-xl border border-border bg-background px-4 py-3"
            aria-label="CVE 情报导入接力"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-body font-medium">下一步可交给 Coding Agent</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  做只读 Feed 导入器：固定 NVD / CISA KEV / EPSS / OSV / GHSA / Vulhub revision，
                  记录样本日期、来源哈希和失败原因；不启动 Docker，不访问外部目标，不把情报命中写成验证。
                </p>
                <p class="mt-2 text-caption text-muted-foreground">
                  {{ feedImportCopyNotice || '不会自动启动 Agent；复制后可交给下一轮 Coding 任务。' }}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-2">
                <Badge variant="secondary">只读导入计划</Badge>
                <Button type="button" variant="outline" size="sm" @click="copyFeedImportPrompt">
                  <ClipboardList class="size-4" />
                  复制导入任务
                </Button>
              </div>
            </div>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="source in dashboard.intelSources"
              :key="source.id"
              class="rounded-xl border border-border bg-background px-4 py-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-body font-medium">{{ source.name }}</p>
                  <p class="mt-1 line-clamp-2 text-caption leading-5 text-muted-foreground">{{ source.role }}</p>
                </div>
                <Badge
                  :variant="source.currentState === '待接入'
                    ? 'outline'
                    : source.currentState === '用户材料'
                      ? 'secondary'
                      : 'info'"
                  class="shrink-0"
                >
                  {{ source.currentState }}
                </Badge>
              </div>
              <p class="mt-3 line-clamp-2 text-caption leading-5 text-muted-foreground">
                {{ source.evidence }}
              </p>
              <p class="mt-2 line-clamp-2 text-caption leading-5 text-muted-foreground">
                下一步：{{ source.nextStep }}
              </p>
            </article>
          </div>
          <div
            class="mt-4 rounded-xl border border-border bg-background px-4 py-3"
            aria-label="Vulhub 练习目录匹配状态"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-body font-medium">Vulhub 练习目录匹配</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  {{ dashboard.practiceCatalogSummary.value.detail }}
                </p>
              </div>
              <Badge :variant="dashboard.practiceCatalogSummary.value.variant" class="shrink-0">
                {{ dashboard.practiceCatalogSummary.value.label }}
              </Badge>
            </div>
            <p class="mt-2 text-caption leading-5 text-muted-foreground">
              固定快照：{{ dashboard.practiceCatalogRevision.value }}；{{ dashboard.practiceCatalogSummary.value.revision }}
            </p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              这里只做只读匹配和启动前计划；拉取镜像、启动容器、开放端口或发送漏洞触发输入仍需用户逐次确认。
            </p>
          </div>
        </section>
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
              <Badge
                :variant="dashboard.practiceSessionFor.value?.state === 'confirmed'
                  ? 'success'
                  : dashboard.practiceSessionFor.value?.state === 'stopped'
                    ? 'secondary'
                    : 'outline'"
              >
                {{
                  dashboard.practiceSessionFor.value?.state === 'confirmed'
                    ? '已确认计划'
                    : dashboard.practiceSessionFor.value?.state === 'stopped'
                      ? '已停止'
                      : '待确认'
                }}
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
              <p class="mt-2 text-caption text-muted-foreground">
                本地记录：{{ new Date(dashboard.practiceSessionFor.value.updatedAt).toLocaleString() }}
              </p>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button
                v-if="dashboard.practiceSessionFor.value?.state !== 'confirmed'"
                size="sm"
                @click="dashboard.confirmPracticeEnvironment(dashboard.selected.value.id)"
              >
                <Play class="size-4" />
                确认练习计划
              </Button>
              <Button
                v-else
                variant="outline"
                size="sm"
                @click="dashboard.stopPracticeEnvironment(dashboard.selected.value.id)"
              >
                <Square class="size-4" />
                标记停止
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
              <Input v-model="assetForm.name" size="sm" placeholder="资产名称" />
              <Input v-model="assetForm.address" size="sm" placeholder="地址 / 仓库 / 服务" />
              <Input v-model="assetForm.environment" size="sm" placeholder="环境，例如生产 / 本地" />
            </div>
            <p v-if="assetFormError" class="mt-2 text-caption text-destructive">{{ assetFormError }}</p>
            <div class="mt-3 flex items-center gap-2">
              <Button type="submit" size="sm">
                加入资产
              </Button>
              <Button type="button" variant="ghost" size="sm" @click="showAssetForm = false">
                取消
              </Button>
            </div>
          </form>
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
            <Badge
              :variant="dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? 'success' : 'outline'"
            >
              {{ dashboard.researchNoteFor.value.notes || dashboard.researchNoteFor.value.keyFindings ? '已记录' : '未记录' }}
            </Badge>
          </div>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            只记录你确认过的材料、判断和学习收获；不要把 Agent 猜测当成事实。
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
