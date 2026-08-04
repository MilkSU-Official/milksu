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
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import WorkspaceDetailTitle from '@/components-vue/WorkspaceDetailTitle.vue'
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
  syncNssctf: []
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
const acceptance = computed(() => props.dashboard?.acceptance ?? null)
const missingAcceptanceTracks = computed(() => (
  acceptance.value?.tracks.filter(track => track.status !== 'judge-verified') ?? []
))
const acceptanceSummary = computed(() => {
  const current = acceptance.value
  if (!current) return '同步题库后显示六赛道真实验收状态。'
  if (current.ready) return '六个赛道都有 Judge-verified 证据，可进入固定回归复核。'
  const missing = missingAcceptanceTracks.value.map(track => track.label).join('、')
  return `${current.judgeVerifiedTracks}/${current.requiredTracks} 个赛道已有 Judge-verified 证据；仍缺 ${missing || '待确认赛道'}。`
})
const nssctfNeedsMaterial = computed(() => Boolean(
  props.selectedNssctf?.hasAttachment
  && !props.selectedBrowserReady
  && !props.localMaterials.length,
))
const primaryActionType = computed<'settings' | 'open' | 'start'>(() => {
  if (!props.modelVerified) return 'settings'
  if (props.hasActiveTraining) return 'start'
  if (props.activeBank === 'nssctf' && nssctfNeedsMaterial.value) return 'open'
  if (props.activeBank === 'ctfshow' && !props.ctfshowBridgeReady) return 'open'
  return 'start'
})
const primaryActionLabel = computed(() => {
  if (primaryActionType.value === 'settings') return '配置模型'
  if (props.hasActiveTraining) return '继续训练'
  if (primaryActionType.value === 'open') {
    return props.activeBank === 'nssctf' ? '打开题目并连接' : '连接 CTFshow'
  }
  return props.activeBank === 'nssctf' ? '用 Agent 开始' : '读取题面并开始'
})
const primaryActionDisabled = computed(() => (
  props.activeBank === 'nssctf'
    ? !props.selectedNssctf
    : !props.selectedCtfshow
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

function acceptanceStatusText(status: string) {
  switch (status) {
    case 'judge-verified':
      return 'Judge 已验证'
    case 'user-confirmed':
      return '用户确认'
    case 'attempted':
      return '已尝试'
    default:
      return '缺证据'
  }
}

function acceptanceStatusVariant(status: string) {
  if (status === 'judge-verified') return 'success'
  if (status === 'user-confirmed') return 'secondary'
  return 'outline'
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

function runPrimaryAction() {
  if (primaryActionType.value === 'settings') {
    emit('openSettings')
    return
  }
  if (primaryActionType.value === 'open') {
    if (props.activeBank === 'nssctf') emit('openProblem')
    else emit('openCtfshow')
    return
  }
  if (props.activeBank === 'nssctf') {
    emit('startNssctf')
    return
  }
  if (props.selectedCtfshow) emit('startCtfshow', props.selectedCtfshow.platformId)
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
                  ? activeBank === 'nssctf' && !catalogReady
                    ? '题库同步失败'
                    : '题库暂时不可用'
                  : activeBank === 'ctfshow'
                    ? '连接 CTFshow 题库'
                    : catalogReady
                      ? '没有匹配题目'
                      : '准备 NSSCTF 题库'
              }}
            </p>
            <p class="mt-1 text-caption text-muted-foreground">
              {{
                catalogError
                  || (activeBank === 'ctfshow'
                    ? '在已登录页面点击 MilkSU 扩展，然后回来刷新。'
                    : catalogReady
                      ? '换个题号、题名或分类试试。'
                      : '首次使用会把公开题目目录同步到本机 SQLite。')
              }}
            </p>
            <Button
              v-if="activeBank === 'nssctf' && !catalogReady"
              variant="brand"
              size="sm"
              class="mt-4"
              @click="emit('syncNssctf')"
            >
              <RefreshCw class="size-4" />
              {{ catalogError ? '重试同步' : '同步 NSSCTF 题库' }}
            </Button>
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
      <details
        v-if="activeBank === 'nssctf' && acceptance"
        class="border-b border-border bg-background/55 px-5 py-3"
        aria-label="CTF 六赛道真实验收"
      >
        <summary class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div class="min-w-0 flex items-center gap-2">
            <p class="text-control font-medium">六赛道真实验收</p>
            <Badge variant="outline">
              {{ acceptance.ready ? 'Ready' : '通用能力 smoke' }}
            </Badge>
          </div>
          <Badge :variant="acceptance.ready ? 'success' : 'outline'" class="shrink-0">
            {{ acceptance.judgeVerifiedTracks }}/{{ acceptance.requiredTracks }} Judge
          </Badge>
          <span class="basis-full text-caption text-muted-foreground">
            展开查看缺失赛道；默认解题界面只保留题面、Agent/实验和当前授权/提交。
          </span>
        </summary>
        <div class="mt-3 border-t border-border pt-3">
          <p class="text-control font-medium">
            {{ acceptance.ready ? 'Ready，可回归复核' : '仍是通用能力 smoke' }}
          </p>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            {{ acceptanceSummary }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Badge
              v-for="track in acceptance.tracks"
              :key="track.key"
              :variant="acceptanceStatusVariant(track.status)"
              class="gap-1"
            >
              <span>{{ track.label }}</span>
              <span class="text-muted-foreground">{{ acceptanceStatusText(track.status) }}</span>
            </Badge>
          </div>
          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            一题成功只算赛道 smoke，不能描述为完整 CTF 成绩；后续补缺失赛道的真实题目、材料、轨迹、Judge 回执、恢复和复盘证据。
          </p>
        </div>
      </details>

      <template v-if="selectedNssctf && activeBank === 'nssctf'">
        <div class="p-7 lg:p-9">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="font-mono text-caption text-muted-foreground">NSSCTF · P{{ selectedNssctf.platformId }}</p>
              <WorkspaceDetailTitle :title="selectedNssctf.title" />
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
            <MarkdownContent
              class="mt-3 max-h-48 overflow-y-auto text-body leading-7 text-foreground/75"
              :content="selectedNssctf.statement"
            />
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
                    首次连接按顺序完成；以后只需在题目页点击 MilkSU。
                  </p>
                </div>
              </div>
              <ol class="mt-3 grid gap-2 sm:grid-cols-3" aria-label="连接 NSSCTF Judge 的步骤">
                <li class="rounded-md border border-warning-border bg-background/80 p-2">
                  <span class="mb-2 block font-mono text-caption text-muted-foreground">1 · 安装</span>
                  <Button
                    block
                    variant="outline"
                    size="sm"
                    :loading="browserSetupBusy"
                    :disabled="!browserExtensionReady"
                    @click="emit('prepareBrowserExtension')"
                  >
                    <FolderOpen class="size-4" />
                    本地扩展
                  </Button>
                </li>
                <li class="rounded-md border border-warning-border bg-background/80 p-2">
                  <span class="mb-2 block font-mono text-caption text-muted-foreground">2 · 配对</span>
                  <Button
                    block
                    variant="default"
                    size="sm"
                    :disabled="!pairingCode"
                    @click="emit('copyPairingCode')"
                  >
                    <Copy class="size-4" />
                    复制配对码
                  </Button>
                </li>
                <li class="rounded-md border border-warning-border bg-background/80 p-2">
                  <span class="mb-2 block font-mono text-caption text-muted-foreground">3 · 连接</span>
                  <Button block variant="outline" size="sm" @click="emit('openProblem')">
                    <ExternalLink class="size-4" />
                    打开 P{{ selectedNssctf.platformId }}
                  </Button>
                </li>
              </ol>
              <p
                v-if="selectedNssctf.hasAttachment"
                class="mt-3 flex items-center gap-2 text-caption text-muted-foreground"
              >
                <ShieldCheck class="size-3.5 shrink-0 text-success" />
                连接后自动校验并导入本题附件。
              </p>
            </div>

            <details
              v-if="selectedNssctf.hasAttachment || localMaterials.length"
              class="mt-4 rounded-lg border border-border bg-muted/20"
              :open="localMaterials.length > 0"
            >
              <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-caption font-medium [&::-webkit-details-marker]:hidden">
                <Paperclip class="size-3.5 text-muted-foreground" />
                使用本地附件
                <span class="ml-auto font-normal text-muted-foreground">
                  {{ localMaterials.length ? `${localMaterials.length} 项` : '备用方式' }}
                </span>
              </summary>
              <div class="flex min-w-0 flex-wrap items-center gap-3 border-t border-border px-3 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  title="从电脑选择文件，只复制到这道题的 MilkSU 本地工作区"
                  @click="emit('chooseLocalMaterials')"
                >
                  <Paperclip class="size-4" />
                  选择附件
                </Button>
                <span
                  v-if="localMaterials.length"
                  class="min-w-0 flex-1 truncate text-caption text-muted-foreground"
                  :title="localMaterials.map(material => material.name).join(' · ')"
                >
                  {{ localMaterials.map(material => material.name).join(' · ') }}
                </span>
                <span v-else class="text-caption text-muted-foreground">
                  只复制到本题工作区，不会上传平台。
                </span>
              </div>
            </details>

            <Alert v-if="attachmentError" variant="destructive" class="mt-4">
              <AlertDescription>{{ attachmentError }}</AlertDescription>
            </Alert>
          </section>

        </div>
      </template>

      <template v-else-if="selectedCtfshow && activeBank === 'ctfshow'">
        <div class="p-7 lg:p-9">
          <p class="font-mono text-caption text-muted-foreground">CTFshow · #{{ selectedCtfshow.platformId }}</p>
          <WorkspaceDetailTitle :title="selectedCtfshow.title" />
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

            <details
              v-if="localMaterials.length"
              class="mt-4 rounded-lg border border-border bg-muted/20"
              open
            >
              <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-caption font-medium [&::-webkit-details-marker]:hidden">
                <Paperclip class="size-3.5 text-muted-foreground" />
                本地附件
                <span class="ml-auto font-normal text-muted-foreground">{{ localMaterials.length }} 项</span>
              </summary>
              <div class="flex min-w-0 flex-wrap items-center gap-3 border-t border-border px-3 py-3">
                <Button variant="outline" size="sm" @click="emit('chooseLocalMaterials')">
                  <Paperclip class="size-4" />
                  继续添加
                </Button>
                <span
                  class="min-w-0 flex-1 truncate text-caption text-muted-foreground"
                  :title="localMaterials.map(material => material.name).join(' · ')"
                >
                  {{ localMaterials.map(material => material.name).join(' · ') }}
                </span>
              </div>
            </details>
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

      <div class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <span class="text-caption font-medium">准备 {{ readiness }}/3</span>
        <span class="flex items-center gap-1 text-caption text-muted-foreground">
          <Check v-if="modelVerified" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          模型
        </span>
        <span class="flex items-center gap-1 text-caption text-muted-foreground">
          <Check v-if="catalogReady" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          题库
        </span>
        <span class="flex items-center gap-1 text-caption text-muted-foreground">
          <Check v-if="judgeReady" class="size-3.5 text-success" />
          <RefreshCw v-else class="size-3.5" />
          Judge
        </span>
        <div class="ml-auto flex items-center gap-2">
          <Button
            v-if="activeBank === 'nssctf' && !judgeReady && pairingCode"
            variant="outline"
            size="sm"
            @click="emit('copyPairingCode')"
          >
            <Copy class="size-4" />
            配对码
          </Button>
          <Button
            variant="brand"
            size="sm"
            :loading="loading && primaryActionType === 'start'"
            :disabled="primaryActionDisabled"
            @click="runPrimaryAction"
          >
            <TerminalSquare v-if="primaryActionType === 'start'" class="size-4" />
            <ExternalLink v-else-if="primaryActionType === 'open'" class="size-4" />
            <ShieldCheck v-else class="size-4" />
            {{ primaryActionLabel }}
            <ArrowRight class="size-4" />
          </Button>
        </div>
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
