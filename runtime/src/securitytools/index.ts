import { createHash } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { readZipFile } from '../appdata/zip.ts'
import type { CommandProbe } from '../agentresources/codingtools.ts'

export const TOOL_IDA = 'ida-pro'
export const TOOL_CAPA = 'capa'
export const TOOL_CODEQL = 'codeql'
export const TOOL_BURP = 'burp-suite'
export const TOOL_SHANNON = 'shannon'
export const TOOL_REA = 'rea'

const IDA_SOURCE_REVISION = '0b5f7ae4026d3c770b190ca93c0692d1b0ceab22'
const IDA_MCP_VERSION = '2.0.0'
const CAPA_VERSION = 'v9.4.0'
const REA_VERSION = '6.1.0'
const REA_PACKAGE = 'rea-agents'

export type SecurityToolStatus =
  | 'ready'
  | 'detected'
  | 'needs_setup'
  | 'missing_app'
  | 'unavailable'
  | 'configuring'
  | 'failed'

export type ToolSnapshot = {
  id: string
  name: string
  purpose: string
  status: SecurityToolStatus
  statusLabel: string
  enabled: boolean
  usableByAgent: boolean
  version?: string
  connection: string
  runtime: string
  capabilities: string[]
  schema: string[]
  problem?: string
  primaryAction?: string
  setupSupported: boolean
  codingSupported: boolean
}

export type SetupStep = { id: string; label: string; status: string; detail?: string }

export type SetupSnapshot = {
  toolId: string
  state: string
  percent: number
  summary: string
  steps: SetupStep[]
  error?: string
  startedAt: string
  completedAt?: string
}

export type CodingHandoff = {
  toolId: string
  title: string
  prompt: string
  visibleText: string
  workspacePath?: string
  executionMode: string
  approvalPolicy: string
}

export type RuntimeTool = {
  id: string
  command: string
  args?: string[]
  version: string
  profilePath?: string
  idaPath?: string
  userIdaPath?: string
  capabilities: string[]
}

type Definition = {
  id: string
  name: string
  purpose: string
  connection: string
  runtime: string
  capabilities: string[]
  schema: string[]
  setupSupported: boolean
  codingSupported: boolean
}

const CATALOG: Definition[] = [
  {
    id: TOOL_IDA, name: 'IDA Pro', purpose: '交互式反汇编与二进制分析',
    connection: 'idalib MCP', runtime: '按需启动本地 MCP',
    capabilities: ['读取函数与反编译结果', '读取交叉引用', '读取字符串与调用图', '打开工作区内二进制数据库'],
    schema: ['idb_open', 'list_funcs', 'decompile', 'xrefs_to', 'callgraph', 'get_string'],
    setupSupported: true, codingSupported: true,
  },
  {
    id: TOOL_CAPA, name: 'capa', purpose: '识别二进制能力与行为特征',
    connection: '本地 CLI Adapter', runtime: '工作区内受限进程',
    capabilities: ['识别能力规则', '输出匹配证据', '读取样本元数据', '生成 JSON 报告'],
    schema: ['capa_analyze(relativePath, format)'],
    setupSupported: true, codingSupported: true,
  },
  {
    id: TOOL_CODEQL, name: 'CodeQL', purpose: '代码查询与漏洞分析',
    connection: '本地 CodeQL CLI', runtime: '工作区数据库',
    capabilities: ['检测本地 CLI', '创建分析数据库', '运行固定查询', '读取 SARIF 结果'],
    schema: ['本批次仅检测 CLI；专用 Adapter 尚未接入'],
    setupSupported: false, codingSupported: true,
  },
  {
    id: TOOL_BURP, name: 'Burp Suite', purpose: 'Web 安全测试与代理抓包',
    connection: '桌面软件探测', runtime: '连接现有 Burp',
    capabilities: ['检测本机 Burp', '后续读取 Proxy 历史', '后续读取 Repeater 请求'],
    schema: ['本批次仅检测软件；MCP Adapter 尚未接入'],
    setupSupported: false, codingSupported: true,
  },
  {
    id: TOOL_SHANNON, name: 'Shannon', purpose: '授权目标的安全任务 Worker',
    connection: '容器 Worker', runtime: '隔离 Docker 容器',
    capabilities: ['检测 Docker', '后续检查 Worker 健康', '后续读取任务报告'],
    schema: ['本批次仅检测运行前提；Worker Adapter 尚未接入'],
    setupSupported: false, codingSupported: true,
  },
  {
    id: TOOL_REA, name: 'REA', purpose: '静态逆向已发出的制品（原生 / Electron / .NET / APK）',
    connection: '本机 stdio MCP', runtime: '工作区内静态分析',
    capabilities: [
      '打开二进制并读取概览',
      '反编译函数与交叉引用',
      '分析 Electron / JavaScript 应用图',
      '检查制品清单与 .NET 程序集',
      '导出带证据与未知项的 Bundle',
    ],
    schema: [
      'binary_session', 'open_binary', 'binary_overview', 'analyze_function',
      'analyze_javascript_application', 'inspect_artifact', 'export_evidence_bundle',
    ],
    setupSupported: true, codingSupported: true,
  },
]

type Detection = {
  status: SecurityToolStatus
  statusLabel: string
  version?: string
  problem?: string
  action?: string
  command?: string
  args?: string[]
  profilePath?: string
  idaPath?: string
  userIDAPath?: string
  setupPossible?: boolean
}

const systemProbe: CommandProbe = {
  async lookPath(name) {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const which = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await promisify(execFile)(which, [name], { timeout: 8000 })
    const first = String(stdout).split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
    if (!first) throw new Error(`not found: ${name}`)
    return first
  },
  async output(command, args) {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout, stderr } = await promisify(execFile)(command, args, { timeout: 8000 })
    return String(stdout || stderr).trim()
  },
}

export class SecurityToolsService {
  readonly root: string
  private readonly settings: { get(): { security_tools?: Record<string, { enabled?: boolean }> }; setSecurityToolEnabled(id: string, enabled: boolean): Promise<void> }
  private readonly probe: CommandProbe
  private readonly emit?: (snapshot: SetupSnapshot) => void
  private readonly setups = new Map<string, SetupSnapshot>()

  constructor(
    dataDirectory: string,
    settings: SecurityToolsService['settings'],
    emit?: (snapshot: SetupSnapshot) => void,
    probe: CommandProbe = systemProbe,
  ) {
    this.root = join(dataDirectory, 'services', 'security-tools')
    this.settings = settings
    this.emit = emit
    this.probe = probe
  }

  async list(): Promise<ToolSnapshot[]> {
    const preferences = this.settings.get().security_tools ?? {}
    const result: ToolSnapshot[] = []
    for (const item of CATALOG) {
      const detected = await this.detect(item.id)
      const enabled = preferences[item.id] ? Boolean(preferences[item.id]?.enabled) : true
      const setup = this.setups.get(item.id)
      if (setup?.state === 'running') {
        detected.status = 'configuring'
        detected.statusLabel = '正在配置'
        detected.action = undefined
      }
      result.push({
        id: item.id,
        name: item.name,
        purpose: item.purpose,
        status: detected.status,
        statusLabel: detected.statusLabel,
        enabled,
        usableByAgent: enabled && detected.status === 'ready' && item.codingSupported,
        version: detected.version,
        connection: item.connection,
        runtime: item.runtime,
        capabilities: [...item.capabilities],
        schema: [...item.schema],
        problem: detected.problem,
        primaryAction: detected.action,
        setupSupported: item.setupSupported && Boolean(detected.setupPossible),
        codingSupported: item.codingSupported,
      })
    }
    return result
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!knownTool(id)) throw new Error(`unknown security tool ${JSON.stringify(id)}`)
    await this.settings.setSecurityToolEnabled(id, enabled)
  }

  setupStatus(id: string): SetupSnapshot {
    if (!knownTool(id)) throw new Error(`unknown security tool ${JSON.stringify(id)}`)
    return this.setups.get(id) ?? { toolId: id, state: 'idle', percent: 0, summary: '尚未开始配置', steps: [], startedAt: '' }
  }

  async startSetup(id: string): Promise<SetupSnapshot> {
    if (id !== TOOL_IDA && id !== TOOL_CAPA && id !== TOOL_REA) {
      throw new Error(`${id} does not have a reviewed automatic setup`)
    }
    const current = this.setups.get(id)
    if (current?.state === 'running') return current
    const detected = await this.detect(id)
    if (detected.status === 'ready') {
      const now = new Date().toISOString()
      const ready: SetupSnapshot = { toolId: id, state: 'completed', percent: 100, summary: '工具已经可用', steps: [], startedAt: now, completedAt: now }
      this.setSetup(ready)
      return ready
    }
    if (!detected.setupPossible) throw new Error(detected.problem || 'setup is not possible')
    const setup = initialSetup(id)
    this.setSetup(setup)
    void this.runSetup(id)
    return setup
  }

  async check(id: string): Promise<ToolSnapshot> {
    const listed = await this.list()
    const found = listed.find((item) => item.id === id)
    if (!found) throw new Error(`unknown security tool ${JSON.stringify(id)}`)
    return found
  }

  async runtimeTools(): Promise<RuntimeTool[]> {
    const preferences = this.settings.get().security_tools ?? {}
    const result: RuntimeTool[] = []
    for (const item of CATALOG) {
      if (item.id !== TOOL_IDA && item.id !== TOOL_CAPA && item.id !== TOOL_REA) continue
      if (preferences[item.id] && preferences[item.id]?.enabled === false) continue
      const detected = await this.detect(item.id)
      if (detected.status !== 'ready' || !detected.command) continue
      result.push({
        id: item.id,
        command: detected.command,
        args: detected.args ? [...detected.args] : undefined,
        version: detected.version ?? '',
        profilePath: detected.profilePath,
        idaPath: detected.idaPath,
        userIdaPath: detected.userIDAPath,
        capabilities: [...item.capabilities],
      })
    }
    return result
  }

  async codingHandoff(id: string): Promise<CodingHandoff> {
    if (!knownTool(id)) throw new Error(`unknown security tool ${JSON.stringify(id)}`)
    const detected = await this.detect(id)
    const name = CATALOG.find((item) => item.id === id)?.name ?? id
    if (detected.status === 'unavailable') {
      const reason = detected.problem || `${name} 在当前平台不可用。`
      throw new Error(`${reason}（${name} is unavailable on this platform; no actionable Coding setup task can be offered）`)
    }
    let prompt = `帮我准备 MilkSU 的 ${name} 本机能力。先检测当前系统和已有安装；优先采用 MilkSU 已审核的固定版本适配器，只使用官方来源与固定版本，不要修改项目业务代码。不要直接启动可能阻塞的 GUI；所有外部工具健康检查都必须是非交互式并带 15 秒超时。完成后运行最小健康检查，并告诉我 MilkSU 设置页还需要重新检测什么。当前检测结果：${detected.statusLabel}。`
    if (detected.problem) prompt += ` 检测说明：${detected.problem}`
    return {
      toolId: id,
      title: `配置 ${name}`,
      prompt,
      visibleText: `检查并准备 ${name}，完成一次最小健康检查。`,
      executionMode: 'go',
      approvalPolicy: 'full-auto',
    }
  }

  private setSetup(value: SetupSnapshot): void {
    this.setups.set(value.toolId, { ...value, steps: value.steps.map((step) => ({ ...step })) })
    this.emit?.({ ...value, steps: value.steps.map((step) => ({ ...step })) })
  }

  private async detect(id: string): Promise<Detection> {
    switch (id) {
      case TOOL_IDA:
        return this.detectIDA()
      case TOOL_CAPA:
        return this.detectCapa()
      case TOOL_CODEQL:
        return this.detectCommand('codeql', ['version', '--format=terse'], '已检测 CLI', '安装后可由 Coding 使用')
      case TOOL_BURP:
        return this.detectBurp()
      case TOOL_SHANNON:
        return this.detectShannon()
      case TOOL_REA:
        return this.detectRea()
      default:
        return { status: 'unavailable', statusLabel: '不可用', problem: '未知工具' }
    }
  }

  private async detectIDA(): Promise<Detection> {
    const idaPath = findIDAApplication()
    if (!idaPath) {
      return { status: 'missing_app', statusLabel: '需要 IDA Pro', action: '安装 IDA Pro', problem: '未在 /Applications 中检测到支持 idalib 的 IDA Pro。' }
    }
    const idaVersion = await applicationVersion(this.probe, idaPath)
    const command = join(this.root, TOOL_IDA, IDA_SOURCE_REVISION, 'venv', 'bin', 'idalib-mcp')
    const profile = join(this.root, TOOL_IDA, IDA_SOURCE_REVISION, 'readonly-profile.txt')
    const userIDAPath = join(homedir(), '.idapro')
    if (regularExecutable(command) && regularFile(profile)) {
      return { status: 'ready', statusLabel: '可用', version: idaVersion, command, profilePath: profile, idaPath, userIDAPath, setupPossible: true }
    }
    try {
      await this.probe.lookPath('uv')
    } catch {
      return { status: 'needs_setup', statusLabel: '需要 uv', version: idaVersion, action: '在 Coding 中配置', idaPath, problem: 'IDA Pro 已安装；准备 idalib MCP 前还需要 uv。' }
    }
    return { status: 'needs_setup', statusLabel: '可准备', version: idaVersion, action: '准备 IDA MCP', idaPath, userIDAPath, setupPossible: true }
  }

  private async detectCapa(): Promise<Detection> {
    if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
      return { status: 'unavailable', statusLabel: '暂不支持', problem: 'capa 当前仅支持 macOS arm64/amd64。' }
    }
    const managed = join(this.root, TOOL_CAPA, CAPA_VERSION, 'capa')
    if (regularExecutable(managed)) {
      return { status: 'ready', statusLabel: '可用', version: CAPA_VERSION, command: managed, setupPossible: true }
    }
    try {
      const command = await this.probe.lookPath('capa')
      let version = ''
      try { version = await this.probe.output(command, ['--version']) } catch { version = '本机 CLI' }
      return { status: 'ready', statusLabel: '可用', version: version || '本机 CLI', command, setupPossible: true }
    } catch {
      return { status: 'needs_setup', statusLabel: '可直接准备', version: CAPA_VERSION, action: '准备 capa', setupPossible: true }
    }
  }

  private async detectCommand(name: string, args: string[], readyLabel: string, action: string): Promise<Detection> {
    try {
      const command = await this.probe.lookPath(name)
      let version = ''
      try { version = firstLine(await this.probe.output(command, args)) } catch { version = '本机 CLI' }
      return { status: 'detected', statusLabel: readyLabel, version: version || '本机 CLI', command }
    } catch {
      return { status: 'needs_setup', statusLabel: '未配置', action, problem: `未在 PATH 中检测到 ${name}。` }
    }
  }

  private async detectBurp(): Promise<Detection> {
    const candidates = [
      '/Applications/Burp Suite Professional.app',
      '/Applications/Burp Suite Community Edition.app',
    ]
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isDirectory()) {
          return {
            status: 'detected',
            statusLabel: '检测到软件',
            version: await applicationVersion(this.probe, candidate),
            problem: 'Burp 已安装；专用读取 Adapter 尚未进入本批生产链。',
          }
        }
      } catch { /* next */ }
    }
    return { status: 'missing_app', statusLabel: '未安装', action: '安装 Burp Suite', problem: '未在 /Applications 中检测到 Burp Suite。' }
  }

  private async detectRea(): Promise<Detection> {
    let nodePath = ''
    try {
      nodePath = await this.probe.lookPath('node')
    } catch {
      return {
        status: 'missing_app',
        statusLabel: '需要 Node.js',
        problem: '未检测到 Node.js。REA 需要 Node 22.19+、24.11+ 或 26+，请先安装 Node.js。',
        action: '安装 Node.js',
      }
    }
    let versionOutput = ''
    try {
      versionOutput = await this.probe.output(nodePath, ['--version'])
    } catch {
      versionOutput = ''
    }
    const parsed = parseNodeVersion(versionOutput)
    if (!parsed) {
      return {
        status: 'missing_app',
        statusLabel: 'Node 版本无法确认',
        problem: '无法读取 Node 版本；REA 需要 Node 22.19+、24.11+ 或 26+。',
        action: '检查 Node.js 安装',
      }
    }
    if (!nodeMeetsReaEngines(parsed.major, parsed.minor)) {
      return {
        status: 'missing_app',
        statusLabel: '需要更高版本 Node.js',
        problem: `当前 Node ${parsed.major}.${parsed.minor} 不满足 REA ${REA_VERSION} 的运行要求（22.19+、24.11+ 或 26+）。`,
        action: '升级 Node.js',
      }
    }
    const entry = reaEntryScript(this.root)
    if (regularFile(entry)) {
      return {
        status: 'ready',
        statusLabel: '可用',
        version: REA_VERSION,
        command: nodePath,
        args: [entry, 'mcp'],
        setupPossible: true,
      }
    }
    try {
      await this.probe.lookPath('npm')
    } catch {
      return {
        status: 'needs_setup',
        statusLabel: '需要 npm',
        problem: `Node ${parsed.major}.${parsed.minor} 已就绪；准备 REA 还需要随 Node 附带的 npm。`,
      }
    }
    return {
      status: 'needs_setup',
      statusLabel: '可准备',
      version: REA_VERSION,
      action: '准备 REA',
      setupPossible: true,
    }
  }

  private async detectShannon(): Promise<Detection> {
    try {
      const docker = await this.probe.lookPath('docker')
      const version = firstLine(await this.probe.output(docker, ['version', '--format', '{{.Server.Version}}']))
      if (!version) return { status: 'needs_setup', statusLabel: 'Docker 未运行', problem: '检测到 Docker CLI，但 Docker Engine 当前不可用。' }
      return { status: 'detected', statusLabel: '前提已就绪', version: `Docker ${version}`, problem: 'Docker 可用；Shannon Worker 与任务回执 Adapter 尚未进入本批生产链。' }
    } catch {
      return { status: 'needs_setup', statusLabel: '需要 Docker', problem: '未检测到 Docker CLI。' }
    }
  }

  private async runSetup(id: string): Promise<void> {
    try {
      if (id === TOOL_IDA) await this.setupIDA()
      else if (id === TOOL_CAPA) await this.setupCapa()
      else if (id === TOOL_REA) await this.setupRea()
    } catch (error) {
      const setup = this.setupStatus(id)
      setup.state = 'failed'
      setup.error = error instanceof Error ? error.message : String(error)
      setup.summary = '配置未完成'
      for (const step of setup.steps) {
        if (step.status === 'running') {
          step.status = 'failed'
          step.detail = setup.error
        }
      }
      setup.completedAt = new Date().toISOString()
      this.setSetup(setup)
    }
  }

  private async setupIDA(): Promise<void> {
    const detected = await this.detectIDA()
    if (!detected.idaPath) throw new Error('未检测到支持 idalib 的 IDA Pro')
    const uv = await this.probe.lookPath('uv')
    this.updateStep(TOOL_IDA, 'detect', 'completed', 15, '已检测 IDA Pro 与 uv')
    const activate = join(detected.idaPath, 'Contents', 'MacOS', 'idalib', 'python', 'py-activate-idalib.py')
    this.updateStep(TOOL_IDA, 'activate', 'running', 25, '正在写入当前用户的 idalib 安装路径')
    await runSetupCommand(120_000, uv, ['run', activate])
    this.updateStep(TOOL_IDA, 'activate', 'completed', 40, 'idalib 已激活')
    const root = join(this.root, TOOL_IDA, IDA_SOURCE_REVISION)
    await mkdir(root, { recursive: true, mode: 0o700 })
    await writeFile(join(root, 'readonly-profile.txt'), IDA_READONLY_PROFILE, { mode: 0o600 })
    this.updateStep(TOOL_IDA, 'install', 'running', 55, `正在安装 ida-pro-mcp ${IDA_MCP_VERSION}`)
    const venv = join(root, 'venv')
    await runSetupCommand(240_000, uv, ['venv', venv, '--python', '3.11'])
    const python = join(venv, 'bin', 'python')
    const source = `git+https://github.com/mrexodia/ida-pro-mcp.git@${IDA_SOURCE_REVISION}`
    await runSetupCommand(480_000, uv, ['pip', 'install', '--python', python, source])
    this.updateStep(TOOL_IDA, 'install', 'completed', 85, '固定版本 MCP 已安装')
    const command = join(venv, 'bin', 'idalib-mcp')
    this.updateStep(TOOL_IDA, 'verify', 'running', 90, '正在检查 MCP 启动入口')
    await runSetupCommand(30_000, command, ['--help'])
    this.completeSetup(TOOL_IDA, 'IDA Pro MCP 已可由 Coding 自动调用')
  }

  private async setupCapa(): Promise<void> {
    const { asset, checksum } = capaAsset()
    this.updateStep(TOOL_CAPA, 'detect', 'completed', 15, `${process.platform}/${process.arch}`)
    const root = join(this.root, TOOL_CAPA, CAPA_VERSION)
    await mkdir(root, { recursive: true, mode: 0o700 })
    this.updateStep(TOOL_CAPA, 'download', 'running', 30, `正在从 mandiant/capa 下载 ${CAPA_VERSION}`)
    const response = await fetch(asset, { signal: AbortSignal.timeout(5 * 60_000) })
    if (!response.ok) throw new Error(`下载 capa: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error('capa 下载校验失败')
    this.updateStep(TOOL_CAPA, 'download', 'completed', 75, '官方发布包校验通过')
    this.updateStep(TOOL_CAPA, 'verify', 'running', 85, '正在解包并运行版本检查')
    const command = join(root, 'capa')
    const { writeFile: writeBytes, unlink } = await import('node:fs/promises')
    const zipPath = join(root, '.capa-download.zip')
    await writeBytes(zipPath, data)
    const zipEntries = await readZipFile(zipPath)
    await unlink(zipPath)
    const capa = zipEntries.find((entry) => entry.name === 'capa')
    if (!capa) throw new Error('发布包中没有 capa 可执行文件')
    await writeFile(command, capa.data, { mode: 0o700 })
    await chmod(command, 0o700)
    await runSetupCommand(30_000, command, ['--version'])
    this.completeSetup(TOOL_CAPA, 'capa 已可由 Coding 自动调用')
  }

  private async setupRea(): Promise<void> {
    const detected = await this.detectRea()
    if (detected.status !== 'needs_setup' || !detected.setupPossible) {
      throw new Error(detected.problem || 'setup is not possible')
    }
    const nodePath = await this.probe.lookPath('node')
    const npmPath = await this.probe.lookPath('npm')
    this.updateStep(TOOL_REA, 'detect', 'completed', 15, 'Node 与 npm 已就绪')
    const root = reaInstallDir(this.root)
    await mkdir(root, { recursive: true, mode: 0o700 })
    this.updateStep(TOOL_REA, 'install', 'running', 40, `正在安装 rea-agents ${REA_VERSION}`)
    try {
      await runNpm(10 * 60_000, npmPath, [
        '--prefix', root,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        'install',
        `${REA_PACKAGE}@${REA_VERSION}`,
      ])
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const clipped = detail.length > 400 ? detail.slice(-400) : detail
      throw new Error(`安装 REA ${REA_VERSION}: ${clipped}`)
    }
    const entry = reaEntryScript(this.root)
    if (!regularFile(entry)) throw new Error('安装完成但未找到 REA 启动脚本')
    this.updateStep(TOOL_REA, 'install', 'completed', 85, '固定版本已安装')
    this.updateStep(TOOL_REA, 'verify', 'running', 90, '正在运行 REA 版本检查')
    const versionOutput = await runSetupCommand(30_000, nodePath, [entry, '--version'])
    if (!versionOutput.includes(REA_VERSION)) {
      throw new Error(`REA 健康检查返回了意外版本: ${firstLine(versionOutput)}`)
    }
    this.completeSetup(TOOL_REA, 'REA 已可由 Coding 会话通过 milksu-rea 调用')
  }

  private updateStep(toolId: string, stepId: string, status: string, percent: number, detail: string): void {
    const setup = this.setupStatus(toolId)
    for (const step of setup.steps) {
      if (step.id === stepId) {
        step.status = status
        step.detail = detail
      }
    }
    setup.percent = percent
    this.setSetup(setup)
  }

  private completeSetup(toolId: string, summary: string): void {
    const setup = this.setupStatus(toolId)
    for (const step of setup.steps) step.status = 'completed'
    setup.state = 'completed'
    setup.percent = 100
    setup.summary = summary
    setup.completedAt = new Date().toISOString()
    this.setSetup(setup)
  }
}

function knownTool(id: string): boolean {
  return CATALOG.some((item) => item.id === id)
}

function initialSetup(id: string): SetupSnapshot {
  if (id === TOOL_IDA) {
    return {
      toolId: id, state: 'running', percent: 0, summary: '正在准备 IDA Pro MCP', startedAt: new Date().toISOString(),
      steps: [
        { id: 'detect', label: '检测 IDA Pro 与 uv', status: 'pending' },
        { id: 'activate', label: '激活 idalib', status: 'pending' },
        { id: 'install', label: '安装固定版本 MCP', status: 'pending' },
        { id: 'verify', label: '运行健康检查', status: 'pending' },
      ],
    }
  }
  if (id === TOOL_REA) {
    return {
      toolId: id, state: 'running', percent: 0, summary: '正在准备 REA', startedAt: new Date().toISOString(),
      steps: [
        { id: 'detect', label: '检测 Node.js 与 npm', status: 'pending' },
        { id: 'install', label: '安装固定版本 rea-agents', status: 'pending' },
        { id: 'verify', label: '运行健康检查', status: 'pending' },
      ],
    }
  }
  return {
    toolId: id, state: 'running', percent: 0, summary: '正在准备 capa', startedAt: new Date().toISOString(),
    steps: [
      { id: 'detect', label: '检测系统架构', status: 'pending' },
      { id: 'download', label: '下载官方固定版本', status: 'pending' },
      { id: 'verify', label: '校验并运行首次检查', status: 'pending' },
    ],
  }
}

function reaInstallDir(root: string): string {
  return join(root, TOOL_REA, REA_VERSION)
}

function reaEntryScript(root: string): string {
  return join(reaInstallDir(root), 'node_modules', REA_PACKAGE, 'scripts', 'rea.mjs')
}

export function nodeMeetsReaEngines(major: number, minor: number): boolean {
  if (major === 22) return minor >= 19
  if (major === 24) return minor >= 11
  return major >= 26
}

export function parseNodeVersion(output: string): { major: number; minor: number } | null {
  const value = firstLine(output).replace(/^v/u, '')
  const parts = value.split('.')
  if (parts.length < 2) return null
  if (!/^\d+$/u.test(parts[0] ?? '') || !/^\d+$/u.test(parts[1] ?? '')) return null
  return { major: Number.parseInt(parts[0] ?? '', 10), minor: Number.parseInt(parts[1] ?? '', 10) }
}

function findIDAApplication(): string {
  try {
    const matches = readdirSync('/Applications')
      .filter((name) => name.startsWith('IDA Professional') && name.endsWith('.app'))
      .map((name) => join('/Applications', name))
      .sort()
      .reverse()
    for (const candidate of matches) {
      const script = join(candidate, 'Contents', 'MacOS', 'idalib', 'python', 'py-activate-idalib.py')
      if (regularFile(script)) return candidate
    }
  } catch { /* no Applications */ }
  return ''
}

async function applicationVersion(probe: CommandProbe, application: string): Promise<string> {
  try {
    const infoPath = join(application, 'Contents', 'Info.plist')
    const value = await probe.output('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPath])
    return firstLine(value) || '已安装'
  } catch {
    return '已安装'
  }
}

function firstLine(value: string): string {
  return String(value ?? '').trim().split(/\n/u)[0]?.trim() ?? ''
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function regularExecutable(path: string): boolean {
  try {
    const info = statSync(path)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function capaAsset(): { asset: string; checksum: string } {
  const base = 'https://github.com/mandiant/capa/releases/download/v9.4.0/'
  if (process.arch === 'arm64') {
    return { asset: `${base}capa-v9.4.0-macos-arm64.zip`, checksum: '119964afc348c80fff93ad8830124a0c55630f179906acb796636c0f8d410672' }
  }
  if (process.arch === 'x64') {
    return { asset: `${base}capa-v9.4.0-macos.zip`, checksum: '4f45921c756e55dc912ff100ad46427ebb087b88ca6b493f50b015c11ed892e4' }
  }
  throw new Error('当前系统架构没有已审阅的 capa 发布包')
}

function runNpm(timeout: number, npmPath: string, args: string[]): Promise<string> {
  if (process.platform === 'win32') {
    return runSetupCommand(timeout, 'cmd', ['/c', npmPath, ...args])
  }
  return runSetupCommand(timeout, npmPath, args)
}

function runSetupCommand(timeout: number, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { timeout })
    const chunks: Buffer[] = []
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim()
      if (code === 0) resolve(output)
      else reject(new Error(output ? `${command} failed: ${output.slice(-800)}` : `${command} failed`))
    })
  })
}

const IDA_READONLY_PROFILE = `# MilkSU reviewed read-only profile for ida-pro-mcp
server_health
list_funcs
list_globals
imports
imports_query
lookup_funcs
func_query
entity_query
int_convert
find_regex
decompile
disasm
func_profile
analyze_batch
xrefs_to
xref_query
xrefs_to_field
callees
basic_blocks
find_bytes
find
insn_query
export_funcs
callgraph
analyze_function
analyze_component
trace_data_flow
read_struct
type_query
get_bytes
get_int
get_string
get_global_value
stack_frame
`
