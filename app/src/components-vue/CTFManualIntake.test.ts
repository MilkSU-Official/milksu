// @vitest-environment jsdom

import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CTFManualIntake from './CTFManualIntake.vue'

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async () => []),
  listenEvent: vi.fn(() => () => {}),
}))

const mountedApps: App[] = []
let originalShowModal: typeof HTMLDialogElement.prototype.showModal | undefined
let originalClose: typeof HTMLDialogElement.prototype.close | undefined
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined

beforeEach(() => {
  originalShowModal = HTMLDialogElement.prototype.showModal
  originalClose = HTMLDialogElement.prototype.close
  originalResizeObserver = globalThis.ResizeObserver
  HTMLDialogElement.prototype.showModal = function showModalStub() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function closeStub() {
    this.removeAttribute('open')
  }
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  if (originalShowModal) {
    HTMLDialogElement.prototype.showModal = originalShowModal
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  }
  if (originalClose) {
    HTMLDialogElement.prototype.close = originalClose
  } else {
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
  }
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver
  } else {
    delete (globalThis as Partial<typeof globalThis>).ResizeObserver
  }
})

async function mountManualIntake() {
  const api = ref<InstanceType<typeof CTFManualIntake> | null>(null)
  const submissions: unknown[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { CTFManualIntake },
    setup() {
      return { api, submissions }
    },
    template: `
      <CTFManualIntake
        ref="api"
        :loading="false"
        error=""
        @submit="submissions.push($event)"
      />
    `,
  })
  const vm = app.mount(host) as unknown as {
    api: InstanceType<typeof CTFManualIntake> | null
    submissions: unknown[]
  }
  mountedApps.push(app)
  await nextTick()
  return { host, vm }
}

function inputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CTFManualIntake', () => {
  it('opens and cancels with a fresh local draft instead of reusing stale custom CTF input', async () => {
    const { host, vm } = await mountManualIntake()
    vm.api?.open()
    await nextTick()

    const title = host.querySelector<HTMLInputElement>('input')
    const statement = host.querySelector<HTMLTextAreaElement>('textarea')
    expect(title).not.toBeNull()
    expect(statement).not.toBeNull()
    inputValue(title!, '旧的逆向题')
    inputValue(statement!, '旧题面')
    await nextTick()

    const cancel = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('取消'))
    cancel?.click()
    await nextTick()
    vm.api?.open()
    await nextTick()

    expect(host.querySelector('dialog')?.hasAttribute('open')).toBe(true)
    expect(title?.value).toBe('')
    expect(statement?.value).toBe('')
  })
})
