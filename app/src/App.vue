<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppSidebar from '@/components-vue/AppSidebar.vue'
import StartupRecoveryBanner from '@/components-vue/StartupRecoveryBanner.vue'
import UpdateNotification from '@/components-vue/UpdateNotification.vue'
import { useConversations } from '@/composables/useConversations'
import { invokeCommand, listenEvent } from '@/desktop'
import type { CTFAgentWorkspaceHandoff } from '@/ctfTypes'
import { useVulnerabilityDashboard, type VulnerabilityCodingTask } from '@/composables/useVulnerabilityDashboard'
import {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  writeThemeMode,
  type ThemeMode,
} from '@/lib/themeMode'
import { settingsReturnSection, type CTFWorkspaceSection } from '@/lib/workspaceNavigation'
import { executeVulnerabilityCodingHandoff } from '@/lib/vulnerabilityCodingHandoff'
import { buildCTFDomainTaskContext } from '@/lib/domainTaskContext'
import {
  rememberWorkspaceConversation,
  selectCodingConversationId,
  selectCTFResumePoint,
  selectReusableDomainConversationId,
} from '@/lib/workspaceSessionRouting'
import { withAppSettingsDefaults, type AccountStatus, type AppSettings, type CTFChatAction, type StartupRecoveryStatus, type UpdateStatus } from '@/types'
import type { ModelCatalogSnapshot } from '@/types'
import { installCustomProviderSettings, installModelCatalog, loadModelCatalog } from '@/modelCatalog'
import type { SecurityToolCodingHandoff } from '@/securityToolsTypes'

const ChatPage = defineAsyncComponent(() => import('@/components-vue/ChatPage.vue'))
const AccountLoginPage = defineAsyncComponent(() => import('@/components-vue/AccountLoginPage.vue'))
const CTFPage = defineAsyncComponent(() => import('@/components-vue/CTFPage.vue'))
const ProfilePage = defineAsyncComponent(() => import('@/components-vue/ProfilePage.vue'))
const SettingsPage = defineAsyncComponent(() => import('@/components-vue/SettingsPage.vue'))
const VulnPage = defineAsyncComponent(() => import('@/components-vue/VulnPage.vue'))

type Section = 'chat' | 'ctf' | 'vuln' | 'profile' | 'settings'

const conversations = useConversations()
const vulnerabilityDashboard = useVulnerabilityDashboard()
const section = ref<Section>('ctf')
const codingConversationDrawerOpen = ref(false)
const ctfSection = ref<CTFWorkspaceSection>('catalog')
const ctfResumeJobId = ref<string | null>(null)
const vulnNavigationEpoch = ref(0)
const lastCodingConversationId = ref<string | null>(null)
const lastCTFConversationId = ref<string | null>(null)
const activeVulnerabilityCodingConversationId = ref<string | null>(null)
// CVE authorization is selected on the CVE surface. It must never inherit the
// currently active Coding or CTF conversation workspace implicitly.
const vulnerabilityCodingWorkspacePath = ref('')
const settingsReturnTarget = ref<Exclude<Section, 'settings'>>('ctf')
type SettingsCategory = 'general' | 'coding' | 'apikeys' | 'browser' | 'cve' | 'security-tools'
const settingsCategory = ref<SettingsCategory>('general')
const settings = ref<AppSettings | null>(null)
const accountStatus = ref<AccountStatus>({ configured: false, authenticated: false, state: 'unconfigured' })
const accountLoaded = ref(false)
const accountLoginBusy = ref(false)
const accountLoginError = ref('')
const localAccountModeKey = 'milksu.account.continue-local'

function readLocalAccountMode() {
  try {
    return window.localStorage?.getItem(localAccountModeKey) === '1'
  } catch {
    return false
  }
}

function writeLocalAccountMode(enabled: boolean) {
  try {
    if (enabled) window.localStorage?.setItem(localAccountModeKey, '1')
    else window.localStorage?.removeItem(localAccountModeKey)
  } catch {
    // Some embedded or test renderers intentionally expose no local storage.
  }
}

const continueWithoutAccount = ref(readLocalAccountMode())
const recoveryStatus = ref<StartupRecoveryStatus | null>(null)
const recoveryDismissed = ref(false)
const updateStatus = ref<UpdateStatus | null>(null)
const dismissedUpdateVersion = ref('')
const themeMode = ref<ThemeMode>(readThemeMode())
let unlistenAccount: (() => void) | undefined
let unlistenModelCatalog: (() => void) | undefined
let unlistenUpdate: (() => void) | undefined

applyThemeMode(themeMode.value)

const defaultTaskModel = computed(() => {
  if (!settings.value) return null
  return {
    provider: settings.value.active_provider,
    model: settings.value.active_model,
  }
})
const activeProvider = computed(() => (
  defaultTaskModel.value ? settings.value?.providers[defaultTaskModel.value.provider] : undefined
))
const accountModelReady = computed(() => Boolean(
  accountStatus.value.state === 'active'
  && settings.value?.relay?.enabled
  && settings.value.relay.has_key,
))
const personalModelReady = computed(() => Boolean(
  activeProvider.value?.enabled && activeProvider.value.has_api_key,
))
const modelReady = computed(() => accountModelReady.value || personalModelReady.value)
const modelVerified = computed(() => Boolean(
  settings.value?.model_verification
  && settings.value.model_verification.provider === defaultTaskModel.value?.provider
  && settings.value.model_verification.model === defaultTaskModel.value?.model,
))
const arenaReady = computed(() => Boolean(settings.value?.nssctf_arena?.has_token))
const showAccountGate = computed(() => (
  accountLoaded.value
  && accountStatus.value.configured
  && accountStatus.value.state !== 'active'
  && !continueWithoutAccount.value
))
const activeCTFConversation = computed(() => (
  Boolean(conversations.active.value?.ctfJobId)
))
const activeVulnerabilityCodingConversation = computed(() => (
  section.value === 'chat'
  && Boolean(conversations.activeId.value)
  && conversations.activeId.value === activeVulnerabilityCodingConversationId.value
  && !activeCTFConversation.value
))
const sidebarSection = computed(() => (
  section.value === 'chat' && activeCTFConversation.value ? 'ctf' : section.value
))

watch(section, current => {
  if (current !== 'chat') codingConversationDrawerOpen.value = false
})

async function loadSettings() {
  const value = await invokeCommand<AppSettings>('get_settings')
  applySettings(value)
}

function applySettings(value: AppSettings) {
  const normalized = withAppSettingsDefaults(value)
  settings.value = normalized
  installCustomProviderSettings(normalized.providers)
}

async function loadAccountStatus() {
  try {
    const next = await invokeCommand<AccountStatus | null>('get_account_status')
    if (next?.state) accountStatus.value = next
  } finally {
    accountLoaded.value = true
  }
}

async function startAccountLogin() {
  accountLoginBusy.value = true
  accountLoginError.value = ''
  try {
    accountStatus.value = await invokeCommand<AccountStatus>('start_account_login')
  } catch {
    accountLoginError.value = '无法打开 GitHub 登录。请检查网络或稍后再试；你仍可使用自己的 API Key。'
    accountStatus.value = {
      ...accountStatus.value,
      authenticated: false,
      state: 'unavailable',
    }
  } finally {
    accountLoginBusy.value = false
  }
}

async function logoutAccount() {
  accountLoginError.value = ''
  accountStatus.value = await invokeCommand<AccountStatus>('logout_account')
  continueWithoutAccount.value = true
  writeLocalAccountMode(true)
}

function useLocalAccountMode() {
  accountLoginError.value = ''
  continueWithoutAccount.value = true
  writeLocalAccountMode(true)
}

function openSettings(category: SettingsCategory = 'general') {
  settingsReturnTarget.value = settingsReturnSection(section.value, settingsReturnTarget.value)
  settingsCategory.value = category
  section.value = 'settings'
}

function startSecurityToolCodingSetup(handoff: SecurityToolCodingHandoff) {
  rememberActiveConversation()
  conversations.startNew()
  conversations.setCodingPolicy(handoff.executionMode, handoff.approvalPolicy)
  conversations.stageComposerDraft(handoff.prompt, handoff.visibleText)
  lastCodingConversationId.value = null
  activeVulnerabilityCodingConversationId.value = null
  section.value = 'chat'
}

function openRecovery() {
  recoveryDismissed.value = true
  openSettings('general')
}

function newConversation() {
  rememberActiveConversation()
  conversations.startNew()
  lastCodingConversationId.value = null
  activeVulnerabilityCodingConversationId.value = null
  section.value = 'chat'
}

function openHistoryConversation(conversationId: string) {
  const target = conversations.conversations.value.find(item => item.id === conversationId)
  if (!target) return
  rememberActiveConversation()
  conversations.activeId.value = conversationId
  if (target.ctfJobId) {
    lastCTFConversationId.value = conversationId
  } else {
    lastCodingConversationId.value = conversationId
  }
  activeVulnerabilityCodingConversationId.value = null
  section.value = 'chat'
}

function rememberActiveConversation() {
  const remembered = rememberWorkspaceConversation(conversations.active.value, {
    codingConversationId: lastCodingConversationId.value,
    ctfConversationId: lastCTFConversationId.value,
  })
  lastCodingConversationId.value = remembered.codingConversationId
  lastCTFConversationId.value = remembered.ctfConversationId
}

function restoreCodingConversation() {
  const nextId = selectCodingConversationId(
    conversations.conversations.value,
    conversations.activeId.value,
    lastCodingConversationId.value,
  )
  if (nextId) {
    conversations.activeId.value = nextId
    lastCodingConversationId.value = nextId
    return
  }
  conversations.startNew()
  lastCodingConversationId.value = null
}

function restoreCTFWorkspaceResumePoint() {
  const next = selectCTFResumePoint(
    conversations.conversations.value,
    conversations.activeId.value,
    lastCTFConversationId.value,
  )
  ctfResumeJobId.value = next.jobId
  if (next.conversationId) lastCTFConversationId.value = next.conversationId
}

function navigateSection(value: Section) {
  rememberActiveConversation()
  if (value === 'ctf') {
    restoreCTFWorkspaceResumePoint()
    section.value = value
    return
  }
  if (value === 'chat') {
    restoreCodingConversation()
    section.value = value
    return
  }
  if (value === 'vuln') {
    vulnNavigationEpoch.value += 1
  }
  section.value = value
}

function returnToCTFWorkspace() {
  rememberActiveConversation()
  restoreCTFWorkspaceResumePoint()
  section.value = 'ctf'
}

function returnToVulnerabilityWorkspace() {
  rememberActiveConversation()
  section.value = 'vuln'
}

async function chooseAgentWorkspace() {
  const workspacePath = await invokeCommand<string>('choose_agent_workspace')
  if (workspacePath) conversations.setWorkspace(workspacePath)
}

async function chooseAgentWorkspaceForNewTask() {
  const workspacePath = await invokeCommand<string>('choose_agent_workspace')
  if (!workspacePath) return
  newConversation()
  conversations.setWorkspace(workspacePath)
}

async function chooseVulnerabilityCodingWorkspace() {
  const workspacePath = await invokeCommand<string>('choose_agent_workspace')
  if (workspacePath) vulnerabilityCodingWorkspacePath.value = workspacePath
}

async function abortConversation() {
  const conversationId = conversations.activeId.value
  if (conversationId) await conversations.abort(conversationId)
}

function domainContextFromCTFHandoff(handoff: CTFAgentWorkspaceHandoff) {
  const role = handoff.role ?? 'solver'
  const title = String(handoff.title ?? '').replace(/^CTF\s*·\s*/u, '').trim()
  return buildCTFDomainTaskContext({
    jobId: handoff.jobId,
    challengeId: handoff.challengeId || handoff.jobId,
    challengeTitle: title || handoff.title,
    statement: handoff.statement,
    category: handoff.category,
    objective: handoff.humanGoal,
    originLabel: handoff.externalPlatform
      ? `${handoff.externalPlatform.replace(/-web$/u, '').toUpperCase()}${handoff.externalAttemptId ? ` · P${handoff.externalAttemptId}` : ''}`
      : '自定义题目',
    role,
    materials: handoff.materials,
    networkScopes: [],
    evidenceCount: 0,
    artifactCount: 0,
    judgeReceipts: [],
  })
}

function visibleCTFDraft(handoff: CTFAgentWorkspaceHandoff) {
  const title = String(handoff.title ?? '').replace(/^CTF\s*·\s*/u, '').trim() || '这道题'
  if (handoff.role === 'strategist') return `复盘 ${title} 的当前路线，给出一个最值得验证的下一步。`
  if (handoff.role === 'tool-builder') return `继续 ${title}：实现并验证当前待办的最小解题工具。`
  return `继续解决 ${title}：检查已有材料和进度，完成下一个可验证步骤。`
}

async function startCTFAgent(handoff: CTFAgentWorkspaceHandoff & {
  domainTaskContext?: import('@/lib/domainTaskContext').DomainTaskContext
}) {
  rememberActiveConversation()
  section.value = 'chat'
  // Prefer structured domain snapshot when the caller already built one (tests /
  // future prepare enrichment). Otherwise derive from handoff materials only.
  // Never auto-send: opening Coding stages a draft only.
  await conversations.startWorkspaceTask({
    ...handoff,
    visibleText: visibleCTFDraft(handoff),
    domainTaskContext: handoff.domainTaskContext ?? domainContextFromCTFHandoff(handoff),
    autoSend: false,
  })
  lastCTFConversationId.value = conversations.activeId.value
}

async function startVulnerabilityCodingTask(
  task: VulnerabilityCodingTask,
  recordHandoff?: (workspacePath: string) => void,
) {
  const accepted = await executeVulnerabilityCodingHandoff(task, vulnerabilityCodingWorkspacePath.value, {
    rememberActiveConversation,
    startNewConversation: conversations.startNew,
    ensureConversation: conversations.ensureConversation,
    activeConversationId: () => conversations.activeId.value,
    reusableConversationId: context => selectReusableDomainConversationId(
      conversations.conversations.value,
      context,
    ),
    setLastCodingConversationId: id => {
      lastCodingConversationId.value = id
      activeVulnerabilityCodingConversationId.value = id
    },
    setSection: value => { section.value = value },
    stageDraft: (prompt, visibleText) => {
      conversations.stageComposerDraft(prompt, visibleText)
    },
  })
  // recordHandoff = opened shared Coding with staged draft; not Agent started / network.
  if (accepted) {
    recordHandoff?.(conversations.workspacePath.value)
  }
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
    await conversations.startWorkspaceTask({
      ...handoff,
      visibleText: visibleCTFDraft(handoff),
      domainTaskContext: domainContextFromCTFHandoff(handoff),
      autoSend: false,
    })
    lastCTFConversationId.value = conversations.activeId.value
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

function toggleThemeMode() {
  themeMode.value = nextThemeMode(themeMode.value)
  applyThemeMode(themeMode.value)
  writeThemeMode(themeMode.value)
}

async function downloadUpdate() {
  updateStatus.value = await invokeCommand<UpdateStatus>('download_update')
}

async function installUpdate() {
  await invokeCommand<boolean>('install_update')
}

onMounted(async () => {
  applyThemeMode(themeMode.value)
  unlistenModelCatalog = await listenEvent<ModelCatalogSnapshot>('model-catalog-changed', event => {
    installModelCatalog(event.payload)
  })
  unlistenUpdate = await listenEvent<UpdateStatus>('update.changed', event => {
    updateStatus.value = event.payload
  })
  await Promise.all([loadModelCatalog(), loadSettings(), loadAccountStatus(), conversations.load()])
  updateStatus.value = await invokeCommand<UpdateStatus>('get_update_status').catch(() => null)
  unlistenAccount = await listenEvent<AccountStatus>('account.changed', event => {
    accountStatus.value = event.payload
    if (event.payload.state === 'active') {
      accountLoginError.value = ''
      continueWithoutAccount.value = false
      writeLocalAccountMode(false)
    }
  })
  await conversations.listen()
  try {
    recoveryStatus.value = await invokeCommand<StartupRecoveryStatus>('get_startup_recovery_status')
  } catch {
    recoveryStatus.value = null
  }
})

onBeforeUnmount(() => {
  unlistenAccount?.()
  unlistenModelCatalog?.()
  unlistenUpdate?.()
})
</script>

<template>
  <div v-if="!accountLoaded" class="game-shell tactical-dark-surface grid h-screen place-items-center text-xl font-semibold text-white">MilkSU</div>
  <AccountLoginPage
    v-else-if="showAccountGate"
    :status="accountStatus"
    :busy="accountLoginBusy"
    :error="accountLoginError"
    @login="startAccountLogin"
    @continue-local="useLocalAccountMode"
  />
  <div v-else class="game-shell flex h-screen min-w-0 flex-col bg-surface-editor text-foreground">
    <StartupRecoveryBanner
      v-if="recoveryStatus && !recoveryDismissed"
      :status="recoveryStatus"
      @dismiss="recoveryDismissed = true"
      @open-recovery="openRecovery"
    />
    <UpdateNotification
      :status="updateStatus"
      :dismissed-version="dismissedUpdateVersion"
      @dismiss="dismissedUpdateVersion = $event"
      @download="downloadUpdate"
      @install="installUpdate"
    />
    <div class="flex min-h-0 flex-1">
      <AppSidebar
        :active-section="sidebarSection"
        :active-conversation-id="conversations.activeId.value"
        :conversations="conversations.conversations.value"
        :account-status="accountStatus"
        :ctf-section="ctfSection"
        :coding-context-open="codingConversationDrawerOpen"
        :theme-mode="themeMode"
        @new="newConversation"
        @navigate="navigateSection"
        @profile="navigateSection('profile')"
        @account-login="startAccountLogin"
        @account-logout="logoutAccount"
        @settings="openSettings('general')"
        @toggle-theme="toggleThemeMode"
        @close-coding-context="codingConversationDrawerOpen = false"
        @select-conversation="id => {
          conversations.activeId.value = id
          rememberActiveConversation()
          section = 'chat'
        }"
        @delete-conversation="conversations.remove"
        @navigate-ctf="ctfSection = $event"
      />

      <SettingsPage
        v-if="section === 'settings'"
        :initial-category="settingsCategory"
        :settings="settings"
        :account-status="accountStatus"
        :vulnerability-dashboard="vulnerabilityDashboard"
        @close="async () => { await loadSettings(); section = settingsReturnTarget }"
        @settings-change="applySettings"
        @account-login="startAccountLogin"
        @account-logout="logoutAccount"
        @security-tool-coding-handoff="startSecurityToolCodingSetup"
      />
      <ProfilePage
        v-else-if="section === 'profile'"
        :account-status="accountStatus"
        :conversations="conversations.conversations.value"
        @account-status-change="accountStatus = $event"
      />
      <KeepAlive include="CTFPage,VulnPage">
        <CTFPage
          v-if="section === 'ctf'"
          :model-ready="modelReady"
          :model-verified="modelVerified"
          :arena-ready="arenaReady"
          :initial-job-id="ctfResumeJobId"
          :ctf-section="ctfSection"
          :conversations="conversations.conversations.value"
          @open-settings="category => openSettings(category ?? 'apikeys')"
          @start-coding-agent="startCTFAgent"
          @open-coding-conversation="openHistoryConversation"
        />
        <VulnPage
          v-else-if="section === 'vuln'"
          :dashboard="vulnerabilityDashboard"
          :coding-workspace-path="vulnerabilityCodingWorkspacePath"
          :navigation-epoch="vulnNavigationEpoch"
          :conversations="conversations.conversations.value"
          @choose-coding-workspace="chooseVulnerabilityCodingWorkspace"
          @start-coding-task="startVulnerabilityCodingTask"
          @open-coding-conversation="openHistoryConversation"
        />
      </KeepAlive>
      <ChatPage
        v-if="section === 'chat'"
        :conversation="conversations.active.value"
        :settings="settings"
        :workspace-path="conversations.workspacePath.value"
        :running="conversations.activeRunning.value"
        :aborting="conversations.activeAborting.value"
        :message-queue="conversations.activeMessageQueue.value"
        :session-ready="conversations.activeSessionReady.value"
        :resumed="conversations.activeResumed.value"
        :compacting="conversations.activeCompacting.value"
        :compacted-at="conversations.activeCompactedAt.value"
        :compaction-error="conversations.activeCompactionError.value"
        :ctf-session="activeCTFConversation"
        :vulnerability-session="activeVulnerabilityCodingConversation"
        :ctf-mode="conversations.active.value?.ctfMode"
        :ctf-role="conversations.active.value?.ctfRole"
        :model-mode="conversations.selectedModelMode.value"
        :model-provider="conversations.selectedModelProvider.value"
        :model-id="conversations.selectedModelId.value"
        :model-source-preference="conversations.selectedModelSourcePreference.value"
        :execution-mode="conversations.selectedExecutionMode.value"
        :approval-policy="conversations.selectedApprovalPolicy.value"
        :mcp-servers="conversations.selectedMCPServers.value"
        :mcp-config-digest="conversations.selectedMCPConfigDigest.value"
        :ensure-conversation="conversations.ensureConversation"
        :pending-composer-draft="conversations.pendingComposerDraft.value"
        :conversation-drawer-open="codingConversationDrawerOpen"
        @send="conversations.send"
        @consume-pending-draft="conversations.consumeComposerDraft()"
        @ctf-action="runCTFChatAction"
        @abort="abortConversation"
        @compact-context="conversations.compactContext"
        @new-conversation="newConversation"
        @control-goal="conversations.controlGoal"
        @respond-approval="conversations.respondApproval"
        @choose-workspace="chooseAgentWorkspace"
        @choose-workspace-for-new-task="chooseAgentWorkspaceForNewTask"
        @change-model="changeModel"
        @change-model-source="conversations.setModelSourcePreference"
        @change-coding-policy="conversations.setCodingPolicy"
        @change-mcp-servers="conversations.setMCPSelection"
        @open-settings="openSettings('apikeys')"
        @open-conversation="openHistoryConversation"
        @return-ctf="returnToCTFWorkspace"
        @return-vuln="returnToVulnerabilityWorkspace"
        @switch-ctf-agent="switchCTFAgent"
        @toggle-conversation-drawer="codingConversationDrawerOpen = !codingConversationDrawerOpen"
      />
    </div>
  </div>
</template>
