// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import chatPageSourceRaw from './ChatPage.vue?raw'
import ctfEndpointAuthorizationSource from './CTFEndpointAuthorization.vue?raw'
import ctfManualIntakeSource from './CTFManualIntake.vue?raw'
import ctfPageSourceRaw from './CTFPage.vue?raw'
import ctfWorkspaceHeaderSource from './CTFWorkspaceHeader.vue?raw'
import labPageSource from './LabPage.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'
import WorkspaceModuleTopBar from './WorkspaceModuleTopBar.vue'
import workspaceModuleTopBarSource from './WorkspaceModuleTopBar.vue?raw'
import workspaceTopBarSource from './WorkspaceTopBar.vue?raw'
import WorkspaceTopBar from './WorkspaceTopBar.vue'
import workspaceTopBarTitleSource from './WorkspaceTopBarTitle.vue?raw'

const chatPageSource = chatPageSourceRaw.replaceAll('\r\n', '\n')
const ctfPageSource = ctfPageSourceRaw.replaceAll('\r\n', '\n')

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

async function mountModuleTopBar(module: 'coding' | 'ctf' | 'cve' | 'lab') {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { WorkspaceModuleTopBar },
    template: `
      <WorkspaceModuleTopBar module="${module}" subtitle="${module} subtitle">
        <template #actions><button type="button">Action</button></template>
      </WorkspaceModuleTopBar>
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
    expect(host.querySelector('[data-workspace-module]')?.getAttribute('data-workspace-module')).toBe('ctf')

    const title = host.querySelector('[data-workspace-topbar-title]')
    expect(title?.tagName).toBe('H1')
    expect(title?.className).toContain('workspace-topbar__title')
    expect(title?.className).toContain('text-control')
    expect(host.querySelector('[data-workspace-topbar-subtitle]')?.className).toContain('text-caption')
    expect(host.querySelector('[data-workspace-topbar-actions]')?.className).toContain('text-control')
    expect(host.querySelector('[data-workspace-topbar-filters]')?.className).toContain('text-control')
  })

  it('uses the same module title element and font class for Coding, CTF, CVE, and Lab', async () => {
    const modules = [
      ['coding', 'Coding'],
      ['ctf', 'CTF'],
      ['cve', 'CVE'],
      ['lab', 'LAB'],
    ] as const
    const titleClasses = new Set<string>()
    const actionClasses = new Set<string>()

    for (const [module, title] of modules) {
      const host = await mountModuleTopBar(module)
      const topbar = host.querySelector('[data-module-topbar]')
      const titleNode = host.querySelector('[data-workspace-topbar-title]')
      expect(topbar).not.toBeNull()
      expect(topbar?.getAttribute('data-workspace-module')).toBe(module)
      expect(titleNode?.tagName).toBe('H1')
      expect(titleNode?.textContent).toBe(title)
      expect(titleNode?.className).toContain('workspace-topbar__title')
      expect(titleNode?.className).toContain('text-control')
      expect(host.querySelector('[data-workspace-topbar-actions]')?.className).toContain('text-control')
      titleClasses.add(titleNode?.className ?? '')
      actionClasses.add(host.querySelector('[data-workspace-topbar-actions]')?.className ?? '')
    }

    expect(titleClasses.size).toBe(1)
    expect(actionClasses.size).toBe(1)
    expect(workspaceTopBarSource).toContain('--module-topbar-title-size')
    expect(workspaceTopBarSource).toContain('--module-topbar-control-size')
  })

  it('keeps Coding, CTF, CVE, and Lab module headers on the shared module topbar component', () => {
    const files = [
      ['Coding', chatPageSource],
      ['CTF catalog', ctfPageSource],
      ['CTF session', ctfWorkspaceHeaderSource],
      ['CVE', vulnPageSource],
      ['Lab', labPageSource],
    ] as const

    for (const [surface, source] of files) {
      expect(source, `${surface} should import the shared module topbar`)
        .toContain("import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'")
      expect(source, `${surface} should render the shared module topbar`)
        .toContain('<WorkspaceModuleTopBar')
    }

    expect(chatPageSource).toContain('const topbarModule = computed')
    expect(chatPageSource).toContain(": props.vulnerabilitySession")
    expect(chatPageSource).toContain("? 'cve'")
    expect(chatPageSource).toContain(':module="topbarModule"')
    expect(ctfPageSource).toContain('module="ctf"')
    expect(ctfWorkspaceHeaderSource).toContain('module="ctf"')
    expect(vulnPageSource).toContain('module="cve"')
    expect(labPageSource).toContain('module="lab"')
    expect(workspaceTopBarSource).toContain('background: transparent')
    expect(workspaceTopBarSource).not.toContain('border-bottom')
    expect(workspaceTopBarSource).not.toContain('--foreground: var(--night-foreground)')
    expect(workspaceTopBarSource).not.toContain('var(--ak-surface-canvas')
    expect(workspaceModuleTopBarSource).toContain("coding: 'Coding'")
    expect(workspaceModuleTopBarSource).toContain("ctf: 'CTF'")
    expect(workspaceModuleTopBarSource).toContain("cve: 'CVE'")
    expect(workspaceModuleTopBarSource).toContain("lab: 'LAB'")
    expect(workspaceModuleTopBarSource).toContain('<WorkspaceTopBar')
    expect(workspaceModuleTopBarSource).toContain('data-workspace-module-topbar')
    expect(workspaceTopBarTitleSource).toContain('data-workspace-topbar-title')
    expect(workspaceTopBarTitleSource).toContain('workspace-topbar__title truncate text-control')
    expect(workspaceTopBarTitleSource).toContain('<h1')
    expect(workspaceTopBarSource).toContain('<WorkspaceTopBarTitle :title="title" />')
    expect(workspaceTopBarSource).toContain('hideIdentity')
    expect(workspaceModuleTopBarSource).toContain('hideIdentity')
    expect(workspaceTopBarSource).not.toContain('<h1')
    expect(chatPageSource).not.toContain('<h1 class="mt-5 text-2xl')
  })

  it('keeps topbar filters on the shared compact size', () => {
    expect(ctfPageSource).toContain('<SelectTrigger')
    expect(ctfPageSource).toContain('size="sm"')
    expect(ctfPageSource).toContain('v-model="deskQuery"')
    expect(ctfPageSource).toContain('v-model="deskCategory"')
    expect(ctfManualIntakeSource).toContain('v-model="category" size="sm"')
    expect(ctfManualIntakeSource).toContain('v-model="sourceKind" size="sm"')
    expect(ctfEndpointAuthorizationSource).toContain('v-model="protocol" size="sm"')
    expect(ctfEndpointAuthorizationSource).toContain('v-model="endpoint" size="sm"')
    expect(vulnPageSource).toContain('<NativeSelect v-model="statusFilter" size="sm"')
    expect(chatPageSource).toContain('<SelectTrigger')
    expect(chatPageSource).toContain('size="sm"')
  })
})
