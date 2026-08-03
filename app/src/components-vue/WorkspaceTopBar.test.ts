// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceTopBar from './WorkspaceTopBar.vue'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountTopBar() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { WorkspaceTopBar },
    template: `
      <WorkspaceTopBar title="CTF" subtitle="题库与解题会话">
        <template #badge><span data-test="badge">解题中</span></template>
        <template #actions><button type="button">设置</button></template>
        <template #filters><input placeholder="搜索" /></template>
      </WorkspaceTopBar>
    `,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('WorkspaceTopBar', () => {
  it('standardizes module title, subtitle, actions, and filter slots', async () => {
    const host = await mountTopBar()

    expect(host.textContent).toContain('CTF')
    expect(host.textContent).toContain('题库与解题会话')
    expect(host.querySelector('[data-test="badge"]')?.textContent).toBe('解题中')
    expect(host.querySelector('button')?.textContent).toBe('设置')
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('搜索')
    expect(host.querySelector('.workspace-topbar')).not.toBeNull()

    const title = host.querySelector('[data-workspace-topbar-title]')
    expect(title?.tagName).toBe('H1')
    expect(title?.className).toContain('workspace-topbar__title')
    expect(host.querySelector('[data-workspace-topbar-subtitle]')?.className).toContain('text-caption')
    expect(host.querySelector('[data-workspace-topbar-actions]')?.className).toContain('text-control')
  })

  it('uses the same module title element and font class for Coding, CTF, and CVE', async () => {
    for (const title of ['Coding', 'CTF', 'CVE']) {
      const host = document.createElement('div')
      document.body.append(host)
      const app = createApp(WorkspaceTopBar, {
        title,
        subtitle: `${title} subtitle`,
      })
      app.mount(host)
      mountedApps.push(app)
      await nextTick()

      const topbar = host.querySelector('[data-module-topbar]')
      const titleNode = host.querySelector('[data-workspace-topbar-title]')
      expect(topbar).not.toBeNull()
      expect(titleNode?.tagName).toBe('H1')
      expect(titleNode?.textContent).toBe(title)
      expect(titleNode?.className).toContain('workspace-topbar__title')
      expect(titleNode?.className).not.toContain('text-control')
    }
  })
})
