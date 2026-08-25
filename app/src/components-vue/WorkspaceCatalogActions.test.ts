// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import WorkspaceCatalogActions from './WorkspaceCatalogActions.vue'
import catalogActionsSource from './WorkspaceCatalogActions.vue?raw'
import catalogHistoryItemSource from './WorkspaceCatalogHistoryItem.vue?raw'
import importDialogSource from './WorkspaceImportDialog.vue?raw'
import ctfPageSource from './CTFPage.vue?raw'
import labPageSource from './LabPage.vue?raw'
import vulnPageSource from './VulnPage.vue?raw'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('list chrome', () => {
  it('renders History and Import as the shared catalog actions', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    let imported = 0
    const app = createApp(WorkspaceCatalogActions, {
      historyCount: 3,
      historyAriaLabel: '打开训练历史',
      historyMenuLabel: '训练历史',
      actionAriaLabel: '导入题目',
      onAction: () => { imported += 1 },
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.querySelector('[data-workspace-catalog-actions]')).not.toBeNull()
    expect(host.querySelector('[data-testid="workspace-history"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="打开训练历史"]')?.textContent).toContain('历史')
    expect(host.textContent).toContain('3')
    const importButton = host.querySelector<HTMLButtonElement>('[data-testid="workspace-import"]')
    expect(importButton?.textContent).toContain('导入')
    expect(importButton?.className).toContain('workspace-catalog-action')
    importButton?.click()
    await nextTick()
    expect(imported).toBe(1)
  })

  it('labels Lab create instead of import', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(WorkspaceCatalogActions, {
      action: 'create',
      actionAriaLabel: '创建自定义任务',
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    const createButton = host.querySelector<HTMLButtonElement>('[data-testid="workspace-create"]')
    expect(createButton?.textContent).toContain('创建')
    expect(host.querySelector('[data-testid="workspace-import"]')).toBeNull()
  })

  it('keeps CTF, CVE, and Lab on the shared list-chrome primitives', () => {
    expect(catalogActionsSource).toContain("t('历史', 'History')")
    expect(catalogActionsSource).toContain("t('导入', 'Import')")
    expect(catalogActionsSource).toContain("t('创建', 'Create')")
    expect(catalogActionsSource).toContain('workspace-catalog-action')
    expect(importDialogSource).toContain("t('导入', 'Import')")
    expect(importDialogSource).toContain('DialogPanel')
    expect(catalogHistoryItemSource).toContain('data-workspace-catalog-history-item')
    for (const source of [ctfPageSource, vulnPageSource, labPageSource]) {
      expect(source).toContain('WorkspaceCatalogActions')
      expect(source).toContain('WorkspaceImportDialog')
      expect(source).toContain('WorkspaceCatalogHistoryItem')
    }
    expect(labPageSource).toContain('action="create"')
    expect(labPageSource).toContain(":title=\"t('创建', 'Create')\"")
    expect(ctfPageSource).toContain('label="NSSCTF"')
    expect(ctfPageSource).toContain('label="CTFshow"')
    expect(ctfPageSource).toContain("@click=\"syncCatalog\"")
    expect(ctfPageSource).toContain("@click=\"refreshCTFShow\"")
    expect(ctfPageSource).not.toContain("screen === 'source'")
    expect(ctfPageSource).not.toContain("activeBank.value = 'custom'")
  })
})
