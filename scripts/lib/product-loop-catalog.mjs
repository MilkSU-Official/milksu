/**
 * Product-loop modules in first-use order.
 * Not a model bench catalog. Lives outside App startup.
 * TokenFlux, if used, is https://tokenflux.dev/v1 only.
 */

export const PRODUCT_LOOP_SCHEMA = 'milksu-product-loop/v2'
export const TOKENFLUX_BASE_URL = 'https://tokenflux.dev/v1'

function item(id, title, module, needsCredential = false) {
  return { id, title, module, needsDesktop: true, needsCredential }
}

export const CASES = {
  'login-gate': item('login-gate', '登录门', 'first-use'),
  'login-github-active': item('login-github-active', 'GitHub 登录', 'first-use'),
  'account-model-fileloop': item('account-model-fileloop', '账户模型文件循环', 'first-use'),
  'settings-custom-relay': item('settings-custom-relay', '设置自定义中转站', 'first-use', true),
  'relay-model-fileloop': item('relay-model-fileloop', '中转站文件循环', 'first-use', true),
  'login-skip-local': item('login-skip-local', '暂不登录进首页', 'first-use', true),

  'coding-pi-files': item('coding-pi-files', 'Pi 写文件', 'coding', true),
  'coding-pi-shell': item('coding-pi-shell', 'Pi 跑命令', 'coding', true),
  'coding-pi-edit': item('coding-pi-edit', 'Pi 改文件', 'coding', true),
  'coding-pi-compact': item('coding-pi-compact', 'Pi 整理上下文', 'coding', true),
  'coding-pi-steer': item('coding-pi-steer', 'Pi 插话', 'coding', true),
  'coding-pi-stop': item('coding-pi-stop', 'Pi 停止', 'coding', true),
  'coding-pi-ask': item('coding-pi-ask', 'Pi 选择卡', 'coding', true),
  'coding-pi-ask-continue': item('coding-pi-ask-continue', 'Pi 选择卡答完续跑', 'coding', true),
  'coding-cite': item('coding-cite', '加入对话引用', 'coding', true),
  'coding-attach': item('coding-attach', '附件进回合', 'coding', true),
  'coding-pi-handoff': item('coding-pi-handoff', 'Pi 接到 DSH', 'coding', true),
  'coding-dsh-files': item('coding-dsh-files', 'DSH 写文件', 'coding', true),
  'coding-dsh-shell': item('coding-dsh-shell', 'DSH 跑命令', 'coding', true),
  'coding-dsh-queue': item('coding-dsh-queue', 'DSH 排队', 'coding', true),
  'coding-dsh-plan': item('coding-dsh-plan', 'DSH 计划模式', 'coding', true),
  'coding-dsh-goal': item('coding-dsh-goal', 'DSH 目标', 'coding', true),
  'coding-dsh-multitask': item('coding-dsh-multitask', 'DSH 并行会话', 'coding', true),
  'coding-dsh-stop': item('coding-dsh-stop', 'DSH 停止', 'coding', true),
  'coding-dsh-compact': item('coding-dsh-compact', 'DSH 整理上下文', 'coding', true),
  'session-new': item('session-new', '新会话画布', 'coding'),
  'session-pin': item('session-pin', '钉选顺序', 'coding'),
  'session-rename': item('session-rename', '重命名会话', 'coding'),
  'session-fork': item('session-fork', 'Fork 会话', 'coding'),
  'session-archive': item('session-archive', '归档会话', 'coding'),
  'session-delete': item('session-delete', '删除会话', 'coding'),
  'session-command-panel': item('session-command-panel', '命令面板', 'coding'),
  'composer-model': item('composer-model', '作曲栏模型', 'coding'),
  'composer-runtime': item('composer-runtime', '作曲栏运行时', 'coding'),
  'composer-git': item('composer-git', '作曲栏 Git', 'coding'),
  'composer-plus': item('composer-plus', '作曲栏加号', 'coding'),
  'rail-open': item('rail-open', '右侧栏', 'coding'),
  'terminal-open': item('terminal-open', '底部终端', 'coding'),
  'session-context-menu': item('session-context-menu', '会话右键菜单', 'coding'),

  'companion-ready': item('companion-ready', '桌宠就绪', 'companion', true),
  'companion-page': item('companion-page', '桌宠页', 'companion'),
  'companion-relay': item('companion-relay', '桌宠转达', 'companion', true),
  'companion-board': item('companion-board', '桌宠看板', 'companion', true),
  'companion-sessions': item('companion-sessions', '多会话看板', 'companion', true),
  'companion-transcript': item('companion-transcript', '大量对话', 'companion', true),
  'companion-archive': item('companion-archive', '桌宠归档', 'companion', true),
  'companion-memory': item('companion-memory', '桌宠记忆', 'companion', true),
  'companion-dispatch-confirm': item('companion-dispatch-confirm', '跨会话调度确认', 'companion', true),
  'companion-model-switch': item('companion-model-switch', '换桌宠模型再发', 'companion', true),
  'companion-settings-model': item('companion-settings-model', '桌宠模型设置', 'companion'),
  'companion-settings-dispatch': item('companion-settings-dispatch', '跨会话调度设置', 'companion'),
  'companion-settings-proactivity': item('companion-settings-proactivity', '主动性设置', 'companion'),
  'companion-float': item('companion-float', '悬浮窗设置', 'companion'),

  'workspace-ctf-open': item('workspace-ctf-open', '打开 CTF', 'workspaces'),
  'workspace-ctf-sync': item('workspace-ctf-sync', 'CTF 同步', 'workspaces'),
  'workspace-ctf-search': item('workspace-ctf-search', 'CTF 搜索', 'workspaces'),
  'workspace-ctf-filter': item('workspace-ctf-filter', 'CTF 分类', 'workspaces'),
  'workspace-ctf-list': item('workspace-ctf-list', 'CTF 列表', 'workspaces'),
  'workspace-ctf-open-item': item('workspace-ctf-open-item', '打开一道 CTF', 'workspaces'),
  'workspace-ctf-platforms': item('workspace-ctf-platforms', 'CTF 训练平台', 'workspaces'),
  'workspace-ctf-start': item('workspace-ctf-start', 'CTF 开始解题', 'workspaces'),
  'workspace-ctf-start-job': item('workspace-ctf-start-job', 'CTF 开始并留下任务', 'workspaces'),
  'workspace-ctf-daily': item('workspace-ctf-daily', 'CTF 每日挑战', 'workspaces'),
  'workspace-ctf-jobs': item('workspace-ctf-jobs', 'CTF 任务列表', 'workspaces'),

  'workspace-cve-open': item('workspace-cve-open', '打开 CVE', 'workspaces'),
  'workspace-cve-search': item('workspace-cve-search', 'CVE 搜索', 'workspaces'),
  'workspace-cve-severity': item('workspace-cve-severity', 'CVE 严重性', 'workspaces'),
  'workspace-cve-sync': item('workspace-cve-sync', 'CVE 同步公开源', 'workspaces'),
  'workspace-cve-list': item('workspace-cve-list', 'CVE 列表', 'workspaces'),
  'workspace-cve-public-search': item('workspace-cve-public-search', '查找公开 CVE', 'workspaces'),
  'workspace-cve-open-item': item('workspace-cve-open-item', '打开一条 CVE', 'workspaces'),
  'workspace-cve-dossier': item('workspace-cve-dossier', 'CVE 档案', 'workspaces'),
  'workspace-cve-repro': item('workspace-cve-repro', 'CVE 复现入口', 'workspaces'),
  'workspace-cve-start-job': item('workspace-cve-start-job', 'CVE 开始并留下任务', 'workspaces'),
  'workspace-cve-jobs': item('workspace-cve-jobs', 'CVE 跟踪列表', 'workspaces'),

  'workspace-lab-open': item('workspace-lab-open', '打开 Lab', 'workspaces'),
  'workspace-lab-packages': item('workspace-lab-packages', 'Lab 题目包', 'workspaces'),
  'workspace-lab-cards': item('workspace-lab-cards', 'Lab 题目包卡片', 'workspaces'),
  'workspace-lab-start': item('workspace-lab-start', 'Lab 启动', 'workspaces'),
  'workspace-lab-jobs': item('workspace-lab-jobs', 'Lab 自定义任务', 'workspaces'),
  'workspace-lab-empty': item('workspace-lab-empty', 'Lab 空任务', 'workspaces'),
  'workspace-lab-create': item('workspace-lab-create', 'Lab 创建任务', 'workspaces'),
  'workspace-lab-start-job': item('workspace-lab-start-job', 'Lab 开始并留下任务', 'workspaces'),
  'workspace-lab-settings': item('workspace-lab-settings', 'Lab 本机环境', 'workspaces'),
  'workspace-lab-status': item('workspace-lab-status', 'Lab 环境状态', 'workspaces'),
  'workspace-lab-docker': item('workspace-lab-docker', 'Lab Docker', 'workspaces'),

  'desktop-cu-status': item('desktop-cu-status', 'Computer Use 权限', 'desktop-surface'),
  'desktop-cu-observe': item('desktop-cu-observe', 'Computer Use 观察计算器', 'desktop-surface', true),
  'desktop-browser-open': item('desktop-browser-open', '隔离浏览器打开', 'desktop-surface'),
  'desktop-browser-navigate': item('desktop-browser-navigate', '隔离浏览器打开页面', 'desktop-surface'),
  'desktop-browser-click': item('desktop-browser-click', '隔离浏览器点击', 'desktop-surface'),
  'desktop-browser-type': item('desktop-browser-type', '隔离浏览器打字', 'desktop-surface'),
  'desktop-browser-tabs': item('desktop-browser-tabs', '隔离浏览器标签', 'desktop-surface'),
  'desktop-browser-back': item('desktop-browser-back', '隔离浏览器后退', 'desktop-surface'),
  'desktop-browser-marker': item('desktop-browser-marker', '隔离浏览器读标记', 'desktop-surface', true),

  'profile-open': item('profile-open', '打开个人资料', 'account-shell'),
  'profile-edit': item('profile-edit', '编辑资料', 'account-shell'),
  'profile-tabs': item('profile-tabs', '资料页 CTF/CVE/Coding', 'account-shell'),
  update: item('update', '客户端更新', 'account-shell'),

  'settings-nav': item('settings-nav', '十二个设置分类', 'settings-rest'),
  'settings-general': item('settings-general', '通用', 'settings-rest'),
  'settings-models': item('settings-models', '模型', 'settings-rest'),
  'settings-ctf': item('settings-ctf', '设置 CTF', 'settings-rest'),
  'settings-cve': item('settings-cve', '设置 CVE', 'settings-rest'),
  'settings-lab': item('settings-lab', '设置 Lab', 'settings-rest'),
  'settings-skills': item('settings-skills', 'Skills', 'settings-rest'),
  'settings-mcp': item('settings-mcp', 'MCP', 'settings-rest'),
  'settings-chats': item('settings-chats', '归档聊天', 'settings-rest'),
  'settings-browser': item('settings-browser', '浏览器控制', 'settings-rest'),
  'settings-eval': item('settings-eval', '评测', 'settings-rest'),
  'settings-companion': item('settings-companion', '设置桌宠', 'settings-rest'),
  'settings-plugins': item('settings-plugins', '插件', 'settings-rest'),
}

export const MODULES = {
  'first-use': {
    id: 'first-use',
    title: '上手',
    from: 'login / account / relay',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: '独立窗口冷启动两次：先看见登录页，走 GitHub / 账户模型 / 设置里填中转站，再开一次点暂不登录。',
    cases: ['login-gate', 'login-github-active', 'account-model-fileloop', 'settings-custom-relay', 'relay-model-fileloop', 'login-skip-local'],
  },
  coding: {
    id: 'coding',
    title: '主页 Coding',
    from: 'homepage after first-use',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: 'Pi 与 DSH 日常开发：写文件、改文件、跑命令、插话、排队、停止、整理上下文、选择卡、计划、目标、并行，以及会话壳和作曲栏。',
    cases: [
      'coding-pi-files', 'coding-pi-shell', 'coding-pi-edit', 'coding-pi-compact', 'coding-pi-steer', 'coding-pi-stop', 'coding-pi-ask', 'coding-pi-ask-continue', 'coding-cite', 'coding-attach', 'coding-pi-handoff',
      'coding-dsh-files', 'coding-dsh-shell', 'coding-dsh-queue', 'coding-dsh-plan', 'coding-dsh-goal', 'coding-dsh-multitask', 'coding-dsh-stop', 'coding-dsh-compact',
      'session-new', 'session-pin', 'session-rename', 'session-fork', 'session-archive', 'session-delete', 'session-command-panel',
      'composer-model', 'composer-runtime', 'composer-git', 'composer-plus', 'rail-open', 'terminal-open', 'session-context-menu',
    ],
  },
  companion: {
    id: 'companion',
    title: '桌宠',
    from: 'companion product',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: '桌宠页、就绪、转达、看板、多会话、大量对话、归档、记忆，以及设置里的模型、调度、主动性和悬浮窗。',
    cases: [
      'companion-ready', 'companion-page', 'companion-relay', 'companion-board', 'companion-sessions', 'companion-transcript',
      'companion-archive', 'companion-memory', 'companion-dispatch-confirm', 'companion-model-switch',
      'companion-settings-model', 'companion-settings-dispatch', 'companion-settings-proactivity', 'companion-float',
    ],
  },
  workspaces: {
    id: 'workspaces',
    title: '领域工作区',
    from: 'CTF / CVE / Lab',
    default: true,
    needsDesktop: true,
    needsCredential: false,
    isolated: true,
    detail: 'CTF、CVE、Lab 各十条：打开、搜索、筛选、列表、打开一条、同步、开始/复现/启动、任务列表和本机环境。',
    cases: [
      'workspace-ctf-open', 'workspace-ctf-sync', 'workspace-ctf-search', 'workspace-ctf-filter', 'workspace-ctf-list',
      'workspace-ctf-open-item', 'workspace-ctf-platforms', 'workspace-ctf-start', 'workspace-ctf-start-job', 'workspace-ctf-daily', 'workspace-ctf-jobs',
      'workspace-cve-open', 'workspace-cve-search', 'workspace-cve-severity', 'workspace-cve-sync', 'workspace-cve-list',
      'workspace-cve-public-search', 'workspace-cve-start-job', 'workspace-cve-open-item', 'workspace-cve-dossier', 'workspace-cve-repro', 'workspace-cve-jobs',
      'workspace-lab-open', 'workspace-lab-packages', 'workspace-lab-cards', 'workspace-lab-start',
      'workspace-lab-start-job', 'workspace-lab-jobs', 'workspace-lab-empty', 'workspace-lab-create',
      'workspace-lab-settings', 'workspace-lab-status', 'workspace-lab-docker',
    ],
  },
  'desktop-surface': {
    id: 'desktop-surface',
    title: '桌面执行面',
    from: 'Computer Use / isolated browser',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: 'Computer Use 单独看权限和观察计算器，缺权限就算失败，不偷偷改走浏览器。隔离浏览器自己测打开、跳转、点击、标签、后退和读标记。',
    cases: [
      'desktop-cu-status', 'desktop-cu-observe',
      'desktop-browser-open', 'desktop-browser-navigate', 'desktop-browser-click', 'desktop-browser-type', 'desktop-browser-tabs', 'desktop-browser-back', 'desktop-browser-marker',
    ],
  },
  'account-shell': {
    id: 'account-shell',
    title: '账户与更新',
    from: 'profile / OTA',
    default: true,
    needsDesktop: true,
    needsCredential: false,
    isolated: true,
    detail: '打开个人资料、改显示名称和介绍、切换 CTF/CVE/Coding 页签；侧栏页脚看版本号和更新。',
    cases: ['profile-open', 'profile-edit', 'profile-tabs', 'update'],
  },
  'settings-rest': {
    id: 'settings-rest',
    title: '设置其余项',
    from: 'settings remainder',
    default: true,
    needsDesktop: true,
    needsCredential: false,
    isolated: true,
    detail: '十二个设置分类都能打开，并核对各页自己的控件：通用、模型、CTF、CVE、Lab、Skills、MCP、归档聊天、浏览器控制、评测、桌宠、插件。',
    cases: [
      'settings-nav', 'settings-general', 'settings-models', 'settings-ctf', 'settings-cve', 'settings-lab',
      'settings-skills', 'settings-mcp', 'settings-chats', 'settings-browser', 'settings-eval', 'settings-companion', 'settings-plugins',
    ],
  },
}

export const MODULE_RUN_ORDER = [
  'first-use',
  'coding',
  'companion',
  'workspaces',
  'desktop-surface',
  'account-shell',
  'settings-rest',
]

export const CASE_RUN_ORDER = MODULE_RUN_ORDER.flatMap(id => MODULES[id].cases)
export const DEFAULT_MODULES = MODULE_RUN_ORDER.filter(id => MODULES[id].default)
export const DEFAULT_SUITES = [...DEFAULT_MODULES]
export const SUITE_RUN_ORDER = [...CASE_RUN_ORDER]

export const SUITES = Object.fromEntries([
  ...Object.values(MODULES).map(module => [module.id, {
    id: module.id,
    title: module.title,
    from: module.from,
    needsDesktop: module.needsDesktop,
    needsCredential: module.needsCredential,
    detail: module.detail,
    module: true,
    cases: module.cases,
  }]),
  ...Object.values(CASES).map(row => [row.id, {
    ...row,
    from: MODULES[row.module].from,
    detail: MODULES[row.module].detail,
  }]),
])

export function expandSuiteSelection(ids) {
  const cases = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (MODULES[id]) {
      cases.push(...MODULES[id].cases)
      continue
    }
    if (CASES[id]) {
      cases.push(id)
      continue
    }
    throw new Error(`unknown product-loop suite: ${raw}. known: ${Object.keys(SUITES).join(', ')}`)
  }
  return orderCases([...new Set(cases)])
}

export function orderCases(ids) {
  return [...ids].sort((left, right) => CASE_RUN_ORDER.indexOf(left) - CASE_RUN_ORDER.indexOf(right))
}

export function orderSuites(ids) {
  return expandSuiteSelection(ids)
}

export function groupCasesByModule(caseIds) {
  return MODULE_RUN_ORDER
    .map(moduleId => {
      const module = MODULES[moduleId]
      const cases = module.cases.filter(id => caseIds.includes(id)).map(id => CASES[id])
      return cases.length ? { module, cases } : null
    })
    .filter(Boolean)
}

export function parseSuiteList(raw) {
  const text = String(raw ?? '').trim()
  if (!text || text === 'all') return [...DEFAULT_SUITES]
  const ids = text.split(',').map(row => row.trim()).filter(Boolean)
  const unknown = ids.filter(id => !SUITES[id])
  if (unknown.length) {
    throw new Error(`unknown product-loop suite: ${unknown.join(', ')}. known: ${Object.keys(SUITES).join(', ')}`)
  }
  return [...new Set(ids)]
}

const ALLOWED_FLAGS = new Set(['--help', '-h', '--list', '--gui'])

export function parseProductLoopArgs(argv) {
  const flags = new Set(argv.filter(row => row.startsWith('--') && !row.startsWith('--suite')))
  const unknownFlags = [...flags].filter(flag => !ALLOWED_FLAGS.has(flag))
  if (unknownFlags.length) {
    throw new Error(`unknown product-loop flag: ${unknownFlags.join(', ')}`)
  }
  let suiteRaw = 'all'
  for (let index = 0; index < argv.length; index += 1) {
    const row = argv[index]
    if (row === '--suite') {
      suiteRaw = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (row.startsWith('--suite=')) {
      suiteRaw = row.slice('--suite='.length)
    }
  }
  const requested = parseSuiteList(suiteRaw)
  const cases = expandSuiteSelection(requested)
  if (flags.has('--help') || flags.has('-h')) {
    return { help: true, list: false, mode: 'gui', suites: [...DEFAULT_SUITES], cases, requested }
  }
  if (flags.has('--list')) {
    return { help: false, list: true, mode: 'gui', suites: [...DEFAULT_SUITES], cases, requested }
  }
  return {
    help: false,
    list: false,
    mode: 'gui',
    gui: true,
    suites: requested,
    cases,
    requested,
    taskTimeoutMs: 180_000,
    desktopReadyMs: 240_000,
  }
}

export function finalizeProductLoopResult(suites, requestedIds, humanReview = []) {
  const rows = suites ?? []
  const failed = rows.filter(row => row.result === 'FAIL')
  const recorded = new Set(rows.map(row => row.id))
  const wanted = expandSuiteSelection(requestedIds ?? [])
  const missing = wanted.filter(id => !recorded.has(id))
  if (failed.length || missing.length) return 'FAIL'
  if (!rows.length && (humanReview ?? []).length) return 'FAIL'
  return 'PASS'
}
