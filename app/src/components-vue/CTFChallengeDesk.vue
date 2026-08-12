<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Button, NativeSelect, NativeSelectOption } from '@felinic/ui'
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  MessagesSquare,
  Paperclip,
  RefreshCw,
  TerminalSquare,
} from 'lucide-vue-next'
import CollectionPicker from '@/components-vue/CollectionPicker.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { ctfManualStatusLabel, type CTFManualStatus } from '@/lib/ctfManualStatus'
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
  selectedCtfshow: null,
  dashboard: null,
  nssctfAttemptedIds: () => [],
  nssctfCompletedIds: () => [],
  ctfshowAttemptedIds: () => [],
  ctfshowCompletedIds: () => [],
  localMaterials: () => [],
  catalogError: '',
  attachmentError: '',
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
  openProblem: []
  openCtfshow: []
  syncNssctf: []
  refreshJudge: []
  openSettings: []
  openBrowserSettings: []
  openConversation: [id: string]
  updateManualStatus: [key: string, status: CTFManualStatus]
  'update:collaborationMode': [value: CTFCollaborationMode]
}>()

const selectedID = computed(() => props.activeBank === 'nssctf'
  ? props.selectedNssctf?.platformId
  : props.selectedCtfshow?.platformId)
const displayedNssctfProblems = computed(() => {
  const selected = props.selectedNssctf
  if (!selected || props.nssctfProblems.some(problem => problem.platformId === selected.platformId)) return props.nssctfProblems
  return [{
    platformId: selected.platformId,
    sourceUrl: selected.sourceUrl,
    title: selected.title,
    category: selected.category,
    points: selected.points,
    difficulty: selected.difficulty,
    tags: selected.tags,
    hasWriteup: selected.writeupCount > 0,
    solvedCount: selected.solvedCount,
    wrongAnswerCount: selected.wrongAnswerCount,
    noAnswerCount: 0,
    open: true,
    syncedAt: selected.importedAt,
  }, ...props.nssctfProblems]
})
const firstProblemID = computed(() => props.activeBank === 'nssctf'
  ? displayedNssctfProblems.value[0]?.platformId
  : props.ctfshowProblems[0]?.platformId)
const relatedConversations = computed(() => props.relatedJobId
  ? props.conversations.filter(item => item.ctfJobId === props.relatedJobId)
  : [])
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
  if (!value || value <= 1.4) return '入门'
  if (value <= 2.4) return '简单'
  if (value <= 3.2) return '中等'
  return '困难'
}

function difficultyClass(value: number) {
  if (!value || value <= 2.4) return 'text-primary'
  if (value <= 3.2) return 'text-warning'
  return 'text-destructive'
}

function select(id: number) {
  if (props.activeBank === 'nssctf') emit('selectNssctf', id)
  else emit('selectCtfshow', id)
}

function updateStatus(id: number, raw: string) {
  if (!['not_started', 'in_progress', 'paused', 'completed'].includes(raw)) return
  emit('updateManualStatus', statusKey(id), raw as CTFManualStatus)
}

function handleStatusChange(id: number, event: Event) {
  const value = (event.target as HTMLSelectElement | null)?.value
  if (value) updateStatus(id, value)
}

function openCoding() {
  if (props.activeBank === 'nssctf') emit('startNssctf')
  else if (props.selectedCtfshow) emit('startCtfshow', props.selectedCtfshow.platformId)
}
</script>

<template>
  <section class="tactical-paper-surface flex h-full min-h-0 flex-col bg-card" aria-label="CTF 挑战列表">
    <div class="tactical-desk-head grid h-12 shrink-0 grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_90px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
      <span>#</span><span>题目</span><span>类别</span><span>难度</span><span>我的状态</span><span class="sr-only">收藏</span><span>操作</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="activeBank === 'nssctf'">
        <template v-for="problem in displayedNssctfProblems" :key="problem.platformId">
          <button
            type="button"
            class="challenge-row tactical-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_90px] items-center gap-4 border-b border-border px-6 text-left hover:bg-muted/30"
            :class="selectedID === problem.platformId ? 'challenge-row-selected' : ''"
            :aria-expanded="selectedID === problem.platformId"
            @click="select(problem.platformId)"
          >
            <span class="font-mono text-caption" :class="firstProblemID === problem.platformId ? 'text-primary' : 'text-muted-foreground'">
              <CalendarDays v-if="firstProblemID === problem.platformId" class="mr-2 inline size-4" />
              {{ firstProblemID === problem.platformId ? 'Daily' : `P${problem.platformId}` }}
            </span>
            <span class="min-w-0">
              <span class="truncate text-control font-medium">{{ problem.title }}</span>
              <Badge v-if="firstProblemID === problem.platformId" variant="outline" class="ml-3">每日挑战</Badge>
            </span>
            <span class="text-caption text-info">{{ problem.category }}</span>
            <span class="text-caption" :class="difficultyClass(problem.difficulty)">{{ difficultyLabel(problem.difficulty) }}</span>
            <span class="text-caption" :class="statusFor(problem.platformId) === 'in_progress' ? 'text-primary' : 'text-muted-foreground'">{{ statusLabel(statusFor(problem.platformId)) }}</span>
            <CollectionPicker :item-key="collectionKey(problem.platformId)" :store="collectionStore" @click.stop />
            <span class="text-caption text-info">{{ selectedID === problem.platformId ? '已展开' : statusFor(problem.platformId) === 'in_progress' ? '继续' : '开始' }}</span>
          </button>

          <div v-if="selectedID === problem.platformId && selectedNssctf" class="game-focus-panel border-b bg-card px-6 py-5">
            <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div class="min-w-0">
                <p class="text-caption font-medium text-muted-foreground">题目描述</p>
                <MarkdownContent class="mt-2 max-h-32 overflow-y-auto text-body leading-6" :content="selectedNssctf.statement" />
                <div class="mt-4 flex flex-wrap items-center gap-5 text-caption">
                  <button v-if="selectedNssctf.hasAttachment || localMaterials.length" class="inline-flex items-center gap-2 text-foreground" @click.stop="emit('chooseLocalMaterials')">
                    <Paperclip class="size-4" />附件 {{ localMaterials.length || 1 }}
                  </button>
                  <span class="inline-flex items-center gap-2 text-info"><MessagesSquare class="size-4" />关联对话 {{ relatedConversations.length }}</span>
                  <button class="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground" @click.stop="emit('openProblem')">
                    <ExternalLink class="size-4" />打开题目
                  </button>
                </div>
                <div v-if="relatedConversations.length" class="mt-4 flex flex-wrap gap-2">
                  <Button v-for="item in relatedConversations" :key="item.id" variant="outline" size="sm" @click="emit('openConversation', item.id)">
                    {{ item.title }}
                  </Button>
                </div>
              </div>
              <div class="flex items-end justify-end gap-3">
                <label class="min-w-36 text-caption text-muted-foreground">我的状态
                  <NativeSelect :model-value="statusFor(problem.platformId)" size="sm" class="mt-2 w-full" @click.stop @change="handleStatusChange(problem.platformId, $event)">
                    <NativeSelectOption value="not_started">未开始</NativeSelectOption>
                    <NativeSelectOption value="in_progress">进行中</NativeSelectOption>
                    <NativeSelectOption value="paused">稍后继续</NativeSelectOption>
                    <NativeSelectOption value="completed">已完成</NativeSelectOption>
                  </NativeSelect>
                </label>
                <Button variant="brand" :loading="actionLoading" :disabled="actionLoading" @click="openCoding">
                  <TerminalSquare class="size-4" />交给 Coding<ArrowRight class="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </template>
      </template>

      <template v-else>
        <template v-for="problem in ctfshowProblems" :key="problem.platformId">
          <button
            type="button"
            class="challenge-row tactical-row grid min-h-[62px] w-full grid-cols-[92px_minmax(0,1fr)_140px_110px_130px_42px_90px] items-center gap-4 border-b border-border px-6 text-left hover:bg-muted/30"
            :class="selectedID === problem.platformId ? 'challenge-row-selected' : ''"
            @click="select(problem.platformId)"
          >
            <span class="font-mono text-caption text-muted-foreground">#{{ problem.platformId }}</span>
            <span class="truncate text-control font-medium">{{ problem.title }}</span>
            <span class="text-caption text-info">{{ problem.category }}</span>
            <span class="text-caption text-primary">{{ problem.points }} 分</span>
            <span class="text-caption text-muted-foreground">{{ statusLabel(statusFor(problem.platformId)) }}</span>
            <CollectionPicker :item-key="collectionKey(problem.platformId)" :store="collectionStore" @click.stop />
            <span class="text-caption text-info">{{ selectedID === problem.platformId ? '已展开' : '开始' }}</span>
          </button>
          <div v-if="selectedID === problem.platformId && selectedCtfshow" class="game-focus-panel border-b bg-card px-6 py-5">
            <div class="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p class="text-body">从已连接的 CTFshow 页面读取题面和附件，再交给同一个 Coding Agent。</p>
                <p class="mt-3 inline-flex items-center gap-2 text-caption text-info"><MessagesSquare class="size-4" />关联对话 {{ relatedConversations.length }}</p>
              </div>
              <div class="flex items-end gap-3">
                <NativeSelect :model-value="statusFor(problem.platformId)" size="sm" class="w-36" @change="handleStatusChange(problem.platformId, $event)">
                  <NativeSelectOption value="not_started">未开始</NativeSelectOption>
                  <NativeSelectOption value="in_progress">进行中</NativeSelectOption>
                  <NativeSelectOption value="paused">稍后继续</NativeSelectOption>
                  <NativeSelectOption value="completed">已完成</NativeSelectOption>
                </NativeSelect>
                <Button variant="brand" :loading="actionLoading" :disabled="actionLoading" @click="openCoding"><TerminalSquare class="size-4" />交给 Coding</Button>
              </div>
            </div>
          </div>
        </template>
      </template>

      <div v-if="loading" class="grid min-h-44 place-items-center"><LoaderCircle class="size-5 animate-spin text-muted-foreground" /></div>
      <div v-else-if="!(activeBank === 'nssctf' ? displayedNssctfProblems.length : ctfshowProblems.length)" class="grid min-h-64 place-items-center px-8 text-center">
        <div>
          <p class="text-control font-medium">{{ catalogError ? '题库暂时不可用' : '没有匹配题目' }}</p>
          <p class="mt-2 text-caption text-muted-foreground">{{ catalogError || '换个题号、题名或分类试试。' }}</p>
          <Button v-if="activeBank === 'nssctf'" variant="outline" size="sm" class="mt-4" @click="emit('syncNssctf')"><RefreshCw class="size-4" />重新同步</Button>
          <Button v-else variant="outline" size="sm" class="mt-4" @click="emit('openCtfshow')"><ExternalLink class="size-4" />打开 CTFshow</Button>
        </div>
      </div>
    </div>

    <footer class="flex h-14 shrink-0 items-center justify-between border-t border-border px-6">
      <span class="text-caption text-muted-foreground">共 {{ total.toLocaleString() }} 题</span>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1 || loading" aria-label="上一页" @click="emit('previousPage')"><ChevronLeft class="size-4" /></Button>
        <Button v-for="pageNumber in visiblePages" :key="pageNumber" :variant="pageNumber === page ? 'outline' : 'ghost'" size="icon-sm" @click="emit('goPage', pageNumber)">{{ pageNumber }}</Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= pageCount || loading" aria-label="下一页" @click="emit('nextPage')"><ChevronRight class="size-4" /></Button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.challenge-row { position: relative; transition: background-color 140ms ease; }
.challenge-row-selected { background: var(--focus-panel); box-shadow: inset 3px 0 0 var(--brand); }
</style>
