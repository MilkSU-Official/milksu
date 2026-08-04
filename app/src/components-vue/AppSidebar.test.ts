// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppSidebar from './AppSidebar.vue'
import type { Conversation } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountSidebar(
  activeSection: 'ctf' | 'vuln' | 'chat',
  conversations: Conversation[] = [],
) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AppSidebar, {
    activeSection,
    activeConversationId: conversations[0]?.id ?? null,
    conversations,
    ctfDashboard: null,
    ctfSection: 'catalog',
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('AppSidebar', () => {
  it('hides single-item CTF and CVE context sidebars until real history exists', async () => {
    const ctf = await mountSidebar('ctf')
    expect(ctf.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('CTF')
    expect(ctf.querySelector('[aria-label="CTF 工作区"]')).toBeNull()
    expect(ctf.querySelector('[aria-label="查看 CTF 能力"]')).toBeNull()
    expect(ctf.textContent).not.toContain('题库')

    const vuln = await mountSidebar('vuln')
    expect(vuln.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('CVE')
    expect(vuln.querySelector('[aria-label="CVE 工作区"]')).toBeNull()
    expect(vuln.querySelector('[aria-label="查看 CTF 能力"]')).toBeNull()
    expect(vuln.textContent).not.toContain('追踪')
  })

  it('keeps the Coding context sidebar because it has real conversation history', async () => {
    const coding = await mountSidebar('chat', [{
      id: 'conversation-1',
      title: '实现产品闭环',
      createdAt: Date.now(),
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    }])

    expect(coding.textContent).toContain('新建编码任务')
    expect(coding.textContent).toContain('milksu')
    expect(coding.textContent).toContain('实现产品闭环')
    expect(coding.querySelector('[data-active-conversation-row]')?.textContent)
      .toContain('实现产品闭环')
  })
})
