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

  return {
    conversations: conversationRows,
    activeId,
    active,
    workspacePath,
    activeRunning: computed(() => false),
    activeAborting: computed(() => false),
    activeSessionReady: computed(() => true),
    activeResumed: computed(() => false),
    activeCompacting: computed(() => false),
    activeCompactedAt: computed(() => undefined),
    activeCompactionError: computed(() => ''),
    selectedModelMode: ref<'auto' | 'manual'>('manual'),
    selectedModelProvider: ref('openai'),
    selectedModelId: ref('gpt-test'),
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
    ensureConversation: vi.fn((title: string) => {
      const id = `ensured-${conversationRows.value.length + 1}`
      conversationRows.value.push(baseConversation({
        id,
        title,
        createdAt: Date.now(),
      }))
      activeId.value = id
      return id
    }),
    startWorkspaceTask: vi.fn(async (task: { title: string; jobId?: string; role?: Conversation['ctfRole'] }) => {
      const id = task.jobId ? `ctf-${task.jobId}` : `coding-${conversationRows.value.length + 1}`
      const existing = conversationRows.value.find(conversation => conversation.id === id)
      if (existing) {
        activeId.value = existing.id
        return
      }
      conversationRows.value.push(baseConversation({
        id,
        title: task.title,
        createdAt: Date.now(),
        ctfJobId: task.jobId,
        ctfRole: task.role ?? (task.jobId ? 'solver' : undefined),
        messages: [{
          id: `${id}-message`,
          role: 'assistant',
          content: `${task.title} started`,
          timestamp: Date.now() + 1,
        }],
      }))
      activeId.value = id
    }),
    send: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    remove: vi.fn(),
    setWorkspace: vi.fn((path: string) => {
      workspacePath.value = path
    }),
    setModelSelection: vi.fn(),
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
        model_routing: {
          default_mode: 'manual',
          fast: { provider: 'openai', model: 'gpt-test' },
        },
        model_verification: null,
        nssctf_arena: {
          token: '',
          has_token: false,
        },
      }
    }
    if (command === 'get_startup_recovery_status') return null
    return null
  }),
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
            'aria-label': 'start CTF agent',
            onClick: () => emit('startCodingAgent', {
              title: 'CTF Solver',
              prompt: 'solve',
              workspacePath: '/Users/milksu/Library/Application Support/MilkSU/ctf/job-1',
              jobId: 'job-1',
              role: 'solver',
            }),
          }, 'Start CTF Agent'),
        ])
      }
    },
  }),
}))

vi.mock('@/components-vue/VulnPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'VulnPage',
    emits: ['openSettings', 'chooseCodingWorkspace', 'startCodingTask'],
    setup() {
      return () => h('section', { 'aria-label': 'mock CVE page' }, 'CVE workspace')
    },
  }),
}))

vi.mock('@/components-vue/ChatPage.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'ChatPage',
    props: ['conversation', 'ctfSession', 'vulnerabilitySession'],
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
      'returnCtf',
      'returnVuln',
      'switchCtfAgent',
    ],
    setup(props, { emit }) {
      return () => h('section', { 'aria-label': 'mock Chat page' }, [
        h('span', { 'data-chat-conversation': props.conversation?.id ?? '' }, props.conversation?.id ?? 'none'),
        h('span', { 'data-chat-ctf-session': String(Boolean(props.ctfSession)) }, String(Boolean(props.ctfSession))),
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
    host.querySelector<HTMLButtonElement>('[aria-label="start CTF agent"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('ctf-job-1')
    expect(host.querySelector('[data-chat-ctf-session]')?.textContent).toBe('true')
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')

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

    host.querySelector<HTMLButtonElement>('[aria-label="start CTF agent"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="return CTF workspace"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock CTF page"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="mock Chat page"]')).toBeNull()
    expect(host.querySelector('[data-ctf-initial-job]')?.textContent).toBe('job-1')
    expect(hoisted.conversations?.activeId.value).toBe('ctf-job-1')
  })

  it('restores Coding navigation to the remembered non-CTF conversation after visiting a CTF Agent', async () => {
    const { host } = await mountApp()

    host.querySelector<HTMLButtonElement>('[aria-label="start CTF agent"]')?.click()
    await flushAsyncComponents()
    host.querySelector<HTMLButtonElement>('[aria-label="navigate Coding"]')?.click()
    await flushAsyncComponents()

    expect(host.querySelector('[aria-label="mock Chat page"]')).not.toBeNull()
    expect(host.querySelector('[data-chat-conversation]')?.textContent).toBe('coding-existing')
    expect(host.querySelector('[data-chat-ctf-session]')?.textContent).toBe('false')
    expect(hoisted.conversations?.activeId.value).toBe('coding-existing')
  })
})
