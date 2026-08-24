<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  SegmentedControl,
} from '@felinic/ui'
import { ArrowLeft, MoreVertical, Pencil, Plus } from 'lucide-vue-next'
import { isComposingKey } from '@/lib/imeComposition'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import ResearchReportPanel from '@/components-vue/ResearchReportPanel.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { invokeCommand } from '@/desktop'
import { labScopeLabel, useLabJobs, type LabJob, type LabScope } from '@/composables/useLabJobs'
import { toStripLease, useEnvLease } from '@/composables/useEnvLease'
import type { EnvPackage } from '@/envbroker'
import EnvironmentStrip from '@/components-vue/lab-env/EnvironmentStrip.vue'
import TargetLivePane from '@/components-vue/lab-env/TargetLivePane.vue'
import { relatedDomainConversations } from '@/lib/workspaceSessionRouting'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
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
  ensureConversation?: (title?: string) => string
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
}>()

const {
  jobs: labJobs,
  selectedId,
  selected,
  createJob,
  rename,
} = useLabJobs()
const showNew = ref(false)
const draftScope = ref<LabScope>('local')
const draftRequest = ref('')
const labTab = ref<'jobs' | 'packages'>('jobs')
const newSource = ref<'package' | 'local' | 'remote'>('local')
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
} = useEnvLease(ownerKind, ownerId, packageId)
const editingJobId = ref<string | null>(null)
const editingTitle = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const scopeItems = [
  { value: 'local' as const, label: '本地' },
  { value: 'remote' as const, label: '远程' },
]
const labTabItems = [
  { value: 'jobs' as const, label: '作业' },
  { value: 'packages' as const, label: '练习包' },
]
const sourceItems = [
  { value: 'package' as const, label: '练习包' },
  { value: 'local' as const, label: '本机地址' },
  { value: 'remote' as const, label: '远程' },
]
const dossierConversations = computed(() => relatedDomainConversations(
  props.conversations ?? [],
  props.conversation ?? null,
))
const pendingOpen = ref(false)
const boundPackage = computed(() => (
  envPackages.value.find(item => item.id === selected.value?.packageId) ?? null
))
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
    detail: '用户自带靶。没有经纪生命周期。',
  })
})

watch(selectedId, (id) => {
  if (!id) {
    targetOpen.value = false
    pendingOpen.value = false
  }
})

function openNew() {
  showNew.value = true
  newSource.value = 'local'
  draftScope.value = 'local'
  draftRequest.value = ''
}

async function startPackage(pkg: EnvPackage) {
  showNew.value = false
  labTab.value = 'jobs'
  const job = createJob({
    scope: 'local',
    request: pkg.brief || (pkg.challenges?.length ? pkg.challenges.map((item, index) => `${index + 1}. ${item}`).join('\n') : pkg.detail),
    title: pkg.name,
    packageId: pkg.id,
  })
  emit('enter', job)
  pendingOpen.value = true
  await nextTick()
  await startEnv(pkg.id)
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
  if (newSource.value === 'package') return
  const request = draftRequest.value.trim()
  if (!request) return
  const job = createJob({
    scope: newSource.value === 'remote' ? 'remote' : draftScope.value,
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
  selectedId.value = ''
}

function startJob() {
  if (!selected.value) return
  emit('run', selected.value)
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
      <WorkspaceModuleTopBar module="lab" title="实验室">
        <template #actions>
          <SegmentedControl v-model="labTab" aria-label="实验室分段" :items="labTabItems" />
          <Button variant="brand" size="sm" @click="openNew">
            <Plus class="size-4" />
            新作业
          </Button>
        </template>
      </WorkspaceModuleTopBar>

      <section v-if="labTab === 'packages'" class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="练习包">
        <div class="min-w-[720px]">
          <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(220px,1fr)_88px_minmax(160px,1fr)_88px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
            <span>练习包</span><span>类型</span><span>说明</span><span>操作</span>
          </div>
          <article
            v-for="item in envPackages"
            :key="item.id"
            class="tactical-row grid min-h-[72px] grid-cols-[minmax(220px,1fr)_88px_minmax(160px,1fr)_88px] items-center gap-4 px-6"
          >
            <span class="truncate text-control font-medium">{{ item.name }}</span>
            <span class="text-body">{{ item.kindLabel }}</span>
            <span class="truncate text-caption text-muted-foreground">{{ item.challenges?.length ? `${item.detail} · ${item.challenges.length} 题` : item.detail }}</span>
            <Button size="sm" variant="outline" @click="startPackage(item)">启动</Button>
          </article>
        </div>
      </section>

      <section v-else class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="实验室列表">
        <div class="min-w-[720px]">
          <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(200px,1fr)_80px_56px_120px_40px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
            <span>作业</span><span>范围</span><span>环境</span><span>最近</span><span class="sr-only">操作</span><span class="sr-only">打开</span>
          </div>
          <article
            v-for="job in labJobs"
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
              aria-label="编辑作业标题"
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
              :class="job.packageId ? 'bg-primary' : 'bg-muted-foreground/40'"
              :title="job.packageId ? '已绑定练习包' : '未绑定'"
              data-testid="lab-env-dot"
            />
            <span class="text-caption text-muted-foreground">{{ new Date(job.updatedAt).toLocaleDateString() }}</span>
            <DropdownMenu v-if="editingJobId !== job.id">
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="作业操作"
                  @click.stop
                >
                  <MoreVertical class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="4" class="w-40">
                <DropdownMenuItem aria-label="重命名作业" @select="startRename(job)">
                  <Pencil class="size-4" />重命名
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-else class="size-8" aria-hidden="true" />
            <Button size="sm" variant="outline" data-testid="open-item" @click="openJob(job)">打开</Button>
          </article>
        </div>
      </section>
      <footer class="flex h-14 shrink-0 items-center border-t border-border px-6">
        <span class="text-caption text-muted-foreground">共 {{ labJobs.length }} 条</span>
      </footer>
    </template>

    <template v-else>
      <WorkspaceModuleTopBar module="lab" :title="selected.title" :subtitle="labScopeLabel(selected.scope)">
        <template #leading>
          <Button variant="ghost" size="icon-sm" aria-label="返回实验室" @click="back">
            <ArrowLeft class="size-4" />
          </Button>
        </template>
        <template #actions>
          <Button variant="brand" size="sm" @click="startJob">开始</Button>
        </template>
      </WorkspaceModuleTopBar>
      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col" :class="targetOpen ? 'max-w-md border-r border-border' : ''">
          <div class="min-h-0 flex-1 overflow-auto">
          <div class="space-y-5 px-6 py-6" :class="targetOpen ? '' : 'mx-auto max-w-5xl'">
            <section class="rounded-xl border border-border bg-card p-6">
              <h2 class="text-label font-medium">作业</h2>
              <p class="mt-3 text-caption text-muted-foreground">{{ labScopeLabel(selected.scope) }}</p>
              <p class="mt-3 whitespace-pre-wrap text-body leading-6">{{ selected.request }}</p>
              <ul v-if="boundPackage?.challenges?.length" class="mt-4 grid gap-1 text-body" data-testid="lab-challenges">
                <li v-for="item in boundPackage.challenges" :key="item">{{ item }}</li>
              </ul>
            </section>
            <EnvironmentStrip
              :lease="stripLease"
              @start="startEnv(selected.packageId || envLease.packageId)"
              @stop="stopEnv"
              @reset="resetEnv"
              @open-target="openTarget"
              @retry="startEnv(selected.packageId || envLease.packageId)"
              @open-docker="openDocker"
            />
            <section class="rounded-xl border border-border bg-card p-6">
              <h2 class="text-label font-medium">报告</h2>
              <ResearchReportPanel
                class="mt-4"
                :workspace-path="workspacePath || conversation?.workspacePath || ''"
                :refresh-key="running ? 'run' : conversation?.messages.length"
              />
            </section>
          </div>
          </div>
          <ConversationDock
            v-if="targetOpen"
            placement="column"
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
        </div>
        <TargetLivePane
          v-if="targetOpen && envLease.state === 'ready'"
          :lease="envLease"
          :conversation-id="conversation?.id"
        />
      </div>
      <ConversationDock
        v-if="!targetOpen"
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

    <Dialog v-model:open="showNew">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新作业</DialogTitle>
          <DialogDescription class="sr-only">范围和要求</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitNew">
          <div>
            <p class="mb-2 text-caption text-muted-foreground">来源</p>
            <SegmentedControl v-model="newSource" aria-label="来源" :items="sourceItems" />
          </div>
          <div v-if="newSource === 'package'" class="grid gap-2">
            <button
              v-for="item in envPackages"
              :key="item.id"
              type="button"
              class="rounded-md border border-border px-3 py-3 text-left"
              @click="startPackage(item)"
            >
              <span class="text-control font-medium">{{ item.name }}</span>
              <span class="mt-1 block text-caption text-muted-foreground">{{ item.detail }}</span>
            </button>
          </div>
          <div v-if="newSource !== 'package'">
            <p class="mb-2 text-caption text-muted-foreground">范围</p>
            <SegmentedControl
              v-model="draftScope"
              aria-label="范围"
              :items="scopeItems"
            />
          </div>
          <label v-if="newSource !== 'package'" class="text-caption text-muted-foreground">要求
            <textarea
              v-model="draftRequest"
              class="mt-1 min-h-32 w-full resize-y rounded-md border border-border px-3 py-2 text-body outline-none"
              aria-label="要求"
            />
          </label>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" @click="showNew = false">取消</Button>
            <Button type="submit" variant="brand" :disabled="!draftRequest.trim()">开始</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </main>
</template>
