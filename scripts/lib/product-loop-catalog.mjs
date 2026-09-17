/**
 * Selectable product-regression suites. Not a model bench catalog.
 * Lives outside App startup. TokenFlux, if used, is https://tokenflux.dev/v1 only.
 */

export const PRODUCT_LOOP_SCHEMA = 'milksu-product-loop/v1'
export const TOKENFLUX_BASE_URL = 'https://tokenflux.dev/v1'

export const SUITES = {
  'stop-scope': {
    id: 'stop-scope',
    title: '停会话范围',
    from: '#98',
    modes: ['gui', 'bridge'],
    needsDesktop: false,
    needsCredential: false,
    detail: '回收 Sidecar 的 engine.stopped 只打到它服务过的会话；没有 sessions 时不广播。',
  },
  'composer-runtime': {
    id: 'composer-runtime',
    title: '作曲栏与配置往返',
    from: 'Working / Multitask / settings persist',
    modes: ['gui', 'bridge'],
    needsDesktop: false,
    needsCredential: false,
    detail: '作曲栏 Stop/Send 相位、DSH Working followup/inbox 排队、host commands/plan/goal/jobs、整理上下文/接到新会话、Pi 阻塞子代理、Multitask 子会话、默认运行时/忙碌发送/模型/界面语言落盘。不启桌面。',
  },
  'chat-pin': {
    id: 'chat-pin',
    title: '钉选落盘',
    from: '#97',
    modes: ['gui', 'bridge'],
    needsDesktop: false,
    needsCredential: false,
    guiPersist: true,
    detail: '钉选顺序经 conversation store 落盘。GUI 再走 SaveConversation / ListConversations。草稿隔离没有 Desktop RPC，不在这一刀冒充测过。',
  },
  'pi-files': {
    id: 'pi-files',
    title: 'Pi 文件循环',
    from: '#99 对照',
    modes: ['gui'],
    needsDesktop: true,
    needsCredential: true,
    detail: '默认 Pi 内核写出 NOTES.md，并实际调用文件工具。',
  },
  dsh: {
    id: 'dsh',
    title: 'DSH 完整循环',
    from: '#99',
    modes: ['gui', 'bridge'],
    needsDesktop: false,
    needsCredential: true,
    detail: '委托 scripts/verify-dsh-complete-loop.mjs 自己启停 Stable，不复用前面套件的窗口。',
  },
  'desktop-surface': {
    id: 'desktop-surface',
    title: '桌面执行面',
    from: '#96',
    modes: ['gui'],
    needsDesktop: true,
    needsCredential: true,
    detail: '优先 Computer Use 观察计算器。TCC / 平台 / 没窗口时降级隔离浏览器 CDP，读本机标记。不点用户 Chrome。',
  },
}

export const SUITE_RUN_ORDER = ['stop-scope', 'composer-runtime', 'dsh', 'chat-pin', 'pi-files', 'desktop-surface']
export const DEFAULT_SUITES = [...SUITE_RUN_ORDER]

export function orderSuites(ids) {
  return [...ids].sort((left, right) => (
    SUITE_RUN_ORDER.indexOf(left) - SUITE_RUN_ORDER.indexOf(right)
  ))
}

export function parseSuiteList(raw) {
  const text = String(raw ?? '').trim()
  if (!text || text === 'all') return [...DEFAULT_SUITES]
  const ids = text.split(',').map(item => item.trim()).filter(Boolean)
  const unknown = ids.filter(id => !SUITES[id])
  if (unknown.length) {
    throw new Error(`unknown product-loop suite: ${unknown.join(', ')}. known: ${Object.keys(SUITES).join(', ')}`)
  }
  return [...new Set(ids)]
}

export function parseProductLoopArgs(argv) {
  const flags = new Set(argv.filter(item => item.startsWith('--') && !item.startsWith('--suite')))
  let suiteRaw = 'all'
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--suite') {
      suiteRaw = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (item.startsWith('--suite=')) {
      suiteRaw = item.slice('--suite='.length)
    }
  }
  if (flags.has('--help') || flags.has('-h')) {
    return { help: true, list: false, mode: 'gui', suites: [...DEFAULT_SUITES] }
  }
  if (flags.has('--list')) {
    return { help: false, list: true, mode: 'gui', suites: [...DEFAULT_SUITES] }
  }
  const mode = flags.has('--bridge') && !flags.has('--gui') ? 'bridge' : 'gui'
  return {
    help: false,
    list: false,
    mode,
    gui: mode === 'gui',
    suites: orderSuites(parseSuiteList(suiteRaw)),
    taskTimeoutMs: 180_000,
    desktopReadyMs: 240_000,
  }
}

export function suiteRunnable(suite, mode) {
  if (!suite.modes.includes(mode)) {
    return { ok: false, reason: `${suite.id} 不支持 mode=${mode}` }
  }
  return { ok: true, reason: '' }
}

export function finalizeProductLoopResult(suites, requestedIds, humanReview = []) {
  const rows = suites ?? []
  const failed = rows.filter(item => item.result === 'FAIL')
  const recorded = new Set(rows.map(item => item.id))
  const missing = (requestedIds ?? []).filter(id => !recorded.has(id))
  if (failed.length || missing.length) return 'FAIL'
  if (!rows.length && (humanReview ?? []).length) return 'FAIL'
  return 'PASS'
}
