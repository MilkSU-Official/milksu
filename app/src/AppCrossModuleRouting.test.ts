// @vitest-environment jsdom

import { createApp, computed, defineComponent, h, nextTick, ref, type App as VueApp } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'

const hoisted = vi.hoisted(() => ({
  conversations: null as ReturnType<typeof createMockConversations> | null,
  lastCTFInitialJobId: '',
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
  const conversationRows = ref<Conversation[]>([
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
  ])
  const activeId = ref<string | null>('coding-existing')
  const workspacePath = ref('/Users/milksu/code/milksu')

  const active = computed(() => (
    conversationRows.value.find(conversation => conversation.id === activeId.value) ?? null
  ))

  const pendingComposerDraft = ref<{ prompt: string; visibleText: string } | null>(null)

  return {
    conversations: conversationRows,
    activeId,
    active,
    workspacePath,
    activeRunning: computed(() => false),
    activeAborting: computed(() => false),
    activeMessageQueue: computed(() => ({ steering: [], followUp: [] })),
    activeSessionReady: computed(() => true),
    activeResumed: computed(() => false),
    activeCompacting: computed(() => false),
    activeCompactedAt: computed(() => undefined),
    activeCompactionError: computed(() => ''),
    selectedModelMode: ref<'auto' | 'manual'>('manual'),
    selectedModelProvider: ref('openai'),
    selectedModelId: ref('gpt-test'),
    selectedModelSourcePreference: ref<'auto' | 'account' | 'personal'>('auto'),
    selectedExecutionMode: ref<'plan' | 'go'>('go'),
    selectedApprovalPolicy: ref<'read-only' | 'ask' | 'workspace-auto' | 'full-auto'>('workspace-auto'),
    selectedMCPServers: ref<string[]>([]),
    selectedMCPConfigDigest: ref(''),
    load: vi.fn(async () => undefined),
    listen: vi.fn(async () => undefined),
    startNew: vi.fn(() => {
      const id = `coding-${conversationRows.value.length + 1}`
      conversationRows.value.push(baseConversation({
        id,
        title: 'New Coding',
        createdAt: Date.now(),
      }))
      activeId.value = id
      return id
    }),
    ensureConversation: vi.fn((title: string, options: {
      conversationId?: string
      workspacePath?: string
      domainTaskContext?: Conversation['domainTaskContext']
    } = {}) => {
      const id = options.conversationId || `ensured-${conversationRows.value.length + 1}`
      const existing = conversationRows.value.find(item => item.id === id)
      if (existing) {
        existing.title = title
        existing.workspacePath = options.workspacePath?.trim() || undefined
        existing.domainTaskContext = options.domainTaskContext ?? existing.domainTaskContext
        if (options.domainTaskContext?.kind === 'cve') {
          existing.ctfJobId = undefined
          existing.ctfMode = undefined
          existing.ctfRole = undefined
        }
        activeId.value = id
        workspacePath.value = existing.workspacePath ?? ''
        return id
      }
      conversationRows.value.push(baseConversation({
        id,
        title,
        createdAt: Date.now(),
        workspacePath: options.workspacePath?.trim() || undefined,
        domainTaskContext: options.domainTaskContext,
      }))
      activeId.value = id
      workspacePath.value = options.workspacePath?.trim() || ''
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
    }) => {
      // Mirror production default: open Coding without auto-send.
      expect(task.autoSend === true).toBe(false)
      const id = task.conversationId
        || (task.jobId ? `ctf-${task.jobId}` : `coding-${conversationRows.value.length + 1}`)
      const existing = conversationRows.value.find(conversation => conversation.id === id)
      if (existing) {
        existing.workspacePath = task.workspacePath?.trim() || undefined
        existing.domainTaskContext = task.domainTaskContext ?? existing.domainTaskContext
        existing.ctfJobId = task.jobId ?? existing.ctfJobId
        existing.ctfRole = task.role ?? existing.ctfRole
        activeId.value = existing.id
        workspacePath.value = existing.workspacePath ?? ''
        if (task.prompt) pendingComposerDraft.value = {
          prompt: task.prompt,
          visibleText: task.prompt,
        }
        return
      }
      conversationRows.value.push(baseConversation({
        id,
        title: task.title,
        createdAt: Date.now(),
        workspacePath: task.workspacePath?.trim() || undefined,
        ctfJobId: task.jobId,
        ctfRole: task.role ?? (task.jobId ? 'solver' : undefined),
        domainTaskContext: task.domainTaskContext,
        // No synthetic assistant "started" message: open path does not send.
        messages: [],
      }))
      activeId.value = id
      workspacePath.value = task.workspacePath?.trim() || ''
      if (task.prompt) pendingComposerDraft.value = {
        prompt: task.prompt,
        visibleText: task.prompt,
      }
    }),
    stageComposerDraft: vi.fn((prompt: string, visibleText = prompt) => {
      pendingComposerDraft.value = { prompt, visibleText }
    }),
    consumeComposerDraft: vi.fn(() => {
      const draft = pendingComposerDraft.value
      pendingComposerDraft.value = null
      return draft
    }),
    pendingComposerDraft,
    send: vi.fn(async () => {
      throw new Error('send must not run on open-Coding handoff')
    }),
    abort: vi.fn(async () => undefined),
    remove: vi.fn(),
    setWorkspace: vi.fn((path: string) => {
      workspacePath.value = path
    }),
    setModelSelection: vi.fn(),
    setModelSourcePreference: vi.fn(),
    setCodingPolicy: vi.fn(),
    setMCPSelection: vi.fn(),
    compactContext: vi.fn(),
    controlGoal: vi.fn(),
    respondApproval: vi.fn(),
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
      return {
        configured: false,
        authenticated: false,
        state: 'unconfigured',
      }
    }
    if (command === 'get_startup_recovery_status') return null
    return null
  }),
  listenEvent: vi.fn(async () => () => undefined),
}))

vi.mock('@/composables/useConversations', () => ({
  useConversations: () => hoisted.conversations,
}))

vi.mock('@/composables/useNSSCTFTraining', () => ({
  useNSSCTFTraining: () => ({
    dashboard: ref(null),
  }),
}))

vi.mock('@/components-vue/AppSidebar.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'AppSidebar',
    props: ['activeSection'],
    emits: ['navigate', 'selectConversation', 'new', 'deleteConversation', 'navigateCtf', 'settings'],
    setup(props, { emit }) {
      return () => h('nav', { 'aria-label': 'mock sidebar' }, [
        h('span', { 'data-active-section': props.activeSection }, String(props.activeSection)),
        h('button', { 'aria-label': 'navigate CTF', onClick: () => emit('navigate', 'ctf') }, 'CTF'),
        h('button', { 'aria-label': 'navigate CVE', onClick: () => emit('navigate', 'vuln') }, 'CVE'),
        h('button', { 'aria-label': 'navigate Coding', onClick: () => emit('navigate', 'chat') }, 'Coding'),
      ])
    },
  }),
}))

vi.mock('@/components-vue/CTFPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'CTFPage',
    props: ['initialJobId', 'ctfSection'],
    emits: ['openSettings', 'startCodingAgent'],
    setup(props, { emit }) {
      return () => {
        hoisted.lastCTFInitialJobId = String(props.initialJobId ?? '')
        return h('section', { 'aria-label': 'mock CTF page' }, [
          h('span', { 'data-ctf-initial-job': String(props.initialJobId ?? '') }, String(props.initialJobId ?? 'none')),
          h('span', { 'data-ctf-section': String(props.ctfSection) }, String(props.ctfSection)),
          h('button', {
            'aria-label': 'open CTF in coding',
            onClick: () => emit('startCodingAgent', {
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
            }),
          }, '在 Coding 中打开'),
        ])
      }
    },
  }),
}))

vi.mock('@/components-vue/VulnPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'VulnPage',
    props: ['codingWorkspacePath'],
    emits: ['openSettings', 'chooseCodingWorkspace', 'startCodingTask'],
    setup(props, { emit }) {
      return () => h('section', { 'aria-label': 'mock CVE page' }, [
        h('span', { 'data-vuln-workspace': String(props.codingWorkspacePath ?? '') }, String(props.codingWorkspacePath ?? '')),
        h('button', {
          'aria-label': 'open CVE in coding',
          onClick: () => emit('startCodingTask', {
            title: 'CVE-2024-3400 研究接力',
            visibleText: '接手 CVE-2024-3400',
            prompt: '只读检查 CVE-2024-3400；不运行 PoC、exploit 或外部扫描。',
            domainTaskContext: {
              kind: 'cve',
              cveId: 'CVE-2024-3400',
              title: 'PAN-OS',
              sourceEvidenceState: 'NVD',
              sourceEvidenceCount: 1,
              assetMatchState: '3 项资产',
              assetCount: 3,
              researchScope: 'read-only',
              safetyBoundary: '不运行 PoC、exploit 或外部扫描',
              roleLabel: 'CVE 只读/研究接力',
            },
          }),
        }, '交给 Coding'),
      ])
    },
  }),
}))

vi.mock('@/components-vue/ChatPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'ChatPage',
    props: ['conversation', 'ctfSession', 'vulnerabilitySession', 'pendingComposerDraft'],
    emits: [
      'send',
      'ctfAction',
      'abort',
      'compactContext',
      'controlGoal',
      'respondApproval',
      'chooseWorkspace',
      'changeModel',
      'changeCodingPolicy',
      'changeMcpServers',
      'openSettings',
      'openConversation',
      'returnCtf',
      'returnVuln',
      'switchCtfAgent',
    ],
    setup(props, { emit }) {
      return () => h('section', { 'aria-label': 'mock Chat page' }, [
        h('span', { 'data-chat-conversation': props.conversation?.id ?? '' }, props.conversation?.id ?? 'none'),
        h('span', { 'data-chat-ctf-session': String(Boolean(props.ctfSession)) }, String(Boolean(props.ctfSession))),
        h('span', { 'data-chat-vulnerability-session': String(Boolean(props.vulnerabilitySession)) }, String(Boolean(props.vulnerabilitySession))),
        h('span', { 'data-chat-draft': props.pendingComposerDraft?.visibleText ?? '' }, props.pendingComposerDraft?.visibleText ?? ''),
        h('button', { 'aria-label': 'open history conversation', onClick: () => emit('openConversation', 'coding-history') }, '打开来源会话'),
        h('button', { 'aria-label': 'return CTF workspace', onClick: () => emit('returnCtf') }, '返回 CTF 工作台'),
      ])
    },
  }),
}))

vi.mock('@/components-vue/SettingsPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'SettingsPage',
    emits: ['close', 'settingsChange'],
    setup() {
      return () => h('section', { 'aria-label': 'mock settings page' }, 'Settings')
    },
  }),
}))

vi.mock('@/components-vue/StartupRecoveryBanner.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'StartupRecoveryBanner',
    emits: ['dismiss', 'openRecovery'],
    setup() {
      return () => h('section', { 'aria-label': 'mock recovery banner' }, 'Recovery')
    },
  }),
}))

const mountedApps: VueApp[] = []

async function flushAsyncComponents() {
  for (let index = 0; index < 3; index++) {
    await Promise.resolve()
    await nextTick()
  }
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

async function mountApp() {
  const { default: AppRoot } = await import('./App.vue')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AppRoot)
  app.mount(host)
  mountedApps.push(app)
  await flushAsyncComponents()
  return { host }
}

beforeEach(() => {
  hoisted.conversations = createMockConversations()
  hoisted.lastCTFInitialJobId = ''
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('App cross-module routing', () => {
  it('keeps a CTF Agent resume point across CVE navigation and returns to the CTF workspace', async () => {
    const { host } = await mountApp()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('ctf-job-1')
    expect(host.querySelector('[data-chat-ctf-session]')?.textContent).toBe('true')
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')
    const opened = hoisted.conversations?.conversations.value.find(item => item.id === 'ctf-job-1')
    expect(opened?.domainTaskContext).toMatchObject({
      kind: 'ctf',
      challengeId: 'ch-1',
      authorizedScope: expect.stringContaining('source-1'),
    })
    expect(opened?.messages ?? []).toEqual([])
    expect(hoisted.conversations?.pendingComposerDraft.value?.prompt).toContain('solve with exact scope')
    expect(hoisted.conversations?.send).not.toHaveBeenCalled()
    expect(hoisted.conversations?.activeRunning.value).toBe(false)

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CVE"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CVE page"]')).not.toBeNull()
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CTF"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[data-ctf-initial-job]')?.textContent).toBe('job-1')
    expect(hoisted.lastCTFInitialJobId).toBe('job-1')
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')
  })

  it('returns from a CTF Agent chat to the workspace instead of reopening the chat surface', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="return CTF workspace"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="mock Chat page"]')).toBeNull()
    expect(host.querySelector('[data-ctf-initial-job]')?.textContent).toBe('job-1')
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')
  })

  it('does not inherit a CTF workspace when CVE opens Coding and stages its draft', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    expect(hoisted.conversations?.workspacePath.value).toContain('/ctf/job-1')

    host.querySelector<HTMLButtonElement>('[aria-label="navigate CVE"]')?.click()
    await flushAsyncComponents()
    expect(host.querySelector('[data-vuln-workspace]')?.textContent).toBe('')
    host.querySelector<HTMLButtonElement>('[aria-label="open CVE in coding"]')?.click()
    await flushAsyncComponents()

    const active = hoisted.conversations?.active.value
    expect(active?.id).toBe('cve-research-cve-2024-3400')
    expect(active?.workspacePath).toBeUndefined()
    expect(active?.ctfJobId).toBeUndefined()
    expect(active?.domainTaskContext).toMatchObject({ kind: 'cve', cveId: 'CVE-2024-3400' })
    expect(host.querySelector('[data-chat-vulnerability-session]')?.textContent).toBe('true')
    expect(host.querySelector('[data-chat-draft]')?.textContent).toBe('接手 CVE-2024-3400')
    expect(hoisted.conversations?.send).not.toHaveBeenCalled()
  })

  it('restores Coding navigation to the remembered non-CTF conversation after visiting a CTF Agent', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="open CTF in coding"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('coding-existing')
    expect(host.querySelector('[data-chat-ctf-session]')?.textContent).toBe('false')
    expect(hoisted.conversations?.activeId.value).toBe('coding-existing')
  })

  it('returns from a related-history graph node to its source conversation', async () => {
    hoisted.conversations?.conversations.value.push(baseConversation({
      id: 'coding-history',
      title: '历史来源会话',
      createdAt: 3,
    }))
    const { host } = await mountApp()
    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()

    host.querySelector<HTMLButtonElement>('[aria-label="open history conversation"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('coding-history')
    expect(hoisted.conversations?.activeId.value).toBe('coding-history')
  })
})
