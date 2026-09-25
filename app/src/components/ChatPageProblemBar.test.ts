import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 6a-2：顶部常驻横幅的**源码守卫**（行首锚定 ⇒ 被注释掉的行不算 ✓）。
// ⚠️ 这是接线守卫，不是渲染用例 ✗ —— 真实渲染用例留产品级黑盒阶段 ✓。
const source = readFileSync(new URL('./ChatPage.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../styles/agent-conversation.css', import.meta.url), 'utf8')

function bannerBlock(): string {
  const start = source.indexOf('data-testid="problem-bar"')
  expect(start).toBeGreaterThan(-1)
  const open = source.lastIndexOf('{activeProblemTurn ? (', start)
  const end = source.indexOf('{engineNotice ? (', start)
  return source.slice(open, end > 0 ? end : start + 1200)
}

describe('被拦对话的顶部常驻横幅', () => {
  it('横幅由 activeProblemTurn 决定是否渲染（常驻，不是瞬时提示）', () => {
    expect(/^\s*\{activeProblemTurn \? \($/m.test(source)).toBe(true)
    expect(/^\s*\) : null\}$/m.test(bannerBlock())).toBe(true)
  })

  it('「知道了」按钮接通 dismissProblemTurn（点它才消失）', () => {
    expect(/^\s*data-testid="dismiss-problem-bar"$/m.test(bannerBlock())).toBe(true)
    expect(/^\s*onClick=\{\(\) => conversations\.dismissProblemTurn\(\)\}$/m.test(bannerBlock())).toBe(true)
  })

  it('文案取自被拦记录（notice / noticeEnglish 二者之一）', () => {
    expect(/activeProblemTurn\.notice/.test(bannerBlock())).toBe(true)
  })

  it('绝不自动消失：横幅内没有定时器 / 12 秒（读者明确否决过 12s 自消失）', () => {
    const block = bannerBlock()
    expect(/setTimeout|setInterval|12000|12_000/.test(block)).toBe(false)
  })

  it('样式是实色底（不是半透明），且类名落在本分支的样式表里', () => {
    expect(/^\.problem-bar \{$/m.test(css)).toBe(true)
    expect(/^\s*background: #7f1d1d;$/m.test(css)).toBe(true)
  })
})
