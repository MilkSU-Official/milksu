<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
} from '@felinic/ui'
import {
  ArrowRight,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Play,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-vue-next'
import CTFCollaborationModePicker from '@/components-vue/CTFCollaborationModePicker.vue'
import type { CTFCollaborationMode, CTFMaterialRequest } from '@/ctfTypes'
import type { CTFShowCatalogProblem } from '@/ctfshowTypes'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type {
  NSSCTFCatalogProblem,
  NSSCTFTrainingDashboard,
} from '@/nssctfTrainingTypes'

const props = withDefaults(defineProps<{
  activeBank: 'nssctf' | 'ctfshow'
  nssctfProblems: NSSCTFCatalogProblem[]
  ctfshowProblems: CTFShowCatalogProblem[]
  selectedNssctf: NSSCTFChallenge | null
  selectedCtfshow: CTFShowCatalogProblem | null
  dashboard: NSSCTFTrainingDashboard | null
  nssctfAttemptedIds: number[]
  nssctfCompletedIds: number[]
  ctfshowAttemptedIds: number[]
  ctfshowCompletedIds: number[]
  page: number
  pageCount: number
  total: number
  loading: boolean
  collaborationMode: CTFCollaborationMode
  selectedBrowserReady: boolean
  ctfshowBridgeReady: boolean
  attachmentError: string
  localMaterials: CTFMaterialRequest[]
  catalogError: string
  modelVerified: boolean
  catalogReady: boolean
  judgeReady: boolean
  hasActiveTraining: boolean
  browserExtensionReady: boolean
  pairingCode: string
  browserSetupBusy: boolean
}>(), {
  nssctfProblems: () => [],
  ctfshowProblems: () => [],
  selectedNssctf: null,
  selectedCtfshow: null,
  dashboard: null,
  nssctfAttemptedIds: () => [],
  nssctfCompletedIds: () => [],
  ctfshowAttemptedIds: () => [],
  ctfshowCompletedIds: () => [],
  attachmentError: '',
  localMaterials: () => [],
  catalogError: '',
})

const emit = defineEmits<{
  selectNssctf: [id: number]
  selectCtfshow: [id: number]
  previousPage: []
  nextPage: []
  goPage: [page: number]
  startNssctf: []
  chooseLocalMaterials: []
  startCtfshow: [id: number]
  openProblem: []
  openCtfshow: []
  refreshJudge: []
  prepareBrowserExtension: []
  copyPairingCode: []
  openSettings: []
  'update:collaborationMode': [value: CTFCollaborationMode]
}>()

const selectedRecommendation = computed(() => (
  props.dashboard?.recommendations.find(
    recommendation => recommendation.problem.platformId === props.selectedNssctf?.platformId,
  ) ?? null
))
const selectedRecommendationReason = computed(() => {
  const recommendation = selectedRecommendation.value
  const actualCategory = props.selectedNssctf?.category
  if (!recommendation || !actualCategory) return recommendation?.reason ?? ''
  return recommendation.reason.replace(
    recommendation.problem.category,
    actualCategory,
  )
})

const readiness = computed(() => (
  Number(props.modelVerified) + Number(props.catalogReady) + Number(props.judgeReady)
))
const detailPane = ref<HTMLElement | null>(null)
const selectedNssctfCatalogProblem = computed<NSSCTFCatalogProblem | null>(() => {
  const problem = props.selectedNssctf
  if (!problem) return null
  return {
    platformId: problem.platformId,
    sourceUrl: problem.sourceUrl,
    title: problem.title,
    category: problem.category,
    points: problem.points,
    difficulty: problem.difficulty,
    tags: problem.tags,
    hasWriteup: problem.writeupCount > 0,
    solvedCount: problem.solvedCount,
    wrongAnswerCount: problem.wrongAnswerCount,
    noAnswerCount: 0,
    open: true,
    syncedAt: problem.importedAt,
  }
})
const displayedNssctfProblems = computed(() => {
  const selected = selectedNssctfCatalogProblem.value
  if (!selected || props.nssctfProblems.some(problem => problem.platformId === selected.platformId)) {
    return props.nssctfProblems
  }
  return [selected, ...props.nssctfProblems]
})

const visiblePages = computed(() => {
  if (props.pageCount <= 5) {
    return Array.from({ length: props.pageCount }, (_, index) => index + 1)
  }
  const first = Math.min(
    Math.max(props.page - 2, 1),
    props.pageCount - 4,
  )
  return Array.from({ length: 5 }, (_, index) => first + index)
})

watch(
  () => props.activeBank === 'nssctf'
    ? props.selectedNssctf?.platformId
    : props.selectedCtfshow?.platformId,
  async selectedID => {
    if (!selectedID || !window.matchMedia('(max-width: 1120px)').matches) return
    await nextTick()
    detailPane.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
)

function nssctfStatus(id: number) {
  if (props.nssctfCompletedIds.includes(id)) return 'completed'
  if (props.nssctfAttemptedIds.includes(id)) return 'attempted'
  return 'new'
}

function ctfshowStatus(id: number) {
  if (props.ctfshowCompletedIds.includes(id)) return 'completed'
  if (props.ctfshowAttemptedIds.includes(id)) return 'attempted'
  return 'new'
}

function statusLabel(status: string) {
  if (status === 'completed') return '已完成'
  if (status === 'attempted') return '进行中'
  return '未开始'
}

function difficultyLabel(difficulty: number) {
  return difficulty > 0 ? difficulty.toFixed(1) : '待定'
}

function difficultyClass(difficulty: number) {
  if (difficulty <= 1.5) return 'bg-success-soft text-success'
  if (difficulty <= 2.8) return 'bg-info-soft text-info'
  return 'bg-warning-soft text-warning'
}

function estimateMinutes(difficulty: number) {
  if (!difficulty) return '15–30 分钟'
  const lower = Math.max(10, Math.round(difficulty * 8 / 5) * 5)
  return `${lower}–${lower + 15} 分钟`
}

function isSelected(id: number) {
  return props.activeBank === 'nssctf'
    ? props.selectedNssctf?.platformId === id
    : props.selectedCtfshow?.platformId === id
}

function nssctfCategory(problem: NSSCTFCatalogProblem) {
  return props.selectedNssctf?.platformId === problem.platformId
    ? props.selectedNssctf.category
    : problem.category
}

function pinnedNssctfLabel(id: number) {
  if (props.nssctfProblems.some(problem => problem.platformId === id)) return ''
  return props.dashboard?.recommendations[0]?.problem.platformId === id ? '推荐' : '当前'
}
</script>

<template>
  <section class="challenge-desk h-full min-h-0" aria-label="CTF 选题与解题桌面">
    <div class="challenge-list min-h-0 border-r border-border bg-background">
      <div
        class="grid h-12 grid-cols-[72px_minmax(0,1fr)_92px_74px_78px] items-center gap-3 border-b border-border px-5 text-caption text-muted-foreground"
        aria-hidden="true"
      >
        <span>题号</span>
        <span>题名</span>
        <span>类型</span>
        <span>难度</span>
        <span>状态</span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-if="activeBank === 'nssctf'">
          <button
            v-for="problem in displayedNssctfProblems"
            :key="problem.platformId"
            type="button"
            class="group grid min-h-[72px] w-full grid-cols-[72px_minmax(0,1fr)_92px_74px_78px] items-center gap-3 border-b border-l-2 border-border px-[18px] text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
            :class="isSelected(problem.platformId)
              ? 'border-l-brand bg-brand-soft/70'
              : 'border-l-transparent bg-background'"
            :aria-pressed="isSelected(problem.platformId)"
            @click="emit('selectNssctf', problem.platformId)"
          >
            <span class="flex items-center gap-2 font-mono text-caption text-muted-foreground">
              <span
                v-if="isSelected(problem.platformId)"
                class="size-1.5 rounded-full bg-brand"
                aria-hidden="true"
              />
              P{{ problem.platformId }}
            </span>
            <span class="min-w-0">
              <span class="flex min-w-0 items-center gap-2">
                <span class="block truncate text-control font-medium">{{ problem.title }}</span>
                <span
                  v-if="pinnedNssctfLabel(problem.platformId)"
                  class="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand"
                >
                  {{ pinnedNssctfLabel(problem.platformId) }}
                </span>
              </span>
              <span v-if="problem.tags.length" class="mt-1 block truncate text-caption text-muted-foreground">
                {{ problem.tags.slice(0, 3).join(' · ') }}
              </span>
            </span>
            <span class="truncate text-caption">{{ nssctfCategory(problem) }}</span>
            <span>
              <span
                class="inline-flex min-w-9 justify-center rounded-md px-2 py-1 font-mono text-caption font-medium"
                :class="difficultyClass(problem.difficulty)"
              >
                {{ difficultyLabel(problem.difficulty) }}
              </span>
            </span>
            <span
              class="text-caption"
              :class="nssctfStatus(problem.platformId) === 'attempted'
                ? 'font-medium text-brand'
                : nssctfStatus(problem.platformId) === 'completed'
                  ? 'text-success'
                  : 'text-muted-foreground'"
            >
              {{ statusLabel(nssctfStatus(problem.platformId)) }}
            </span>
          </button>
        </template>

        <template v-else>
          <button
            v-for="problem in ctfshowProblems"
            :key="problem.platformId"
            type="button"
            class="group grid min-h-[72px] w-full grid-cols-[72px_minmax(0,1fr)_92px_74px_78px] items-center gap-3 border-b border-l-2 border-border px-[18px] text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
            :class="isSelected(problem.platformId)
              ? 'border-l-brand bg-brand-soft/70'
              : 'border-l-transparent bg-background'"
            :aria-pressed="isSelected(problem.platformId)"
            @click="emit('selectCtfshow', problem.platformId)"
          >
            <span class="flex items-center gap-2 font-mono text-caption text-muted-foreground">
              <span
                v-if="isSelected(problem.platformId)"
                class="size-1.5 rounded-full bg-brand"
                aria-hidden="true"
              />
              #{{ problem.platformId }}
            </span>
            <span class="min-w-0">
              <span class="block truncate text-control font-medium">{{ problem.title }}</span>
              <span v-if="problem.tags.length" class="mt-1 block truncate text-caption text-muted-foreground">
                {{ problem.tags.slice(0, 3).join(' · ') }}
              </span>
            </span>
            <span class="truncate text-caption">{{ problem.category }}</span>
            <span>
              <span class="inline-flex min-w-9 justify-center rounded-md bg-muted px-2 py-1 font-mono text-caption">
                {{ problem.points }}
              </span>
            </span>
            <span
              class="text-caption"
              :class="ctfshowStatus(problem.platformId) === 'attempted'
                ? 'font-medium text-brand'
                : ctfshowStatus(problem.platformId) === 'completed'
                  ? 'text-success'
                  : 'text-muted-foreground'"
            >
              {{ statusLabel(ctfshowStatus(problem.platformId)) }}
            </span>
          </button>
        </template>

        <div v-if="loading" class="grid min-h-40 place-items-center">
          <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
        </div>
        <div
          v-else-if="!(activeBank === 'nssctf' ? displayedNssctfProblems.length : ctfshowProblems.length)"
          class="grid min-h-56 place-items-center px-8 text-center"
        >
          <div>
            <p class="text-control font-medium">
              {{
                catalogError
                  ? '题库暂时不可用'
                  : activeBank === 'ctfshow'
                    ? '连接 CTFshow 题库'
                    : '没有匹配题目'
              }}
            </p>
            <p class="mt-1 text-caption text-muted-foreground">
              {{
                catalogError
                  || (activeBank === 'ctfshow'
                    ? '在已登录页面点击 MilkSU 扩展，然后回来刷新。'
                    : '换个题号、题名或分类试试。')
              }}
            </p>
            <Button
              v-if="activeBank === 'ctfshow' && !catalogError"
              variant="outline"
              size="sm"
              class="mt-4"
              @click="emit('openCtfshow')"
            >
              <ExternalLink class="size-4" />
              打开 CTFshow
            </Button>
          </div>
        </div>
      </div>

      <footer class="flex h-16 shrink-0 items-center justify-between border-t border-border px-5">
        <span class="text-caption text-muted-foreground">
          {{ total.toLocaleString() }} 题
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="page <= 1 || loading"
            aria-label="上一页"
            @click="emit('previousPage')"
          >
            <ChevronLeft class="size-4" />
          </Button>
          <Button
            v-for="pageNumber in visiblePages"
            :key="pageNumber"
            :variant="pageNumber === page ? 'default' : 'ghost'"
            size="icon-sm"
            :aria-label="`第 ${pageNumber} 页`"
            :aria-current="pageNumber === page ? 'page' : undefined"
            :disabled="loading"
            @click="emit('goPage', pageNumber)"
          >
            {{ pageNumber }}
          </Button>
          <span v-if="pageCount > 5" class="px-1 font-mono text-caption text-muted-foreground">
            / {{ pageCount }}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="page >= pageCount || loading"
            aria-label="下一页"
            @click="emit('nextPage')"
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>
      </footer>
    </div>

    <aside ref="detailPane" class="challenge-detail min-h-0 overflow-y-auto bg-card" aria-live="polite">
      <template v-if="selectedNssctf && activeBank === 'nssctf'">
        <div class="p-7 lg:p-9">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="font-mono text-caption text-muted-foreground">NSSCTF · P{{ selectedNssctf.platformId }}</p>
              <h2 class="mt-3 text-2xl font-semibold tracking-[-0.035em]">{{ selectedNssctf.title }}</h2>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="在 NSSCTF 打开" @click="emit('openProblem')">
              <ExternalLink class="size-4" />
            </Button>
          </div>

          <div class="mt-5 flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{{ selectedNssctf.category }}</Badge>
            <span
              class="rounded-md px-2 py-1 font-mono text-caption font-medium"
              :class="difficultyClass(selectedNssctf.difficulty)"
            >
              难度 {{ difficultyLabel(selectedNssctf.difficulty) }}
            </span>
            <span class="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Clock3 class="size-3.5" />
              预计 {{ estimateMinutes(selectedNssctf.difficulty) }}
            </span>
          </div>

          <section class="mt-7 border-t border-border pt-6">
            <h3 class="text-label font-medium">题目描述</h3>
            <p class="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-body leading-7 text-foreground/75">
              {{ selectedNssctf.statement }}
            </p>
          </section>

          <section class="mt-6 border-t border-border pt-6">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="text-label font-medium">我的进度</h3>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{ selectedNssctf.solvedCount.toLocaleString() }} 人解出
                  · {{ statusLabel(nssctfStatus(selectedNssctf.platformId)) }}
                </p>
              </div>
              <CTFCollaborationModePicker
                :model-value="collaborationMode"
                @update:model-value="emit('update:collaborationMode', $event as CTFCollaborationMode)"
              />
            </div>

            <div v-if="selectedRecommendation" class="mt-5 rounded-lg bg-muted/40 px-4 py-3">
              <p class="text-caption font-medium">{{ selectedRecommendation.kind }} · 推荐思路</p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ selectedRecommendationReason }}</p>
            </div>

            <div
              v-if="!judgeReady"
              class="mt-5 rounded-lg border border-warning-border bg-warning-soft px-4 py-4"
            >
              <div class="flex items-start gap-3">
                <Cable class="mt-0.5 size-4 shrink-0 text-warning" />
                <div class="min-w-0">
                  <p class="text-control font-medium">连接 NSSCTF Judge</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">
                    第一次使用：安装扩展，复制下方配对码，再到当前题目页点击 MilkSU 扩展并粘贴。
                  </p>
                </div>
              </div>
              <div
                v-if="pairingCode"
                class="mt-3 flex items-center gap-2 rounded-md border border-warning-border bg-background/80 px-3 py-2 text-caption text-muted-foreground"
              >
                <ShieldCheck class="size-3.5 shrink-0 text-success" />
                配对码已生成。为避免泄露，本页不显示明文；点击下方按钮复制。
              </div>
              <div class="mt-3 grid gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  size="sm"
                  :loading="browserSetupBusy"
                  :disabled="!browserExtensionReady"
                  @click="emit('prepareBrowserExtension')"
                >
                  <FolderOpen class="size-4" />
                  安装本地扩展
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  :disabled="!pairingCode"
                  @click="emit('copyPairingCode')"
                >
                  <Copy class="size-4" />
                  复制配对码
                </Button>
                <Button variant="outline" size="sm" @click="emit('openProblem')">
                  <ExternalLink class="size-4" />
                  打开 P{{ selectedNssctf.platformId }}
                </Button>
              </div>
            </div>

            <div class="mt-4 flex min-w-0 flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                title="从电脑选择文件，只复制到这道题的 MilkSU 本地工作区"
                @click="emit('chooseLocalMaterials')"
              >
                <Paperclip class="size-4" />
                添加本地材料
              </Button>
              <span
                v-if="localMaterials.length"
                class="min-w-0 truncate text-caption text-muted-foreground"
                :title="localMaterials.map(material => material.name).join(' · ')"
              >
                已添加 {{ localMaterials.length }} 项 ·
                {{ localMaterials.map(material => material.name).join(' · ') }}
              </span>
              <span v-else class="text-caption text-muted-foreground">
                仅保存到本题工作区，不会上传平台
              </span>
            </div>

            <div
              v-if="selectedNssctf.hasAttachment && !selectedBrowserReady && !localMaterials.length"
              class="mt-5 flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
            >
              <Cable class="mt-0.5 size-4 shrink-0 text-warning" />
              <div class="min-w-0 flex-1">
                <p class="text-control font-medium">先连接当前题目页</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  此题有附件。打开 P{{ selectedNssctf.platformId }} 后，用 MilkSU Chrome 扩展连接当前页。
                </p>
              </div>
              <Button variant="outline" size="sm" @click="emit('openProblem')">打开题目</Button>
            </div>

            <Alert v-if="attachmentError" variant="destructive" class="mt-4">
              <AlertDescription>{{ attachmentError }}</AlertDescription>
            </Alert>

            <Button
              block
              size="lg"
              class="mt-5"
              :loading="loading"
              :disabled="!hasActiveTraining && selectedNssctf.hasAttachment && !selectedBrowserReady && !localMaterials.length"
              @click="modelVerified ? emit('startNssctf') : emit('openSettings')"
            >
              <TerminalSquare class="size-4" />
              {{
                !modelVerified
                  ? '配置模型后开始'
                  : hasActiveTraining
                    ? '继续训练'
                    : '用 Agent 开始'
              }}
              <ArrowRight class="size-4" />
            </Button>
          </section>

        </div>
      </template>

      <template v-else-if="selectedCtfshow && activeBank === 'ctfshow'">
        <div class="p-7 lg:p-9">
          <p class="font-mono text-caption text-muted-foreground">CTFshow · #{{ selectedCtfshow.platformId }}</p>
          <h2 class="mt-3 text-2xl font-semibold tracking-[-0.035em]">{{ selectedCtfshow.title }}</h2>
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{{ selectedCtfshow.category }}</Badge>
            <span class="rounded-md bg-muted px-2 py-1 font-mono text-caption">
              {{ selectedCtfshow.points }} 分
            </span>
            <span class="text-caption text-muted-foreground">
              {{ selectedCtfshow.solvedCount.toLocaleString() }} 人解出
            </span>
          </div>

          <section class="mt-7 border-t border-border pt-6">
            <h3 class="text-label font-medium">读取题面</h3>
            <p class="mt-2 text-body leading-7 text-muted-foreground">
              MilkSU 会从已连接的 CTFshow 标签页读取题面和附件，并建立与 NSSCTF 相同的 PI 工作区、Judge 和复盘证据链。
            </p>
          </section>

          <section class="mt-6 border-t border-border pt-6">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h3 class="text-label font-medium">我的进度</h3>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{ statusLabel(ctfshowStatus(selectedCtfshow.platformId)) }}
                </p>
              </div>
              <CTFCollaborationModePicker
                :model-value="collaborationMode"
                @update:model-value="emit('update:collaborationMode', $event as CTFCollaborationMode)"
              />
            </div>

            <div
              v-if="!ctfshowBridgeReady"
              class="mt-5 flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
            >
              <Cable class="mt-0.5 size-4 shrink-0 text-warning" />
              <div class="min-w-0 flex-1">
                <p class="text-control font-medium">连接 CTFshow 标签页</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  先在已登录页面运行 MilkSU 扩展，再读取这道题。
                </p>
              </div>
              <Button variant="outline" size="sm" @click="emit('openCtfshow')">
                <ExternalLink class="size-4" />
                打开
              </Button>
            </div>

            <div class="mt-4 flex min-w-0 flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                title="从电脑选择文件，只复制到这道题的 MilkSU 本地工作区"
                @click="emit('chooseLocalMaterials')"
              >
                <Paperclip class="size-4" />
                添加本地材料
              </Button>
              <span
                v-if="localMaterials.length"
                class="min-w-0 truncate text-caption text-muted-foreground"
                :title="localMaterials.map(material => material.name).join(' · ')"
              >
                已添加 {{ localMaterials.length }} 项 ·
                {{ localMaterials.map(material => material.name).join(' · ') }}
              </span>
              <span v-else class="text-caption text-muted-foreground">
                仅保存到本题工作区，不会上传平台
              </span>
            </div>

            <Button
              block
              size="lg"
              class="mt-5"
              :loading="loading"
              :disabled="!hasActiveTraining && !ctfshowBridgeReady"
              @click="modelVerified
                ? emit('startCtfshow', selectedCtfshow.platformId)
                : emit('openSettings')"
            >
              <TerminalSquare class="size-4" />
              {{
                !modelVerified
                  ? '配置模型后开始'
                  : hasActiveTraining
                    ? '继续训练'
                    : '读取题面并开始'
              }}
              <ArrowRight class="size-4" />
            </Button>
          </section>

        </div>
      </template>

      <div v-else class="grid min-h-full place-items-center p-8 text-center">
        <div class="max-w-xs">
          <Play class="mx-auto size-6 text-muted-foreground" />
          <h2 class="mt-4 text-label font-medium">选择一道题</h2>
          <p class="mt-2 text-caption leading-5 text-muted-foreground">
            题面、训练方式和 Agent 入口会出现在这里。
          </p>
        </div>
      </div>

      <div class="sticky bottom-0 flex items-center gap-4 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
        <span class="text-caption font-medium">准备状态 {{ readiness }}/3</span>
        <span class="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Check v-if="modelVerified" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          模型
        </span>
        <span class="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Check v-if="catalogReady" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          题库
        </span>
        <span class="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Check v-if="judgeReady" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          Judge
        </span>
        <Button
          v-if="!modelVerified"
          variant="link"
          size="text"
          class="ml-auto"
          @click="emit('openSettings')"
        >
          配置模型
        </Button>
        <Button
          v-else-if="!judgeReady"
          variant="link"
          size="text"
          class="ml-auto"
          @click="emit('refreshJudge')"
        >
          检测连接
        </Button>
        <ShieldCheck v-else class="ml-auto size-4 text-success" />
      </div>
    </aside>
  </section>
</template>

<style scoped>
.challenge-desk {
  display: grid;
  grid-template-columns: minmax(470px, 0.98fr) minmax(410px, 1.02fr);
}

.challenge-list {
  display: flex;
  flex-direction: column;
}

.challenge-detail {
  position: relative;
}

@media (max-width: 1120px) {
  .challenge-desk {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .challenge-list {
    min-height: 560px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .challenge-detail {
    min-height: 620px;
    overflow: visible;
  }
}
</style>
