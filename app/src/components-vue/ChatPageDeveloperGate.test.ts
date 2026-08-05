import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'

describe('ChatPage developer gate', () => {
  it('delegates Coding product-loop visibility to the collapsed panel component', () => {
    const panelStart = chatPageSource.indexOf('<CodingProductLoopPanel')
    const taskActionsStart = chatPageSource.indexOf('任务操作')

    expect(panelStart).toBeGreaterThan(-1)
    expect(taskActionsStart).toBeGreaterThan(panelStart)
    expect(chatPageSource).not.toContain('aria-label="Coding 开发者验收后台"')
  })
})
