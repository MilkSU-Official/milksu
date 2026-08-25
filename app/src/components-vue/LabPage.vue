<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ActionCard,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ModelListRow,
  SegmentedControl,
  SettingsRow,
  SettingsSection,
} from '@felinic/ui'
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Globe,
  MoreVertical,
  Pencil,
  Radio,
  ShieldAlert,
  Smartphone,
  SquareTerminal,
} from 'lucide-vue-next'
import { isComposingKey } from '@/lib/imeComposition'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import ResearchReportPanel from '@/components-vue/ResearchReportPanel.vue'
import WorkspaceCatalogActions from '@/components-vue/WorkspaceCatalogActions.vue'
import WorkspaceCatalogHistoryItem from '@/components-vue/WorkspaceCatalogHistoryItem.vue'
import WorkspaceImportDialog from '@/components-vue/WorkspaceImportDialog.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { invokeCommand } from '@/desktop'
import { labScopeLabel, useLabJobs, type LabJob, type LabScope } from '@/composables/useLabJobs'
import { toStripLease, useEnvLease } from '@/composables/useEnvLease'
import type { EnvChallenge, EnvLease, EnvPackage } from '@/envbroker'
import EnvironmentStrip from '@/components-vue/lab-env/EnvironmentStrip.vue'
import TargetLivePane from '@/components-vue/lab-env/TargetLivePane.vue'
import { relatedDomainConversations } from '@/lib/workspaceSessionRouting'
import { useDossierSplit } from '@/lib/useDossierSplit'
import { groupLabPackages, type LabPackageCategory } from '@/lib/labPackageCategory'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import { t } from '@/lib/uiLocale'
import type { Conversation } from '@/types'

defineOptions({ name: 'LabPage' })

const props = withDefaults(defineProps<{
  conversations?: Conversation[]
  conversation?: Conversation | null
  running?: boolean
  aborting?: boolean
  settings?: CodingAgentSurfaceBind['settings']
  workspacePath?: string
  messageQueue?: CodingAgentSurfaceBind['messageQueue']
  sessionReady?: boolean
  resumed?: boolean
  compacting?: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: CodingAgentSurfaceBind['turnStatus']
  ctfSession?: boolean
  vulnerabilitySession?: boolean
  ctfMode?: Conversation['ctfMode']
  ctfRole?: Conversation['ctfRole']
  modelMode?: Conversation['modelMode']
  modelProvider?: string
  modelId?: string
  modelSourcePreference?: CodingAgentSurfaceBind['modelSourcePreference']
  executionMode?: CodingAgentSurfaceBind['executionMode']
  approvalPolicy?: CodingAgentSurfaceBind['approvalPolicy']
  mcpServers?: string[]
  mcpConfigDigest?: string
  pendingComposerDraft?: CodingAgentSurfaceBind['pendingComposerDraft']
  ensureConversation?: (
    title?: string,
    options?: {
      conversationId?: string
      domainTaskContext?: Conversation['domainTaskContext']
    },
  ) => string
}>(), {
  conversations: () => [],
  conversation: null,
  running: false,
  aborting: false,
  settings: null,
  workspacePath: '',
  sessionReady: false,
  resumed: false,
  compacting: false,
  ctfSession: false,
  vulnerabilitySession: false,
  mcpServers: () => [],
  pendingComposerDraft: null,
  ensureConversation: () => '',
})

const emit = defineEmits<{
  enter: [job: LabJob]
  run: [job: LabJob]
  rename: [id: string, title: string]
  send: CodingAgentSendArgs
  abort: []
  selectConversation: [id: string]
  createConversation: []
  expand: []
  consumePendingDraft: []
  compactContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [
    executionMode: NonNullable<CodingAgentSurfaceBind['executionMode']>,
    approvalPolicy: NonNullable<CodingAgentSurfaceBind['approvalPolicy']>,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
  openSettings: []
  openLabSettings: []
}>()

const {
  jobs: labJobs,
  selectedId,
  selected,
  createJob,
  rename,
  focusChallenge,
} = useLabJobs()
const showNew = ref(false)
const catalogActions = ref<{ closeHistoryMenu: () => void } | null>(null)
const draftScope = ref<LabScope>('local')
const draftRequest = ref('')
const labTab = ref<'jobs' | 'packages'>('packages')
const targetOpen = ref(false)
const ownerKind = computed(() => 'lab' as const)
const ownerId = computed(() => selected.value?.id ?? '')
const packageId = computed(() => selected.value?.packageId)
const {
  lease: envLease,
  packages: envPackages,
  start: startEnv,
  stop: stopEnv,
  reset: resetEnv,
  listLeases,
} = useEnvLease(ownerKind, ownerId, packageId)
const allLeases = ref<EnvLease[]>([])
let leaseTimer: ReturnType<typeof setInterval> | null = null
const editingJobId = ref<string | null>(null)
const editingTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const scopeItems = computed(() => [
  { value: 'local' as const, label: t('本地', 'Local') },
  { value: 'remote' as const, label: t('远程', 'Remote') },
])
const labTabItems = computed(() => [
  { value: 'packages' as const, label: t('题目包', 'Packages') },
  { value: 'jobs' as const, label: t('自定义任务', 'Custom jobs') },
])
const customJobs = computed(() => labJobs.value.filter(job => !job.packageId))
const historyJobs = computed(() => (
  [...labJobs.value].sort((left, right) => right.updatedAt - left.updatedAt)
))
const packageGroups = computed(() => groupLabPackages(envPackages.value))
const dossierConversations = computed(() => relatedDomainConversations(
  props.conversations ?? [],
  props.conversation ?? null,
))
const pendingOpen = ref(false)
const selectedPackId = ref('')
const selectedPack = computed(() => (
  envPackages.value.find(item => item.id === selectedPackId.value) ?? null
))
const boundPackage = computed(() => (
  envPackages.value.find(item => item.id === selected.value?.packageId) ?? null
))
const boundChallenge = computed(() => {
  const id = selected.value?.challengeId
  if (!id) return null
  return boundPackage.value?.challenges?.find(item => item.id === id) ?? null
})
const stripLease = computed(() => {
  if (selected.value?.packageId) {
    return toStripLease(envLease.value, {
      name: boundPackage.value?.name || envLease.value.packageName,
      provider: boundPackage.value?.provider || envLease.value.provider,
    })
  }
  return toStripLease({
    ...envLease.value,
    provider: 'user-attached',
    detail: t('用户自带靶。没有经纪生命周期。', 'User-attached target. No broker lifecycle.'),
  })
})
const { width: briefWidth, startResize: startBriefResize } = useDossierSplit('milksu.lab-split.v1', 400)
const liveTargetVisible = computed(() => targetOpen.value && envLease.value.state === 'ready')

watch(selectedId, (id) => {
  if (!id) {
    targetOpen.value = false
    pendingOpen.value = false
  }
})

async function refreshAllLeases() {
  allLeases.value = await listLeases()
}

function parseOccupyOwner(value?: string) {
  const raw = String(value || '')
  const index = raw.indexOf(':')
  if (index <= 0) return { kind: '', id: '' }
  return { kind: raw.slice(0, index), id: raw.slice(index + 1) }
}

function jobEnvDot(job: LabJob) {
  if (!job.packageId) return { className: 'bg-muted-foreground/40', title: t('未绑定', 'Unbound') }
  const lease = allLeases.value.find(item => item.ownerKind === 'lab' && item.ownerId === job.id)
  switch (lease?.state) {
    case 'ready':
      return { className: 'bg-primary', title: t('就绪', 'Ready') }
    case 'pulling':
      return { className: 'bg-accent', title: t('启动中', 'Starting') }
    case 'failed':
    case 'docker-down':
    case 'busy':
      return { className: 'bg-destructive', title: lease.state === 'busy' ? t('被占用', 'Occupied') : t('失败', 'Failed') }
    default:
      return { className: 'bg-muted-foreground/40', title: t('已停止', 'Stopped') }
  }
}

function occupyGo() {
  const occupy = parseOccupyOwner(envLease.value.occupyOwner)
  if (occupy.kind === 'lab' && occupy.id) {
    const job = labJobs.value.find(item => item.id === occupy.id)
    if (job) openJob(job)
  }
}

async function occupyStop() {
  const occupy = parseOccupyOwner(envLease.value.occupyOwner)
  if (!occupy.kind || !occupy.id) return
  await invokeCommand('stop_env_lease', { ownerKind: occupy.kind, ownerId: occupy.id }).catch(() => undefined)
  await startEnv(selected.value?.packageId || envLease.value.packageId)
}

onMounted(() => {
  void refreshAllLeases()
  leaseTimer = setInterval(() => { void refreshAllLeases() }, 2000)
})
onBeforeUnmount(() => {
  if (leaseTimer) clearInterval(leaseTimer)
})

function packSummary(pkg: EnvPackage) {
  if (pkg.difficulty && pkg.purpose) return `${pkg.difficulty} · ${pkg.purpose}`
  return pkg.detail || pkg.kindLabel
}

function packCategoryIcon(category: LabPackageCategory) {
  if (category === 'probe') return Radio
  if (category === 'web') return Globe
  if (category === 'linux') return SquareTerminal
  if (category === 'android') return Smartphone
  if (category === 'cve') return ShieldAlert
  return Box
}

function packIntro(pkg: EnvPackage) {
  return pkg.brief || pkg.detail
}

function packSubtitle(pkg: EnvPackage) {
  if (pkg.difficulty) return `${pkg.kindLabel} · ${pkg.difficulty}`
  return pkg.kindLabel
}

function packHostLine(pkg: EnvPackage) {
  if (pkg.provider === 'android-avd') {
    return pkg.id === 'android-lab'
      ? t('模拟器 MilkSU-Lab · 已预装 InjuredAndroid', 'Emulator MilkSU-Lab · InjuredAndroid preinstalled')
      : t('模拟器 MilkSU-Lab · 空白设备', 'Emulator MilkSU-Lab · blank device')
  }
  if (pkg.address) {
    return `${pkg.surface === 'shell' ? t('终端', 'Terminal') : t('浏览器', 'Browser')} · ${pkg.address}`
  }
  return pkg.detail
}

function jobForPackage(packageId: string) {
  return labJobs.value
    .filter(job => job.packageId === packageId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

function openNew() {
  catalogActions.value?.closeHistoryMenu()
  showNew.value = true
  draftScope.value = 'local'
  draftRequest.value = ''
}

function resumeFromHistory(job: LabJob) {
  catalogActions.value?.closeHistoryMenu()
  openJob(job)
}

function openPack(pkg: EnvPackage) {
  showNew.value = false
  labTab.value = 'packages'
  selectedPackId.value = pkg.id
}

function closePack() {
  selectedPackId.value = ''
}

async function startPackage(pkg: EnvPackage, challenge?: EnvChallenge) {
  showNew.value = false
  const focused = challenge || ((pkg.challenges?.length || 0) === 1 ? pkg.challenges?.[0] : undefined)
  const existing = jobForPackage(pkg.id)
  if (existing) {
    if (focused) focusChallenge(existing.id, focused.id, focused.guidance)
    selectedPackId.value = ''
    selectedId.value = existing.id
    emit('enter', existing)
    pendingOpen.value = true
    await nextTick()
    await startEnv(pkg.id)
    return
  }
  const job = createJob({
    scope: 'local',
    request: focused?.guidance || packIntro(pkg),
    title: pkg.name,
    packageId: pkg.id,
    challengeId: focused?.id,
  })
  selectedPackId.value = ''
  emit('enter', job)
  pendingOpen.value = true
  await nextTick()
  await startEnv(pkg.id)
}

function selectChallenge(challenge: EnvChallenge) {
  if (!selected.value) return
  focusChallenge(selected.value.id, challenge.id, challenge.guidance)
}

function openDocker() {
  void invokeCommand('open_docker_desktop').catch(() => undefined)
}

function openTarget() {
  if (envLease.value.state !== 'ready') return
  targetOpen.value = true
  const conversationId = props.conversation?.id || props.ensureConversation?.(selected.value?.title)
  if (conversationId && envLease.value.surface === 'browser' && envLease.value.address) {
    void invokeCommand('start_coding_browser', {
      conversationId,
      initialUrl: `http://${envLease.value.address}`,
    }).catch(() => undefined)
  }
}

watch(() => envLease.value.state, state => {
  if (state === 'ready' && pendingOpen.value) {
    pendingOpen.value = false
    openTarget()
  }
})

function submitNew() {
  const request = draftRequest.value.trim()
  if (!request) return
  const job = createJob({
    scope: draftScope.value,
    request,
  })
  showNew.value = false
  emit('run', job)
}

function openJob(job: LabJob) {
  selectedId.value = job.id
  emit('enter', job)
}

function back() {
  const packId = selected.value?.packageId
  selectedId.value = ''
  if (packId) {
    labTab.value = 'packages'
    selectedPackId.value = packId
    return
  }
  labTab.value = 'jobs'
}

function openCoding() {
  const job = selected.value
  if (!job) return
  props.ensureConversation?.(job.title, {
    conversationId: `lab-job-${job.id}`,
    domainTaskContext: {
      kind: 'lab',
      jobId: job.id,
      title: job.title,
      scope: job.scope,
      request: job.request,
    },
  })
  emit('expand')
}

function setRenameInput(element: unknown) {
  const node = (element as { $el?: unknown } | null)?.$el ?? element
  if (node instanceof HTMLInputElement) renameInput.value = node
  else renameInput.value = (node as HTMLElement | null)?.querySelector?.('input') ?? null
}

function startRename(job: LabJob) {
  editingJobId.value = job.id
  editingTitle.value = job.title
  void nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function finishRename(job: LabJob) {
  if (editingJobId.value !== job.id) return
  const title = editingTitle.value.trim().slice(0, 40)
  editingJobId.value = null
  if (!title || title === job.title) return
  rename(job.id, title)
  emit('rename', job.id, title)
}

function cancelRename() {
  editingJobId.value = null
}

function submitRename(event: KeyboardEvent, job: LabJob) {
  if (isComposingKey(event)) return
  event.preventDefault()
  finishRename(job)
}

function abortRename(event: KeyboardEvent) {
  if (isComposingKey(event)) return
  event.preventDefault()
  cancelRename()
}
</script>

<template>
  <main class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <template v-if="!selected">
      <WorkspaceModuleTopBar
        module="lab"
        :title="selectedPack ? selectedPack.name : t('实验室', 'Lab')"
        :subtitle="selectedPack ? packSubtitle(selectedPack) : ''"
      >
        <template v-if="selectedPack" #leading>
          <Button variant="ghost" size="icon-sm" :aria-label="t('返回题目包', 'Back to packages')" @click="closePack">
            <ArrowLeft class="size-4" />
          </Button>
        </template>
        <template v-if="!selectedPack" #actions>
          <WorkspaceCatalogActions
            ref="catalogActions"
            :history-count="historyJobs.length"
            :history-aria-label="t('打开任务历史', 'Open job history')"
            :history-menu-label="t('任务历史', 'Job history')"
            action="create"
            :action-aria-label="t('创建自定义任务', 'Create a custom job')"
            @action="openNew"
          >
            <template #history>
              <WorkspaceCatalogHistoryItem
                v-for="job in historyJobs"
                :key="job.id"
                :title="job.title"
                :subtitle="job.packageId ? t('题目包', 'Package') : labScopeLabel(job.scope)"
                :time="job.updatedAt"
                :current="selectedId === job.id"
                @select="resumeFromHistory(job)"
              />
            </template>
          </WorkspaceCatalogActions>
        </template>
        <template v-if="!selectedPack" #filters>
          <div class="collection-tabs flex min-w-0 items-center gap-2" role="tablist" :aria-label="t('实验室分段', 'Lab sections')">
            <div class="ak-segmented">
              <button
                v-for="item in labTabItems"
                :key="item.value"
                type="button"
                class="ak-segmented__item"
                role="tab"
                :aria-pressed="labTab === item.value"
                :aria-selected="labTab === item.value"
                @click="labTab = item.value"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </template>
      </WorkspaceModuleTopBar>

      <section v-if="labTab === 'packages' && selectedPack" class="page-scroll flex-1 bg-background" :aria-label="t('靶机', 'Target')">
        <div class="page-column page-stack">
          <SettingsSection :title="t('简介', 'Overview')" data-testid="lab-pack-intro">
            <SettingsRow v-if="selectedPack.source" :label="t('来源', 'Source')" :description="selectedPack.source" />
            <SettingsRow v-if="selectedPack.purpose" :label="t('用途', 'Purpose')" :description="selectedPack.purpose" />
            <SettingsRow v-if="selectedPack.difficulty" :label="t('难度', 'Difficulty')" :description="selectedPack.difficulty" />
            <SettingsRow stack="always" :label="t('说明', 'Notes')" :description="packIntro(selectedPack)" :divider="false" />
          </SettingsSection>
          <SettingsSection :title="t('靶机', 'Target')" data-testid="lab-machine-card">
            <SettingsRow :label="selectedPack.name" :description="packHostLine(selectedPack)" :divider="false">
              <template #leading>
                <Smartphone v-if="selectedPack.provider === 'android-avd'" class="size-4" />
                <Box v-else class="size-4" />
              </template>
              <Button size="sm" variant="brand" @click="startPackage(selectedPack)">{{ t('启动', 'Start') }}</Button>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection v-if="(selectedPack.challenges?.length || 0) > 1" :title="t('题目', 'Challenges')">
            <div
              v-for="(challenge, index) in selectedPack.challenges"
              :key="challenge.id"
              class="contents"
              data-testid="lab-flag-row"
            >
              <ModelListRow
                :label="challenge.title"
                :meta="`${challenge.kind} · ${challenge.guidance}`"
                :last="index === (selectedPack.challenges?.length || 0) - 1"
                @click="startPackage(selectedPack, challenge)"
              >
                <template #trailing>
                  <ChevronRight class="size-4 text-muted-foreground" />
                </template>
              </ModelListRow>
            </div>
          </SettingsSection>
        </div>
      </section>

      <section v-else-if="labTab === 'packages'" class="page-scroll flex-1 bg-background" :aria-label="t('题目包', 'Packages')">
        <div class="page-column page-stack">
          <section
            v-for="group in packageGroups"
            :key="group.category"
            data-testid="lab-pack-group"
            :aria-label="group.label"
          >
            <h2 class="mb-3 flex items-baseline gap-2 text-label font-medium text-muted-foreground">
              <span>{{ group.label }}</span>
              <span class="font-mono text-caption">{{ group.packages.length }}</span>
            </h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <ActionCard
                v-for="item in group.packages"
                :key="item.id"
                data-testid="lab-pack-card"
                :title="item.name"
                :description="packSummary(item)"
                @click="openPack(item)"
              >
                <template #icon>
                  <component :is="packCategoryIcon(group.category)" />
                </template>
              </ActionCard>
            </div>
          </section>
        </div>
      </section>

      <section v-else class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" :aria-label="t('自定义任务', 'Custom jobs')">
        <div v-if="!customJobs.length" class="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <p class="text-body text-muted-foreground">{{ t('还没有自定义任务。', 'No custom jobs.') }}</p>
          <Button size="sm" variant="brand" @click="labTab = 'packages'">{{ t('看题目包', 'Browse packages') }}</Button>
        </div>
        <div v-else class="min-w-[720px]">
          <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(200px,1fr)_80px_56px_120px_40px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
            <span>{{ t('任务', 'Job') }}</span><span>{{ t('范围', 'Scope') }}</span><span>{{ t('环境', 'Environment') }}</span><span>{{ t('最近', 'Recent') }}</span><span class="sr-only">{{ t('操作', 'Actions') }}</span><span class="sr-only">{{ t('打开', 'Open') }}</span>
          </div>
          <article
            v-for="job in customJobs"
            :key="job.id"
            class="tactical-row grid min-h-[72px] w-full grid-cols-[minmax(200px,1fr)_80px_56px_120px_40px_72px] items-center gap-4 px-6 text-left"
            data-testid="catalog-row"
          >
            <Input
              v-if="editingJobId === job.id"
              :ref="setRenameInput"
              v-model="editingTitle"
              size="sm"
              class="h-8 min-w-0"
              :aria-label="t('编辑任务标题', 'Edit job title')"
              maxlength="40"
              @keydown.enter="submitRename($event, job)"
              @keydown.escape="abortRename($event)"
              @blur="finishRename(job)"
            />
            <span
              v-else
              class="truncate text-control font-medium select-text"
              data-testid="lab-job-title"
              @dblclick.stop="startRename(job)"
            >{{ job.title }}</span>
            <span class="text-body">{{ labScopeLabel(job.scope) }}</span>
            <span
              class="inline-block size-2 rounded-full"
              :class="jobEnvDot(job).className"
              :title="jobEnvDot(job).title"
              data-testid="lab-env-dot"
            />
            <span class="text-caption text-muted-foreground">{{ new Date(job.updatedAt).toLocaleDateString() }}</span>
            <DropdownMenu v-if="editingJobId !== job.id">
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('任务操作', 'Job actions')"
                  @click.stop
                >
                  <MoreVertical class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="4" class="w-40">
                <DropdownMenuItem :aria-label="t('重命名任务', 'Rename job')" @select="startRename(job)">
                  <Pencil class="size-4" />{{ t('重命名', 'Rename') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-else class="size-8" aria-hidden="true" />
            <Button size="sm" variant="outline" data-testid="open-item" @click="openJob(job)">{{ t('打开', 'Open') }}</Button>
          </article>
        </div>
      </section>
      <footer class="flex h-14 shrink-0 items-center border-t border-border px-6">
        <span v-if="labTab === 'packages' && selectedPack" class="text-caption text-muted-foreground">
          {{ t('1 台靶机', '1 target') }}<span v-if="(selectedPack.challenges?.length || 0) > 1"> · {{ t(`${selectedPack.challenges?.length} 题`, `${selectedPack.challenges?.length} challenges`) }}</span>
        </span>
        <span v-else-if="labTab === 'packages'" class="text-caption text-muted-foreground">
          {{ t(`${envPackages.length} 个题目包`, `${envPackages.length} packages`) }}
        </span>
        <span v-else class="text-caption text-muted-foreground">{{ t(`共 ${customJobs.length} 条`, `${customJobs.length} items`) }}</span>
      </footer>
    </template>

    <template v-else>
      <WorkspaceModuleTopBar module="lab" :title="selected.title" :subtitle="labScopeLabel(selected.scope)">
        <template #leading>
          <Button variant="ghost" size="icon-sm" :aria-label="t('返回实验室', 'Back to Lab')" @click="back">
            <ArrowLeft class="size-4" />
          </Button>
        </template>
        <template #actions>
          <Button variant="outline" size="sm" @click="openCoding">{{ t('进入 Coding', 'Open in Coding') }}</Button>
        </template>
      </WorkspaceModuleTopBar>
      <div class="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
        <div
          class="flex min-h-0 min-w-0 flex-col"
          :class="liveTargetVisible ? '' : 'flex-1'"
          :style="liveTargetVisible ? { width: `${briefWidth}px`, flex: 'none' } : undefined"
        >
          <div class="page-scroll flex-1">
          <div class="page-stack" :class="liveTargetVisible ? 'page-stack--flush' : 'page-column'">
            <SettingsSection :title="t('题面', 'Brief')">
              <SettingsRow v-if="boundPackage?.source" :label="t('来源', 'Source')" :description="boundPackage.source" />
              <SettingsRow v-if="boundPackage?.purpose" :label="t('用途', 'Purpose')" :description="boundPackage.purpose" />
              <SettingsRow v-if="boundPackage?.difficulty" :label="t('难度', 'Difficulty')" :description="boundPackage.difficulty" />
              <SettingsRow
                v-if="boundPackage"
                stack="always"
                :label="t('说明', 'Notes')"
                :description="packIntro(boundPackage)"
              />
              <template v-if="(boundPackage?.challenges?.length || 0) > 1">
                <div
                  v-for="(challenge, index) in boundPackage?.challenges"
                  :key="challenge.id"
                  class="contents"
                  data-testid="lab-flag-row"
                >
                  <ModelListRow
                    :label="challenge.title"
                    :meta="`${challenge.kind} · ${challenge.guidance}`"
                    :last="index === (boundPackage?.challenges?.length || 0) - 1"
                    @click="selectChallenge(challenge)"
                  >
                    <template #trailing>
                      <ChevronRight class="size-4 text-muted-foreground" />
                    </template>
                  </ModelListRow>
                </div>
              </template>
              <SettingsRow
                stack="always"
                :label="t('当前', 'Current')"
                :description="boundChallenge?.guidance || selected.request"
                :divider="false"
                data-testid="lab-challenges"
              />
            </SettingsSection>
            <EnvironmentStrip
              :lease="stripLease"
              @start="startEnv(selected.packageId || envLease.packageId)"
              @stop="stopEnv"
              @reset="resetEnv"
              @open-target="openTarget"
              @retry="startEnv(selected.packageId || envLease.packageId)"
              @open-docker="openDocker"
              @occupy-go="occupyGo"
              @occupy-stop="occupyStop"
              @open-lab-settings="$emit('openLabSettings')"
            />
            <SettingsSection :title="t('报告', 'Report')">
              <ResearchReportPanel
                class="px-4 py-3 text-body leading-6"
                :workspace-path="workspacePath || conversation?.workspacePath || ''"
                :refresh-key="running ? 'run' : conversation?.messages.length"
              />
            </SettingsSection>
          </div>
          </div>
        </div>
        <div v-if="liveTargetVisible" class="relative flex min-h-0 min-w-0 flex-1">
          <div
            class="dossier-split-handle app-no-drag"
            role="separator"
            aria-orientation="vertical"
            data-testid="dossier-split"
            :aria-label="t('调节题面宽度', 'Resize the brief pane')"
            @pointerdown="startBriefResize"
          />
          <TargetLivePane
            :lease="envLease"
            :conversation-id="conversation?.id"
          />
        </div>
      </div>
      <ConversationDock
        :conversation="conversation ?? null"
        :conversations="dossierConversations"
        :running="running"
        :aborting="aborting"
        :settings="settings"
        :workspace-path="workspacePath"
        :message-queue="messageQueue"
        :session-ready="sessionReady"
        :resumed="resumed"
        :compacting="compacting"
        :compacted-at="compactedAt"
        :compaction-error="compactionError"
        :turn-status="turnStatus"
        :ctf-session="ctfSession"
        :vulnerability-session="vulnerabilitySession"
        :ctf-mode="ctfMode"
        :ctf-role="ctfRole"
        :model-mode="modelMode"
        :model-provider="modelProvider"
        :model-id="modelId"
        :model-source-preference="modelSourcePreference"
        :execution-mode="executionMode"
        :approval-policy="approvalPolicy"
        :mcp-servers="mcpServers"
        :mcp-config-digest="mcpConfigDigest"
        :ensure-conversation="ensureConversation"
        :pending-composer-draft="pendingComposerDraft"
        @send="(...args) => $emit('send', ...args)"
        @abort="$emit('abort')"
        @select="$emit('selectConversation', $event)"
        @create="$emit('createConversation')"
        @expand="$emit('expand')"
        @consume-pending-draft="$emit('consumePendingDraft')"
        @compact-context="$emit('compactContext')"
        @control-goal="$emit('controlGoal', $event)"
        @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
        @change-model="(mode, provider, model) => $emit('changeModel', mode, provider, model)"
        @change-model-source="$emit('changeModelSource', $event)"
        @change-coding-policy="(mode, policy) => $emit('changeCodingPolicy', mode, policy)"
        @change-mcp-servers="(servers, digest) => $emit('changeMcpServers', servers, digest)"
        @choose-workspace="$emit('chooseWorkspace')"
        @choose-workspace-for-new-task="$emit('chooseWorkspaceForNewTask')"
        @select-workspace="$emit('selectWorkspace', $event)"
        @forget-workspace="$emit('forgetWorkspace', $event)"
        @clear-workspace="$emit('clearWorkspace')"
        @cancel-queued-guidance="$emit('cancelQueuedGuidance', $event)"
        @edit-queued-guidance="$emit('editQueuedGuidance', $event)"
        @open-settings="$emit('openSettings')"
      />
    </template>

    <WorkspaceImportDialog
      v-model:open="showNew"
      :title="t('创建', 'Create')"
      :description="t('范围和要求', 'Scope and request')"
    >
      <SettingsSection :title="t('自定义任务', 'Custom job')">
        <form class="grid gap-4 px-4 py-4" @submit.prevent="submitNew">
          <div>
            <p class="mb-2 text-caption text-muted-foreground">{{ t('范围', 'Scope') }}</p>
            <SegmentedControl
              v-model="draftScope"
              :aria-label="t('范围', 'Scope')"
              :items="scopeItems"
            />
          </div>
          <label class="text-caption text-muted-foreground">{{ t('要求', 'Request') }}
            <textarea
              v-model="draftRequest"
              class="mt-1 min-h-32 w-full resize-y rounded-md border border-border px-3 py-2 text-body outline-none"
              :aria-label="t('要求', 'Request')"
            />
          </label>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" @click="showNew = false">{{ t('取消', 'Cancel') }}</Button>
            <Button type="submit" variant="brand" :disabled="!draftRequest.trim()">{{ t('开始', 'Start') }}</Button>
          </div>
        </form>
      </SettingsSection>
    </WorkspaceImportDialog>
  </main>
</template>

<style scoped>
.dossier-split-handle {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
  border: 0;
  padding: 0;
  background: transparent;
}
.dossier-split-handle::after {
  position: absolute;
  inset: 0 3px;
  background: transparent;
  content: '';
}
.dossier-split-handle:hover::after,
.dossier-split-handle:focus-visible::after {
  background: var(--brand);
  opacity: .55;
}
</style>
