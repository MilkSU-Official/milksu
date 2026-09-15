// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from '@/lib/reactStore'
import type { AccountStatus, Conversation } from '@/types'

const hoisted = vi.hoisted(() => ({
  conversations: null as ReturnType<typeof createMockConversations> | null,
  labJobs: null as ReturnType<typeof createMockLabJobs> | null,
  vulnDashboard: null as ReturnType<typeof createMockVulnDashboard> | null,
  lastCTFInitialJobId: '',
  accountStatus: {
    configured: false,
    authenticated: false,
    state: 'unconfigured',
  } as AccountStatus,
}))

function baseConversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'conversation',
    title: 'Conversation',
    createdAt: Date.now(),
    messages: [],
    ...overrides,
  }
}

function createMockConversations() {
  const store = createStore({
    conversations: [
      baseConversation({
        id: 'coding-existing',
        title: 'MilkSU Coding',
        createdAt: 1,
        messages: [{
          id: 'coding-message',
          role: 'assistant',
          content: 'existing coding work',
          timestamp: 2,
        }],
      }),
    ] as Conversation[],
    activeId: 'coding-existing' as string | null,
    workspacePath: '/Users/milksu/code/milksu',
    pendingComposerDraft: null as { prompt: string; visibleText: string } | null,
    engineNotice: '',
    engineNoticeRepeat: 0,
    conversationActionError: '',
    selectedModelMode: 'manual' as const,
    selectedModelProvider: 'openai',
    selectedModelId: 'gpt-test',
    selectedThinkingLevel: 'high',
    selectedModelSourcePreference: 'auto' as const,
    selectedExecutionMode: 'go' as const,
    selectedApprovalPolicy: 'workspace-auto' as const,
    selectedMCPServers: [] as string[],
    selectedMCPConfigDigest: '',
    selectedKernel: 'pi' as const,
  })

  return {
    store,
    get conversations() { return store.getState().conversations },
    set conversations(value: Conversation[]) { store.setState({ conversations: value }) },
    get activeId() { return store.getState().activeId },
    set activeId(value: string | null) { store.setState({ activeId: value }) },
    get active() {
      const state = store.getState()
      return state.conversations.find(conversation => conversation.id === state.activeId) ?? null
    },
    get workspacePath() { return store.getState().workspacePath },
    set workspacePath(value: string) { store.setState({ workspacePath: value }) },
    get engineNotice() { return store.getState().engineNotice },
    get engineNoticeRepeat() { return store.getState().engineNoticeRepeat },
    get runningConversationIds() { return [] as string[] },
    get conversationActionError() { return store.getState().conversationActionError },
    get activeRunning() { return false },
    get activeAborting() { return false },
    get activeAbortStalled() { return false },
    get activeMessageQueue() { return { steering: [] as string[], followUp: [] as string[] } },
    get activeSessionReady() { return true },
    get activeResumed() { return false },
    get activeCompacting() { return false },
    get activeCompactedAt() { return undefined as number | undefined },
    get activeCompactionError() { return '' },
    get activeTurnStatus() { return { compacting: false } },
    get selectedModelMode() { return store.getState().selectedModelMode },
    get selectedModelProvider() { return store.getState().selectedModelProvider },
    get selectedModelId() { return store.getState().selectedModelId },
    get selectedThinkingLevel() { return store.getState().selectedThinkingLevel },
    get selectedModelSourcePreference() { return store.getState().selectedModelSourcePreference },
    get selectedExecutionMode() { return store.getState().selectedExecutionMode },
    get selectedApprovalPolicy() { return store.getState().selectedApprovalPolicy },
    get selectedMCPServers() { return store.getState().selectedMCPServers },
    get selectedMCPConfigDigest() { return store.getState().selectedMCPConfigDigest },
    get pendingComposerDraft() { return store.getState().pendingComposerDraft },
    get selectedKernel() { return store.getState().selectedKernel },
    load: vi.fn(async () => undefined),
    listen: vi.fn(async () => undefined),
    startNew: vi.fn(() => {
      store.setState({ activeId: null })
      return null
    }),
    ensureConversation: vi.fn((title: string, options: {
      conversationId?: string
      workspacePath?: string
      domainTaskContext?: Conversation['domainTaskContext']
    } = {}) => {
      const rows = store.getState().conversations
      const id = options.conversationId || `ensured-${rows.length + 1}`
      const existing = rows.find(item => item.id === id)
      if (existing) {
        existing.title = title
        existing.workspacePath = options.workspacePath?.trim() || undefined
        existing.domainTaskContext = options.domainTaskContext ?? existing.domainTaskContext
        if (options.domainTaskContext?.kind === 'cve') {
          existing.ctfJobId = undefined
          existing.ctfMode = undefined
          existing.ctfRole = undefined
        }
        store.setState({
          activeId: id,
          workspacePath: existing.workspacePath ?? '',
        })
        return id
      }
      const created = baseConversation({
        id,
        title,
        createdAt: Date.now(),
        workspacePath: options.workspacePath?.trim() || undefined,
        domainTaskContext: options.domainTaskContext,
      })
      store.setState({
        conversations: [...rows, created],
        activeId: id,
        workspacePath: options.workspacePath?.trim() || '',
      })
      return id
    }),
    startWorkspaceTask: vi.fn(async (task: {
      title: string
      jobId?: string
      conversationId?: string
      workspacePath?: string
      role?: Conversation['ctfRole']
      domainTaskContext?: Conversation['domainTaskContext']
      autoSend?: boolean
      prompt?: string
      visibleText?: string
    }) => {
      expect(task.autoSend === true).toBe(false)
      const rows = store.getState().conversations
      const id = task.conversationId
        || (task.jobId ? `ctf-${task.jobId}` : `coding-${rows.length + 1}`)
      const existing = rows.find(conversation => conversation.id === id)
      if (existing) {
        existing.workspacePath = task.workspacePath?.trim() || undefined
        existing.domainTaskContext = task.domainTaskContext ?? existing.domainTaskContext
        existing.ctfJobId = task.jobId ?? existing.ctfJobId
        existing.ctfRole = task.role ?? existing.ctfRole
        store.setState({
          activeId: existing.id,
          workspacePath: existing.workspacePath ?? '',
        })
        return
      }
      const created = baseConversation({
        id,
        title: task.title,
        createdAt: Date.now(),
        workspacePath: task.workspacePath?.trim() || undefined,
        ctfJobId: task.jobId,
        ctfRole: task.role ?? (task.jobId ? 'solver' : undefined),
        domainTaskContext: task.domainTaskContext,
        messages: [],
      })
      store.setState({
        conversations: [...rows, created],
        activeId: id,
        workspacePath: task.workspacePath?.trim() || '',
      })
    }),
    stageComposerDraft: vi.fn((prompt: string, visibleText = prompt) => {
      store.setState({ pendingComposerDraft: { prompt, visibleText } })
    }),
    consumeComposerDraft: vi.fn(() => {
      const draft = store.getState().pendingComposerDraft
      store.setState({ pendingComposerDraft: null })
      return draft
    }),
    send: vi.fn(async () => {
      throw new Error('send must not run on open-Coding handoff')
    }),
    abort: vi.fn(async () => undefined),
    remove: vi.fn(),
    archive: vi.fn(),
    rename: vi.fn(),
    setConversationPinned: vi.fn(),
    movePinnedConversation: vi.fn(),
    reorderPinnedConversation: vi.fn(),
    setWorkspace: vi.fn((path: string) => {
      store.setState({ workspacePath: path })
    }),
    clearWorkspace: vi.fn(),
    cancelQueuedGuidance: vi.fn(),
    editQueuedGuidance: vi.fn(),
    editAndResend: vi.fn(),
    branchFromAssistant: vi.fn(),
    setKernel: vi.fn(),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn(),
    setModelSourcePreference: vi.fn(),
    setCodingPolicy: vi.fn(),
    setMCPSelection: vi.fn(),
    compactContext: vi.fn(),
    rewindContext: vi.fn(),
    handoffContext: vi.fn(),
    controlGoal: vi.fn(),
    respondApproval: vi.fn(),
    settleRunsForRuntimeRecovery: vi.fn(),
  }
}

function createMockLabJobs() {
  const store = createStore({
    jobs: [] as Array<{ id: string; title: string }>,
    selectedId: '',
  })
  return {
    store,
    get jobs() { return store.getState().jobs },
    set jobs(value: Array<{ id: string; title: string }>) { store.setState({ jobs: value }) },
    get selectedId() { return store.getState().selectedId },
    set selectedId(value: string) { store.setState({ selectedId: value }) },
    rename: vi.fn(),
    createJob: vi.fn(),
    focusChallenge: vi.fn(),
    touch: vi.fn(),
  }
}

function createMockVulnDashboard() {
  const store = createStore({
    tracked: [] as unknown[],
    selectedId: '',
  })
  return {
    store,
    get tracked() { return store.getState().tracked },
    get selectedId() { return store.getState().selectedId },
    set selectedId(value: string) { store.setState({ selectedId: value }) },
    patchTrackingItem: vi.fn(),
    addTrackingItem: vi.fn(),
  }
}

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'get_settings') {
      return {
        active_provider: 'openai',
        active_model: 'gpt-test',
        providers: {
          openai: {
            enabled: true,
            api_key: '',
            has_api_key: false,
          },
        },
        relay: {
          enabled: false,
          url: '',
          key: '',
          has_key: false,
        },
        model_verification: null,
        nssctf_arena: {
          token: '',
          has_token: false,
        },
      }
    }
    if (command === 'get_account_status') {
      return hoisted.accountStatus
    }
    if (command === 'logout_account') {
      hoisted.accountStatus = {
        configured: true,
        authenticated: false,
        state: 'signed_out',
      }
      return hoisted.accountStatus
    }
    if (command === 'get_startup_recovery_status') return null
    if (command === 'list_lab_jobs') return []
    return null
  }),
  listenEvent: vi.fn(async () => () => undefined),
}))

vi.mock('@/stores/conversationsStore', () => ({
  useConversations: () => hoisted.conversations,
  ConversationsProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/stores/labJobsStore', () => ({
  useLabJobs: () => hoisted.labJobs,
  LabJobsProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/composables/useVulnerabilityDashboard', () => ({
  useVulnerabilityDashboard: () => hoisted.vulnDashboard,
}))

vi.mock('@/components/AppSidebar', () => ({
  default: function AppSidebar(props: {
    activeSection?: string
    accountStatus?: AccountStatus
    onNavigate?: (section: string) => void
    onSettings?: () => void
    onAccountLogout?: () => void
  }) {
    return (
      <nav aria-label="mock sidebar">
        <span data-active-section={props.activeSection}>{String(props.activeSection)}</span>
        <button aria-label="navigate CTF" onClick={() => props.onNavigate?.('ctf')}>CTF</button>
        <button aria-label="navigate CVE" onClick={() => props.onNavigate?.('vuln')}>CVE</button>
        <button aria-label="navigate Coding" onClick={() => props.onNavigate?.('chat')}>Coding</button>
        <button aria-label="open settings" onClick={() => props.onSettings?.()}>设置</button>
        {props.accountStatus?.state === 'active' ? (
          <button aria-label="logout account" onClick={() => props.onAccountLogout?.()}>退出登录</button>
        ) : null}
      </nav>
    )
  },
}))

vi.mock('@/components/AccountLoginPage', () => ({
  default: function AccountLoginPage(props: { status?: AccountStatus }) {
    return (
      <section aria-label="mock account login gate">{String(props.status?.state ?? '')}</section>
    )
  },
}))

vi.mock('@/components/CTFPage', () => ({
  default: function CTFPage(props: {
    initialJobId?: string
    ctfSection?: string
    onStartCodingAgent?: (handoff: Record<string, unknown>) => void
  }) {
    hoisted.lastCTFInitialJobId = String(props.initialJobId ?? '')
    return (
      <section aria-label="mock CTF page">
        <span data-ctf-initial-job={String(props.initialJobId ?? '')}>{String(props.initialJobId ?? 'none')}</span>
        <span data-ctf-section={String(props.ctfSection)}>{String(props.ctfSection)}</span>
        <button
          aria-label="open CTF in coding"
          onClick={() => props.onStartCodingAgent?.({
            title: 'CTF · Web challenge',
            prompt: 'solve with exact scope',
            conversationId: 'ctf-job-1',
            workspacePath: '/Users/milksu/Library/Application Support/MilkSU/ctf/job-1',
            jobId: 'job-1',
            role: 'solver',
            policy: { mode: 'copilot' },
            materials: [{ name: 'dist.zip' }],
            domainTaskContext: {
              kind: 'ctf',
              jobId: 'job-1',
              challengeId: 'ch-1',
              challengeTitle: 'Web challenge',
              role: 'solver',
              roleLabel: '解题 Agent',
              materialStatus: '已挂载 1 份材料：dist.zip',
              materialCount: 1,
              authorizedScope: 'source-1 · base → origin:https://base.example',
              evidenceCount: 0,
              artifactCount: 0,
              judgeState: '尚无 Judge 回执',
              liveProjection: true,
            },
          })}
        >
          在 Coding 中打开
        </button>
      </section>
    )
  },
}))

vi.mock('@/components/VulnPage', () => ({
  default: function VulnPage(props: {
    codingWorkspacePath?: string
    onStartCodingTask?: (handoff: Record<string, unknown>) => void
  }) {
    return (
      <section aria-label="mock CVE page">
        <span data-vuln-workspace={String(props.codingWorkspacePath ?? '')}>{String(props.codingWorkspacePath ?? '')}</span>
        <button
          aria-label="open CVE in coding"
          onClick={() => props.onStartCodingTask?.({
            title: 'CVE-2024-3400 研究接力',
            visibleText: '接手 CVE-2024-3400',
            prompt: '研究 CVE-2024-3400，并按当前任务继续验证。',
            domainTaskContext: {
              kind: 'cve',
              cveId: 'CVE-2024-3400',
              title: 'PAN-OS',
              sourceEvidenceState: 'NVD',
              sourceEvidenceCount: 1,
              assetMatchState: '3 项资产',
              assetCount: 3,
              researchScope: '当前会话与用户所选项目/材料',
              safetyBoundary: '沿用 Coding Agent 当前权限档',
              roleLabel: 'CVE 研究接力',
            },
          })}
        >
          交给 Coding
        </button>
      </section>
    )
  },
}))

vi.mock('@/components/ChatPage', () => ({
  default: function ChatPage(props: {
    conversation?: Conversation | null
    ctfSession?: boolean
    vulnerabilitySession?: boolean
    pendingComposerDraft?: { visibleText?: string } | null
    onOpenConversation?: (id: string) => void
    onReturnCtf?: () => void
  }) {
    return (
      <section aria-label="mock Chat page">
        <span data-chat-conversation={props.conversation?.id ?? ''}>{props.conversation?.id ?? 'none'}</span>
        <span data-chat-ctf-session={String(Boolean(props.ctfSession))}>{String(Boolean(props.ctfSession))}</span>
        <span data-chat-vulnerability-session={String(Boolean(props.vulnerabilitySession))}>{String(Boolean(props.vulnerabilitySession))}</span>
        <span data-chat-draft={props.pendingComposerDraft?.visibleText ?? ''}>{props.pendingComposerDraft?.visibleText ?? ''}</span>
        <button aria-label="open linked coding conversation" onClick={() => props.onOpenConversation?.('coding-existing')}>打开关联 Coding</button>
        <button aria-label="return CTF workspace" onClick={() => props.onReturnCtf?.()}>返回 CTF 工作台</button>
      </section>
    )
  },
}))

vi.mock('@/components/SettingsPage', () => ({
  default: function SettingsPage(props: {
    onSecurityToolCodingHandoff?: (handoff: Record<string, unknown>) => void
  }) {
    return (
      <section aria-label="mock settings page">
        Settings
        <button
          aria-label="configure security tool in coding"
          onClick={() => props.onSecurityToolCodingHandoff?.({
            toolId: 'ida-pro',
            title: '配置 IDA Pro',
            prompt: '检测并准备 IDA Pro。',
            visibleText: '检查并准备 IDA Pro。',
            executionMode: 'go',
            approvalPolicy: 'full-auto',
          })}
        >
          在 Coding 中配置
        </button>
      </section>
    )
  },
}))

vi.mock('@/components/LabPage', () => ({
  default: function LabPage() {
    return <section aria-label="mock Lab page" />
  },
}))

vi.mock('@/components/ProfilePage', () => ({
  default: function ProfilePage() {
    return <section aria-label="mock profile page" />
  },
}))

vi.mock('@/components/UpdateInstallDialog', () => ({
  default: function UpdateInstallDialog() {
    return null
  },
}))

vi.mock('@/components/CodingToolBudgetDialog', () => ({
  default: function CodingToolBudgetDialog() {
    return null
  },
}))

const mountedRoots: Root[] = []
let localAccountStore = new Map<string, string>()

function installLocalStorage() {
  localAccountStore = new Map()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => localAccountStore.get(key) ?? null,
      setItem: (key: string, value: string) => { localAccountStore.set(key, value) },
      removeItem: (key: string) => { localAccountStore.delete(key) },
      clear: () => { localAccountStore.clear() },
    },
  })
}

async function flushAsyncComponents() {
  for (let index = 0; index < 8; index++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

async function mountApp() {
  const { default: AppRoot } = await import('./App')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  await act(async () => {
    root.render(<AppRoot />)
  })
  await flushAsyncComponents()
  return { host }
}

beforeEach(() => {
  installLocalStorage()
  hoisted.conversations = createMockConversations()
  hoisted.labJobs = createMockLabJobs()
  hoisted.vulnDashboard = createMockVulnDashboard()
  hoisted.lastCTFInitialJobId = ''
  hoisted.accountStatus = {
    configured: false,
    authenticated: false,
    state: 'unconfigured',
  }
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('App cross-module routing', () => {
  it('returns an authenticated user to the login gate immediately after logout', async () => {
    hoisted.accountStatus = {
      configured: true,
      authenticated: true,
      state: 'active',
      user: { githubLogin: 'milksu', displayName: 'MilkSU', avatarUrl: '' },
    }
    window.localStorage.setItem('milksu.account.continue-local', '1')
    const { host } = await mountApp()

    expect(host.querySelector('[aria-label="mock account login gate"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="logout account"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock account login gate"]')?.textContent).toBe('signed_out')
    expect(host.querySelector('[aria-label="mock sidebar"]')).toBeNull()
    expect(window.localStorage.getItem('milksu.account.continue-local')).toBeNull()
  }, 30_000)

  it('opens a security-tool setup draft in a new Coding task without sending it', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open settings"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="configure security tool in coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(host.querySelector('[data-chat-draft]')?.textContent).toBe('检查并准备 IDA Pro。')
    expect(hoisted.conversations?.startNew).toHaveBeenCalledTimes(1)
    expect(hoisted.conversations?.setCodingPolicy).toHaveBeenCalledWith('go', 'full-auto')
    expect(hoisted.conversations?.send).not.toHaveBeenCalled()
  }, 30_000)

  it('keeps a CTF Agent resume point across CVE navigation and returns to the CTF workspace', async () => {
    const { host } = await mountApp()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="mock Chat page"]')).toBeNull()
    expect(hoisted.conversations?.activeId).toBe('ctf-job-1')
    const opened = hoisted.conversations?.conversations.find(item => item.id === 'ctf-job-1')
    expect(opened?.domainTaskContext).toMatchObject({
      kind: 'ctf',
      challengeId: 'ch-1',
      authorizedScope: expect.stringContaining('source-1'),
    })
    expect(opened?.messages ?? []).toEqual([])
    expect(hoisted.conversations?.pendingComposerDraft).toBeNull()
    expect(hoisted.conversations?.send).not.toHaveBeenCalled()
    expect(hoisted.conversations?.activeRunning).toBe(false)

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CVE"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CVE page"]')).not.toBeNull()
    expect(hoisted.conversations?.conversations.some(item => item.id === 'ctf-job-1')).toBe(true)

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CTF"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[data-ctf-initial-job]')?.textContent).toBe('none')
    expect(hoisted.conversations?.conversations.some(item => item.id === 'ctf-job-1')).toBe(true)
  })

  it('returns from a CTF Agent chat to the workspace instead of reopening the chat surface', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()
    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="return CTF workspace"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="mock Chat page"]')).toBeNull()
    expect(host.querySelector('[data-ctf-initial-job]')?.textContent).toBe('job-1')
    expect(hoisted.conversations?.activeId).toBe('ctf-job-1')
  })

  it('does not inherit a CTF workspace when CVE opens Coding', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    expect(hoisted.conversations?.workspacePath).toContain('/ctf/job-1')

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CVE"]')?.click()
    await flushAsyncComponents()
    expect(host.querySelector('[data-vuln-workspace]')?.textContent).toBe('')
    host.querySelector<HTMLButtonElement>('[aria-label="open CVE in coding"]')?.click()
    await flushAsyncComponents()

    const active = hoisted.conversations?.active
    expect(active?.id).toBe('cve-research-cve-2024-3400')
    expect(active?.workspacePath).toBeUndefined()
    expect(active?.ctfJobId).toBeUndefined()
    expect(active?.domainTaskContext).toMatchObject({ kind: 'cve', cveId: 'CVE-2024-3400' })
    expect(host.querySelector('[aria-label="mock CVE page"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="mock Chat page"]')).toBeNull()
    expect(hoisted.conversations?.pendingComposerDraft).toBeNull()
    expect(hoisted.conversations?.send).not.toHaveBeenCalled()
  })

  it('restores the last Coding conversation when navigating back to Coding', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    expect(hoisted.conversations?.activeId).toBe('ctf-job-1')

    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(hoisted.conversations?.startNew).not.toHaveBeenCalled()
    expect(hoisted.conversations?.activeId).toBe('coding-existing')
    expect(host.querySelector('[data-chat-ctf-session]')?.textContent).toBe('false')
  })

  it('routes an explicit linked Coding conversation through the existing conversation store', async () => {
    const { host } = await mountApp()
    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()

    host.querySelector<HTMLButtonElement>('[aria-label="open linked coding conversation"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('coding-existing')
    expect(hoisted.conversations?.activeId).toBe('coding-existing')
  })
})
