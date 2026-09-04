// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChatSubagentRoster from './ChatSubagentRoster.vue'
import type { SubagentTask } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function mountRoster(tasks: SubagentTask[]) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatSubagentRoster },
    setup: () => ({ tasks }),
    template: '<ChatSubagentRoster :tasks="tasks" />',
  })
  app.mount(host)
  mountedApps.push(app)
  return host
}

describe('ChatSubagentRoster', () => {
  it('draws nothing when the roster is empty', () => {
    const host = mountRoster([])
    expect(host.querySelector('[data-testid="subagent-roster"]')).toBeNull()
    expect(host.textContent).not.toContain('还没有子任务')
    expect(host.textContent).not.toContain('No subtasks')
  })

  it('shows a start row and then success or failure', async () => {
    const tasks: SubagentTask[] = [
      { id: 'call-1', role: 'scout', status: 'start' },
    ]
    const host = mountRoster(tasks)
    await nextTick()
    expect(host.querySelector('[data-testid="subagent-roster"]')).not.toBeNull()
    expect(host.querySelector('.agent-chip')).not.toBeNull()
    expect(host.textContent).toContain('scout')
    expect(host.textContent).toContain('call-1')
    expect(host.textContent).toContain('进行中')
    expect(host.querySelector('.agent-pixel')).not.toBeNull()

    tasks[0] = {
      id: 'call-1',
      role: 'scout',
      status: 'succeeded',
      durationMs: 1500,
      exitCode: 0,
      yield: {
        status: 'succeeded',
        cwd: '.',
        files: ['a.ts'],
        findings: [{ path: 'a.ts', note: 'renamed' }],
        exitCode: 0,
      },
    }
    const rebuilt = mountRoster(tasks)
    await nextTick()
    expect(rebuilt.textContent).toContain('成功')
    expect(rebuilt.textContent).toContain('结束码 0')
    rebuilt.querySelector('summary')?.click()
    await nextTick()
    expect(rebuilt.textContent).toContain('files[0]=a.ts')
  })
})
