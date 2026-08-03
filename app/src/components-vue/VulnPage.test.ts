// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
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

async function mountVulnPageWithCodingTaskSink() {
  const host = document.createElement('div')
  document.body.append(host)
  const tasks: Array<{ title: string; prompt: string; visibleText: string }> = []
  const app = createApp(VulnPage, {
    onStartCodingTask: (task: { title: string; prompt: string; visibleText: string }) => {
      tasks.push(task)
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, tasks }
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
    expect(text).toContain('当前模式')
    expect(text).toContain('学习与追踪')
    expect(text).toContain('学习路径')
    expect(text).toContain('隔离练习环境')
    expect(text).toContain('Agent 可接手任务')
    expect(text).toContain('研究任务工作区')
    expect(text).toContain('安全边界')
    expect(text).toContain('不批量扫描或攻击外部目标')
    expect(text).toContain('不自动运行 PoC、exploit 或漏洞触发输入')
    expect(text).not.toContain('红队 Agent')
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

    expect(host.textContent).toContain('研究任务已建立')
    expect(host.textContent).toContain('理解 PAN-OS 的影响范围、修复证据和学习要点')
    expect(host.textContent).toContain('Palo Alto Networks / PAN-OS')
    expect(host.textContent).toContain('固化情报快照')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
    expect(host.textContent).toContain('不要运行 PoC、exploit 或外部扫描')
    expect(host.textContent).toContain('研究中')

    const advance = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('推进下一步'),
    )
    advance?.click()
    await nextTick()
    expect(host.textContent).toContain('阅读材料与补丁')
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
    expect(host.textContent).toContain('activemq/CVE-2023-46604')
    expect(host.textContent).toContain('61616/tcp · OpenWire')
    expect(host.textContent).toContain('默认只创建启动计划')
    expect(host.textContent).toContain('练习成功只代表本地学习完成')

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认本地练习'),
    )
    if (!confirm) throw new Error('missing confirm practice button')
    confirm.click()
    await nextTick()

    expect(host.textContent).toContain('已确认')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
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
    const { host, tasks } = await mountVulnPageWithCodingTaskSink()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认本地练习'),
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
    expect(tasks[0].title).toBe('CVE-2023-46604 研究接力')
    expect(tasks[0].visibleText).toContain('接手 CVE-2023-46604')
    expect(tasks[0].prompt).toContain('Apache ActiveMQ OpenWire RCE')
    expect(tasks[0].prompt).toContain('vulhub/activemq/CVE-2023-46604')
    expect(tasks[0].prompt).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')
    expect(tasks[0].prompt).toContain('不要把情报命中或练习结果写成真实资产已验证')
  })
})
