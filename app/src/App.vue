<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import AppSidebar from '@/components-vue/AppSidebar.vue'
import StartupRecoveryBanner from '@/components-vue/StartupRecoveryBanner.vue'
import { useConversations } from '@/composables/useConversations'
import { useNSSCTFTraining } from '@/composables/useNSSCTFTraining'
import { invokeCommand } from '@/desktop'
import type { CTFAgentWorkspaceHandoff } from '@/ctfTypes'
import type { VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import type { CTFWorkspaceSection } from '@/lib/workspaceNavigation'
import { withAppSettingsDefaults, type AppSettings, type CTFChatAction, type StartupRecoveryStatus } from '@/types'

const ChatPage = defineAsyncComponent(() => import('@/components-vue/ChatPage.vue'))
const CTFPage = defineAsyncComponent(() => import('@/components-vue/CTFPage.vue'))
const SettingsPage = defineAsyncComponent(() => import('@/components-vue/SettingsPage.vue'))
const VulnPage = defineAsyncComponent(() => import('@/components-vue/VulnPage.vue'))

type Section = 'chat' | 'ctf' | 'vuln' | 'settings'

const conversations = useConversations()
const ctfTraining = useNSSCTFTraining()
const section = ref<Section>('ctf')
const ctfSection = ref<CTFWorkspaceSection>('catalog')
const ctfResumeJobId = ref<string | null>(null)
const settingsCategory = ref<'general' | 'apikeys'>('general')
const settings = ref<AppSettings | null>(null)
const recoveryStatus = ref<StartupRecoveryStatus | null>(null)
const recoveryDismissed = ref(false)

const defaultTaskModel = computed(() => {
  if (!settings.value) return null
  if (settings.value.model_routing.default_mode === 'manual') {
    return {
      provider: settings.value.active_provider,
      model: settings.value.active_model,
    }
  }
  const preferred = settings.value.model_routing.fast
  const configured = settings.value.providers[preferred.provider]
  if (settings.value.relay?.enabled && settings.value.relay.has_key) return preferred
  if (configured?.enabled && configured.has_api_key) return preferred
  return {
    provider: settings.value.active_provider,
    model: settings.value.active_model,
  }
})
const activeProvider = computed(() => (
  defaultTaskModel.value ? settings.value?.providers[defaultTaskModel.value.provider] : undefined
))
const modelReady = computed(() => Boolean(
  settings.value?.relay?.enabled
    ? settings.value.relay.has_key
    : activeProvider.value?.enabled && activeProvider.value.has_api_key,
))
const modelVerified = computed(() => Boolean(
  settings.value?.model_verification
  && settings.value.model_verification.provider === defaultTaskModel.value?.provider
  && settings.value.model_verification.model === defaultTaskModel.value?.model,
))
const arenaReady = computed(() => Boolean(settings.value?.nssctf_arena?.has_token))
const activeCTFConversation = computed(() => (
  Boolean(conversations.active.value?.ctfJobId)
))
const sidebarSection = computed(() => (
  section.value === 'chat' && activeCTFConversation.value ? 'ctf' : section.value
))

async function loadSettings() {
  const value = await invokeCommand<AppSettings>('get_settings')
  settings.value = withAppSettingsDefaults(value)
}

function openSettings(category: 'general' | 'apikeys' = 'general') {
  settingsCategory.value = category
  section.value = 'settings'
}

function openRecovery() {
  recoveryDismissed.value = true
  openSettings('general')
}

function newConversation() {
  conversations.startNew()
  section.value = 'chat'
}

function navigateSection(value: Section) {
  if (value === 'ctf') {
    ctfResumeJobId.value = conversations.active.value?.ctfJobId ?? null
  }
  if (value === 'chat' && activeCTFConversation.value) {
    conversations.startNew()
  }
  section.value = value
}

function returnToCTFWorkspace() {
  ctfResumeJobId.value = conversations.active.value?.ctfJobId ?? null
  section.value = 'ctf'
}

async function chooseAgentWorkspace() {
  const workspacePath = await invokeCommand<string>('choose_agent_workspace')
  if (workspacePath) conversations.setWorkspace(workspacePath)
}

async function abortConversation() {
  const conversationId = conversations.activeId.value
  if (conversationId) await conversations.abort(conversationId)
}

async function startCTFAgent(handoff: CTFAgentWorkspaceHandoff) {
  section.value = 'chat'
  await conversations.startWorkspaceTask(handoff)
}

async function startVulnerabilityCodingTask(task: VulnerabilityCodingTask) {
  const existingWorkspacePath = conversations.workspacePath.value
  conversations.startNew()
  if (existingWorkspacePath) conversations.setWorkspace(existingWorkspacePath)
  conversations.ensureConversation(task.title)
  section.value = 'chat'
  await conversations.send(task.prompt, task.visibleText)
}

async function switchCTFAgent(role: 'solver' | 'tool-builder' | 'strategist') {
  const conversation = conversations.active.value
  if (!conversation?.ctfJobId) return
  if (conversation.ctfRole === role) return
  const command = role === 'tool-builder'
    ? 'prepare_ctf_tool_builder_workspace'
    : role === 'strategist'
      ? 'prepare_ctf_strategist_workspace'
      : 'prepare_ctf_agent_workspace'
  try {
    const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>(command, {
      id: conversation.ctfJobId,
    })
    await conversations.startWorkspaceTask(handoff)
  } catch (reason) {
    console.error('Failed to switch CTF Agent role', reason)
  }
}

async function runCTFChatAction(action: CTFChatAction) {
  const conversation = conversations.active.value
  if (!conversation || !activeCTFConversation.value) return
  if (action.kind === 'hint' && action.level && conversation.ctfJobId) {
    try {
      await invokeCommand('record_ctf_learning', {
        id: conversation.ctfJobId,
        request: {
          kind: 'hint',
          level: action.level,
          concept: 'PI 分级提示',
          content: `用户主动请求 ${action.level} 级提示。`,
        },
      })
    } catch (reason) {
      console.error('Failed to record CTF hint dependency', reason)
    }
  }
  await conversations.send(action.prompt)
}

function changeModel(mode: 'auto' | 'manual', provider?: string, model?: string) {
  conversations.setModelSelection(mode, provider, model)
}

onMounted(async () => {
  await Promise.all([loadSettings(), conversations.load()])
  await conversations.listen()
  try {
    recoveryStatus.value = await invokeCommand<StartupRecoveryStatus>('get_startup_recovery_status')
  } catch {
    recoveryStatus.value = null
  }
})
</script>

<template>
  <div class="flex h-screen min-w-0 flex-col bg-surface-editor text-foreground">
    <StartupRecoveryBanner
      v-if="recoveryStatus && !recoveryDismissed"
      :status="recoveryStatus"
      @dismiss="recoveryDismissed = true"
      @open-recovery="openRecovery"
    />
    <div class="flex min-h-0 flex-1">
      <AppSidebar
        v-if="section !== 'settings'"
        :active-section="sidebarSection"
        :active-conversation-id="conversations.activeId.value"
        :conversations="conversations.conversations.value"
        :ctf-dashboard="ctfTraining.dashboard.value"
        :ctf-section="ctfSection"
        @new="newConversation"
        @navigate="navigateSection"
        @select-conversation="id => { conversations.activeId.value = id; section = 'chat' }"
        @delete-conversation="conversations.remove"
        @navigate-ctf="ctfSection = $event"
        @settings="openSettings('general')"
      />

      <SettingsPage
        v-if="section === 'settings'"
        :initial-category="settingsCategory"
        :settings="settings"
        @close="async () => { await loadSettings(); section = 'ctf' }"
        @settings-change="value => { settings = value }"
      />
      <KeepAlive include="CTFPage,VulnPage">
        <CTFPage
          v-if="section === 'ctf'"
          :model-ready="modelReady"
          :model-verified="modelVerified"
          :arena-ready="arenaReady"
          :initial-job-id="ctfResumeJobId"
          :ctf-section="ctfSection"
          @open-settings="openSettings('apikeys')"
          @start-coding-agent="startCTFAgent"
        />
        <VulnPage
          v-else-if="section === 'vuln'"
          @open-settings="openSettings('general')"
          @start-coding-task="startVulnerabilityCodingTask"
        />
      </KeepAlive>
      <ChatPage
        v-if="section === 'chat'"
        :conversation="conversations.active.value"
        :settings="settings"
        :workspace-path="conversations.workspacePath.value"
        :running="conversations.activeRunning.value"
        :aborting="conversations.activeAborting.value"
        :session-ready="conversations.activeSessionReady.value"
        :resumed="conversations.activeResumed.value"
        :compacting="conversations.activeCompacting.value"
        :compacted-at="conversations.activeCompactedAt.value"
        :compaction-error="conversations.activeCompactionError.value"
        :ctf-session="activeCTFConversation"
        :ctf-mode="conversations.active.value?.ctfMode"
        :ctf-role="conversations.active.value?.ctfRole"
        :model-mode="conversations.selectedModelMode.value"
        :model-provider="conversations.selectedModelProvider.value"
        :model-id="conversations.selectedModelId.value"
        :execution-mode="conversations.selectedExecutionMode.value"
        :approval-policy="conversations.selectedApprovalPolicy.value"
        :mcp-servers="conversations.selectedMCPServers.value"
        :mcp-config-digest="conversations.selectedMCPConfigDigest.value"
        :ensure-conversation="conversations.ensureConversation"
        @send="conversations.send"
        @ctf-action="runCTFChatAction"
        @abort="abortConversation"
        @compact-context="conversations.compactContext"
        @control-goal="conversations.controlGoal"
        @respond-approval="conversations.respondApproval"
        @choose-workspace="chooseAgentWorkspace"
        @change-model="changeModel"
        @change-coding-policy="conversations.setCodingPolicy"
        @change-mcp-servers="conversations.setMCPSelection"
        @open-settings="openSettings('apikeys')"
        @return-ctf="returnToCTFWorkspace"
        @switch-ctf-agent="switchCTFAgent"
      />
    </div>
  </div>
</template>
