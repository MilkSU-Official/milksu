<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from '@/components-vue/AppSidebar.vue'
import SettingsPage from '@/components-vue/SettingsPage.vue'
import { applyThemeMode, type ResolvedThemeMode } from '@/lib/themeMode'
import { withAppSettingsDefaults, type AppSettings } from '@/types'
import type { SecurityToolSetupSnapshot, SecurityToolSnapshot } from '@/securityToolsTypes'

const theme = ref<ResolvedThemeMode>('dark')
const settings = ref(withAppSettingsDefaults({} as AppSettings))
const setupListeners = new Set<(value: unknown) => void>()

const catalog: SecurityToolSnapshot[] = [
  {
    id: 'ida-pro', name: 'IDA Pro', purpose: '交互式反汇编与二进制分析',
    status: 'needs_setup', statusLabel: '可准备', enabled: true, usableByAgent: false,
    version: '9.1', connection: 'idalib MCP', runtime: '按需启动本地 MCP',
    capabilities: ['读取函数与反编译结果', '读取交叉引用', '读取字符串与调用图', '打开工作区内二进制数据库'],
    schema: ['idb_open', 'list_funcs', 'decompile', 'xrefs_to', 'callgraph', 'get_string'],
    problem: '已检测到 IDA Pro；准备完成后，新 Coding 会话会自动获得只读分析能力。',
    primaryAction: '准备 IDA MCP', setupSupported: true, codingSupported: true,
  },
  {
    id: 'capa', name: 'capa', purpose: '识别二进制能力与行为特征',
    status: 'ready', statusLabel: '可用', enabled: true, usableByAgent: true,
    version: 'v9.4.0', connection: '本地 CLI Adapter', runtime: '工作区内受限进程',
    capabilities: ['识别能力规则', '输出匹配证据', '读取样本元数据', '生成 JSON 报告'],
    schema: ['capa_analyze(relativePath, format)'],
    setupSupported: true, codingSupported: true,
  },
  {
    id: 'codeql', name: 'CodeQL', purpose: '代码查询与漏洞分析',
    status: 'needs_setup', statusLabel: '未配置', enabled: true, usableByAgent: false,
    connection: '本地 CodeQL CLI', runtime: '工作区数据库',
    capabilities: ['检测本地 CLI', '创建分析数据库', '运行固定查询', '读取 SARIF 结果'],
    schema: ['本批次仅检测 CLI；专用 Adapter 尚未接入'],
    problem: '未在 PATH 中检测到 codeql。', setupSupported: false, codingSupported: true,
  },
  {
    id: 'burp-suite', name: 'Burp Suite', purpose: 'Web 安全测试与代理抓包',
    status: 'detected', statusLabel: '检测到软件', enabled: true, usableByAgent: false,
    version: '2026.3.3', connection: '桌面软件探测', runtime: '连接现有 Burp',
    capabilities: ['检测本机 Burp', '后续读取 Proxy 历史', '后续读取 Repeater 请求'],
    schema: ['本批次仅检测软件；MCP Adapter 尚未接入'],
    problem: 'Burp 已安装；专用读取 Adapter 尚未进入本批生产链。', setupSupported: false, codingSupported: true,
  },
  {
    id: 'shannon', name: 'Shannon', purpose: '授权目标的安全任务 Worker',
    status: 'detected', statusLabel: '前提已就绪', enabled: true, usableByAgent: false,
    version: 'Docker 29.4.3', connection: '容器 Worker', runtime: '隔离 Docker 容器',
    capabilities: ['检测 Docker', '后续检查 Worker 健康', '后续读取任务报告'],
    schema: ['本批次仅检测运行前提；Worker Adapter 尚未接入'],
    problem: 'Docker 可用；Shannon Worker 与任务回执 Adapter 尚未进入本批生产链。', setupSupported: false, codingSupported: true,
  },
]

applyThemeMode(theme.value)

Object.defineProperty(window, 'milksu', {
  configurable: true,
  value: {
    async invoke(method: string, args: unknown[]) {
      if (method === 'ListSecurityTools') return catalog
      if (method === 'GetSecurityToolSetup') return { toolId: args[0], state: 'idle', percent: 0, summary: '' }
      if (method === 'SetSecurityToolEnabled') return undefined
      if (method === 'CheckSecurityTool') return catalog.find(tool => tool.id === args[0])
      if (method === 'PrepareSecurityToolCodingHandoff') return {
        toolId: args[0], title: '配置本机安全工具', prompt: '检测并配置这个工具。', visibleText: '检测并配置这个工具。',
        executionMode: 'go', approvalPolicy: 'full-auto',
      }
      if (method === 'StartSecurityToolSetup') {
        const snapshot: SecurityToolSetupSnapshot = {
          toolId: String(args[0]), state: 'running', percent: 60, summary: 'Coding Agent 正在安装并验证本地分析能力',
          steps: [
            { id: 'detect', label: '检测 IDA Pro 与 uv', status: 'completed', detail: '已完成' },
            { id: 'activate', label: '激活 idalib', status: 'completed', detail: '已完成' },
            { id: 'install', label: '安装固定版本 MCP', status: 'running', detail: '正在配置只读工具配置' },
            { id: 'verify', label: '运行健康检查', status: 'pending' },
          ],
        }
        setTimeout(() => setupListeners.forEach(listener => listener(snapshot)), 30)
        return snapshot
      }
      if (method === 'GetLocalDataStatus') return { directory: '/Users/demo/Library/Application Support/MilkSU', fileCount: 12, bytes: 2048 }
      if (method === 'GetUserArtifactDirectoryStatus') return { directory: '/Users/demo/Documents/MilkSU' }
      if (method === 'GetBuildTracking') return { channel: 'stable', productName: 'MilkSU', appId: 'com.milksu.app', gitBranch: 'main', gitCommit: 'preview', dirty: false, buildTime: '', trackingId: 'preview', development: true }
      if (method === 'GetStartupRecoveryStatus') return { previousExit: 'clean', consecutiveAbnormalExits: 0, startedAt: new Date().toISOString() }
      if (method === 'GetCodingComputerUseStatus') return { available: true, enabled: false, phase: 'disabled', permissions: { accessibility: true, screenRecording: true } }
      if (method === 'GetNSSCTFWebBridgeStatus') return { bridge: { active: true, connected: false }, pages: [] }
      throw new Error(`Preview does not implement ${method}`)
    },
    onEvent(event: string, callback: (value: unknown) => void) {
      if (event === 'security-tool-setup') setupListeners.add(callback)
      return () => setupListeners.delete(callback)
    },
  },
})
</script>

<template>
  <div class="flex h-screen min-h-[720px] min-w-0 overflow-hidden bg-background text-foreground">
    <AppSidebar
      active-section="settings"
      :account-status="{ configured: false, authenticated: false, state: 'unconfigured' }"
      :active-conversation-id="null"
      :conversations="[]"
      ctf-section="catalog"
      :theme-mode="theme"
    />
    <SettingsPage
      :settings="settings"
      :resolved-theme="theme"
      initial-category="security-tools"
      @settings-change="settings = $event"
    />
  </div>
</template>
