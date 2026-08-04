// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VulnPage from './VulnPage.vue'

const mountedApps: App[] = []
const storage = new Map<string, string>()

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  storage.clear()
})

async function mountVulnPage() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(VulnPage)
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

async function mountVulnPageWithWorkspace(path = '') {
  const host = document.createElement('div')
  document.body.append(host)
  let chooseCount = 0
  const app = createApp(VulnPage, {
    codingWorkspacePath: path,
    onChooseCodingWorkspace: () => {
      chooseCount += 1
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, chooseCount: () => chooseCount }
}

async function mountVulnPageWithCodingTaskSink() {
  const host = document.createElement('div')
  document.body.append(host)
  const tasks: Array<{ title: string; prompt: string; visibleText: string }> = []
  const handoffRecorders: Array<(workspacePath: string) => void> = []
  const app = createApp(VulnPage, {
    onStartCodingTask: (
      task: { title: string; prompt: string; visibleText: string },
      recordHandoff: (workspacePath: string) => void,
    ) => {
      tasks.push(task)
      handoffRecorders.push(recordHandoff)
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, tasks, handoffRecorders }
}

async function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function unmountAll() {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  await nextTick()
}

describe('VulnPage', () => {
  it('renders a CVE learning and tracking scaffold without red-team promises', async () => {
    const host = await mountVulnPage()
    const text = host.textContent ?? ''

    expect(text).toContain('CVE')
    expect(text).toContain('追踪 CVE、资产命中与研究进度')
    expect(text).toContain('导入 JSON')
    expect(text).toContain('导入练习')
    expect(host.querySelector('[data-module-topbar]')).not.toBeNull()
    expect(host.querySelector('[data-module-topbar]')?.getAttribute('data-workspace-module')).toBe('cve')
    expect(host.querySelector('[data-workspace-topbar-title]')?.className).toContain('workspace-topbar__title')
    expect(text).toContain('情报源')
    expect(text).toContain('追踪条目')
    expect(text).toContain('7')
    expect(text).toContain('0 关注中')
    expect(text).toContain('6')
    expect(text).toContain('情报源接入状态')
    expect(text).toContain('尚未复核')
    expect(text).toContain('刷新不会联网拉取 Feed')
    expect(text).toContain('下一步可交给 Coding Agent')
    expect(text).toContain('只读 Feed 导入器')
    expect(text).toContain('复制导入任务')
    expect(text).toContain('不会自动启动 Agent')
    expect(text).toContain('不启动 Docker，不访问外部目标，不把情报命中写成验证')
    expect(text).toContain('CVE-2024-6387')
    expect(text).toContain('OpenSSH regreSSHion')
    expect(text).toContain('CVE-2024-4577')
    expect(text).toContain('PHP-CGI Windows Argument Injection')
    expect(text).toContain('CVE-2023-27997')
    expect(text).toContain('Fortinet FortiOS SSL-VPN')
    expect(text).toContain('闭环')
    expect(text).toContain('待建立')
    expect(text).toContain('有练习')
    expect(text).toContain('NVD')
    expect(text).toContain('CISA KEV')
    expect(text).toContain('FIRST EPSS')
    expect(text).toContain('OSV / GitHub Advisory')
    expect(text).toContain('Vulhub 练习目录')
    expect(text).toContain('非实时同步')
    expect(text).toContain('不把排序信号当成 Judge')
    expect(text).toContain('待接入')
    expect(text).toContain('Vulhub 练习目录匹配')
    expect(text).toContain('未匹配练习环境')
    expect(text).toContain('固定快照：aeaf657')
    expect(text).toContain('CVE-2024-3400 在当前只读 Vulhub 快照中没有匹配目录')
    expect(text).toContain('拉取镜像、启动容器、开放端口或发送漏洞触发输入仍需用户逐次确认')
    expect(text).toContain('练习环境')
    expect(text).toContain('1 匹配')
    expect(text).toContain('0 已确认计划')
    expect(text).toContain('当前下一步')
    expect(text).toContain('建立研究任务')
    expect(text).toContain('CVE-2024-3400 还没有固定目标、Scope 和安全边界。')
    expect(text).toContain('学习路径')
    expect(text).toContain('CVE 最小闭环')
    expect(text).toContain('练习结果不等于真实资产已验证')
    expect(text).toContain('隔离练习环境')
    expect(text).toContain('Coding 接力范围')
    expect(text).toContain('Agent 可接手任务')
    expect(text).toContain('研究任务工作区')
    expect(text).toContain('安全边界')
    expect(text).toContain('不批量扫描或攻击外部目标')
    expect(text).toContain('不自动运行 PoC、exploit 或漏洞触发输入')
    expect(text).not.toContain('红队 Agent')
  })

  it('makes CVE source refresh explicit as local snapshot review', async () => {
    const host = await mountVulnPage()
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '刷新 CVE 本机快照',
    )
    if (!refresh) throw new Error('missing local snapshot refresh button')

    expect(host.textContent).toContain('尚未复核')
    refresh.click()
    await nextTick()

    expect(host.textContent).toContain('本机复核 rev 2')
    expect(host.textContent).toContain('只更新本机视图状态')
    expect(host.textContent).toContain('不代表 NVD/KEV/EPSS/OSV 已实时同步')
  })

  it('copies a bounded read-only CVE feed import task for Coding Agent', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    const host = await mountVulnPage()
    const copy = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('复制导入任务'),
    )
    if (!copy) throw new Error('missing feed import copy button')

    copy.click()
    await Promise.resolve()
    await nextTick()

    expect(writeText).toHaveBeenCalledOnce()
    const copied = String((writeText.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '')
    expect(copied).toContain('继续 MilkSU M3 产品闭环冲刺')
    expect(copied).toContain('补 CVE 情报源的只读导入纵切')
    expect(copied).toContain('NVD、CISA KEV、FIRST EPSS、OSV、GitHub Advisory 或 Vulhub catalog')
    expect(copied).toContain('revision/digest')
    expect(copied).toContain('不拉起 Docker')
    expect(copied).toContain('不开放端口')
    expect(copied).toContain('不发送漏洞触发输入')
    expect(copied).toContain('不能把 EPSS/KEV/情报命中写成 Judge 或真实资产验证')
    expect(copied).toContain('不要读取、输出或迁移 Provider/API Key')
    expect(copied).toContain('commit 并 push')
    expect(host.textContent).toContain('已复制')
  })

  it('shows the Coding workspace scope before handing CVE tasks to Coding', async () => {
    const empty = await mountVulnPageWithWorkspace()
    expect(empty.host.textContent).toContain('临时工作区')
    expect(empty.host.textContent).toContain('项目影响检查')
    const choose = [...empty.host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('选择项目目录'),
    )
    if (!choose) throw new Error('missing choose workspace button')
    choose.click()
    await nextTick()
    expect(empty.chooseCount()).toBe(1)

    for (const app of mountedApps.splice(0)) app.unmount()
    document.body.innerHTML = ''

    const scoped = await mountVulnPageWithWorkspace('/Users/milksu/code/milksu')
    expect(scoped.host.textContent).toContain('已选择项目')
    expect(scoped.host.textContent).toContain('/Users/milksu/code/milksu')
    expect(scoped.host.textContent).toContain('更换项目目录')
  })

  it('lets the user create a visible research tracking task', async () => {
    const host = await mountVulnPage()
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('建立研究任务'),
    )
    if (!button) throw new Error('missing research task button')

    expect(host.textContent).toContain('研究任务')
    expect(host.textContent).toContain('0')
    button.click()
    await nextTick()

    expect(host.textContent).toContain('查看研究任务')
    expect(host.textContent).toContain('已建立')
    expect(host.textContent).toContain('当前研究焦点')
    expect(host.textContent).toContain('研究任务已建立')
    expect(host.textContent).toContain('交给 Coding')
    expect(host.textContent).toContain('把公告、补丁、资产/项目影响和练习启动前清单交给当前授权任务。')
    expect(host.textContent).toContain('研究任务')
    expect(host.textContent).toContain('理解 PAN-OS 的影响范围、修复证据和学习要点')
    expect(host.textContent).toContain('Palo Alto Networks / PAN-OS')
    expect(host.textContent).toContain('下一步给 Agent 的明确任务')
    expect(host.textContent).toContain('固化情报快照')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
    expect(host.textContent).toContain('不要运行 PoC、exploit 或外部扫描')
    expect(host.textContent).toContain('研究中')

    const advance = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('记录下一步'),
    )
    advance?.click()
    await nextTick()
    expect(host.textContent).toContain('阅读材料与补丁')
    advance?.click()
    await nextTick()
    advance?.click()
    await nextTick()
    advance?.click()
    await nextTick()
    expect(host.textContent).toContain('修复与缓解证据')
    expect(host.textContent).toContain('学习复盘')
    expect(host.textContent).toContain('研究中')
  })

  it('makes the top current-next-step card actionable for the selected CVE', async () => {
    const host = await mountVulnPage()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    const nextStep = () => {
      const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
        item.getAttribute('aria-label') === '执行当前 CVE 下一步',
      )
      if (!button) throw new Error('missing current next-step button')
      return button
    }

    expect(host.textContent).toContain('当前下一步')
    expect(host.textContent).toContain('建立研究任务')
    expect(nextStep().textContent).toContain('建立')
    nextStep().click()
    await nextTick()

    expect(host.textContent).toContain('研究任务已建立')
    expect(host.textContent).toContain('确认练习计划')
    expect(nextStep().textContent).toContain('确认')
    nextStep().click()
    await nextTick()

    expect(host.textContent).toContain('已确认计划')
    expect(host.textContent).toContain('1 已确认计划')
    expect(host.textContent).toContain('交给 Coding')
    expect(nextStep().textContent).toContain('交给 Coding')
  })

  it('lets the user add a local CVE tracking item beyond the built-in demo list', async () => {
    const host = await mountVulnPage()
    const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('新增追踪'),
    )
    if (!add) throw new Error('missing add tracking button')
    add.click()
    await nextTick()

    const byPlaceholder = (text: string) => {
      const input = [...host.querySelectorAll<HTMLInputElement>('input')].find(item =>
        item.placeholder.includes(text),
      )
      if (!input) throw new Error(`missing input ${text}`)
      return input
    }
    await setInput(byPlaceholder('CVE-2024-12345'), 'CVE-2026-42424')
    await setInput(byPlaceholder('组件 / 产品'), 'MilkSU Sidecar')
    await setInput(byPlaceholder('厂商 / 项目'), 'MilkSU')
    await setInput(byPlaceholder('受影响版本范围'), 'pre-release local branch')
    await setInput(byPlaceholder('漏洞标题'), '本地测试 CVE 学习追踪')
    await setInput(byPlaceholder('公告、补丁'), 'https://example.test/advisory')
    await setInput(byPlaceholder('这次想学会什么'), '确认补丁阅读和影响判断流程')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('加入追踪'),
    )
    if (!submit) throw new Error('missing submit button')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('CVE-2026-42424')
    expect(host.textContent).toContain('本地测试 CVE 学习追踪')
    expect(host.textContent).toContain('MilkSU')
  })

  it('imports pasted local CVE JSON into visible tracking rows without syncing live feeds', async () => {
    const host = await mountVulnPage()
    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 JSON'),
    )
    if (!openImport) throw new Error('missing import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('导入本地 CVE JSON')
    expect(host.textContent).toContain('不联网同步、不启动 Docker、不运行 PoC')

    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="本地 CVE JSON"]')
    if (!input) throw new Error('missing local CVE JSON textarea')
    await setInput(input, JSON.stringify({
      items: [
        {
          cveId: 'CVE-2026-42424',
          title: '用户导入的依赖风险',
          vendor: 'MilkSU',
          product: 'sidecar fixture',
          affected: 'pre-release',
          details: '本地样本，只用于学习追踪。',
          references: [{ href: 'https://example.test/local-cve' }],
        },
      ],
    }))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入为本地追踪'),
    )
    if (!submit) throw new Error('missing import submit')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('8')
    expect(host.textContent).toContain('CVE-2026-42424')
    expect(host.textContent).toContain('用户导入的依赖风险')
    expect(host.textContent).toContain('本地样本，只用于学习追踪。')
    expect(host.textContent).toContain('已导入 1 条本地 CVE 追踪')
    expect(host.textContent).toContain('撤销本次导入')
    expect(host.textContent).toContain('尚未复核')
    expect(host.textContent).toContain('刷新不会联网拉取 Feed')

    const undo = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('撤销本次导入'),
    )
    if (!undo) throw new Error('missing undo import button')
    undo.click()
    await nextTick()

    expect(host.textContent).toContain('已撤销本次导入的 1 条本地 CVE 追踪')
    expect(host.textContent).not.toContain('CVE-2026-42424')
    expect(host.textContent).not.toContain('用户导入的依赖风险')
    expect(host.textContent).toContain('7')
  })

  it('imports pasted local practice catalog JSON into matched CVE practice plans without launching Docker', async () => {
    const host = await mountVulnPage()
    expect(host.textContent).toContain('未匹配练习环境')
    expect(host.textContent).toContain('1 匹配')

    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入练习'),
    )
    if (!openImport) throw new Error('missing practice import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('导入本地练习 Catalog')
    expect(host.textContent).toContain('只绑定启动前计划')
    expect(host.textContent).toContain('不拉镜像、不启动容器、不运行触发输入')

    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="本地 CVE 练习 Catalog JSON"]')
    if (!input) throw new Error('missing local practice catalog textarea')
    await setInput(input, JSON.stringify({
      items: [
        {
          cveId: 'CVE-2024-3400',
          title: 'Local PAN-OS lab plan',
          directory: 'pan-os/CVE-2024-3400',
          sourceHref: 'https://example.test/catalog/pan-os/CVE-2024-3400',
          revision: 'local catalog abc123',
          ports: ['8080/tcp · local lab'],
          network: '仅允许 127.0.0.1 访问。',
        },
      ],
    }))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入练习匹配'),
    )
    if (!submit) throw new Error('missing practice import submit')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('已导入 1 个本地练习环境匹配')
    expect(host.textContent).toContain('2 匹配')
    expect(host.textContent).toContain('已匹配练习环境')
    expect(host.textContent).toContain('Local PAN-OS lab plan')
    expect(host.textContent).toContain('pan-os/CVE-2024-3400')
    expect(host.textContent).toContain('local catalog abc123')
    expect(host.textContent).toContain('确认练习计划')
    expect(host.textContent).toContain('练习成功只代表本地学习完成')

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认练习计划'),
    )
    if (!confirm) throw new Error('missing imported practice confirm button')
    confirm.click()
    await nextTick()

    expect(host.textContent).toContain('已确认计划')
    expect(host.textContent).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')

    const undo = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('撤销本次导入'),
    )
    if (!undo) throw new Error('missing practice undo button')
    undo.click()
    await nextTick()

    expect(host.textContent).toContain('已撤销本次导入的 1 个本地练习环境匹配')
    expect(host.textContent).toContain('1 匹配')
    expect(host.textContent).toContain('未匹配练习环境')
  })

  it('persists user-confirmed research notes for the selected CVE', async () => {
    const host = await mountVulnPage()
    const byLabel = (label: string) => {
      const textarea = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')].find(item =>
        item.getAttribute('aria-label') === label,
      )
      if (!textarea) throw new Error(`missing textarea ${label}`)
      return textarea
    }

    await setInput(byLabel('CVE 关键结论'), '确认影响范围后再交给 Coding Agent 做只读版本检查。')
    await setInput(byLabel('CVE 学习笔记'), '已阅读公告，暂不运行 PoC，下一步核对依赖和补丁。')

    expect(host.textContent).toContain('已记录')
    await unmountAll()

    const remounted = await mountVulnPage()
    const textareas = [...remounted.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(textareas.some(item => item.value.includes('只读版本检查'))).toBe(true)
    expect(textareas.some(item => item.value.includes('暂不运行 PoC'))).toBe(true)
  })

  it('lets the user attach a local asset hit to a tracked CVE', async () => {
    const host = await mountVulnPage()
    const openAssetForm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('新增资产'),
    )
    if (!openAssetForm) throw new Error('missing add asset button')
    openAssetForm.click()
    await nextTick()

    const byPlaceholder = (text: string) => {
      const input = [...host.querySelectorAll<HTMLInputElement>('input')].find(item =>
        item.placeholder.includes(text),
      )
      if (!input) throw new Error(`missing input ${text}`)
      return input
    }
    await setInput(byPlaceholder('资产名称'), 'vpn-prod-user-confirmed')
    await setInput(byPlaceholder('地址 / 仓库 / 服务'), '10.88.0.12')
    await setInput(byPlaceholder('环境'), '用户本地资产清单')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('加入资产'),
    )
    if (!submit) throw new Error('missing submit asset button')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('受影响资产（4）')
    expect(host.textContent).toContain('vpn-prod-user-confirmed')
    expect(host.textContent).toContain('10.88.0.12')
    expect(host.textContent).toContain('用户本地资产清单')
    expect(host.textContent).toContain('研究中')
  })

  it('lets the user confirm a matched isolated practice environment without launching Docker', async () => {
    const host = await mountVulnPage()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    expect(host.textContent).toContain('Vulhub · Apache ActiveMQ OpenWire RCE')
    expect(host.textContent).toContain('已匹配练习环境')
    expect(host.textContent).toContain('vulhub/activemq/CVE-2023-46604 · activemq/CVE-2023-46604')
    expect(host.textContent).toContain('vulhub/vulhub HEAD aeaf65793f147f29bd50841ef77f4e9cad07ecc7')
    expect(host.textContent).toContain('确认练习计划')
    expect(host.textContent).toContain('activemq/CVE-2023-46604')
    expect(host.textContent).toContain('61616/tcp · OpenWire')
    expect(host.textContent).toContain('默认只创建启动计划')
    expect(host.textContent).toContain('练习成功只代表本地学习完成')

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认练习计划'),
    )
    if (!confirm) throw new Error('missing confirm practice button')
    confirm.click()
    await nextTick()

    expect(host.textContent).toContain('已确认计划')
    expect(host.textContent).toContain('练习已确认')
    expect(host.textContent).toContain('1 已确认计划')
    expect(host.textContent).toContain('已确认本地练习计划，尚未启动容器')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
    expect(host.textContent).toContain('本地练习启动前清单')
    expect(host.textContent).toContain('复制启动前计划')
    expect(host.textContent).toContain('必须逐项人工确认 Docker、端口、目录、网络边界和清理方式')
    expect(host.textContent).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')

    const stop = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('标记停止'),
    )
    if (!stop) throw new Error('missing stop practice button')
    stop.click()
    await nextTick()
    expect(host.textContent).toContain('已停止')

    const clear = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('清除记录'),
    )
    if (!clear) throw new Error('missing clear practice button')
    clear.click()
    await nextTick()
    expect(host.textContent).toContain('待确认')
  })

  it('hands confirmed CVE practice context to Coding Agent as a safe task', async () => {
    const { host, tasks, handoffRecorders } = await mountVulnPageWithCodingTaskSink()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认练习计划'),
    )
    confirm?.click()
    await nextTick()

    const handoff = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('交给 Coding'),
    )
    if (!handoff) throw new Error('missing Coding handoff button')
    handoff.click()
    await nextTick()

    expect(tasks).toHaveLength(1)
    expect(handoffRecorders).toHaveLength(1)
    expect(tasks[0].title).toBe('CVE-2023-46604 研究接力')
    expect(tasks[0].visibleText).toContain('接手 CVE-2023-46604')
    expect(tasks[0].prompt).toContain('Apache ActiveMQ OpenWire RCE')
    expect(tasks[0].prompt).toContain('情报源接入状态')
    expect(tasks[0].prompt).toContain('NVD：内置快照')
    expect(tasks[0].prompt).toContain('OSV / GitHub Advisory：待接入')
    expect(tasks[0].prompt).toContain('Vulhub 练习目录：内置快照')
    expect(tasks[0].prompt).toContain('vulhub/activemq/CVE-2023-46604')
    expect(tasks[0].prompt).toContain('当前练习状态：已确认计划，未启动容器')
    expect(tasks[0].prompt).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')
    expect(tasks[0].prompt).toContain('不要把情报命中或练习结果写成真实资产已验证')
    expect(host.textContent).not.toContain('最近 Coding 接力')
    expect(host.textContent).not.toContain('已交接')

    handoffRecorders[0](' /Users/milksu/code/milksu ')
    await nextTick()

    expect(host.textContent).toContain('最近 Coding 接力')
    expect(host.textContent).toContain('已交接')
    expect(host.textContent).toContain('已接力')
    expect(host.textContent).toContain('/Users/milksu/code/milksu')
  })
})
