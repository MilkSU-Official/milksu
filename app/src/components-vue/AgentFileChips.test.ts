// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AgentFileChips from './AgentFileChips.vue'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('AgentFileChips', () => {
  it('shows file chips and a hover preview of the diff', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const opened: string[] = []
    const app = createApp(AgentFileChips, {
      files: [{
        path: 'greet.ts',
        add: 2,
        del: 1,
        lines: [
          { text: 'hello', tone: 'del' },
          { text: 'hello world', tone: 'add' },
        ],
      }],
      onOpenChanges: (path: string) => opened.push(path),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const chip = host.querySelector<HTMLElement>('[data-diffchip]')
    expect(host.textContent).toContain('greet.ts')
    expect(host.textContent).toContain('+2')
    chip?.dispatchEvent(new Event('mouseenter', { bubbles: true }))
    await nextTick()
    const preview = document.querySelector('.agent-diff-preview')
    expect(preview?.textContent).toContain('hello world')
    expect(preview?.textContent).toContain('hello')
    host.querySelector<HTMLButtonElement>('[aria-label="在变更中打开 greet.ts"]')?.click()
    expect(opened).toEqual(['greet.ts'])
  })
})
