<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button } from '@felinic/ui'
import { Pencil, RotateCw } from 'lucide-vue-next'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand } from '@/desktop'
import type { CTFSummary } from '@/ctfTypes'
import type { AccountStatus, Conversation } from '@/types'
import type { VulnSummary } from '@/vulnTypes'
import {
  activityCalendar,
  buildPersonalProfileSnapshot,
  profileAvatarFileProblem,
  type PersonalActivityModule,
} from '@/lib/personalProfile'

const props = defineProps<{ accountStatus: AccountStatus, conversations: Conversation[] }>()

const ctfJobs = ref<CTFSummary[]>([])
const vulnJobs = ref<VulnSummary[]>([])
const loading = ref(false)
const error = ref('')
const editing = ref(false)
const displayName = ref(window.localStorage.getItem('milksu.profile.name') || '')
const bio = ref(window.localStorage.getItem('milksu.profile.bio') || '记录真实练习，也保留自己的节奏。')
const customAvatar = ref(window.localStorage.getItem('milksu.profile.avatar') || '')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarError = ref('')

const snapshot = computed(() => buildPersonalProfileSnapshot(
  props.conversations,
  ctfJobs.value,
  vulnJobs.value,
))
const calendar = computed(() => activityCalendar(snapshot.value.dayCounts))
const recentGrowth = computed(() => snapshot.value.activities.filter(activity => activity.confirmed).slice(0, 6))
const shownAvatar = computed(() => customAvatar.value || props.accountStatus.user?.avatarUrl || profileAvatar)
const shownName = computed(() => displayName.value || props.accountStatus.user?.displayName || 'MilkSU')
const shownIdentity = computed(() => props.accountStatus.user?.githubLogin ? `@${props.accountStatus.user.githubLogin}` : '本机资料')
const balanceLabel = computed(() => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format((props.accountStatus.balanceCents ?? 0) / 100))
const monthLabels = computed(() => {
  const labels: Array<{ key: string, label: string, column: number }> = []
  let previous = -1
  calendar.value.forEach((cell, index) => {
    const month = cell.date.getMonth()
    if (month !== previous && index % 7 <= 6) {
      labels.push({ key: `${cell.key}:${month}`, label: `${month + 1}月`, column: Math.floor(index / 7) + 1 })
      previous = month
    }
  })
  return labels
})

const moduleClass: Record<PersonalActivityModule, string> = {
  ctf: 'ctf',
  vuln: 'vuln',
  coding: 'coding',
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [ctf, vuln] = await Promise.all([
      invokeCommand<CTFSummary[]>('list_ctf_jobs'),
      invokeCommand<VulnSummary[]>('list_vuln_jobs'),
    ])
    ctfJobs.value = ctf
    vulnJobs.value = vuln
  } catch {
    error.value = '暂时无法读取本机成长记录，请稍后再试。'
  } finally {
    loading.value = false
  }
}

function saveProfile() {
  displayName.value = displayName.value.trim().slice(0, 40)
  bio.value = bio.value.trim().slice(0, 100) || '记录真实练习，也保留自己的节奏。'
  window.localStorage.setItem('milksu.profile.name', displayName.value)
  window.localStorage.setItem('milksu.profile.bio', bio.value)
  editing.value = false
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
  reader.onerror = () => { avatarError.value = '头像读取失败，请重新选择。' }
  reader.onload = () => {
    const value = typeof reader.result === 'string' ? reader.result : ''
    if (!value.startsWith(`data:${file.type};base64,`)) {
      avatarError.value = '头像读取失败，请重新选择。'
      return
    }
    customAvatar.value = value
    try {
      window.localStorage.setItem('milksu.profile.avatar', value)
      avatarError.value = ''
    } catch {
      avatarError.value = '头像已用于当前页面，但没有保存到本机。'
    }
    if (input) input.value = ''
  }
  reader.readAsDataURL(file)
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(timestamp))
}

onMounted(load)
</script>

<template>
  <main class="profile-page min-w-0 flex-1 overflow-y-auto bg-background text-foreground" aria-label="个人资料">
    <div class="mx-auto w-full max-w-[1180px] px-10 py-10">
      <header class="profile-header flex items-center gap-6 border-b border-border pb-7">
        <div class="relative shrink-0">
          <img :src="shownAvatar" alt="个人头像" class="size-24 rounded-full border-2 border-border object-cover shadow-sm">
          <input ref="avatarInput" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" @change="updateAvatar">
          <Button variant="outline" size="icon-sm" class="absolute -bottom-1 -right-1 rounded-full" aria-label="更换头像" @click="chooseAvatar">
            <Pencil class="size-3.5" />
          </Button>
        </div>
        <div class="min-w-0 flex-1">
          <template v-if="editing">
            <input v-model="displayName" class="profile-name-input" aria-label="显示名称" maxlength="40">
            <input v-model="bio" class="profile-bio-input" aria-label="个人介绍" maxlength="100" @keydown.enter="saveProfile">
            <div class="mt-3 flex gap-2"><Button size="sm" @click="saveProfile">保存</Button><Button variant="ghost" size="sm" @click="editing = false">取消</Button></div>
          </template>
          <template v-else>
            <div class="flex items-center gap-3"><h1 class="text-3xl font-semibold tracking-tight">{{ shownName }}</h1><span class="text-caption text-muted-foreground">{{ shownIdentity }}</span></div>
            <p class="mt-3 max-w-2xl text-body text-muted-foreground">{{ bio }}</p>
            <Button variant="ghost" size="sm" class="mt-3 px-0" @click="startEditingProfile">编辑资料</Button>
          </template>
        </div>
        <div class="flex items-center gap-4">
          <span v-if="accountStatus.state === 'active'" class="text-body">可用额度 <strong class="ml-2 text-primary">{{ balanceLabel }}</strong></span>
          <Button variant="ghost" size="sm" :disabled="loading" @click="load"><RotateCw class="mr-2 size-4" />刷新</Button>
        </div>
      </header>
      <p v-if="avatarError" class="mt-3 text-caption text-destructive">{{ avatarError }}</p>

      <section class="activity-section border-b border-border py-8" aria-labelledby="activity-heading">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <h2 id="activity-heading" class="text-2xl font-medium">过去一年，活跃 <strong class="ml-2 text-5xl font-semibold text-primary">{{ snapshot.activeDays }}</strong> 天</h2>
          <div class="flex items-center gap-8 text-body">
            <span v-for="item in snapshot.modules" :key="item.module">{{ item.label }} <strong class="ml-2 text-xl text-primary">{{ item.count }}</strong></span>
          </div>
        </div>

        <div class="activity-scroll mt-8 overflow-x-auto pb-2">
          <div class="activity-calendar" role="img" :aria-label="`过去一年活跃 ${snapshot.activeDays} 天`">
            <span v-for="month in monthLabels" :key="month.key" class="month-label" :style="{ gridColumn: month.column }">{{ month.label }}</span>
            <span
              v-for="(cell, cellIndex) in calendar"
              :key="cell.key"
              class="activity-cell"
              :class="[`level-${Math.min(cell.count, 4)}`, { future: cell.future }]"
              :style="{ gridColumn: Math.floor(cellIndex / 7) + 1, gridRow: cell.date.getDay() + 2 }"
              :title="`${cell.key} · ${cell.count} 条真实记录`"
              aria-hidden="true"
            />
          </div>
        </div>
        <p class="mt-3 text-right text-caption text-muted-foreground">每格按当日真实任务记录计数；工具调用不单独计入。</p>
      </section>

      <section class="module-grid grid grid-cols-3 border-b border-border py-8" aria-label="成长概况">
        <article v-for="(item, index) in snapshot.modules" :key="item.module" class="px-8 first:pl-0 last:pr-0" :class="index ? 'border-l border-border' : ''">
          <h2 class="text-2xl font-semibold">{{ item.label }}</h2>
          <p class="mt-2 text-body text-info">{{ item.stage }}</p>
          <p class="mt-2"><strong class="text-3xl font-medium text-primary">{{ item.count }}</strong><span class="ml-2 text-body text-muted-foreground">{{ item.unit }}</span></p>
          <p class="mt-5 text-caption text-muted-foreground">最近记录</p>
          <p class="mt-1 truncate text-body">{{ item.recentFocus }}</p>
        </article>
      </section>

      <section class="py-7" aria-labelledby="growth-heading">
        <h2 id="growth-heading" class="text-xl font-semibold">最近成长</h2>
        <p v-if="error" class="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-body text-destructive">{{ error }}</p>
        <div v-else-if="!recentGrowth.length" class="mt-6 border-l-2 border-border py-4 pl-6 text-body text-muted-foreground">完成真实 Coding、CTF 或 CVE 任务后，这里会自动出现记录。</div>
        <ol v-else class="growth-list mt-5">
          <li v-for="activity in recentGrowth" :key="activity.id" class="grid grid-cols-[76px_92px_1fr] items-start gap-5 py-4">
            <time class="text-body text-muted-foreground">{{ formatDate(activity.timestamp) }}</time>
            <span class="growth-module" :class="moduleClass[activity.module]">{{ activity.module === 'vuln' ? 'CVE' : activity.module === 'coding' ? 'Coding' : 'CTF' }}</span>
            <div><h3 class="text-body font-medium">{{ activity.title }}</h3><p class="mt-1 text-caption text-muted-foreground">{{ activity.detail }}</p></div>
          </li>
        </ol>
      </section>
    </div>
  </main>
</template>

<style scoped>
.profile-page { background-image: radial-gradient(circle at 75% 0%, color-mix(in srgb, var(--primary) 4%, transparent), transparent 36%); }
.profile-name-input { width: min(26rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .25rem 0; font-size: 1.875rem; font-weight: 600; outline: 0; }
.profile-bio-input { margin-top: .75rem; width: min(40rem, 100%); border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: .35rem 0; color: var(--muted-foreground); outline: 0; }
.activity-calendar { min-width: 900px; display: grid; grid-template-columns: repeat(53, minmax(10px, 1fr)); grid-template-rows: 20px repeat(7, 11px); gap: 4px; }
.month-label { grid-row: 1; color: var(--muted-foreground); font-size: .7rem; white-space: nowrap; }
.activity-cell { border-radius: 2px; background: color-mix(in srgb, var(--muted-foreground) 22%, transparent); }
.activity-cell.level-1 { background: color-mix(in srgb, var(--info) 55%, transparent); }
.activity-cell.level-2 { background: var(--info); }
.activity-cell.level-3 { background: color-mix(in srgb, var(--info) 60%, var(--primary)); }
.activity-cell.level-4 { background: var(--primary); }
.activity-cell.future { opacity: .24; }
.growth-list { position: relative; }
.growth-list::before { content: ''; position: absolute; left: 92px; top: 1.5rem; bottom: 1.5rem; width: 1px; background: var(--border); }
.growth-list li { position: relative; }
.growth-list li::before { content: ''; position: absolute; left: 88px; top: 1.45rem; width: 9px; height: 9px; border-radius: 50%; background: var(--primary); }
.growth-module { justify-self: start; min-width: 64px; border: 1px solid var(--border); border-radius: .3rem; padding: .2rem .55rem; text-align: center; font-size: .75rem; color: var(--foreground); }
.growth-module.ctf { border-color: color-mix(in srgb, var(--primary) 55%, var(--border)); }
.growth-module.vuln { border-color: color-mix(in srgb, var(--info) 55%, var(--border)); }
@media (max-width: 900px) { .module-grid { grid-template-columns: 1fr; }.module-grid article { border-left: 0 !important; border-top: 1px solid var(--border); padding: 1.4rem 0; }.module-grid article:first-child { border-top: 0; } }
</style>
