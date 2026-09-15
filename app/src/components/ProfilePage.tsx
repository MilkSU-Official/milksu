import { createStore, nextTick, useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useRef } from 'react'
import { LockKeyhole, Pencil, RotateCw, UserRound } from 'lucide-react'
import { Button } from '@/components/ui'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand, listenEvent } from '@/desktop'
import { isComposingKey } from '@/lib/imeComposition'
import type { CTFSummary } from '@/ctfTypes'
import { providerModelLabel } from '@/modelCatalog'
import {
  EMPTY_CODING_USAGE,
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
import { useT } from '@/hooks/useUiLocale'

type Translate = (zh: string, en: string) => string
type ProfileTab = 'ctf' | 'vuln' | 'coding'
type SelectedDays = Record<ProfileTab, string>

type ProfileState = {
  accountStatus: AccountStatus
  conversations: Conversation[]
  vulnerabilities: VulnerabilityIntel[]
  ctfJobs: CTFSummary[]
  codingUsage: CodingUsageSnapshot
  activeTab: ProfileTab
  selectedDay: SelectedDays
  loading: boolean
  error: string
  editing: boolean
  displayName: string
  bio: string
  customAvatar: string
  avatarError: string
}

const tabs: Array<{ id: ProfileTab, label: string }> = [
  { id: 'ctf', label: 'CTF' },
  { id: 'vuln', label: 'CVE' },
  { id: 'coding', label: 'Coding' },
]

const moduleClass: Record<PersonalActivityModule, string> = {
  ctf: 'ctf',
  vuln: 'vuln',
  coding: 'coding',
}

const USAGE_RETRY_DELAYS = [2_000, 5_000, 10_000]
function trimDecimal(value: number) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/u, '')
}

function compactNumber(value: number, t: Translate) {
  if (value >= 100_000_000) return t(`${trimDecimal(value / 100_000_000)}亿`, `${trimDecimal(value / 1_000_000)}M`)
  if (value >= 10_000) return t(`${trimDecimal(value / 10_000)}万`, `${trimDecimal(value / 1_000)}K`)
  return t(new Intl.NumberFormat('zh-CN').format(value), new Intl.NumberFormat('en').format(value))
}

function modelLabel(provider: string, model: string) {
  const value = providerModelLabel(provider, model)
  return value.includes(' · ') ? value.split(' · ').at(-1) || model : value
}

function sourceLabel(source: string, t: Translate) {
  if (source === 'account') return t('账户分配模型', 'Account-assigned model')
  if (source === 'personal') return t('个人 API', 'Personal API')
  return t('未标注来源', 'Unlabeled source')
}

function formatDuration(durationMs: number, t: Translate) {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return t(`${trimDecimal(durationMs / 1000)} 秒`, `${trimDecimal(durationMs / 1000)}s`)
}

function formatDate(timestamp: number, t: Translate) {
  const date = new Date(timestamp)
  return t(
    new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date),
    new Intl.DateTimeFormat('en', { month: 'numeric', day: 'numeric' }).format(date),
  )
}

function selectedDateLabel(day: string, t: Translate) {
  if (!day) return t('尚无记录日期', 'No recorded date yet')
  const date = new Date(`${day}T12:00:00`)
  return t(
    new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date),
    new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(date),
  )
}

function calendarCellTitle(day: string, value: number, activeTab: ProfileTab, t: Translate) {
  if (!value) return t(`${day} · 无记录`, `${day} · no activity`)
  if (activeTab === 'coding') return t(`${day} · ${compactNumber(value, t)} Token`, `${day} · ${compactNumber(value, t)} tokens`)
  return t(`${day} · ${value} 条真实记录`, `${day} · ${value} confirmed records`)
}

function ctfState(job: CTFSummary, t: Translate) {
  if (job.verdict === 'pass') return t('Judge 已验证', 'Judge verified')
  if (job.verdict === 'fail') return t('Judge 未通过', 'Judge failed')
  if (job.pendingJudge) return t('等待 Judge', 'Waiting for Judge')
  if (job.pendingSubmission) return t('等待提交', 'Waiting to submit')
  if (job.status === 'running') return t('练习中', 'In practice')
  if (job.status === 'failed') return t('任务已结束', 'Task ended')
  return t('继续练习', 'Continue practice')
}

function aggregateLabels(values: string[], t: Translate) {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const label = raw.trim() || t('未标注', 'Unlabeled')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
}

function referenceSource(reference: { label: string, href: string }, t: Translate) {
  const label = reference.label.trim()
  if (label) return label
  try {
    return new URL(reference.href).hostname.replace(/^www\./u, '')
  } catch {
    return t('其他来源', 'Other source')
  }
}

function rawDayCountsFrom(state: ProfileState) {
  if (state.activeTab === 'coding') {
    return Object.fromEntries(state.codingUsage.days.map(day => [day.date, day.totalTokens]))
  }
  const records = state.activeTab === 'ctf'
    ? ctfActivities(state.ctfJobs)
    : vulnActivities(state.vulnerabilities, state.conversations)
  const counts: Record<string, number> = {}
  for (const activity of records) {
    const day = localDayKey(activity.timestamp)
    counts[day] = (counts[day] ?? 0) + 1
  }
  return counts
}

function calendarLevelsFrom(rawDayCounts: Record<string, number>) {
  const values = Object.values(rawDayCounts).filter(value => value > 0).sort((left, right) => left - right)
  const counts: Record<string, number> = {}
  if (!values.length) return counts
  const max = values.at(-1) ?? 1
  for (const [day, value] of Object.entries(rawDayCounts)) {
    counts[day] = value <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(value / max * 4)))
  }
  return counts
}

function monthLabelsFrom(calendar: ReturnType<typeof activityCalendar>, t: Translate) {
  const labels: Array<{ key: string, label: string, column: number }> = []
  let previous = -1
  calendar.forEach((cell, index) => {
    const month = cell.date.getMonth()
    if (month !== previous) {
      labels.push({
        key: `${cell.key}:${month}`,
        label: t(`${month + 1}月`, new Intl.DateTimeFormat('en', { month: 'short' }).format(cell.date)),
        column: Math.floor(index / 7) + 2,
      })
      previous = month
    }
  })
  return labels
}

function availableDaysFrom(state: ProfileState) {
  return {
    coding: state.codingUsage.days.map(day => day.date).sort(),
    ctf: [...new Set(ctfActivities(state.ctfJobs).map(item => localDayKey(item.timestamp)))].sort(),
    vuln: [...new Set(vulnActivities(state.vulnerabilities, state.conversations).map(item => localDayKey(item.timestamp)))].sort(),
  }
}

function resolveSelectedDay(selected: string, days: string[]) {
  return selected && days.includes(selected) ? selected : (days.at(-1) ?? '')
}

export default function ProfilePage({
  accountStatus,
  conversations,
  vulnerabilities,
  onAccountStatusChange,
}: {
  accountStatus: AccountStatus
  conversations: Conversation[]
  vulnerabilities: VulnerabilityIntel[]
  onAccountStatusChange?: (status: AccountStatus) => void
}) {
  const t = useT()
  const accountStatusChange = useRef(onAccountStatusChange)
  accountStatusChange.current = onAccountStatusChange
  const avatarInput = useRef<HTMLInputElement>(null)

  const runtime = useStoreRuntime(() => {
    const store = createStore<ProfileState>({
      accountStatus,
      conversations,
      vulnerabilities,
      ctfJobs: [],
      codingUsage: { ...EMPTY_CODING_USAGE },
      activeTab: 'coding',
      selectedDay: { ctf: '', vuln: '', coding: '' },
      loading: false,
      error: '',
      editing: false,
      displayName: window.localStorage.getItem('milksu.profile.name') || '',
      bio: window.localStorage.getItem('milksu.profile.bio') || t('记录真实练习，也保留自己的节奏。', 'Keep a record of real practice, at your own pace.'),
      customAvatar: window.localStorage.getItem('milksu.profile.avatar') || '',
      avatarError: '',
    })

    let stopUsageEvents: (() => void) | undefined
    let usageRetryTimer: number | undefined
    let usageRetryAttempt = 0

    function scheduleUsageRetry() {
      if (usageRetryTimer !== undefined || usageRetryAttempt >= USAGE_RETRY_DELAYS.length) return
      const delay = USAGE_RETRY_DELAYS[usageRetryAttempt] ?? 0
      usageRetryAttempt += 1
      usageRetryTimer = window.setTimeout(() => {
        usageRetryTimer = undefined
        void refreshUsage()
      }, delay)
    }

    async function refreshUsage() {
      try {
        const codingUsage = await invokeCommand<CodingUsageSnapshot>('get_coding_usage_snapshot')
        usageRetryAttempt = 0
        store.setState({ codingUsage, error: '' })
      } catch {
        store.setState({
          error: t('模型用量暂时无法加载，正在自动重试。', 'Model usage could not be loaded yet. Retrying automatically.'),
        })
        scheduleUsageRetry()
      }
    }

    async function load(options: { account?: boolean } = {}) {
      store.setState({ loading: true, error: '' })
      const [ctfResult, usageResult, accountResult] = await Promise.allSettled([
        invokeCommand<CTFSummary[]>('list_ctf_jobs'),
        invokeCommand<CodingUsageSnapshot>('get_coding_usage_snapshot'),
        options.account ? invokeCommand<AccountStatus>('get_account_status') : Promise.resolve(undefined),
      ])
      const failures: string[] = []
      const patch: Partial<ProfileState> = { loading: false }
      if (ctfResult.status === 'fulfilled') {
        patch.ctfJobs = ctfResult.value
      } else {
        failures.push(t('成长记录', 'progress'))
      }
      if (usageResult.status === 'fulfilled') {
        patch.codingUsage = usageResult.value
        usageRetryAttempt = 0
      } else {
        failures.push(t('模型用量', 'model usage'))
      }
      if (accountResult.status === 'fulfilled' && accountResult.value) {
        accountStatusChange.current?.(accountResult.value)
      } else if (options.account && accountResult.status === 'rejected') {
        failures.push(t('账户状态', 'account status'))
      }
      if (failures.length) {
        patch.error = options.account
          ? t(`暂时无法刷新${failures.join('、')}，正在自动重试。`, `Could not refresh ${failures.join(', ')}. Retrying automatically.`)
          : t(`暂时无法读取${failures.join('、')}，正在自动重试。`, `Could not load ${failures.join(', ')}. Retrying automatically.`)
        scheduleUsageRetry()
      }
      store.setState(patch)
    }

    function saveProfile() {
      const state = store.getState()
      const displayName = state.displayName.trim().slice(0, 40)
      const bio = state.bio.trim().slice(0, 100) || t('记录真实练习，也保留自己的节奏。', 'Keep a record of real practice, at your own pace.')
      window.localStorage.setItem('milksu.profile.name', displayName)
      window.localStorage.setItem('milksu.profile.bio', bio)
      store.setState({ displayName, bio, editing: false })
    }

    function submitProfile(event: React.KeyboardEvent) {
      if (isComposingKey(event.nativeEvent)) return
      event.preventDefault()
      saveProfile()
    }

    function startEditingProfile() {
      const state = store.getState()
      const shownName = state.displayName || state.accountStatus.user?.displayName || 'MilkSU'
      store.setState({
        displayName: state.displayName.trim() ? state.displayName : shownName,
        editing: true,
      })
    }

    function start() {
      void load()
      void nextTick().then(async () => {
        stopUsageEvents = await listenEvent('model-usage-changed', () => { void refreshUsage() })
      })
    }

    function stop() {
      stopUsageEvents?.()
      if (usageRetryTimer !== undefined) window.clearTimeout(usageRetryTimer)
    }

    return {
      store,
      start,
      stop,
      load,
      saveProfile,
      submitProfile,
      startEditingProfile,
    }
  })

  useEffect(() => {
    runtime.store.setState({ accountStatus, conversations, vulnerabilities })
  }, [runtime, accountStatus, conversations, vulnerabilities])

  const state = runtime.store.getState()
  const snapshot = buildPersonalProfileSnapshot(state.conversations, state.ctfJobs, state.vulnerabilities)
  const recentGrowth = snapshot.activities.filter(activity => activity.confirmed).slice(0, 6)
  const shownAvatar = state.customAvatar || state.accountStatus.user?.avatarUrl || profileAvatar
  const shownName = state.displayName || state.accountStatus.user?.displayName || 'MilkSU'
  const shownIdentity = state.accountStatus.user?.githubLogin
    ? `@${state.accountStatus.user.githubLogin}`
    : t('本机资料', 'Local profile')
  const rawDayCounts = rawDayCountsFrom(state)
  const calendar = activityCalendar(calendarLevelsFrom(rawDayCounts))
  const monthLabels = monthLabelsFrom(calendar, t)
  const availableDays = availableDaysFrom(state)
  const selectedDays: SelectedDays = {
    coding: resolveSelectedDay(state.selectedDay.coding, availableDays.coding),
    ctf: resolveSelectedDay(state.selectedDay.ctf, availableDays.ctf),
    vuln: resolveSelectedDay(state.selectedDay.vuln, availableDays.vuln),
  }
  const currentDayKey = selectedDays[state.activeTab]
  const selectedCodingDay = state.codingUsage.days.find(day => day.date === selectedDays.coding)
  const selectedCTFJobs = state.ctfJobs
    .filter(job => localDayKey(Date.parse(job.updatedAt)) === selectedDays.ctf)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const selectedVulnRecords = vulnActivities(state.vulnerabilities, state.conversations)
    .filter(item => localDayKey(item.timestamp) === selectedDays.vuln)
  const ctfCategoryCounts = aggregateLabels(state.ctfJobs.map(job => job.category || t('未分类', 'Uncategorized')), t)
  const ctfSourceCounts = aggregateLabels(state.ctfJobs.map(job => job.externalPlatform || t('本地练习', 'Local practice')), t)
  const ctfVerifiedCount = state.ctfJobs.filter(job => job.verdict === 'pass').length
  const vulnStatusCounts = aggregateLabels(state.vulnerabilities.map(item => vulnerabilityStatusLabel(item.status)), t)
  const vulnReferenceCounts = aggregateLabels(
    state.vulnerabilities.flatMap(item => item.references.map(reference => referenceSource(reference, t))),
    t,
  )

  function chooseAvatar() {
    runtime.store.setState({ avatarError: '' })
    avatarInput.current?.click()
  }

  function updateAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    const problem = profileAvatarFileProblem(file)
    if (problem) {
      runtime.store.setState({ avatarError: problem })
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onerror = () => {
      runtime.store.setState({ avatarError: t('头像读取失败，请重新选择。', 'Could not read the avatar. Please choose another file.') })
    }
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      if (!value.startsWith(`data:${file.type};base64,`)) {
        runtime.store.setState({ avatarError: t('头像读取失败，请重新选择。', 'Could not read the avatar. Please choose another file.') })
        return
      }
      runtime.store.setState({ customAvatar: value })
      try {
        window.localStorage.setItem('milksu.profile.avatar', value)
        runtime.store.setState({ avatarError: '' })
      } catch {
        runtime.store.setState({ avatarError: t('头像已用于当前页面，但没有保存到本机。', 'The avatar is used on this page, but it was not saved locally.') })
      }
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  function selectCalendarDay(day: string, future: boolean) {
    if (future || !rawDayCounts[day]) return
    runtime.store.setState(current => ({
      ...current,
      selectedDay: { ...current.selectedDay, [current.activeTab]: day },
    }))
  }

  return (
    <main className="profile-page page-scroll min-w-0 flex-1 bg-background text-foreground" aria-label={t('个人资料', 'Profile')}>
      <div className="page-column">
        <header className="shell-window-control-safe-x flex items-center justify-between gap-5 pb-5">
          <div className="flex items-center gap-3">
            <UserRound className="size-6 text-primary" />
            <h1 className="text-2xl font-medium tracking-tight">{t('个人资料', 'Profile')}</h1>
            <span className="inline-flex items-center gap-1.5 text-caption text-success"><LockKeyhole className="size-3.5" />{t('仅自己可见', 'Only visible to you')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={state.loading} onClick={() => void runtime.load({ account: true })}><RotateCw className="size-4" />{t('刷新', 'Refresh')}</Button>
            <Button variant="outline" size="sm" onClick={() => runtime.startEditingProfile()}><Pencil className="size-4" />{t('编辑资料', 'Edit profile')}</Button>
          </div>
        </header>

        <section className="profile-identity flex flex-wrap items-center gap-6 rounded-[8px] px-4 py-5">
          <div className="relative shrink-0">
            <img src={shownAvatar} alt={t('个人头像', 'Profile photo')} className="size-24 rounded-full border-2 border-primary object-cover shadow-sm" />
            <input ref={avatarInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={updateAvatar} />
            <Button variant="outline" size="icon-sm" className="absolute -bottom-1 -right-1 rounded-full" aria-label={t('更换头像', 'Change photo')} onClick={chooseAvatar}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
          <div className="min-w-[15rem] flex-1">
            {state.editing ? (
              <>
                <input
                  value={state.displayName}
                  onChange={event => { runtime.store.setState({ displayName: event.target.value }) }}
                  className="profile-name-input"
                  aria-label={t('显示名称', 'Display name')}
                  maxLength={40}
                />
                <input
                  value={state.bio}
                  onChange={event => { runtime.store.setState({ bio: event.target.value }) }}
                  className="profile-bio-input"
                  aria-label={t('个人介绍', 'Bio')}
                  maxLength={100}
                  onKeyDown={event => { if (event.key === 'Enter') runtime.submitProfile(event) }}
                />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => runtime.saveProfile()}>{t('保存', 'Save')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => { runtime.store.setState({ editing: false }) }}>{t('取消', 'Cancel')}</Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-3xl font-semibold tracking-[-0.04em]">{shownName}</h2>
                <p className="mt-1 text-body text-muted-foreground">{shownIdentity}</p>
                <p className="mt-3 max-w-2xl text-body text-muted-foreground">{state.bio}</p>
              </>
            )}
          </div>
          <div className="profile-summary flex flex-wrap items-center gap-7 border-l border-border pl-7">
            <div>
              <span className="text-caption text-muted-foreground block">{t('活跃天数', 'Active days')}</span>
              <strong className="mt-1 block text-2xl font-semibold">{t(`${snapshot.activeDays} 天`, `${snapshot.activeDays} days`)}</strong>
            </div>
            {snapshot.modules.map(item => (
              <div key={`summary:${item.module}`}>
                <span className="text-caption text-muted-foreground block">{item.label}</span>
                <strong className="mt-1 block text-2xl font-semibold">{item.count} {item.unit}</strong>
              </div>
            ))}
          </div>
        </section>
        {state.avatarError ? <p className="mt-3 text-caption text-destructive">{state.avatarError}</p> : null}

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="profile-command-panel min-w-0" aria-labelledby="profile-panel-heading">
            <div className="profile-tabs" role="tablist" aria-label={t('成长模块', 'Progress modules')}>
              {tabs.map(tab => (
                <button
                  id={`profile-tab-${tab.id}`}
                  key={tab.id}
                  className={`profile-tab${state.activeTab === tab.id ? ' active' : ''}`}
                  role="tab"
                  aria-selected={state.activeTab === tab.id}
                  aria-controls={`profile-panel-${tab.id}`}
                  onClick={() => { runtime.store.setState({ activeTab: tab.id }) }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              id={`profile-panel-${state.activeTab}`}
              className="profile-panel-body"
              role="tabpanel"
              aria-labelledby={`profile-tab-${state.activeTab}`}
            >
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-caption text-muted-foreground">{t('过去一年', 'Past year')}</p>
                  <h2 id="profile-panel-heading" className="mt-1 text-2xl font-semibold">
                    {state.activeTab === 'coding' ? t('Coding 活动与用量', 'Coding activity and usage') : state.activeTab === 'ctf' ? t('CTF 练习与验证', 'CTF practice and verification') : t('CVE 研究与来源', 'CVE research and sources')}
                  </h2>
                </div>
              </div>

              <div className="profile-metrics mt-4">
                {state.activeTab === 'coding' ? (
                  <>
                    <span><b>{compactNumber(state.codingUsage.totalTokens, t)}</b> Token</span>
                    <span><b>{state.codingUsage.activeDays}</b> {t('个用量日', 'usage days')}</span>
                    <span><b>{t(new Intl.NumberFormat('zh-CN').format(state.codingUsage.toolCalls), new Intl.NumberFormat('en').format(state.codingUsage.toolCalls))}</b> {t('次工具调用', 'tool calls')}</span>
                  </>
                ) : state.activeTab === 'ctf' ? (
                  <>
                    <span><b>{state.ctfJobs.length}</b> {t('个练习任务', 'practice tasks')}</span>
                    <span><b>{availableDays.ctf.length}</b> {t('个活跃日', 'active days')}</span>
                    <span><b>{ctfVerifiedCount}</b> {t('个 Judge 通过', 'Judge passes')}</span>
                  </>
                ) : (
                  <>
                    <span><b>{state.vulnerabilities.length}</b> {t('个跟踪项', 'tracked items')}</span>
                    <span><b>{availableDays.vuln.length}</b> {t('个研究日', 'research days')}</span>
                    <span><b>{vulnReferenceCounts.length}</b> {t('类资料来源', 'source types')}</span>
                  </>
                )}
              </div>

              <div className="calendar-heading mt-5 flex items-center justify-between gap-4">
                <span>{state.activeTab === 'coding' ? t('每日 Token', 'Daily tokens') : state.activeTab === 'ctf' ? t('每日练习更新', 'Daily practice updates') : t('每日研究记录', 'Daily research records')}</span>
                <span>{t('53 周', '53 weeks')}</span>
              </div>
              <div className="activity-scroll mt-3 overflow-x-auto pb-2">
                <div className="activity-calendar" aria-label={t(`${state.activeTab} 过去一年活动图`, `${state.activeTab} activity in the past year`)}>
                  {monthLabels.map(month => (
                    <span key={month.key} className="month-label" style={{ gridColumn: month.column }}>{month.label}</span>
                  ))}
                  <span className="weekday-label weekday-mon">{t('周一', 'Mon')}</span>
                  <span className="weekday-label weekday-wed">{t('周三', 'Wed')}</span>
                  <span className="weekday-label weekday-fri">{t('周五', 'Fri')}</span>
                  <span className="weekday-label weekday-sun">{t('周日', 'Sun')}</span>
                  {calendar.map((cell, cellIndex) => (
                    <button
                      key={cell.key}
                      className={`activity-cell level-${cell.count}${cell.future ? ' future' : ''}${currentDayKey === cell.key ? ' selected' : ''}`}
                      style={{ gridColumn: Math.floor(cellIndex / 7) + 2, gridRow: cell.date.getDay() + 2 }}
                      title={calendarCellTitle(cell.key, rawDayCounts[cell.key] ?? 0, state.activeTab, t)}
                      aria-label={calendarCellTitle(cell.key, rawDayCounts[cell.key] ?? 0, state.activeTab, t)}
                      disabled={cell.future || !rawDayCounts[cell.key]}
                      onClick={() => selectCalendarDay(cell.key, cell.future)}
                    />
                  ))}
                </div>
              </div>
              <div className="calendar-legend mt-2 flex items-center justify-between text-caption text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  {t('低', 'Low')}
                  {[1, 2, 3, 4].map(level => <i key={level} className={`legend-cell level-${level}`} />)}
                  {t('高', 'High')}
                </span>
                <span>{selectedDateLabel(currentDayKey, t)}</span>
              </div>

              {state.error ? <p className="mt-5 border border-destructive/30 bg-destructive/10 px-4 py-3 text-body text-destructive">{state.error}</p> : null}

              {state.activeTab === 'coding' && selectedCodingDay ? (
                <div className="detail-grid mt-5">
                  <section className="detail-column" aria-labelledby="coding-models-heading">
                    <h3 id="coding-models-heading">{selectedDateLabel(selectedCodingDay.date, t)} · {compactNumber(selectedCodingDay.totalTokens, t)} Token</h3>
                    <ul className="detail-list">
                      {selectedCodingDay.models.map(model => (
                        <li key={`${model.provider}:${model.model}:${model.source}`}>
                          <span>
                            <b>{modelLabel(model.provider, model.model)}</b>
                            <small>{sourceLabel(model.source, t)} · {t(`${model.calls} 次响应`, `${model.calls} responses`)}</small>
                          </span>
                          <strong>{compactNumber(model.totalTokens, t)}</strong>
                        </li>
                      ))}
                    </ul>
                    <p className="detail-foot">
                      {t(`输入 ${compactNumber(selectedCodingDay.inputTokens, t)} · 输出 ${compactNumber(selectedCodingDay.outputTokens, t)} · 缓存读取 ${compactNumber(selectedCodingDay.cacheReadTokens, t)}`, `Input ${compactNumber(selectedCodingDay.inputTokens, t)} · output ${compactNumber(selectedCodingDay.outputTokens, t)} · cache read ${compactNumber(selectedCodingDay.cacheReadTokens, t)}`)}
                    </p>
                  </section>
                  <section className="detail-column" aria-labelledby="coding-tools-heading">
                    <h3 id="coding-tools-heading">{t('工具活动', 'Tool activity')}</h3>
                    {selectedCodingDay.tools.length ? (
                      <ul className="detail-list">
                        {selectedCodingDay.tools.map(tool => (
                          <li key={tool.name}>
                            <span>
                              <b className="font-mono">{tool.name}</b>
                              <small>{formatDuration(tool.durationMs, t)} · {tool.failures ? t(`${tool.failures} 次失败`, `${tool.failures} failed`) : t('无失败', 'No failures')}</small>
                            </span>
                            <strong>{t(`${tool.calls} 次`, `${tool.calls} calls`)}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                </div>
              ) : null}

              {state.activeTab === 'ctf' && state.ctfJobs.length ? (
                <div className="detail-grid mt-5">
                  <section className="detail-column" aria-labelledby="ctf-records-heading">
                    <h3 id="ctf-records-heading">{t(`${selectedDateLabel(selectedDays.ctf, t)} · 练习记录`, `${selectedDateLabel(selectedDays.ctf, t)} · practice records`)}</h3>
                    {selectedCTFJobs.length ? (
                      <ul className="detail-list">
                        {selectedCTFJobs.map(job => (
                          <li key={job.id}>
                            <span>
                              <b>{job.title}</b>
                              <small>{job.category || t('未分类', 'Uncategorized')} · {ctfState(job, t)}</small>
                            </span>
                            <strong>{t(`${job.experimentCount} 次实验`, `${job.experimentCount} experiments`)}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                  <section className="detail-column" aria-labelledby="ctf-distribution-heading">
                    <h3 id="ctf-distribution-heading">{t('题型与来源', 'Categories and sources')}</h3>
                    <div className="compact-distributions">
                      <div>
                        <p>{t('题型', 'Category')}</p>
                        {ctfCategoryCounts.slice(0, 4).map(item => (
                          <span key={`category:${item.label}`}><b>{item.label}</b>{t(`${item.count} 题`, `${item.count} challenges`)}</span>
                        ))}
                      </div>
                      <div>
                        <p>{t('来源', 'Source')}</p>
                        {ctfSourceCounts.slice(0, 4).map(item => (
                          <span key={`source:${item.label}`}><b>{item.label}</b>{t(`${item.count} 题`, `${item.count} challenges`)}</span>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {state.activeTab === 'vuln' && state.vulnerabilities.length ? (
                <div className="detail-grid mt-5">
                  <section className="detail-column" aria-labelledby="vuln-records-heading">
                    <h3 id="vuln-records-heading">{t(`${selectedDateLabel(selectedDays.vuln, t)} · 研究记录`, `${selectedDateLabel(selectedDays.vuln, t)} · research records`)}</h3>
                    {selectedVulnRecords.length ? (
                      <ul className="detail-list">
                        {selectedVulnRecords.map(activity => (
                          <li key={activity.id}>
                            <span>
                              <b>{activity.title}</b>
                              <small>{activity.detail}</small>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                  <section className="detail-column" aria-labelledby="vuln-sources-heading">
                    <h3 id="vuln-sources-heading">{t('跟踪状态与资料来源', 'Tracking status and sources')}</h3>
                    <div className="compact-distributions">
                      <div>
                        <p>{t('状态', 'Status')}</p>
                        {vulnStatusCounts.map(item => (
                          <span key={`status:${item.label}`}><b>{item.label}</b>{t(`${item.count} 项`, `${item.count} items`)}</span>
                        ))}
                      </div>
                      <div>
                        <p>{t('来源', 'Source')}</p>
                        {vulnReferenceCounts.slice(0, 5).map(item => (
                          <span key={`reference:${item.label}`}><b>{item.label}</b>{t(`${item.count} 条`, `${item.count} sources`)}</span>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </section>

          <section className="growth-panel rounded-[8px] px-4 py-4" aria-labelledby="growth-heading">
            <div className="border-b border-border pb-4">
              <p className="text-caption text-muted-foreground">{t('有结果来源', 'Confirmed sources')}</p>
              <h2 id="growth-heading" className="mt-1 text-xl font-semibold">{t('最近确认的成长', 'Recent confirmed progress')}</h2>
            </div>
            {recentGrowth.length ? (
              <ol className="growth-list mt-2">
                {recentGrowth.map(activity => (
                  <li key={activity.id} className="relative border-b border-border py-4 pl-5 last:border-b-0">
                    <i className="growth-dot" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-3">
                      <span className={`growth-module ${moduleClass[activity.module]}`}>{activity.module === 'vuln' ? 'CVE' : activity.module === 'coding' ? 'Coding' : 'CTF'}</span>
                      <time className="text-caption text-muted-foreground">{formatDate(activity.timestamp, t)}</time>
                    </div>
                    <h3 className="mt-3 text-body font-medium">{activity.title}</h3>
                    <p className="mt-1 text-caption leading-5 text-muted-foreground">{activity.detail}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>
      </div>
      <style>{profilePageCss}</style>
    </main>
  )
}

const profilePageCss = `
.profile-page {
  --profile-graphite: var(--card);
  --profile-graphite-raised: var(--muted);
  --profile-graphite-line: var(--border);
}
.profile-name-input { width: min(26rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .25rem 0; font-size: 1.875rem; font-weight: 600; outline: 0; }
.profile-bio-input { margin-top: .75rem; width: min(40rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .35rem 0; color: var(--muted-foreground); outline: 0; }
.profile-identity { border-radius: 8px; }
.profile-command-panel { overflow: hidden; border-radius: 8px; background: var(--background); }
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
`
