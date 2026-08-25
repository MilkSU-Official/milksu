<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppSidebar from '@/components-vue/AppSidebar.vue'
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
import {
  applyLabJobRecord,
  hydrateLabJobsFromBackend,
  removeLabJobIds,
  useLabJobs,
  type LabJob,
} from '@/composables/useLabJobs'
import type { CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'
import type { VulnerabilityIntel } from '@/vulnerabilityIntel'
import { executeVulnerabilityCodingHandoff } from '@/lib/vulnerabilityCodingHandoff'
import { debugLog } from '@/lib/debugMode'
import { applyUiLocale, t } from '@/lib/uiLocale'
import { readWorkspaceViewState, writeWorkspaceViewState } from '@/lib/workspaceViewState'
import { buildCTFDomainTaskContext, buildCVEDomainTaskContext } from '@/lib/domainTaskContext'
import { labBriefing } from '@/lib/researchBriefing'
import {
  rememberWorkspaceConversation,
  selectCTFResumePoint,
  selectReusableDomainConversationId,
} from '@/lib/workspaceSessionRouting'
import { withAppSettingsDefaults, type AccountStatus, type AppSettings, type CTFChatAction, type UpdateStatus } from '@/types'
import type { ModelCatalogSnapshot } from '@/types'
import { installAppModelSettings, installModelCatalog, loadModelCatalog } from '@/modelCatalog'
import type { SecurityToolCodingHandoff } from '@/securityToolsTypes'
import CodingToolBudgetDialog from '@/components-vue/CodingToolBudgetDialog.vue'
import { toolBudgetToolName } from '@/lib/toolBudget'

const ChatPage = defineAsyncComponent(() => import('@/components-vue/ChatPage.vue'))
const AccountLoginPage = defineAsyncComponent(() => import('@/components-vue/AccountLoginPage.vue'))
const CTFPage = defineAsyncComponent(() => import('@/components-vue/CTFPage.vue'))
const ProfilePage = defineAsyncComponent(() => import('@/components-vue/ProfilePage.vue'))
const SettingsPage = defineAsyncComponent(() => import('@/components-vue/SettingsPage.vue'))
const VulnPage = defineAsyncComponent(() => import('@/components-vue/VulnPage.vue'))
const LabPage = defineAsyncComponent(() => import('@/components-vue/LabPage.vue'))

type Section = 'chat' | 'ctf' | 'vuln' | 'lab' | 'profile' | 'settings'

const restoredViewState = readWorkspaceViewState()
const conversations = useConversations()
const vulnerabilityDashboard = useVulnerabilityDashboard()
const labJobs = useLabJobs()
const section = ref<Section>(restoredViewState?.section ?? 'ctf')
// Coding history is a fixed left panel (not a floating drawer); open by default.
const codingConversationDrawerOpen = ref(restoredViewState?.codingHistoryOpen ?? true)
const ctfSection = ref<CTFWorkspaceSection>(restoredViewState?.ctfSection ?? 'catalog')
const ctfResumeJobId = ref<string | null>(null)
const vulnNavigationEpoch = ref(0)
const lastCodingConversationId = ref<string | null>(null)
const lastCTFConversationId = ref<string | null>(null)
const lastLabConversationId = ref<string | null>(null)
const activeVulnerabilityCodingConversationId = ref<string | null>(null)
// CVE authorization is selected on the CVE surface. It must never inherit the
// currently active Coding or CTF conversation workspace implicitly.
const vulnerabilityCodingWorkspacePath = ref('')
const settingsReturnTarget = ref<Exclude<Section, 'settings'>>(restoredViewState?.settingsReturnTarget ?? 'ctf')
type SettingsCategory = 'general' | 'coding' | 'apikeys' | 'browser' | 'cve' | 'lab' | 'chats' | 'security-tools' | 'ctf' | 'eval'
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
const updateStatus = ref<UpdateStatus | null>(null)
const dismissedUpdateVersion = ref('')
const themeMode = ref<ThemeMode>(readThemeMode())
let unlistenAccount: (() => void) | undefined
let unlistenModelCatalog: (() => void) | undefined
let unlistenUpdate: (() => void) | undefined
let unlistenWorkspaceRecords: (() => void) | undefined
let unlistenRuntime: (() => void) | undefined
const runtimeStatus = ref<'ready' | 'starting' | 'recovering' | 'exited'>('ready')

const toolBudgetPrompt = computed(() => {
  for (const conversation of conversations.conversations.value) {
    const pending = [...conversation.messages].reverse().find(message => (
      message.toolName === toolBudgetToolName
      && message.approvalState === 'pending'
      && message.approvalRequestId
    ))
    if (!pending?.approvalRequestId) continue
    const count = Number.parseInt(String(pending.approvalInput || '0'), 10)
    return {
      requestId: pending.approvalRequestId,
      count: Number.isFinite(count) && count > 0 ? count : 150,
    }
  }
  return null
})

function continueToolBudget() {
  const prompt = toolBudgetPrompt.value
  if (!prompt) return
  void conversations.respondApproval(prompt.requestId, true, 'once')
}

function stopToolBudget() {
  const prompt = toolBudgetPrompt.value
  if (!prompt) return
  void conversations.respondApproval(prompt.requestId, false)
}
let systemThemeMedia: MediaQueryList | undefined
let systemThemeListener: (() => void) | undefined
const workspaceViewStateReady = ref(false)

function persistWorkspaceViewState() {
  if (!workspaceViewStateReady.value) return
  writeWorkspaceViewState({
    version: 1,
    section: section.value,
    activeConversationId: conversations.activeId.value,
    codingHistoryOpen: codingConversationDrawerOpen.value,
    ctfSection: ctfSection.value,
    settingsReturnTarget: settingsReturnTarget.value,
  })
}

watch(
  [section, codingConversationDrawerOpen, ctfSection, settingsReturnTarget, conversations.activeId],
  persistWorkspaceViewState,
)

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
const codingAgentBind = computed<CodingAgentSurfaceBind>(() => ({
  settings: settings.value,
  workspacePath: conversations.workspacePath.value,
  running: conversations.activeRunning.value,
  aborting: conversations.activeAborting.value,
  messageQueue: conversations.activeMessageQueue.value,
  sessionReady: conversations.activeSessionReady.value,
  resumed: conversations.activeResumed.value,
  compacting: conversations.activeCompacting.value,
  compactedAt: conversations.activeCompactedAt.value,
  compactionError: conversations.activeCompactionError.value,
  turnStatus: conversations.activeTurnStatus.value,
  ctfSession: activeCTFConversation.value,
  vulnerabilitySession: conversations.active.value?.domainTaskContext?.kind === 'cve',
  ctfMode: conversations.active.value?.ctfMode,
  ctfRole: conversations.active.value?.ctfRole,
  modelMode: conversations.selectedModelMode.value,
  modelProvider: conversations.selectedModelProvider.value,
  modelId: conversations.selectedModelId.value,
  modelSourcePreference: conversations.selectedModelSourcePreference.value,
  executionMode: conversations.selectedExecutionMode.value,
  approvalPolicy: conversations.selectedApprovalPolicy.value,
  mcpServers: conversations.selectedMCPServers.value,
  mcpConfigDigest: conversations.selectedMCPConfigDigest.value,
  pendingComposerDraft: conversations.pendingComposerDraft.value,
}))

// History open/closed is user-controlled; entering Coding does not force it open.

function startupLog(label: string, detail = '') {
  const suffix = detail ? ` ${detail}` : ''
  console.info(`[startup] ${label}${suffix}`)
}

async function timedStartupStep<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    startupLog(label, `${Math.round(performance.now() - started)}ms`)
  }
}

async function loadSettings() {
  const value = await invokeCommand<AppSettings>('get_settings')
  applySettings(value)
}

function applySettings(value: AppSettings) {
  const normalized = withAppSettingsDefaults(value)
  settings.value = normalized
  installAppModelSettings(normalized)
  applyUiLocale(normalized.locale)
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
    accountLoginError.value = t('无法打开 GitHub 登录。请检查网络或稍后再试；你仍可使用自己的 API Key。', 'Could not open GitHub sign-in. Check your network or try again later. You can still use your own API key.')
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
  continueWithoutAccount.value = false
  writeLocalAccountMode(false)
  codingConversationDrawerOpen.value = false
  section.value = 'ctf'
}

/** Single control for Coding history: only the ChatPage topbar toggles this. */
function toggleCodingConversationDrawer() {
  codingConversationDrawerOpen.value = !codingConversationDrawerOpen.value
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

function restoreCodingWorkspace() {
  const restored = conversations.conversations.value.find(conversation => (
    conversation.id === lastCodingConversationId.value && !conversation.ctfJobId
  ))
  if (restored) conversations.activeId.value = restored.id
  else conversations.startNew()
  activeVulnerabilityCodingConversationId.value = null
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

function restoreConversation(id: string | null) {
  const conversationId = String(id ?? '').trim()
  if (!conversationId) return
  if (conversations.conversations.value.some(item => item.id === conversationId)) {
    conversations.activeId.value = conversationId
  }
}

function navigateSection(value: Section) {
  debugLog('section', value)
  rememberActiveConversation()
  if (value === 'ctf') {
    restoreCTFWorkspaceResumePoint()
    restoreConversation(lastCTFConversationId.value)
    section.value = value
    return
  }
  if (value === 'chat') {
    restoreCodingWorkspace()
    section.value = value
    return
  }
  if (value === 'vuln') {
    vulnNavigationEpoch.value += 1
    restoreConversation(activeVulnerabilityCodingConversationId.value)
    section.value = value
    return
  }
  if (value === 'lab') {
    restoreConversation(lastLabConversationId.value)
    section.value = value
    return
  }
  section.value = value
}

function returnToCTFWorkspace() {
  rememberActiveConversation()
  restoreCTFWorkspaceResumePoint()
  restoreConversation(lastCTFConversationId.value)
  section.value = 'ctf'
}

function returnToVulnerabilityWorkspace() {
  rememberActiveConversation()
  restoreConversation(activeVulnerabilityCodingConversationId.value)
  section.value = 'vuln'
}

function returnToLabWorkspace() {
  rememberActiveConversation()
  restoreConversation(lastLabConversationId.value)
  section.value = 'lab'
}

function expandDossierToCoding() {
  rememberActiveConversation()
  const active = conversations.active.value
  if (active?.ctfJobId || active?.domainTaskContext?.kind === 'ctf') {
    lastCTFConversationId.value = conversations.activeId.value
  } else if (active?.domainTaskContext?.kind === 'lab') {
    lastLabConversationId.value = conversations.activeId.value
  } else {
    activeVulnerabilityCodingConversationId.value = conversations.activeId.value
  }
  section.value = 'chat'
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

function selectCodingWorkspace(path: string) {
  const next = path.trim()
  if (!next) return
  if (conversations.active.value?.messages.length) newConversation()
  conversations.setWorkspace(next)
}

function clearCodingWorkspace() {
  if (conversations.active.value?.messages.length) newConversation()
  conversations.clearWorkspace()
}

async function forgetCodingWorkspace(path: string) {
  const next = path.trim()
  if (!next) return
  try {
    await invokeCommand('forget_coding_project', { path: next })
    if (conversations.workspacePath.value === next) conversations.clearWorkspace()
  } catch (reason) {
    console.error(reason)
  }
}

function newCodingProjectSession(workspacePath: string) {
  const next = workspacePath.trim()
  if (!next) return
  newConversation()
  conversations.setWorkspace(next)
  codingConversationDrawerOpen.value = true
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
      : t('自定义题目', 'Custom challenge'),
    role,
    materials: handoff.materials,
    networkScopes: [],
    evidenceCount: 0,
    artifactCount: 0,
    judgeReceipts: [],
  })
}

async function startCTFAgent(handoff: CTFAgentWorkspaceHandoff & {
  domainTaskContext?: import('@/lib/domainTaskContext').DomainTaskContext
}) {
  rememberActiveConversation()
  await conversations.startWorkspaceTask({
    ...handoff,
    domainTaskContext: handoff.domainTaskContext ?? domainContextFromCTFHandoff(handoff),
    autoSend: false,
  })
  lastCTFConversationId.value = conversations.activeId.value
}

function selectDossierConversation(id: string) {
  if (!conversations.conversations.value.some(item => item.id === id)) return
  conversations.activeId.value = id
  const active = conversations.active.value
  if (active?.ctfJobId || active?.domainTaskContext?.kind === 'ctf') {
    lastCTFConversationId.value = id
  } else if (active?.domainTaskContext?.kind === 'lab') {
    lastLabConversationId.value = id
  } else {
    activeVulnerabilityCodingConversationId.value = id
  }
}

function createDossierConversation() {
  const current = conversations.active.value
  const context = current?.domainTaskContext
  if (!current || !context) return
  const title = context.kind === 'cve'
    ? t(`${context.cveId} 复现`, `${context.cveId} reproduction`)
    : context.kind === 'lab'
      ? context.title
      : context.challengeTitle
  const id = conversations.ensureConversation(title, {
    conversationId: crypto.randomUUID(),
    domainTaskContext: context,
    workspacePath: current.workspacePath,
    ctfJobId: current.ctfJobId,
    ctfMode: current.ctfMode,
    ctfRole: current.ctfRole,
  })
  selectDossierConversation(id)
}

async function bindDossierConversation(
  title: string,
  conversationId: string,
  domainTaskContext: NonNullable<import('@/lib/domainTaskContext').DomainTaskContext>,
) {
  rememberActiveConversation()
  conversations.ensureConversation(title, {
    conversationId,
    domainTaskContext,
  })
  try {
    const workspace = await invokeCommand<string>('ensure_coding_artifact_workspace', {
      conversationId: conversations.activeId.value,
    })
    if (workspace) conversations.setWorkspace(workspace)
  } catch {
    // Report preview stays empty until the first Agent turn creates the workspace.
  }
}

async function enterVulnerabilityDossier(item: VulnerabilityIntel) {
  const cveId = item.id.trim()
  await bindDossierConversation(
    t(`${cveId} 复现`, `${cveId} reproduction`),
    `cve-research-${cveId.toLowerCase()}`,
    buildCVEDomainTaskContext({
      cveId,
      title: item.title,
      summary: item.summary,
      vendor: item.vendor,
      product: item.product,
      affected: item.affected,
    }),
  )
  activeVulnerabilityCodingConversationId.value = conversations.activeId.value
}

async function runVulnerabilityReproduction(item: VulnerabilityIntel) {
  await enterVulnerabilityDossier(item)
}

async function runLabJob(job: LabJob) {
  await enterLabJob(job)
  const conversation = conversations.active.value
  if (conversation && conversation.messages.length === 0) {
    const briefing = labBriefing({ scope: job.scope, request: job.request })
    await conversations.send(briefing.prompt, briefing.visible)
  }
}

function renameLabJob(id: string, title: string) {
  labJobs.rename(id, title)
  conversations.rename(`lab-job-${id}`, title)
}

function applyWorkspaceRecord(payload: {
  action?: string
  kind?: string
  id?: string
  ids?: string[]
  record?: Record<string, unknown>
}) {
  const action = String(payload.action ?? '').trim()
  const kind = String(payload.kind ?? '').trim()
  const record = payload.record ?? {}
  const id = String(payload.id || record.id || '').trim()
  if (action === 'focus') {
    if (kind === 'lab' && id) {
      labJobs.selectedId.value = id
      const job = labJobs.jobs.value.find(item => item.id === id)
      section.value = 'lab'
      if (job) void enterLabJob(job)
      return
    }
    if (kind === 'cve' && id) {
      vulnerabilityDashboard.selectedId.value = id.toUpperCase()
      section.value = 'vuln'
      return
    }
    if (kind === 'ctf' && id) {
      ctfResumeJobId.value = id
      section.value = 'ctf'
      return
    }
    if (kind === 'conversation' && id) {
      conversations.activeId.value = id
      section.value = 'chat'
    }
    return
  }
  if (kind === 'lab') {
    if (action === 'archive') {
      removeLabJobIds(payload.ids?.length ? payload.ids : (id ? [id] : []))
      return
    }
    if (record.id) {
      applyLabJobRecord(record)
      if (record.title) conversations.rename(`lab-job-${String(record.id)}`, String(record.title))
    }
    return
  }
  if (kind === 'conversation') {
    if (action === 'update' && id && record.title) {
      conversations.rename(id, String(record.title))
      return
    }
    void conversations.load()
    return
  }
  if (kind === 'cve' && id) {
    const tracking = {
      id,
      title: String(record.title ?? ''),
      vendor: String(record.vendor ?? ''),
      product: String(record.product ?? ''),
      affected: String(record.affected ?? ''),
      summary: String(record.summary ?? ''),
      referenceHref: String(record.url ?? ''),
    }
    if (action === 'update') {
      vulnerabilityDashboard.patchTrackingItem(id, {
        title: tracking.title,
        vendor: tracking.vendor,
        product: tracking.product,
        affected: tracking.affected,
        summary: tracking.summary,
      })
      return
    }
    try {
      vulnerabilityDashboard.addTrackingItem(tracking)
    } catch {
      vulnerabilityDashboard.patchTrackingItem(id, tracking)
    }
  }
}

async function enterLabJob(job: LabJob) {
  await bindDossierConversation(
    job.title,
    `lab-job-${job.id}`,
    {
      kind: 'lab',
      jobId: job.id,
      title: job.title,
      scope: job.scope,
      request: job.request,
    },
  )
  lastLabConversationId.value = conversations.activeId.value
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
  })
  // recordHandoff = opened shared Coding; not Agent started / network.
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
          concept: t('PI 分级提示', 'Pi graded hint'),
          content: t(`用户主动请求 ${action.level} 级提示。`, `The user requested a level ${action.level} hint.`),
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
  const mountedAt = performance.now()
  startupLog('renderer.onMounted')
  applyThemeMode(themeMode.value)
  if (typeof window.matchMedia === 'function') {
    systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeListener = () => {
      if (themeMode.value === 'system') applyThemeMode('system')
    }
    systemThemeMedia.addEventListener('change', systemThemeListener)
  }
  // Subscribe before any RPC so background account.bootstrap → onChanged is not missed
  // (network status often completes right after first paint).
  unlistenAccount = await listenEvent<AccountStatus>('account.changed', event => {
    const previous = accountStatus.value
    accountStatus.value = event.payload
    if (event.payload.state === 'active') {
      accountLoginError.value = ''
      continueWithoutAccount.value = false
      writeLocalAccountMode(false)
      // First confirmed status after provisional bootstrap may have just written
      // the managed relay into credentials.db — refresh has_key for modelReady.
      if (previous.provisional && !event.payload.provisional) {
        void loadSettings().catch(() => {})
      }
    }
  })
  unlistenModelCatalog = await listenEvent<ModelCatalogSnapshot>('model-catalog-changed', event => {
    installModelCatalog(event.payload)
  })
  unlistenUpdate = await listenEvent<UpdateStatus>('update.changed', event => {
    updateStatus.value = event.payload
  })
  unlistenRuntime = await listenEvent<{ state?: string }>('runtime.status', event => {
    const state = event.payload?.state
    if (state === 'recovering' || state === 'starting' || state === 'exited' || state === 'ready') {
      runtimeStatus.value = state
    }
    if (state === 'recovering' || state === 'exited') {
      conversations.settleRunsForRuntimeRecovery()
    }
  })
  unlistenWorkspaceRecords = await listenEvent<{
    action?: string
    kind?: string
    id?: string
    ids?: string[]
    record?: Record<string, unknown>
  }>('workspace-record.changed', event => {
    applyWorkspaceRecord(event.payload ?? {})
  })
  // Four parallel RPCs; accountLoaded only flips after loadAccountStatus finishes.
  // After bootstrap, GetAccountStatus is non-blocking (provisional or cache).
  const parallelStarted = performance.now()
  async function measure(label: string, work: () => Promise<unknown>) {
    const started = performance.now()
    await work()
    const ms = Math.round(performance.now() - started)
    startupLog(label, `${ms}ms`)
    return ms
  }
  const [catalogMs, settingsMs, accountMs, conversationsMs] = await Promise.all([
    measure('rpc.loadModelCatalog', () => loadModelCatalog()),
    measure('rpc.loadSettings', () => loadSettings()),
    measure('rpc.loadAccountStatus', () => loadAccountStatus()),
    measure('rpc.conversations.load', () => conversations.load()),
  ])
  await hydrateLabJobsFromBackend()
  const parallelWallMs = Math.round(performance.now() - parallelStarted)
  const slowest = Math.max(catalogMs, settingsMs, accountMs, conversationsMs)
  startupLog(
    'renderer.parallelBootstrap',
    `wall=${parallelWallMs}ms catalog=${catalogMs}ms settings=${settingsMs}ms account=${accountMs}ms conversations=${conversationsMs}ms slowest=${slowest}ms accountLoaded=${accountLoaded.value} provisional=${accountStatus.value.provisional === true}`,
  )
  if (restoredViewState) {
    const restoredConversation = conversations.conversations.value.find(
      conversation => conversation.id === restoredViewState.activeConversationId,
    )
    conversations.activeId.value = restoredConversation?.id ?? null
    if (restoredConversation?.ctfJobId) lastCTFConversationId.value = restoredConversation.id
    else if (restoredConversation) lastCodingConversationId.value = restoredConversation.id
  }
  workspaceViewStateReady.value = true
  persistWorkspaceViewState()
  updateStatus.value = await timedStartupStep('rpc.get_update_status', () =>
    invokeCommand<UpdateStatus>('get_update_status').catch(() => null),
  )
  await conversations.listen()
  startupLog(
    'renderer.firstPaintGateDone',
    `fromMount=${Math.round(performance.now() - mountedAt)}ms state=${accountStatus.value.state} provisional=${accountStatus.value.provisional === true}`,
  )
})

onBeforeUnmount(() => {
  unlistenAccount?.()
  unlistenModelCatalog?.()
  unlistenUpdate?.()
  unlistenWorkspaceRecords?.()
  unlistenRuntime?.()
  if (systemThemeMedia && systemThemeListener) {
    systemThemeMedia.removeEventListener('change', systemThemeListener)
  }
})
</script>

<template>
  <div v-if="!accountLoaded" class="grid h-screen place-items-center bg-background text-xl font-semibold text-foreground">MilkSU</div>
  <AccountLoginPage
    v-else-if="showAccountGate"
    :status="accountStatus"
    :busy="accountLoginBusy"
    :error="accountLoginError"
    @login="startAccountLogin"
    @continue-local="useLocalAccountMode"
  />
  <div v-else class="game-shell flex h-screen min-w-0 flex-col bg-surface-editor text-foreground">
    <UpdateNotification
      :status="updateStatus"
      :dismissed-version="dismissedUpdateVersion"
      @dismiss="dismissedUpdateVersion = $event"
      @download="downloadUpdate"
      @install="installUpdate"
    />
    <p
      v-if="runtimeStatus === 'recovering' || runtimeStatus === 'starting'"
      class="shrink-0 border-b border-border bg-card px-4 py-2 text-caption text-foreground"
    >
      {{ t('正在恢复运行时', 'Restoring the runtime') }}
    </p>
    <p
      v-else-if="runtimeStatus === 'exited'"
      class="shrink-0 border-b border-border bg-card px-4 py-2 text-caption text-foreground"
    >
      {{ t('本地运行时已停止', 'Local runtime stopped') }}
    </p>
    <div class="flex min-h-0 flex-1">
      <AppSidebar
        :active-section="sidebarSection"
        :active-conversation-id="conversations.activeId.value"
        :conversations="conversations.conversations.value"
        :running-conversation-ids="conversations.runningConversationIds.value"
        :conversation-action-error="conversations.conversationActionError.value"
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
        @open-coding-context="codingConversationDrawerOpen = true"
        @collapse-coding-context="codingConversationDrawerOpen = false"
        @select-conversation="id => {
          conversations.activeId.value = id
          rememberActiveConversation()
          section = 'chat'
          codingConversationDrawerOpen = true
        }"
        @delete-conversation="conversations.archive"
        @delete-conversation-permanently="conversations.remove"
        @new-project-session="newCodingProjectSession"
        @rename-conversation="conversations.rename"
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
        @conversations-changed="conversations.load"
      />
      <ProfilePage
        v-else-if="section === 'profile'"
        :account-status="accountStatus"
        :conversations="conversations.conversations.value"
        :vulnerabilities="vulnerabilityDashboard.tracked.value"
        @account-status-change="accountStatus = $event"
      />
      <KeepAlive include="CTFPage,VulnPage,LabPage">
        <CTFPage
          v-if="section === 'ctf'"
          v-bind="codingAgentBind"
          :model-ready="modelReady"
          :model-verified="modelVerified"
          :arena-ready="arenaReady"
          :initial-job-id="ctfResumeJobId"
          :ctf-section="ctfSection"
          :conversations="conversations.conversations.value"
          :conversation="conversations.active.value"
          :ensure-conversation="conversations.ensureConversation"
          @open-settings="category => openSettings(category ?? 'apikeys')"
          @start-coding-agent="startCTFAgent"
          @open-coding-conversation="openHistoryConversation"
          @send="conversations.send"
          @abort="abortConversation"
          @select-conversation="selectDossierConversation"
          @create-conversation="createDossierConversation"
          @expand="expandDossierToCoding"
          @consume-pending-draft="conversations.consumeComposerDraft()"
          @ctf-action="runCTFChatAction"
          @compact-context="conversations.compactContext"
          @control-goal="conversations.controlGoal"
          @respond-approval="conversations.respondApproval"
          @change-model="changeModel"
          @change-model-source="conversations.setModelSourcePreference"
          @change-coding-policy="conversations.setCodingPolicy"
          @change-mcp-servers="conversations.setMCPSelection"
          @choose-workspace="chooseAgentWorkspace"
          @choose-workspace-for-new-task="chooseAgentWorkspaceForNewTask"
          @select-workspace="selectCodingWorkspace"
          @forget-workspace="forgetCodingWorkspace"
          @clear-workspace="clearCodingWorkspace"
          @cancel-queued-guidance="conversations.cancelQueuedGuidance"
          @edit-queued-guidance="conversations.editQueuedGuidance"
        />
        <VulnPage
          v-else-if="section === 'vuln'"
          v-bind="codingAgentBind"
          :dashboard="vulnerabilityDashboard"
          :coding-workspace-path="vulnerabilityCodingWorkspacePath"
          :navigation-epoch="vulnNavigationEpoch"
          :conversations="conversations.conversations.value"
          :conversation="conversations.active.value"
          :ensure-conversation="conversations.ensureConversation"
          @choose-coding-workspace="chooseVulnerabilityCodingWorkspace"
          @start-coding-task="startVulnerabilityCodingTask"
          @open-coding-conversation="openHistoryConversation"
          @enter="enterVulnerabilityDossier"
          @run="runVulnerabilityReproduction"
          @send="conversations.send"
          @abort="abortConversation"
          @select-conversation="selectDossierConversation"
          @create-conversation="createDossierConversation"
          @expand="expandDossierToCoding"
          @consume-pending-draft="conversations.consumeComposerDraft()"
          @compact-context="conversations.compactContext"
          @control-goal="conversations.controlGoal"
          @respond-approval="conversations.respondApproval"
          @change-model="changeModel"
          @change-model-source="conversations.setModelSourcePreference"
          @change-coding-policy="conversations.setCodingPolicy"
          @change-mcp-servers="conversations.setMCPSelection"
          @choose-workspace="chooseAgentWorkspace"
          @choose-workspace-for-new-task="chooseAgentWorkspaceForNewTask"
          @select-workspace="selectCodingWorkspace"
          @forget-workspace="forgetCodingWorkspace"
          @clear-workspace="clearCodingWorkspace"
          @cancel-queued-guidance="conversations.cancelQueuedGuidance"
          @edit-queued-guidance="conversations.editQueuedGuidance"
          @open-settings="openSettings('apikeys')"
          @open-lab-settings="openSettings('lab')"
        />
        <LabPage
          v-else-if="section === 'lab'"
          v-bind="codingAgentBind"
          :conversations="conversations.conversations.value"
          :conversation="conversations.active.value"
          :ensure-conversation="conversations.ensureConversation"
          @enter="enterLabJob"
          @run="runLabJob"
          @rename="renameLabJob"
          @send="conversations.send"
          @abort="abortConversation"
          @select-conversation="selectDossierConversation"
          @create-conversation="createDossierConversation"
          @expand="expandDossierToCoding"
          @consume-pending-draft="conversations.consumeComposerDraft()"
          @compact-context="conversations.compactContext"
          @control-goal="conversations.controlGoal"
          @respond-approval="conversations.respondApproval"
          @change-model="changeModel"
          @change-model-source="conversations.setModelSourcePreference"
          @change-coding-policy="conversations.setCodingPolicy"
          @change-mcp-servers="conversations.setMCPSelection"
          @choose-workspace="chooseAgentWorkspace"
          @choose-workspace-for-new-task="chooseAgentWorkspaceForNewTask"
          @select-workspace="selectCodingWorkspace"
          @forget-workspace="forgetCodingWorkspace"
          @clear-workspace="clearCodingWorkspace"
          @cancel-queued-guidance="conversations.cancelQueuedGuidance"
          @edit-queued-guidance="conversations.editQueuedGuidance"
          @open-settings="openSettings('apikeys')"
          @open-lab-settings="openSettings('lab')"
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
        :turn-status="conversations.activeTurnStatus.value"
        :ctf-session="activeCTFConversation"
        :vulnerability-session="activeVulnerabilityCodingConversation"
        :ctf-mode="conversations.active.value?.ctfMode"
        :ctf-role="conversations.active.value?.ctfRole"
        :model-mode="conversations.selectedModelMode.value"
        :model-provider="conversations.selectedModelProvider.value"
        :model-id="conversations.selectedModelId.value"
        :thinking-level="conversations.selectedThinkingLevel.value"
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
        @select-workspace="selectCodingWorkspace"
        @forget-workspace="forgetCodingWorkspace"
        @clear-workspace="clearCodingWorkspace"
        @cancel-queued-guidance="conversations.cancelQueuedGuidance"
        @edit-queued-guidance="conversations.editQueuedGuidance"
        @change-model="changeModel"
        @change-thinking-level="conversations.setThinkingLevel"
        @change-model-source="conversations.setModelSourcePreference"
        @change-coding-policy="conversations.setCodingPolicy"
        @change-mcp-servers="conversations.setMCPSelection"
        @open-settings="openSettings('apikeys')"
        @open-conversation="openHistoryConversation"
        @return-ctf="returnToCTFWorkspace"
        @return-vuln="returnToVulnerabilityWorkspace"
        @return-lab="returnToLabWorkspace"
        @switch-ctf-agent="switchCTFAgent"
        @toggle-conversation-drawer="toggleCodingConversationDrawer"
      />
    </div>
    <CodingToolBudgetDialog
      :open="Boolean(toolBudgetPrompt)"
      :count="toolBudgetPrompt?.count ?? 150"
      @update:open="open => { if (!open) stopToolBudget() }"
      @continue="continueToolBudget"
      @stop="stopToolBudget"
    />
  </div>
</template>
