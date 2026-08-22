<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
} from '@felinic/ui'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import ResearchReportPanel from '@/components-vue/ResearchReportPanel.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { labScopeLabel, useLabJobs, type LabJob, type LabScope } from '@/composables/useLabJobs'
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
} = useLabJobs()
const showNew = ref(false)
const draftScope = ref<LabScope>('local')
const draftRequest = ref('')
const scopeItems = [
  { value: 'local' as const, label: '本地' },
  { value: 'remote' as const, label: '远程' },
]
const dossierConversations = computed(() => relatedDomainConversations(
  props.conversations ?? [],
  props.conversation ?? null,
))

function openNew() {
  showNew.value = true
  draftScope.value = 'local'
  draftRequest.value = ''
}

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
  selectedId.value = ''
}

function startJob() {
  if (!selected.value) return
  emit('run', selected.value)
}
</script>

<template>
  <main class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <template v-if="!selected">
      <WorkspaceModuleTopBar module="lab" title="实验室">
        <template #actions>
          <Button variant="brand" size="sm" @click="openNew">
            <Plus class="size-4" />
            新作业
          </Button>
        </template>
      </WorkspaceModuleTopBar>

      <section class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="实验室列表">
        <div class="min-w-[720px]">
          <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(220px,1fr)_80px_120px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
            <span>作业</span><span>范围</span><span>最近</span><span class="sr-only">打开</span>
          </div>
          <article
            v-for="job in labJobs"
            :key="job.id"
            class="tactical-row grid min-h-[72px] w-full grid-cols-[minmax(220px,1fr)_80px_120px_72px] items-center gap-4 px-6 text-left"
            data-testid="catalog-row"
          >
            <span class="truncate text-control font-medium select-text">{{ job.title }}</span>
            <span class="text-body">{{ labScopeLabel(job.scope) }}</span>
            <span class="text-caption text-muted-foreground">{{ new Date(job.updatedAt).toLocaleDateString() }}</span>
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
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto max-w-5xl space-y-5 px-6 py-6">
          <section class="rounded-xl border border-border bg-card p-6">
            <h2 class="text-label font-medium">作业</h2>
            <p class="mt-3 text-caption text-muted-foreground">{{ labScopeLabel(selected.scope) }}</p>
            <p class="mt-3 whitespace-pre-wrap text-body leading-6">{{ selected.request }}</p>
          </section>
          <section class="rounded-xl border border-border bg-card p-6">
            <h2 class="text-label font-medium">报告</h2>
            <ResearchReportPanel
              class="mt-4"
              :workspace-path="conversation?.workspacePath ?? ''"
              :refresh-key="running ? 'run' : conversation?.messages.length"
            />
          </section>
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

    <Dialog v-model:open="showNew">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新作业</DialogTitle>
          <DialogDescription class="sr-only">范围和要求</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitNew">
          <div>
            <p class="mb-2 text-caption text-muted-foreground">范围</p>
            <SegmentedControl
              v-model="draftScope"
              aria-label="范围"
              :items="scopeItems"
            />
          </div>
          <label class="text-caption text-muted-foreground">要求
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
