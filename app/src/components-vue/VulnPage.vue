<script setup lang="ts">
import { ref } from 'vue'
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
import WorkspaceTopBar from '@/components-vue/WorkspaceTopBar.vue'
import { useVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'

defineOptions({ name: 'VulnPage' })

defineEmits<{ openSettings: [] }>()
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
const showAssetForm = ref(false)
const assetFormError = ref('')
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
    <WorkspaceTopBar title="CVE" subtitle="追踪 CVE、资产命中与研究进度">
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
        <Button variant="ghost" size="icon-sm" aria-label="刷新" @click="dashboard.refreshSources">
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
          <Input v-model="dashboard.query.value" class="pl-9" placeholder="搜索 CVE、产品或厂商" />
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
          内置演示情报源 · rev {{ dashboard.sourceRevision.value }}
        </span>
      </div>
      </template>

      <template #metrics>
      <div class="grid gap-3 text-body sm:grid-cols-3">
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">关注中</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.watched.value.length }}</p>
        </div>
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">研究任务</p>
          <p class="mt-1 font-mono text-xl font-semibold">{{ dashboard.researchTasks.value.length }}</p>
        </div>
        <div class="rounded-xl border border-border bg-card px-4 py-3">
          <p class="text-caption text-muted-foreground">当前模式</p>
          <p class="mt-1 font-medium">学习与追踪</p>
        </div>
      </div>
      </template>
    </WorkspaceTopBar>

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
            <Input v-model="customForm.id" placeholder="CVE-2024-12345" />
            <Input v-model="customForm.product" placeholder="组件 / 产品，例如 nginx" />
            <Input v-model="customForm.vendor" placeholder="厂商 / 项目，例如 F5" />
            <Input v-model="customForm.affected" placeholder="受影响版本范围" />
            <Input v-model="customForm.title" class="sm:col-span-2" placeholder="漏洞标题或学习主题" />
            <Input v-model="customForm.referenceHref" class="sm:col-span-2" placeholder="公告、补丁或学习材料 URL（可选）" />
            <Input v-model="customForm.learningGoal" class="sm:col-span-2" placeholder="这次想学会什么 / 要确认什么" />
            <Input v-model="customForm.summary" class="sm:col-span-2" placeholder="一句话背景（可选）" />
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
          <h2 class="mt-4 text-xl font-semibold leading-8 tracking-[-0.03em]">{{ dashboard.selected.value.title }}</h2>
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

        <section class="border-b border-border px-6 py-5">
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
                :variant="dashboard.practiceSessionFor.value?.state === 'running'
                  ? 'success'
                  : dashboard.practiceSessionFor.value?.state === 'stopped'
                    ? 'secondary'
                    : 'outline'"
              >
                {{
                  dashboard.practiceSessionFor.value?.state === 'running'
                    ? '已确认'
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
              <p class="text-caption font-medium text-muted-foreground">下一步交给 Coding Agent</p>
              <p class="mt-2 text-body leading-6">{{ dashboard.practiceSessionFor.value.nextPrompt }}</p>
              <p class="mt-2 text-caption text-muted-foreground">
                本地记录：{{ new Date(dashboard.practiceSessionFor.value.updatedAt).toLocaleString() }}
              </p>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button
                v-if="dashboard.practiceSessionFor.value?.state !== 'running'"
                size="sm"
                @click="dashboard.confirmPracticeEnvironment(dashboard.selected.value.id)"
              >
                <Play class="size-4" />
                确认本地练习
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

        <section class="border-b border-border px-6 py-5">
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
              <Input v-model="assetForm.name" placeholder="资产名称" />
              <Input v-model="assetForm.address" placeholder="地址 / 仓库 / 服务" />
              <Input v-model="assetForm.environment" placeholder="环境，例如生产 / 本地" />
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
              <p class="flex items-center gap-2 text-caption font-medium text-muted-foreground">
                <FileText class="size-4" />
                下一步交给 Coding Agent
              </p>
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
            @click="dashboard.establishResearchTask(dashboard.selected.value.id)"
          >
            <ShieldCheck
              v-if="dashboard.researchTaskFor.value"
              class="size-4"
            />
            <Workflow v-else class="size-4" />
            {{ dashboard.researchTaskFor.value ? '研究任务已建立' : '建立研究任务' }}
          </Button>
          <Button
            variant="ghost"
            block
            class="mt-2"
            @click="dashboard.advanceTask(dashboard.selected.value.id)"
          >
            推进下一步
          </Button>
          <p class="mt-3 text-center text-caption leading-5 text-muted-foreground">
            建立任务后固化情报快照、受影响资产与证据边界。
          </p>
        </section>
      </aside>
    </div>
  </main>
</template>
