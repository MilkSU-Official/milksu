<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@felinic/ui'
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Link2,
  Plus,
  Search,
} from 'lucide-vue-next'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask, type VulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'
import type { VulnerabilityIntel, VulnerabilitySeverity, VulnerabilityStatus } from '@/vulnerabilityIntel'

defineOptions({ name: 'VulnPage' })

const props = withDefaults(defineProps<{
  dashboard?: VulnerabilityDashboard
  codingWorkspacePath?: string
  navigationEpoch?: number
  conversations?: Conversation[]
}>(), {
  codingWorkspacePath: '',
  navigationEpoch: 0,
  conversations: () => [],
})

const emit = defineEmits<{
  chooseCodingWorkspace: []
  startCodingTask: [task: VulnerabilityCodingTask, recordHandoff: (workspacePath: string) => void]
  openCodingConversation: [id: string]
}>()

const dashboard = props.dashboard ?? useVulnerabilityDashboard()
const showCustomForm = ref(false)
const showLearningTopics = ref(false)
const customFormError = ref('')
const statusFilter = ref<'all' | VulnerabilityStatus>('all')
const page = ref(1)
const pageSize = 20
const customForm = ref({
  id: '',
  title: '',
  vendor: '',
  product: '',
  affected: '',
  referenceHref: '',
})

const statusOptions: Array<{ value: VulnerabilityStatus; label: string }> = [
  { value: '待复现', label: '待复现' },
  { value: '研究中', label: '研究中' },
  { value: '已验证', label: '已验证' },
  { value: '已分流', label: '已归档' },
]

const learningTopics = [
  {
    title: '命令与参数注入',
    query: 'Injection',
    detail: '从输入边界、调用链到补丁方式，横向看同类 CVE。',
  },
  {
    title: '反序列化与协议边界',
    query: 'ActiveMQ',
    detail: '对照协议、对象创建与不受信类型的共同风险。',
  },
  {
    title: '供应链与组件信任',
    query: 'Supply Chain',
    detail: '从构建、依赖和发布链理解供应链事件。',
  },
] as const

const filteredItems = computed(() => dashboard.tracked.value.filter(item => (
  statusFilter.value === 'all' || item.status === statusFilter.value
)))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / pageSize)))
const visibleItems = computed(() => filteredItems.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([() => dashboard.query.value, statusFilter], () => { page.value = 1 })
watch(pageCount, count => { if (page.value > count) page.value = count })
watch(
  () => filteredItems.value.map(item => item.id).join('|'),
  () => {
    if (!filteredItems.value.length) return
    if (!filteredItems.value.some(item => item.id === dashboard.selectedId.value)) {
      dashboard.selectedId.value = filteredItems.value[0].id
    }
  },
  { flush: 'sync' },
)
watch(() => props.navigationEpoch, () => { showLearningTopics.value = false })

function relatedConversations(cveId: string) {
  return props.conversations.filter(conversation => (
    conversation.domainTaskContext?.kind === 'cve'
    && conversation.domainTaskContext.cveId === cveId
  )).sort((left, right) => right.createdAt - left.createdAt)
}

function selectItem(id: string) {
  dashboard.selectedId.value = id
}

function startCoding(item: VulnerabilityIntel) {
  selectItem(item.id)
  const task = dashboard.codingTaskForSelected.value
  if (!task) return
  emit('startCodingTask', task, workspacePath => {
    dashboard.recordCodingHandoff(item.id, task, workspacePath)
  })
}

function setStatus(id: string, event: Event) {
  const raw = (event.target as HTMLSelectElement | null)?.value
  const status = statusOptions.find(option => option.value === raw)?.value
  if (!status) return
  dashboard.setStatus(id, status)
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

function recentResearch(item: VulnerabilityIntel) {
  const latest = relatedConversations(item.id)[0]
  if (!latest) return item.updated
  const date = new Date(latest.createdAt)
  if (Number.isNaN(date.getTime())) return item.updated
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function addCustomTrackingItem() {
  customFormError.value = ''
  try {
    dashboard.addTrackingItem({
      ...customForm.value,
      summary: '',
      learningGoal: '',
    })
    showCustomForm.value = false
    customForm.value = {
      id: '',
      title: '',
      vendor: '',
      product: '',
      affected: '',
      referenceHref: '',
    }
  } catch (cause) {
    customFormError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function openTopic(query: string) {
  dashboard.query.value = query
  statusFilter.value = 'all'
  showLearningTopics.value = false
}
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <WorkspaceModuleTopBar module="cve">
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          :aria-expanded="showLearningTopics"
          @click="showLearningTopics = !showLearningTopics"
        >
          <BookOpen class="size-4" />
          学习专题
        </Button>
        <Button variant="brand" size="sm" @click="showCustomForm = !showCustomForm">
          <Plus class="size-4" />
          添加 CVE
        </Button>
      </template>

      <template #filters>
        <div class="flex flex-wrap items-center gap-3">
          <label class="relative min-w-64 flex-1 max-w-md">
            <Search class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="dashboard.query.value"
              size="sm"
              class="pl-9"
              placeholder="搜索我添加的 CVE…"
              aria-label="搜索 CVE"
            />
          </label>
          <NativeSelect v-model="statusFilter" size="sm" class="w-40" aria-label="按我的状态筛选">
            <NativeSelectOption value="all">我的状态：全部</NativeSelectOption>
            <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </template>
    </WorkspaceModuleTopBar>

    <section v-if="showLearningTopics" class="grid shrink-0 gap-3 border-b border-border bg-card/40 px-6 py-5 md:grid-cols-3" aria-label="CVE 学习专题">
      <button
        v-for="topic in learningTopics"
        :key="topic.title"
        type="button"
        class="rounded-xl border border-border bg-background px-4 py-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
        @click="openTopic(topic.query)"
      >
        <span class="text-control font-semibold">{{ topic.title }}</span>
        <span class="mt-2 block text-caption leading-5 text-muted-foreground">{{ topic.detail }}</span>
      </button>
    </section>

    <form v-if="showCustomForm" class="shrink-0 border-b border-border bg-card/70 px-6 py-5" @submit.prevent="addCustomTrackingItem">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Input v-model="customForm.id" size="sm" aria-label="CVE 编号" placeholder="CVE-2024-12345" />
        <Input v-model="customForm.title" size="sm" aria-label="漏洞名称" placeholder="漏洞名称" />
        <Input v-model="customForm.vendor" size="sm" aria-label="厂商或项目" placeholder="厂商或项目" />
        <Input v-model="customForm.product" size="sm" aria-label="产品或组件" placeholder="产品或组件" />
        <Input v-model="customForm.affected" size="sm" aria-label="受影响版本" placeholder="受影响版本，可稍后补充" />
        <Input v-model="customForm.referenceHref" size="sm" aria-label="公开来源链接" placeholder="公开公告或来源链接，可选" />
      </div>
      <p v-if="customFormError" class="mt-3 text-caption text-destructive">{{ customFormError }}</p>
      <div class="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm">添加到列表</Button>
        <Button type="button" variant="ghost" size="sm" @click="showCustomForm = false">取消</Button>
      </div>
    </form>

    <section class="min-h-0 flex-1 overflow-auto" aria-label="CVE 列表">
      <div class="min-w-[1040px]">
        <div class="grid h-12 grid-cols-[170px_minmax(260px,1.2fr)_minmax(190px,.9fr)_100px_150px_120px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
          <span>CVE</span><span>漏洞</span><span>厂商/产品</span><span>严重性</span><span>我的状态</span><span>最近研究</span>
        </div>

        <template v-for="item in visibleItems" :key="item.id">
          <button
            type="button"
            class="grid min-h-[72px] w-full grid-cols-[170px_minmax(260px,1.2fr)_minmax(190px,.9fr)_100px_150px_120px] items-center gap-4 border-b border-border px-6 text-left hover:bg-muted/25"
            :class="item.id === dashboard.selectedId.value ? 'bg-primary/5' : ''"
            :aria-expanded="item.id === dashboard.selectedId.value"
            @click="selectItem(item.id)"
          >
            <span class="font-mono text-body" :class="item.id === dashboard.selectedId.value ? 'text-primary' : ''">{{ item.id }}</span>
            <span class="min-w-0 truncate text-control font-medium">{{ item.title }}</span>
            <span class="min-w-0">
              <span class="block truncate text-body">{{ item.vendor }}</span>
              <span class="mt-0.5 block truncate text-caption text-muted-foreground">{{ item.product }}</span>
            </span>
            <span><Badge :variant="severityVariant(item.severity)" font="mono">{{ item.cvss.toFixed(1) }}</Badge></span>
            <span><Badge :variant="statusVariant(item.status)">{{ item.status === '已分流' ? '已归档' : item.status }}</Badge></span>
            <span class="text-caption text-muted-foreground">{{ recentResearch(item) }}</span>
          </button>

          <div v-if="item.id === dashboard.selectedId.value" class="border-b border-l-2 border-l-primary border-border bg-card px-6 py-5">
            <div class="flex flex-wrap items-start justify-between gap-5">
              <div class="min-w-0 flex-1">
                <p class="max-w-4xl text-body leading-6 text-muted-foreground">{{ item.summary }}</p>
                <div class="mt-4 flex flex-wrap items-center gap-5 text-caption">
                  <span class="inline-flex items-center gap-2"><Link2 class="size-4" />来源链接 {{ item.references.length }}</span>
                  <span class="inline-flex items-center gap-2 text-info"><Code2 class="size-4" />关联对话 {{ relatedConversations(item.id).length }}</span>
                </div>
                <div v-if="item.references.length" class="mt-3 flex flex-wrap gap-2">
                  <Button
                    v-for="reference in item.references"
                    :key="reference.href"
                    as="a"
                    :href="reference.href"
                    target="_blank"
                    rel="noreferrer"
                    variant="outline"
                    size="sm"
                  >
                    {{ reference.label }}<ExternalLink class="size-3" />
                  </Button>
                </div>
              </div>
              <div class="flex shrink-0 items-end gap-3">
                <label class="min-w-40 text-caption text-muted-foreground">我的状态
                  <NativeSelect
                    :model-value="item.status"
                    size="sm"
                    class="mt-2 w-full"
                    :aria-label="`${item.id} 状态`"
                    @change="setStatus(item.id, $event)"
                  >
                    <NativeSelectOption v-for="option in statusOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
                <Button variant="brand" @click="startCoding(item)">
                  <Code2 class="size-4" />
                  交给 Coding
                  <ArrowRight class="size-4" />
                </Button>
              </div>
            </div>

            <div v-if="relatedConversations(item.id).length" class="mt-4 border border-border bg-background/40">
              <p class="border-b border-border px-4 py-3 text-caption font-medium text-muted-foreground">关联的 Coding 对话</p>
              <button
                v-for="conversation in relatedConversations(item.id)"
                :key="conversation.id"
                type="button"
                class="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/30"
                @click="emit('openCodingConversation', conversation.id)"
              >
                <Code2 class="size-4 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate text-body">{{ conversation.title }}</span>
                <span class="text-caption text-muted-foreground">{{ recentResearch(item) }}</span>
              </button>
            </div>
          </div>
        </template>

        <div v-if="!visibleItems.length" class="grid min-h-64 place-items-center px-8 text-center">
          <div>
            <p class="text-control font-medium">{{ dashboard.tracked.value.length ? '没有匹配的 CVE' : '还没有添加 CVE' }}</p>
            <p class="mt-2 text-caption text-muted-foreground">{{ dashboard.tracked.value.length ? '换个关键词或状态试试。' : '添加一个你想研究的公开 CVE。' }}</p>
          </div>
        </div>
      </div>
    </section>

    <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
      <span class="text-caption text-muted-foreground">共 {{ filteredItems.length }} 条</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1" aria-label="上一页" @click="page -= 1"><ChevronLeft class="size-4" /></Button>
        <Button variant="outline" size="icon-sm">{{ page }}</Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= pageCount" aria-label="下一页" @click="page += 1"><ChevronRight class="size-4" /></Button>
      </div>
    </footer>
  </main>
</template>
