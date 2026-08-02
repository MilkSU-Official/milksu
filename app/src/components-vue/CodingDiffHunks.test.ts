// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CodingDiffHunks from './CodingDiffHunks.vue'

const diff = [
  'diff --git a/example.txt b/example.txt',
  'index 1111111..2222222 100644',
  '--- a/example.txt',
  '+++ b/example.txt',
  '@@ -1 +1 @@',
  '-before',
  '+after',
  '',
].join('\n')

const apps: App[] = []

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mount(source: 'staged' | 'working-tree') {
  const host = document.createElement('div')
  document.body.append(host)
  const applied: unknown[][] = []
  const app = createApp(CodingDiffHunks, {
    diff,
    source,
    onApply: (...args: unknown[]) => applied.push(args),
  })
  app.mount(host)
  apps.push(app)
  await nextTick()
  return { host, applied }
}

describe('CodingDiffHunks', () => {
  it('offers stage and discard for a working-tree hunk', async () => {
    const { host, applied } = await mount('working-tree')

    expect(host.querySelector('[aria-label="暂存代码块 1"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="撤销代码块 1"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="取消暂存代码块 1"]')).toBeNull()
    ;(host.querySelector('[aria-label="暂存代码块 1"]') as HTMLButtonElement).click()
    await nextTick()

    expect(applied).toEqual([['stage-hunk', expect.stringContaining('+after')]])
  })

  it('offers only unstage for a staged hunk', async () => {
    const { host } = await mount('staged')

    expect(host.querySelector('[aria-label="取消暂存代码块 1"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="暂存代码块 1"]')).toBeNull()
    expect(host.querySelector('[aria-label="撤销代码块 1"]')).toBeNull()
  })
})
