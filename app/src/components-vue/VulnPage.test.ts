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

describe('VulnPage', () => {
  it('renders a CVE learning and tracking scaffold without red-team promises', async () => {
    const host = await mountVulnPage()
    const text = host.textContent ?? ''

    expect(text).toContain('CVE')
    expect(text).toContain('追踪 CVE、资产命中与研究进度')
    expect(text).toContain('当前模式')
    expect(text).toContain('学习与追踪')
    expect(text).toContain('学习路径')
    expect(text).toContain('Agent 可接手任务')
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
    expect(host.textContent).toContain('研究中')
  })
})
