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
  'login-intent-fallback': item('login-intent-fallback', '未登录走主模型', 'first-use', true),
  'login-intent-issued': item('login-intent-issued', '登录后发下决策钥匙', 'first-use'),

  'coding-pi-files': item('coding-pi-files', 'Pi 写文件', 'coding', true),
  'coding-pi-subagent': item('coding-pi-subagent', 'Pi 后台子代理', 'coding', true),
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
  'coding-user-memory': item('coding-user-memory', 'Coding 用户记忆', 'coding', true),
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
  'session-transcript-window': item('session-transcript-window', '长会话翻阅', 'coding'),
  'session-command-panel': item('session-command-panel', '命令面板', 'coding'),
  'composer-model': item('composer-model', '输入栏模型', 'coding'),
  'composer-runtime': item('composer-runtime', '输入栏运行时', 'coding'),
  'composer-git': item('composer-git', '输入栏 Git', 'coding'),
  'composer-plus': item('composer-plus', '输入栏加号', 'coding'),
  'rail-open': item('rail-open', '右侧栏', 'coding'),
  'terminal-open': item('terminal-open', '底部终端', 'coding'),
  'session-context-menu': item('session-context-menu', '会话右键菜单', 'coding'),

  'companion-ready': item('companion-ready', '看板娘就绪', 'companion', true),
  'companion-page': item('companion-page', '看板娘小窗', 'companion'),
  'companion-pet-menu': item('companion-pet-menu', '看板娘右键菜单', 'companion'),
  'companion-pet-drag': item('companion-pet-drag', '看板娘身体拖拽', 'companion'),
  'companion-core': item('companion-core', '看板娘核心循环', 'companion', true),
  'companion-archive': item('companion-archive', '看板娘归档', 'companion', true),
  'companion-memory': item('companion-memory', '看板娘记忆', 'companion', true),
  'companion-memory-settings': item('companion-memory-settings', '看板娘记忆设置', 'companion'),
  'companion-dispatch-confirm': item('companion-dispatch-confirm', '跨会话调度确认', 'companion', true),
  'companion-fuzz-app': item('companion-fuzz-app', '看板娘功能询问', 'companion', true),
  'companion-fuzz-recovery': item('companion-fuzz-recovery', '看板娘停后再续跑', 'companion', true),
  'companion-model-switch': item('companion-model-switch', '换看板娘模型再发', 'companion', true),
  'companion-settings-model': item('companion-settings-model', '看板娘模型设置', 'companion'),
  'companion-settings-dispatch': item('companion-settings-dispatch', '跨会话调度设置', 'companion'),
  'companion-settings-proactivity': item('companion-settings-proactivity', '主动性设置', 'companion'),
  'companion-float': item('companion-float', '悬浮窗设置', 'companion'),
  'companion-skin-default': item('companion-skin-default', '出厂皮肤', 'companion'),
  'companion-skin-import': item('companion-skin-import', '导入第三方皮肤', 'companion'),
  'companion-skin-apply': item('companion-skin-apply', '换上第三方皮肤', 'companion'),
  'companion-float-surface': item('companion-float-surface', '悬浮窗出厂帧', 'companion'),
  'companion-hide': item('companion-hide', '隐藏看板娘', 'companion'),
  'companion-show': item('companion-show', '显示看板娘', 'companion'),
  'companion-dock-park': item('companion-dock-park', '关掉主窗口留桌面栏', 'companion'),

  'intent-account-issued': item('intent-account-issued', '账户发下决策钥匙', 'decisions'),
  'intent-settings-blank': item('intent-settings-blank', '设置里没有钥匙', 'decisions'),
  'intent-settings-reject': item('intent-settings-reject', '设置里写不进钥匙', 'decisions'),
  'intent-chat': item('intent-chat', '闲聊直接回', 'decisions', true),
  'intent-deep': item('intent-deep', '深入思考仍在这一轮', 'decisions', true),
  'intent-long': item('intent-long', '长任务派出去', 'decisions', true),
  'intent-status': item('intent-status', '追问不另派', 'decisions', true),
  'intent-done': item('intent-done', '做完她通知', 'decisions', true),
  'intent-notices-merge': item('intent-notices-merge', '两条通知都在', 'decisions', true),
  'intent-approval': item('intent-approval', '待批她通知', 'decisions', true),
  'intent-error': item('intent-error', '真报错她通知', 'decisions', true),
  'intent-tool-continues': item('intent-tool-continues', '工具失败后还盯着', 'decisions', true),
  'intent-stall': item('intent-stall', '卡住才问说不说', 'decisions', true),
  'intent-memory': item('intent-memory', '记忆留或丢', 'decisions', true),
  'intent-other-silent': item('intent-other-silent', '没派的会话不说', 'decisions', true),
  'intent-notice-waits': item('intent-notice-waits', '开口时不串话', 'decisions', true),
  'intent-fallback-record': item('intent-fallback-record', '没接上标明主模型', 'decisions', true),

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
  'workspace-cve-learning': item('workspace-cve-learning', 'CVE 档案复盘', 'workspaces'),
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
  'settings-companion': item('settings-companion', '设置看板娘', 'settings-rest'),
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
    cases: [
      'login-gate', 'login-github-active', 'account-model-fileloop', 'settings-custom-relay',
      'relay-model-fileloop', 'login-skip-local', 'login-intent-fallback', 'login-intent-issued',
    ],
  },
  coding: {
    id: 'coding',
    title: '主页 Coding',
    from: 'homepage after first-use',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: 'Pi 与 DSH 日常开发：写文件、后台子代理、改文件、跑命令、插话、排队、停止、整理上下文、选择卡、计划、目标、并行，以及会话壳、输入栏、一条直接写下的用户记忆，和一条写满 1200 条消息的长会话翻阅（滑动窗口、锚定、「回到最新」）。',
    cases: [
      'coding-pi-files', 'coding-pi-subagent', 'coding-pi-shell', 'coding-pi-edit', 'coding-pi-compact', 'coding-pi-steer', 'coding-pi-stop', 'coding-pi-ask', 'coding-pi-ask-continue', 'coding-cite', 'coding-attach', 'coding-pi-handoff', 'coding-user-memory',
      'coding-dsh-files', 'coding-dsh-shell', 'coding-dsh-queue', 'coding-dsh-plan', 'coding-dsh-goal', 'coding-dsh-multitask', 'coding-dsh-stop', 'coding-dsh-compact',
      'session-new', 'session-pin', 'session-rename', 'session-fork', 'session-archive', 'session-delete', 'session-transcript-window', 'session-command-panel',
      'composer-model', 'composer-runtime', 'composer-git', 'composer-plus', 'rail-open', 'terminal-open', 'session-context-menu',
    ],
  },
  companion: {
    id: 'companion',
    title: '看板娘',
    from: 'companion product',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: '看板娘手机对话、右键菜单、身体拖拽、就绪、核心循环（开测时写入多条真实议题抄本，再在手机里提问、按停止、收尾），归档、记忆、记忆设置、功能询问，回合结束后停再续跑，设置里的模型、调度、主动性、悬浮窗、出厂皮肤和第三方换装，以及隐藏、显示、关掉主窗口后从 Dock / 任务栏唤醒。',
    cases: [
      'companion-ready', 'companion-page', 'companion-pet-menu', 'companion-pet-drag', 'companion-core',
      'companion-archive', 'companion-memory', 'companion-memory-settings', 'companion-dispatch-confirm', 'companion-fuzz-app',
      'companion-fuzz-recovery', 'companion-model-switch',
      'companion-settings-model', 'companion-settings-dispatch', 'companion-settings-proactivity', 'companion-float',
      'companion-skin-default', 'companion-skin-import', 'companion-skin-apply', 'companion-float-surface',
      'companion-hide', 'companion-show', 'companion-dock-park',
    ],
  },
  decisions: {
    id: 'decisions',
    title: '决策',
    from: 'companion and coding turns',
    default: true,
    needsDesktop: true,
    needsCredential: true,
    isolated: true,
    detail: '决策。账户登录后发下钥匙，设置里没有也不能写入；折叠记录的来源是 Jev。闲聊、深入思考、长任务；追问不另派；做完、待批、真报错直接通知；两条通知合成一条；工具失败后还盯着；卡住才判断说不说；记忆留或丢；开口时不和用户的话串在一起。未登录时来源是主模型。',
    cases: [
      'intent-account-issued', 'intent-settings-blank', 'intent-settings-reject',
      'intent-chat', 'intent-deep', 'intent-long', 'intent-status',
      'intent-done', 'intent-notices-merge', 'intent-approval', 'intent-error', 'intent-tool-continues',
      'intent-stall', 'intent-memory', 'intent-other-silent', 'intent-notice-waits', 'intent-fallback-record',
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
    detail: 'CTF、CVE、Lab：打开、搜索、筛选、列表、打开一条、同步、开始/复现/启动、任务列表、本机环境，以及 CVE 档案上记下并忘掉一条复盘。',
    cases: [
      'workspace-ctf-open', 'workspace-ctf-sync', 'workspace-ctf-search', 'workspace-ctf-filter', 'workspace-ctf-list',
      'workspace-ctf-open-item', 'workspace-ctf-platforms', 'workspace-ctf-start', 'workspace-ctf-start-job', 'workspace-ctf-daily', 'workspace-ctf-jobs',
      'workspace-cve-open', 'workspace-cve-search', 'workspace-cve-severity', 'workspace-cve-sync', 'workspace-cve-list',
      'workspace-cve-public-search', 'workspace-cve-start-job', 'workspace-cve-open-item', 'workspace-cve-dossier', 'workspace-cve-learning', 'workspace-cve-repro', 'workspace-cve-jobs',
      'workspace-lab-open', 'workspace-lab-packages', 'workspace-lab-cards', 'workspace-lab-start',
      'workspace-lab-empty', 'workspace-lab-jobs', 'workspace-lab-create', 'workspace-lab-start-job',
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
    detail: '十二个设置分类都能打开，并核对各页自己的控件：通用、模型、CTF、CVE、Lab、Skills、MCP、归档聊天、浏览器控制、评测、看板娘、插件。',
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
  'decisions',
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
  const failed = rows.filter(row => row.result === 'FAIL' || row.result === 'BLOCKED')
  const skipped = rows.filter(row => row.result === 'SKIP')
  const recorded = new Set(rows.map(row => row.id))
  const wanted = expandSuiteSelection(requestedIds ?? [])
  const missing = wanted.filter(id => !recorded.has(id))
  if (failed.length || missing.length) return 'FAIL'
  if (!rows.length && (humanReview ?? []).length) return 'FAIL'
  if (skipped.length) return 'SKIP'
  return 'PASS'
}
