// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChatComposer from './ChatComposer.vue'

const mountedApps: App[] = []

function mountComposer(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const sent: unknown[][] = []
  let consumedGoals = 0
  const app = createApp(ChatComposer, {
    running: false,
    aborting: false,
    ctfSession: false,
    goalMode: false,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
    approvalLabel: '替我审批',
    modelKey: 'auto',
    automaticModelLabel: '自动 · DeepSeek · DeepSeek V4 Flash · 快速执行',
    compactModelLabel: 'V4 Flash',
    onSend: (...args: unknown[]) => sent.push(args),
    onConsumeGoal: () => {
      consumedGoals += 1
    },
    ...overrides,
  })
  const vm = app.mount(host) as unknown as { appendDraftText: (text: string) => void }
  mountedApps.push(app)
  return {
    host,
    vm,
    sent,
    consumedGoals: () => consumedGoals,
  }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('ChatComposer', () => {
  it('keeps only mode, permission, and model controls above a Coding message', async () => {
    const { host } = mountComposer()
    await nextTick()

    expect(host.querySelectorAll('[aria-label="Coding 执行模式"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="Coding 权限策略"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="选择本任务模型"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="添加文件或图片"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="消息"]')?.getAttribute('placeholder') ?? '').toBe('')
    expect(host.textContent).not.toContain('架构图')
    expect(host.textContent).not.toContain('能力')
    expect(host.textContent).not.toContain('目标')
  })

  it('submits a goal without exposing goal controls in the Composer', async () => {
    const result = mountComposer({ goalMode: true })
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea).not.toBeNull()
    if (!textarea) return
    textarea.value = '完成发布回归'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['/goal 完成发布回归', '完成发布回归', []],
    ])
    expect(result.consumedGoals()).toBe(1)
  })

  it('lets a parent append confirmed context into the draft before sending', async () => {
    const result = mountComposer()
    await nextTick()

    result.vm.appendDraftText('参考相关历史：CVE 同步失败曾由缓存过期导致。')
    await nextTick()

    const textarea = result.host.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')
    expect(textarea?.value).toContain('参考相关历史')

    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toEqual([
      ['参考相关历史：CVE 同步失败曾由缓存过期导致。', '参考相关历史：CVE 同步失败曾由缓存过期导致。', []],
    ])
  })

  it('keeps CTF collaboration actions without leaking Coding controls', async () => {
    const { host } = mountComposer({
      ctfSession: true,
      ctfRole: 'solver',
      ctfMode: 'coach',
    })
    await nextTick()

    expect(host.querySelector('[aria-label="Coding 执行模式"]')).toBeNull()
    expect(host.querySelector('[aria-label="Coding 权限策略"]')).toBeNull()
    expect(host.querySelector('[aria-label="选择本任务模型"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="添加文件或图片"]')).toBeNull()
    expect(host.querySelector('[aria-label="CTF 快捷协作"]')?.textContent)
      .toContain('梳理题面')
    expect(host.querySelector('[aria-label="CTF 快捷协作"]')?.textContent)
      .toContain('重新规划')
  })

  it('allows one stop request and shows the pending acknowledgement state', async () => {
    const stopped: unknown[][] = []
    const running = mountComposer({
      running: true,
      onAbort: (...args: unknown[]) => stopped.push(args),
    })
    await nextTick()

    const stop = running.host.querySelector<HTMLButtonElement>('[aria-label="停止 Agent"]')
    expect(stop).not.toBeNull()
    stop?.click()
    expect(stopped).toEqual([[]])

    const aborting = mountComposer({
      running: true,
      aborting: true,
      onAbort: (...args: unknown[]) => stopped.push(args),
    })
    await nextTick()

    const pending = aborting.host.querySelector<HTMLButtonElement>(
      '[aria-label="正在停止 Agent"]',
    )
    expect(pending?.disabled).toBe(true)
    pending?.click()
    expect(stopped).toEqual([[]])
  })
})
