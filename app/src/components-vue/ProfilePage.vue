<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button } from '@felinic/ui'
import { LockKeyhole, Pencil, RotateCw, UserRound } from 'lucide-vue-next'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand, listenEvent } from '@/desktop'
import { isComposingKey } from '@/lib/imeComposition'
import type { CTFSummary } from '@/ctfTypes'
import { providerModelLabel } from '@/modelCatalog'
import {
  EMPTY_CODING_USAGE,
  type CodingUsageDay,
  type CodingUsageSnapshot,
} from '@/modelUsageTypes'
import type { AccountStatus, Conversation } from '@/types'
import {
  vulnerabilityStatusLabel,
  type VulnerabilityIntel,
} from '@/vulnerabilityIntel'
import {
  activityCalendar,
  buildPersonalProfileSnapshot,
  ctfActivities,
  localDayKey,
  profileAvatarFileProblem,
  vulnActivities,
  type PersonalActivityModule,
} from '@/lib/personalProfile'
import { t } from '@/lib/uiLocale'

type ProfileTab = 'ctf' | 'vuln' | 'coding'

const props = defineProps<{
  accountStatus: AccountStatus
  conversations: Conversation[]
  vulnerabilities: VulnerabilityIntel[]
}>()
const emit = defineEmits<{ accountStatusChange: [status: AccountStatus] }>()

const tabs: Array<{ id: ProfileTab, label: string }> = [
  { id: 'ctf', label: 'CTF' },
  { id: 'vuln', label: 'CVE' },
  { id: 'coding', label: 'Coding' },
]

const ctfJobs = ref<CTFSummary[]>([])
const codingUsage = ref<CodingUsageSnapshot>({ ...EMPTY_CODING_USAGE })
const activeTab = ref<ProfileTab>('coding')
const selectedDay = ref<Record<ProfileTab, string>>({ ctf: '', vuln: '', coding: '' })
const loading = ref(false)
const error = ref('')
const editing = ref(false)
const displayName = ref(window.localStorage.getItem('milksu.profile.name') || '')
const bio = ref(window.localStorage.getItem('milksu.profile.bio') || t('记录真实练习，也保留自己的节奏。', 'Keep a record of real practice, at your own pace.'))
const customAvatar = ref(window.localStorage.getItem('milksu.profile.avatar') || '')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarError = ref('')
let stopUsageEvents: (() => void) | undefined

const snapshot = computed(() => buildPersonalProfileSnapshot(
  props.conversations,
  ctfJobs.value,
  props.vulnerabilities,
))
const ctfRecords = computed(() => ctfActivities(ctfJobs.value))
const vulnRecords = computed(() => vulnActivities(props.vulnerabilities, props.conversations))
const recentGrowth = computed(() => snapshot.value.activities.filter(activity => activity.confirmed).slice(0, 6))
const shownAvatar = computed(() => customAvatar.value || props.accountStatus.user?.avatarUrl || profileAvatar)
const shownName = computed(() => displayName.value || props.accountStatus.user?.displayName || 'MilkSU')
const shownIdentity = computed(() => props.accountStatus.user?.githubLogin ? `@${props.accountStatus.user.githubLogin}` : t('本机资料', 'Local profile'))

const rawDayCounts = computed<Record<string, number>>(() => {
  if (activeTab.value === 'coding') {
    return Object.fromEntries(codingUsage.value.days.map(day => [day.date, day.totalTokens]))
  }
  const records = activeTab.value === 'ctf' ? ctfRecords.value : vulnRecords.value
  const counts: Record<string, number> = {}
  for (const activity of records) {
    const day = localDayKey(activity.timestamp)
    counts[day] = (counts[day] ?? 0) + 1
  }
  return counts
})

const calendarLevels = computed(() => {
  const values = Object.values(rawDayCounts.value).filter(value => value > 0).sort((left, right) => left - right)
  const counts: Record<string, number> = {}
  if (!values.length) return counts
  const max = values.at(-1) ?? 1
  for (const [day, value] of Object.entries(rawDayCounts.value)) {
    counts[day] = value <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(value / max * 4)))
  }
  return counts
})
const calendar = computed(() => activityCalendar(calendarLevels.value))
const monthLabels = computed(() => {
  const labels: Array<{ key: string, label: string, column: number }> = []
  let previous = -1
  calendar.value.forEach((cell, index) => {
    const month = cell.date.getMonth()
    if (month !== previous) {
      labels.push({ key: `${cell.key}:${month}`, label: t(`${month + 1}月`, new Intl.DateTimeFormat('en', { month: 'short' }).format(cell.date)), column: Math.floor(index / 7) + 2 })
      previous = month
    }
  })
  return labels
})

const availableDays = computed<Record<ProfileTab, string[]>>(() => ({
  coding: codingUsage.value.days.map(day => day.date).sort(),
  ctf: [...new Set(ctfRecords.value.map(item => localDayKey(item.timestamp)))].sort(),
  vuln: [...new Set(vulnRecords.value.map(item => localDayKey(item.timestamp)))].sort(),
}))

const currentDayKey = computed(() => selectedDay.value[activeTab.value])
const selectedCodingDay = computed<CodingUsageDay | undefined>(() => (
  codingUsage.value.days.find(day => day.date === selectedDay.value.coding)
))
const selectedCTFJobs = computed(() => ctfJobs.value
  .filter(job => localDayKey(Date.parse(job.updatedAt)) === selectedDay.value.ctf)
  .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)))
const selectedVulnRecords = computed(() => vulnRecords.value
  .filter(item => localDayKey(item.timestamp) === selectedDay.value.vuln))

const ctfCategoryCounts = computed(() => aggregateLabels(ctfJobs.value.map(job => job.category || t('未分类', 'Uncategorized'))))
const ctfSourceCounts = computed(() => aggregateLabels(ctfJobs.value.map(job => job.externalPlatform || t('本地练习', 'Local practice'))))
const ctfVerifiedCount = computed(() => ctfJobs.value.filter(job => job.verdict === 'pass').length)
const vulnStatusCounts = computed(() => aggregateLabels(props.vulnerabilities.map(item => vulnerabilityStatusLabel(item.status))))
const vulnReferenceCounts = computed(() => aggregateLabels(props.vulnerabilities.flatMap(item => item.references.map(referenceSource))))

const moduleClass: Record<PersonalActivityModule, string> = {
  ctf: 'ctf',
  vuln: 'vuln',
  coding: 'coding',
}

watch(availableDays, days => {
  for (const tab of tabs) {
    const current = selectedDay.value[tab.id]
    if (!current || !days[tab.id].includes(current)) {
      selectedDay.value[tab.id] = days[tab.id].at(-1) ?? ''
    }
  }
}, { immediate: true, deep: true })

async function load(options: { account?: boolean } = {}) {
  loading.value = true
  error.value = ''
  try {
    const requests: [Promise<CTFSummary[]>, Promise<CodingUsageSnapshot>, Promise<AccountStatus> | undefined] = [
      invokeCommand<CTFSummary[]>('list_ctf_jobs'),
      invokeCommand<CodingUsageSnapshot>('get_coding_usage_snapshot'),
      options.account ? invokeCommand<AccountStatus>('get_account_status') : undefined,
    ]
    const [ctf, usage, account] = await Promise.all(requests)
    ctfJobs.value = ctf
    codingUsage.value = usage
    if (account) emit('accountStatusChange', account)
  } catch {
    error.value = options.account
      ? t('暂时无法刷新本机成长记录或账户状态，请稍后再试。', 'Could not refresh local progress or account status. Try again later.')
      : t('暂时无法读取本机成长记录，请稍后再试。', 'Could not load local progress. Try again later.')
  } finally {
    loading.value = false
  }
}

async function refreshUsage() {
  try {
    codingUsage.value = await invokeCommand<CodingUsageSnapshot>('get_coding_usage_snapshot')
  } catch {
    error.value = t('模型用量已更新，但当前页面刷新失败，请手动刷新。', 'Model usage updated, but this page failed to refresh. Please refresh it yourself.')
  }
}

function selectTab(tab: ProfileTab) {
  activeTab.value = tab
}

function selectCalendarDay(day: string, future: boolean) {
  if (future || !rawDayCounts.value[day]) return
  selectedDay.value[activeTab.value] = day
}

function aggregateLabels(values: string[]) {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const label = raw.trim() || t('未标注', 'Unlabeled')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
}

function referenceSource(reference: { label: string, href: string }) {
  const label = reference.label.trim()
  if (label) return label
  try {
    return new URL(reference.href).hostname.replace(/^www\./u, '')
  } catch {
    return t('其他来源', 'Other source')
  }
}

function compactNumber(value: number) {
  if (value >= 100_000_000) return t(`${trimDecimal(value / 100_000_000)}亿`, `${trimDecimal(value / 1_000_000)}M`)
  if (value >= 10_000) return t(`${trimDecimal(value / 10_000)}万`, `${trimDecimal(value / 1_000)}K`)
  return t(new Intl.NumberFormat('zh-CN').format(value), new Intl.NumberFormat('en').format(value))
}

function trimDecimal(value: number) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/u, '')
}

function modelLabel(provider: string, model: string) {
  const value = providerModelLabel(provider, model)
  return value.includes(' · ') ? value.split(' · ').at(-1) || model : value
}

function sourceLabel(source: string) {
  if (source === 'account') return t('账户分配模型', 'Account-assigned model')
  if (source === 'personal') return t('个人 API', 'Personal API')
  return t('未标注来源', 'Unlabeled source')
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return t(`${trimDecimal(durationMs / 1000)} 秒`, `${trimDecimal(durationMs / 1000)}s`)
}

function selectedDateLabel(day = currentDayKey.value) {
  if (!day) return t('尚无记录日期', 'No recorded date yet')
  const date = new Date(`${day}T12:00:00`)
  return t(
    new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date),
    new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(date),
  )
}

function calendarCellTitle(day: string) {
  const value = rawDayCounts.value[day] ?? 0
  if (!value) return t(`${day} · 无记录`, `${day} · no activity`)
  if (activeTab.value === 'coding') return t(`${day} · ${compactNumber(value)} Token`, `${day} · ${compactNumber(value)} tokens`)
  return t(`${day} · ${value} 条真实记录`, `${day} · ${value} confirmed records`)
}

function ctfState(job: CTFSummary) {
  if (job.verdict === 'pass') return t('Judge 已验证', 'Judge verified')
  if (job.verdict === 'fail') return t('Judge 未通过', 'Judge failed')
  if (job.pendingJudge) return t('等待 Judge', 'Waiting for Judge')
  if (job.pendingSubmission) return t('等待提交', 'Waiting to submit')
  if (job.status === 'running') return t('练习中', 'In practice')
  if (job.status === 'failed') return t('任务已结束', 'Task ended')
  return t('继续练习', 'Continue practice')
}

function saveProfile() {
  displayName.value = displayName.value.trim().slice(0, 40)
  bio.value = bio.value.trim().slice(0, 100) || t('记录真实练习，也保留自己的节奏。', 'Keep a record of real practice, at your own pace.')
  window.localStorage.setItem('milksu.profile.name', displayName.value)
  window.localStorage.setItem('milksu.profile.bio', bio.value)
  editing.value = false
}

function submitProfile(event: KeyboardEvent) {
  if (isComposingKey(event)) return
  event.preventDefault()
  saveProfile()
}

function startEditingProfile() {
  if (!displayName.value.trim()) displayName.value = shownName.value
  editing.value = true
}

function chooseAvatar() {
  avatarError.value = ''
  avatarInput.value?.click()
}

function updateAvatar(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return
  const problem = profileAvatarFileProblem(file)
  if (problem) {
    avatarError.value = problem
    if (input) input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onerror = () => { avatarError.value = t('头像读取失败，请重新选择。', 'Could not read the avatar. Please choose another file.') }
  reader.onload = () => {
    const value = typeof reader.result === 'string' ? reader.result : ''
    if (!value.startsWith(`data:${file.type};base64,`)) {
      avatarError.value = t('头像读取失败，请重新选择。', 'Could not read the avatar. Please choose another file.')
      return
    }
    customAvatar.value = value
    try {
      window.localStorage.setItem('milksu.profile.avatar', value)
      avatarError.value = ''
    } catch {
      avatarError.value = t('头像已用于当前页面，但没有保存到本机。', 'The avatar is used on this page, but it was not saved locally.')
    }
    if (input) input.value = ''
  }
  reader.readAsDataURL(file)
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp)
  return t(
    new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date),
    new Intl.DateTimeFormat('en', { month: 'numeric', day: 'numeric' }).format(date),
  )
}

onMounted(async () => {
  await load()
  await nextTick()
  stopUsageEvents = await listenEvent('model-usage-changed', () => { void refreshUsage() })
})

onBeforeUnmount(() => stopUsageEvents?.())
</script>

<template>
  <main class="profile-page tactical-page page-scroll min-w-0 flex-1 bg-background text-foreground" :aria-label="t('个人资料', 'Profile')">
    <div class="page-column">
      <header class="flex items-center justify-between gap-5 pb-5">
        <div class="flex items-center gap-3">
          <UserRound class="size-6 text-primary" />
          <h1 class="text-2xl font-medium tracking-tight">{{ t('个人资料', 'Profile') }}</h1>
          <span class="inline-flex items-center gap-1.5 text-caption text-success"><LockKeyhole class="size-3.5" />{{ t('仅自己可见', 'Only visible to you') }}</span>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" :disabled="loading" @click="load({ account: true })"><RotateCw class="size-4" />{{ t('刷新', 'Refresh') }}</Button>
          <Button variant="outline" size="sm" @click="startEditingProfile"><Pencil class="size-4" />{{ t('编辑资料', 'Edit profile') }}</Button>
        </div>
      </header>

      <section class="profile-identity flex flex-wrap items-center gap-6 rounded-[8px] px-4 py-5">
        <div class="relative shrink-0">
          <img :src="shownAvatar" :alt="t('个人头像', 'Profile photo')" class="size-24 rounded-full border-2 border-primary object-cover shadow-sm">
          <input ref="avatarInput" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" @change="updateAvatar">
          <Button variant="outline" size="icon-sm" class="absolute -bottom-1 -right-1 rounded-full" :aria-label="t('更换头像', 'Change photo')" @click="chooseAvatar">
            <Pencil class="size-3.5" />
          </Button>
        </div>
        <div class="min-w-[15rem] flex-1">
          <template v-if="editing">
            <input v-model="displayName" class="profile-name-input" :aria-label="t('显示名称', 'Display name')" maxlength="40">
            <input v-model="bio" class="profile-bio-input" :aria-label="t('个人介绍', 'Bio')" maxlength="100" @keydown.enter="submitProfile">
            <div class="mt-3 flex gap-2"><Button size="sm" @click="saveProfile">{{ t('保存', 'Save') }}</Button><Button variant="ghost" size="sm" @click="editing = false">{{ t('取消', 'Cancel') }}</Button></div>
          </template>
          <template v-else>
            <h2 class="text-3xl font-semibold tracking-[-0.04em]">{{ shownName }}</h2>
            <p class="mt-1 text-body text-muted-foreground">{{ shownIdentity }}</p>
            <p class="mt-3 max-w-2xl text-body text-muted-foreground">{{ bio }}</p>
          </template>
        </div>
        <div class="profile-summary flex flex-wrap items-center gap-7 border-l border-border pl-7">
          <div><span class="game-kicker block">{{ t('活跃天数', 'Active days') }}</span><strong class="mt-1 block text-2xl font-semibold">{{ t(`${snapshot.activeDays} 天`, `${snapshot.activeDays} days`) }}</strong></div>
          <div v-for="item in snapshot.modules" :key="`summary:${item.module}`"><span class="game-kicker block">{{ item.label }}</span><strong class="mt-1 block text-2xl font-semibold">{{ item.count }} {{ item.unit }}</strong></div>
        </div>
      </section>
      <p v-if="avatarError" class="mt-3 text-caption text-destructive">{{ avatarError }}</p>

      <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          class="profile-command-panel min-w-0"
          aria-labelledby="profile-panel-heading"
        >
          <div class="profile-tabs" role="tablist" :aria-label="t('成长模块', 'Progress modules')">
            <button
              v-for="tab in tabs"
              :id="`profile-tab-${tab.id}`"
              :key="tab.id"
              class="profile-tab"
              :class="{ active: activeTab === tab.id }"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :aria-controls="`profile-panel-${tab.id}`"
              @click="selectTab(tab.id)"
            >{{ tab.label }}</button>
          </div>

          <div
            :id="`profile-panel-${activeTab}`"
            class="profile-panel-body"
            role="tabpanel"
            :aria-labelledby="`profile-tab-${activeTab}`"
          >
            <div class="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p class="game-kicker">{{ t('过去一年', 'Past year') }}</p>
                <h2 id="profile-panel-heading" class="mt-1 text-2xl font-semibold">
                  {{ activeTab === 'coding' ? t('Coding 活动与用量', 'Coding activity and usage') : activeTab === 'ctf' ? t('CTF 练习与验证', 'CTF practice and verification') : t('CVE 研究与来源', 'CVE research and sources') }}
                </h2>
              </div>

            </div>

            <div class="profile-metrics mt-4">
              <template v-if="activeTab === 'coding'">
                <span><b>{{ compactNumber(codingUsage.totalTokens) }}</b> Token</span>
                <span><b>{{ codingUsage.activeDays }}</b> {{ t('个用量日', 'usage days') }}</span>
                <span><b>{{ t(new Intl.NumberFormat('zh-CN').format(codingUsage.toolCalls), new Intl.NumberFormat('en').format(codingUsage.toolCalls)) }}</b> {{ t('次工具调用', 'tool calls') }}</span>
              </template>
              <template v-else-if="activeTab === 'ctf'">
                <span><b>{{ ctfJobs.length }}</b> {{ t('个练习任务', 'practice tasks') }}</span>
                <span><b>{{ availableDays.ctf.length }}</b> {{ t('个活跃日', 'active days') }}</span>
                <span><b>{{ ctfVerifiedCount }}</b> {{ t('个 Judge 通过', 'Judge passes') }}</span>
              </template>
              <template v-else>
                <span><b>{{ vulnerabilities.length }}</b> {{ t('个跟踪项', 'tracked items') }}</span>
                <span><b>{{ availableDays.vuln.length }}</b> {{ t('个研究日', 'research days') }}</span>
                <span><b>{{ vulnReferenceCounts.length }}</b> {{ t('类资料来源', 'source types') }}</span>
              </template>
            </div>

            <div class="calendar-heading mt-5 flex items-center justify-between gap-4">
              <span>{{ activeTab === 'coding' ? t('每日 Token', 'Daily tokens') : activeTab === 'ctf' ? t('每日练习更新', 'Daily practice updates') : t('每日研究记录', 'Daily research records') }}</span>
              <span>{{ t('53 周', '53 weeks') }}</span>
            </div>
            <div class="activity-scroll mt-3 overflow-x-auto pb-2">
              <div class="activity-calendar" :aria-label="t(`${activeTab} 过去一年活动图`, `${activeTab} activity in the past year`)">
                <span v-for="month in monthLabels" :key="month.key" class="month-label" :style="{ gridColumn: month.column }">{{ month.label }}</span>
                <span class="weekday-label weekday-mon">{{ t('周一', 'Mon') }}</span>
                <span class="weekday-label weekday-wed">{{ t('周三', 'Wed') }}</span>
                <span class="weekday-label weekday-fri">{{ t('周五', 'Fri') }}</span>
                <span class="weekday-label weekday-sun">{{ t('周日', 'Sun') }}</span>
                <button
                  v-for="(cell, cellIndex) in calendar"
                  :key="cell.key"
                  class="activity-cell"
                  :class="[`level-${cell.count}`, { future: cell.future, selected: currentDayKey === cell.key }]"
                  :style="{ gridColumn: Math.floor(cellIndex / 7) + 2, gridRow: cell.date.getDay() + 2 }"
                  :title="calendarCellTitle(cell.key)"
                  :aria-label="calendarCellTitle(cell.key)"
                  :disabled="cell.future || !rawDayCounts[cell.key]"
                  @click="selectCalendarDay(cell.key, cell.future)"
                />
              </div>
            </div>
            <div class="calendar-legend mt-2 flex items-center justify-between text-caption text-muted-foreground">
              <span class="inline-flex items-center gap-2">{{ t('低', 'Low') }} <i v-for="level in 4" :key="level" class="legend-cell" :class="`level-${level}`" /> {{ t('高', 'High') }}</span>
              <span>{{ selectedDateLabel() }}</span>
            </div>

            <p v-if="error" class="mt-5 border border-destructive/30 bg-destructive/10 px-4 py-3 text-body text-destructive">{{ error }}</p>

            <template v-if="activeTab === 'coding'">
              <div v-if="selectedCodingDay" class="detail-grid mt-5">
                <section class="detail-column" aria-labelledby="coding-models-heading">
                  <h3 id="coding-models-heading">{{ selectedDateLabel(selectedCodingDay.date) }} · {{ compactNumber(selectedCodingDay.totalTokens) }} Token</h3>
                  <ul class="detail-list">
                    <li v-for="model in selectedCodingDay.models" :key="`${model.provider}:${model.model}:${model.source}`">
                      <span><b>{{ modelLabel(model.provider, model.model) }}</b><small>{{ sourceLabel(model.source) }} · {{ t(`${model.calls} 次响应`, `${model.calls} responses`) }}</small></span>
                      <strong>{{ compactNumber(model.totalTokens) }}</strong>
                    </li>
                  </ul>
                  <p class="detail-foot">{{ t(`输入 ${compactNumber(selectedCodingDay.inputTokens)} · 输出 ${compactNumber(selectedCodingDay.outputTokens)} · 缓存读取 ${compactNumber(selectedCodingDay.cacheReadTokens)}`, `Input ${compactNumber(selectedCodingDay.inputTokens)} · output ${compactNumber(selectedCodingDay.outputTokens)} · cache read ${compactNumber(selectedCodingDay.cacheReadTokens)}`) }}</p>
                </section>
                <section class="detail-column" aria-labelledby="coding-tools-heading">
                  <h3 id="coding-tools-heading">{{ t('工具活动', 'Tool activity') }}</h3>
                  <ul v-if="selectedCodingDay.tools.length" class="detail-list">
                    <li v-for="tool in selectedCodingDay.tools" :key="tool.name">
                      <span><b class="font-mono">{{ tool.name }}</b><small>{{ formatDuration(tool.durationMs) }} · {{ tool.failures ? t(`${tool.failures} 次失败`, `${tool.failures} failed`) : t('无失败', 'No failures') }}</small></span>
                      <strong>{{ t(`${tool.calls} 次`, `${tool.calls} calls`) }}</strong>
                    </li>
                  </ul>

                </section>
              </div>

            </template>

            <template v-else-if="activeTab === 'ctf'">
              <div v-if="ctfJobs.length" class="detail-grid mt-5">
                <section class="detail-column" aria-labelledby="ctf-records-heading">
                  <h3 id="ctf-records-heading">{{ t(`${selectedDateLabel(selectedDay.ctf)} · 练习记录`, `${selectedDateLabel(selectedDay.ctf)} · practice records`) }}</h3>
                  <ul v-if="selectedCTFJobs.length" class="detail-list">
                    <li v-for="job in selectedCTFJobs" :key="job.id">
                      <span><b>{{ job.title }}</b><small>{{ job.category || t('未分类', 'Uncategorized') }} · {{ ctfState(job) }}</small></span>
                      <strong>{{ t(`${job.experimentCount} 次实验`, `${job.experimentCount} experiments`) }}</strong>
                    </li>
                  </ul>

                </section>
                <section class="detail-column" aria-labelledby="ctf-distribution-heading">
                  <h3 id="ctf-distribution-heading">{{ t('题型与来源', 'Categories and sources') }}</h3>
                  <div class="compact-distributions">
                    <div><p>{{ t('题型', 'Category') }}</p><span v-for="item in ctfCategoryCounts.slice(0, 4)" :key="`category:${item.label}`"><b>{{ item.label }}</b>{{ t(`${item.count} 题`, `${item.count} challenges`) }}</span></div>
                    <div><p>{{ t('来源', 'Source') }}</p><span v-for="item in ctfSourceCounts.slice(0, 4)" :key="`source:${item.label}`"><b>{{ item.label }}</b>{{ t(`${item.count} 题`, `${item.count} challenges`) }}</span></div>
                  </div>
                </section>
              </div>


            </template>

            <template v-else>
              <div v-if="vulnerabilities.length" class="detail-grid mt-5">
                <section class="detail-column" aria-labelledby="vuln-records-heading">
                  <h3 id="vuln-records-heading">{{ t(`${selectedDateLabel(selectedDay.vuln)} · 研究记录`, `${selectedDateLabel(selectedDay.vuln)} · research records`) }}</h3>
                  <ul v-if="selectedVulnRecords.length" class="detail-list">
                    <li v-for="activity in selectedVulnRecords" :key="activity.id">
                      <span><b>{{ activity.title }}</b><small>{{ activity.detail }}</small></span>
                    </li>
                  </ul>

                </section>
                <section class="detail-column" aria-labelledby="vuln-sources-heading">
                  <h3 id="vuln-sources-heading">{{ t('跟踪状态与资料来源', 'Tracking status and sources') }}</h3>
                  <div class="compact-distributions">
                    <div><p>{{ t('状态', 'Status') }}</p><span v-for="item in vulnStatusCounts" :key="`status:${item.label}`"><b>{{ item.label }}</b>{{ t(`${item.count} 项`, `${item.count} items`) }}</span></div>
                    <div><p>{{ t('来源', 'Source') }}</p><span v-for="item in vulnReferenceCounts.slice(0, 5)" :key="`reference:${item.label}`"><b>{{ item.label }}</b>{{ t(`${item.count} 条`, `${item.count} sources`) }}</span></div>
                  </div>
                </section>
              </div>


            </template>
          </div>
        </section>

        <section class="growth-panel rounded-[8px] px-4 py-4" aria-labelledby="growth-heading">
          <div class="border-b border-border pb-4"><p class="game-kicker">{{ t('有结果来源', 'Confirmed sources') }}</p><h2 id="growth-heading" class="mt-1 text-xl font-semibold">{{ t('最近确认的成长', 'Recent confirmed progress') }}</h2></div>

          <ol v-if="recentGrowth.length" class="growth-list mt-2">
            <li v-for="activity in recentGrowth" :key="activity.id" class="relative border-b border-border py-4 pl-5 last:border-b-0">
              <i class="growth-dot" aria-hidden="true" />
              <div class="flex items-center justify-between gap-3"><span class="growth-module" :class="moduleClass[activity.module]">{{ activity.module === 'vuln' ? 'CVE' : activity.module === 'coding' ? 'Coding' : 'CTF' }}</span><time class="text-caption text-muted-foreground">{{ formatDate(activity.timestamp) }}</time></div>
              <h3 class="mt-3 text-body font-medium">{{ activity.title }}</h3><p class="mt-1 text-caption leading-5 text-muted-foreground">{{ activity.detail }}</p>
            </li>
          </ol>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.profile-page {
  --profile-graphite: var(--card);
  --profile-graphite-raised: var(--muted);
  --profile-graphite-line: var(--border);
}
.profile-name-input { width: min(26rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .25rem 0; font-size: 1.875rem; font-weight: 600; outline: 0; }
.profile-bio-input { margin-top: .75rem; width: min(40rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .35rem 0; color: var(--muted-foreground); outline: 0; }
.profile-identity { border-radius: 8px; }
.profile-command-panel {
  overflow: hidden;
  border-radius: 8px;
  background: var(--background);
}
.profile-tabs { display: flex; gap: 1px; padding: 0.25rem; }
.profile-tab { position: relative; min-height: 2rem; border: 0; border-radius: 8px; background: transparent; padding: 0 0.75rem; color: var(--muted-foreground); font-size: 14px; font-weight: 500; cursor: pointer; transition: color 150ms ease, background 150ms ease; }
.profile-tab:hover { background: var(--hover-2); color: var(--foreground); }
.profile-tab.active { background: var(--hover-2); color: var(--foreground); }
.profile-tab.active::after { content: none; }
.profile-panel-body { padding: 1.35rem 1.45rem 1rem; }
.profile-metrics { display: flex; flex-wrap: wrap; gap: .6rem 1.2rem; color: var(--muted-foreground); font-size: .88rem; }
.profile-metrics span { display: inline-flex; align-items: center; gap: .38rem; }
.profile-metrics span::before { content: ''; width: .36rem; height: .36rem; border-radius: 50%; background: var(--primary); box-shadow: 0 0 8px color-mix(in srgb, var(--primary) 50%, transparent); }
.profile-metrics b { color: var(--foreground); font-weight: 600; }
.calendar-heading { border-top: 1px solid var(--border); padding-top: .85rem; color: var(--muted-foreground); font-size: .78rem; }
.activity-calendar { min-width: 780px; display: grid; grid-template-columns: 2.3rem repeat(53, minmax(8px, 1fr)); grid-template-rows: 18px repeat(7, 10px); gap: 4px; }
.month-label { grid-row: 1; color: var(--muted-foreground); font-size: .68rem; white-space: nowrap; }
.weekday-label { grid-column: 1; align-self: center; color: var(--muted-foreground); font-size: .65rem; }
.weekday-mon { grid-row: 3; }.weekday-wed { grid-row: 5; }.weekday-fri { grid-row: 7; }.weekday-sun { grid-row: 2; }
.activity-cell { min-width: 8px; border: 0; border-radius: 2px; background: color-mix(in srgb, var(--muted-foreground) 17%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 4%, transparent); }
.activity-cell:not(:disabled) { cursor: pointer; }
.activity-cell.level-1, .legend-cell.level-1 { background: color-mix(in srgb, var(--primary) 22%, var(--profile-graphite-raised)); }
.activity-cell.level-2, .legend-cell.level-2 { background: color-mix(in srgb, var(--primary) 43%, var(--profile-graphite-raised)); }
.activity-cell.level-3, .legend-cell.level-3 { background: color-mix(in srgb, var(--primary) 68%, var(--profile-graphite-raised)); }
.activity-cell.level-4, .legend-cell.level-4 { background: var(--primary); }
.activity-cell.future { opacity: .23; }
.activity-cell.selected { outline: 2px solid var(--primary); outline-offset: 2px; }
.legend-cell { display: inline-block; width: .65rem; height: .65rem; border-radius: 2px; background: color-mix(in srgb, var(--muted-foreground) 17%, transparent); }
.detail-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); border-top: 1px solid var(--border); }
.detail-column { min-width: 0; padding: 1rem .4rem .25rem; }
.detail-column + .detail-column { border-left: 1px solid var(--border); padding-left: 1.35rem; }
.detail-column:first-child { padding-right: 1.35rem; }
.detail-column h3 { font-size: .92rem; font-weight: 600; }
.detail-list { margin-top: .55rem; }
.detail-list li { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--border); padding: .62rem 0; }
.detail-list li > span { min-width: 0; }
.detail-list b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 500; }
.detail-list small { display: block; margin-top: .18rem; overflow: hidden; color: var(--muted-foreground); font-size: .68rem; text-overflow: ellipsis; white-space: nowrap; }
.detail-list strong { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .77rem; font-weight: 500; }
.detail-foot, .detail-empty { margin-top: .55rem; border-top: 1px solid var(--border); padding-top: .7rem; color: var(--muted-foreground); font-size: .72rem; line-height: 1.45; }
.compact-distributions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: .55rem; border-top: 1px solid var(--border); padding-top: .7rem; }
.compact-distributions p { margin-bottom: .35rem; color: var(--muted-foreground); font-size: .68rem; }
.compact-distributions span { display: flex; justify-content: space-between; gap: .6rem; padding: .23rem 0; color: var(--muted-foreground); font-size: .72rem; }
.compact-distributions b { overflow: hidden; color: var(--foreground); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.panel-empty { border: 1px solid var(--border); background: color-mix(in srgb, var(--muted) 35%, transparent); padding: 1.4rem; }
.panel-empty strong { font-size: .92rem; }
.panel-empty p { margin-top: .4rem; max-width: 38rem; color: var(--muted-foreground); font-size: .78rem; line-height: 1.6; }
.growth-panel { border-radius: 8px; background: var(--background); }
.growth-list { position: relative; }
.growth-list::before { content: ''; position: absolute; left: .25rem; top: 1.5rem; bottom: 1.5rem; width: 1px; background: var(--border); }
.growth-dot { position: absolute; left: 0; top: 1.55rem; width: .55rem; height: .55rem; border-radius: 50%; background: var(--primary); box-shadow: 0 0 10px color-mix(in srgb, var(--primary) 45%, transparent); }
.growth-module { min-width: 64px; border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--profile-graphite-line)); border-radius: .3rem; background: color-mix(in srgb, var(--primary) 4%, var(--profile-graphite)); padding: .2rem .55rem; text-align: center; font-size: .75rem; color: var(--foreground); }
.growth-module.ctf { border-color: color-mix(in srgb, var(--primary) 55%, var(--profile-graphite-line)); }
.growth-module.vuln { border-color: color-mix(in srgb, var(--primary) 40%, var(--profile-graphite-line)); }
@media (max-width: 900px) {
  .profile-summary { width: 100%; border-left: 0; border-top: 1px solid var(--border); padding-left: 0; padding-top: 1.25rem; }
  .detail-grid { grid-template-columns: 1fr; }
  .detail-column + .detail-column { border-top: 1px solid var(--border); border-left: 0; padding-left: .4rem; }
  .detail-column:first-child { padding-right: .4rem; }
}
@media (max-width: 640px) {
  .profile-tabs { grid-template-columns: repeat(3, 1fr); }
  .profile-panel-body { padding-inline: 1rem; }
  .compact-distributions { grid-template-columns: 1fr; }
}
</style>
