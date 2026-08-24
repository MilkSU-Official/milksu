<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next'
import CollectionPicker from '@/components-vue/CollectionPicker.vue'
import { ctfManualStatusLabel, type CTFManualStatus } from '@/lib/ctfManualStatus'
import { t } from '@/lib/uiLocale'
import type { CTFCollaborationMode, CTFMaterialRequest } from '@/ctfTypes'
import type { CTFShowCatalogProblem } from '@/ctfshowTypes'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type { NSSCTFCatalogProblem, NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'
import type { ItemCollectionStore } from '@/lib/itemCollections'

const props = withDefaults(defineProps<{
  activeBank: 'nssctf' | 'ctfshow'
  nssctfProblems: NSSCTFCatalogProblem[]
  ctfshowProblems: CTFShowCatalogProblem[]
  selectedNssctf: NSSCTFChallenge | null
  dailyProblem?: NSSCTFCatalogProblem | null
  dailyReason?: string
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
  loadingTitle?: string
  loadingDetail?: string
  emptyTitle?: string
  emptyDetail?: string
  actionLoading: boolean
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
  manualStatuses?: Record<string, CTFManualStatus>
  conversations?: Conversation[]
  relatedJobId?: string
  collectionStore: ItemCollectionStore
}>(), {
  nssctfProblems: () => [],
  ctfshowProblems: () => [],
  selectedNssctf: null,
  dailyProblem: null,
  dailyReason: '',
  selectedCtfshow: null,
  dashboard: null,
  nssctfAttemptedIds: () => [],
  nssctfCompletedIds: () => [],
  ctfshowAttemptedIds: () => [],
  ctfshowCompletedIds: () => [],
  localMaterials: () => [],
  catalogError: '',
  attachmentError: '',
  loadingTitle: t('正在加载题库', 'Loading catalog'),
  loadingDetail: '',
  emptyTitle: t('没有匹配题目', 'No matching challenges'),
  emptyDetail: '',
  manualStatuses: () => ({}),
  conversations: () => [],
  relatedJobId: '',
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
  clearSelection: []
  openProblem: []
  openCtfshow: []
  syncNssctf: []
  refreshJudge: []
  openSettings: []
  openBrowserSettings: []
  openConversation: [id: string]
  updateManualStatus: [key: string, status: CTFManualStatus]
  changeDaily: []
  'update:collaborationMode': [value: CTFCollaborationMode]
}>()

const displayedNssctfProblems = computed(() => {
  const problems: NSSCTFCatalogProblem[] = []
  if (props.dailyProblem) problems.push(props.dailyProblem)
  problems.push(...props.nssctfProblems)
  return [...new Map(problems.map(problem => [problem.platformId, problem])).values()]
})
const dailyProblemID = computed(() => props.dailyProblem?.platformId)
const visiblePages = computed(() => {
  if (props.pageCount <= 5) return Array.from({ length: props.pageCount }, (_, index) => index + 1)
  const first = Math.min(Math.max(props.page - 2, 1), props.pageCount - 4)
  return Array.from({ length: 5 }, (_, index) => first + index)
})

function statusKey(id: number) {
  return `${props.activeBank}:${id}`
}

function collectionKey(id: number) {
  return `${props.activeBank}:${id}`
}

function statusFor(id: number): CTFManualStatus {
  return props.manualStatuses?.[statusKey(id)] ?? 'not_started'
}

function statusLabel(status: CTFManualStatus) {
  return ctfManualStatusLabel(status)
}

function difficultyLabel(value: number) {
  if (!value || value <= 1.4) return t('入门', 'Intro')
  if (value <= 2.4) return t('简单', 'Easy')
  if (value <= 3.2) return t('中等', 'Medium')
  return t('困难', 'Hard')
}

function difficultyTag(value: number) {
  if (!value || value <= 2.4) return ''
  if (value <= 3.2) return 'ak-tag--advanced'
  return 'ak-tag--danger'
}

function select(id: number) {
  if (props.activeBank === 'nssctf') emit('selectNssctf', id)
  else emit('selectCtfshow', id)
}
</script>

<template>
  <section class="tactical-paper-surface flex h-full min-h-0 flex-col bg-card" :aria-label="t('CTF 挑战列表', 'CTF challenge list')">
    <div class="tactical-desk-head grid h-12 shrink-0 grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
      <span>#</span><span>{{ t('题目', 'Challenge') }}</span><span>{{ t('类别', 'Category') }}</span><span>{{ t('难度', 'Difficulty') }}</span><span>{{ t('我的状态', 'My status') }}</span><span class="sr-only">{{ t('收藏', 'Collections') }}</span><span class="sr-only">{{ t('打开', 'Open') }}</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="activeBank === 'nssctf'">
        <template v-for="problem in displayedNssctfProblems" :key="problem.platformId">
          <article
            class="challenge-row tactical-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-muted/30"
            data-testid="catalog-row"
          >
            <span class="font-mono text-caption" :class="dailyProblemID === problem.platformId ? 'text-primary' : 'text-muted-foreground'">
              <CalendarDays v-if="dailyProblemID === problem.platformId" class="mr-2 inline size-4" />
              {{ dailyProblemID === problem.platformId ? 'Daily' : `P${problem.platformId}` }}
            </span>
            <span class="min-w-0 select-text">
              <span class="truncate text-control font-medium">{{ problem.title }}</span>
              <span v-if="dailyProblemID === problem.platformId" class="ak-tag ak-tag--advanced ml-3">{{ t('每日挑战', 'Daily challenge') }}</span>
            </span>
            <span class="ak-tag ak-tag--compact">{{ problem.category }}</span>
            <span class="ak-tag ak-tag--compact" :class="difficultyTag(problem.difficulty)">{{ difficultyLabel(problem.difficulty) }}</span>
            <span class="text-caption" :class="statusFor(problem.platformId) === 'in_progress' ? 'text-primary' : 'text-muted-foreground'">{{ statusLabel(statusFor(problem.platformId)) }}</span>
            <CollectionPicker :item-key="collectionKey(problem.platformId)" :store="collectionStore" />
            <Button size="sm" variant="outline" data-testid="open-item" @click="select(problem.platformId)">{{ t('打开', 'Open') }}</Button>
          </article>
        </template>
      </template>

      <template v-else>
        <template v-for="problem in ctfshowProblems" :key="problem.platformId">
          <article
            class="challenge-row tactical-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_72px] items-center gap-4 border-b border-border px-6 text-left hover:bg-muted/30"
            data-testid="catalog-row"
          >
            <span class="font-mono text-caption text-muted-foreground">#{{ problem.platformId }}</span>
            <span class="min-w-0 truncate text-control font-medium select-text">{{ problem.title }}</span>
            <span class="ak-tag ak-tag--compact">{{ problem.category }}</span>
            <span class="text-caption text-primary">{{ t(`${problem.points} 分`, `${problem.points} pts`) }}</span>
            <span class="text-caption text-muted-foreground">{{ statusLabel(statusFor(problem.platformId)) }}</span>
            <CollectionPicker :item-key="collectionKey(problem.platformId)" :store="collectionStore" />
            <Button size="sm" variant="outline" data-testid="open-item" @click="select(problem.platformId)">{{ t('打开', 'Open') }}</Button>
          </article>
        </template>
      </template>

      <div
        v-if="loading && !(activeBank === 'nssctf' ? displayedNssctfProblems.length : ctfshowProblems.length)"
        class="grid min-h-64 place-items-center px-8 text-center"
        data-testid="ctf-catalog-loading-state"
      >
        <div class="max-w-lg">
          <LoaderCircle class="mx-auto size-5 animate-spin text-primary" />
          <p class="mt-4 text-control font-medium">{{ loadingTitle }}</p>
          <p v-if="loadingDetail" class="mt-2 text-caption leading-5 text-muted-foreground">{{ loadingDetail }}</p>
          <Button
            v-if="activeBank === 'ctfshow'"
            variant="outline"
            size="sm"
            class="mt-4"
            @click="emit('openCtfshow')"
          >
            <ExternalLink class="size-4" />
            {{ t('打开 CTFshow', 'Open CTFshow') }}
          </Button>
        </div>
      </div>
      <div
        v-else-if="loading"
        class="flex min-h-12 items-center justify-center gap-2 border-b border-border px-6 text-caption text-muted-foreground"
      >
        <LoaderCircle class="size-4 animate-spin" />
        {{ t('正在后台刷新，当前题目仍可使用', 'Refreshing in the background; current challenges remain usable') }}
      </div>
      <div v-else-if="!(activeBank === 'nssctf' ? displayedNssctfProblems.length : ctfshowProblems.length)" class="grid min-h-64 place-items-center px-8 text-center">
        <div>
          <p v-if="catalogError || emptyTitle" class="text-control font-medium">{{ catalogError ? t('题库暂时不可用', 'Catalog temporarily unavailable') : emptyTitle }}</p>
          <p v-if="catalogError || emptyDetail" class="mt-2 max-w-lg text-caption leading-5 text-muted-foreground">{{ catalogError || emptyDetail }}</p>
          <Button v-if="activeBank === 'nssctf'" variant="outline" size="sm" class="mt-4" @click="emit('syncNssctf')"><RefreshCw class="size-4" />{{ t('重新同步', 'Resync') }}</Button>
          <Button v-else variant="outline" size="sm" class="mt-4" @click="emit('openCtfshow')"><ExternalLink class="size-4" />{{ t('打开 CTFshow', 'Open CTFshow') }}</Button>
        </div>
      </div>
    </div>

    <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
      <span class="text-caption text-muted-foreground">{{ t(`共 ${total.toLocaleString()} 题`, `${total.toLocaleString()} challenges`) }}</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1 || loading" :aria-label="t('上一页', 'Previous page')" @click="emit('previousPage')"><ChevronLeft class="size-4" /></Button>
        <Button v-for="pageNumber in visiblePages" :key="pageNumber" :variant="pageNumber === page ? 'outline' : 'ghost'" size="icon-sm" @click="emit('goPage', pageNumber)">{{ pageNumber }}</Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= pageCount || loading" :aria-label="t('下一页', 'Next page')" @click="emit('nextPage')"><ChevronRight class="size-4" /></Button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.challenge-row { position: relative; cursor: default; transition: background-color 140ms ease; }
</style>
