import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 6b-2：侧栏红叉的**接线守卫**（行首锚定 ⇒ 注释掉的行不算 ✓）。
// ⚠️ 这是接线守卫，不是渲染用例 ✗（渲染用例留产品级黑盒 ✓）。
const sidebar = readFileSync(new URL('./ContextSidebar.tsx', import.meta.url), 'utf8')
const appSidebar = readFileSync(new URL('./AppSidebar.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

describe('侧栏红叉接线（只要被拦就亮）', () => {
  it('该对话在 problemConversationIds 里 ⇒ 槽位渲染 problem 变体', () => {
    expect(/^\s*\{problemConversationIds\.has\(conversation\.id\) \? \($/m.test(sidebar)).toBe(true)
    expect(/^\s*<AgentDecisionMark variant="problem" \/>$/m.test(sidebar)).toBe(true)
  })

  it('红叉优先于待决策/运行中（被拦就一定亮）', () => {
    const i = sidebar.indexOf('{problemConversationIds.has(conversation.id) ? (')
    const j = sidebar.indexOf('needsDecisionConversationIds.has(conversation.id) ? (')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(-1)
    expect(i).toBeLessThan(j)
  })

  it('AppSidebar 透传 + App.tsx 两处接线（与上游同形）', () => {
    expect(/^\s*problemConversationIds={problemConversationIds}$/m.test(appSidebar)).toBe(true)
    expect(/^\s*problemConversationIds: conversations\.problemConversationIds,$/m.test(app)).toBe(true)
    expect(/^\s*problemConversationIds={conv\.problemConversationIds}$/m.test(app)).toBe(true)
  })
})
