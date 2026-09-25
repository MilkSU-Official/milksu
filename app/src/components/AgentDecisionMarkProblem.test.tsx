/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AgentDecisionMark from './AgentDecisionMark'

// 6b-1：侧栏红叉（variant="problem"）。口径 = 只要被拦就亮，不分单次/停轮。
describe('AgentDecisionMark variant="problem"（红叉）', () => {
  it('problem：点亮叉形五格（左上/右上/中心/左下/右下），其余四格留空', () => {
    const { container } = render(<AgentDecisionMark variant="problem" />)
    expect(container.querySelectorAll('.agent-pixel__cell--problem')).toHaveLength(5)
    expect(container.querySelectorAll('.agent-pixel__cell--decision')).toHaveLength(0)
    expect(container.querySelectorAll('.agent-pixel__cell--hole')).toHaveLength(4)
    expect(container.querySelector('.agent-pixel--problem')).not.toBeNull()
  })

  it('默认（decision）仍是琥珀色一圈：中心留空、其余八格点亮', () => {
    const { container } = render(<AgentDecisionMark />)
    expect(container.querySelectorAll('.agent-pixel__cell--decision')).toHaveLength(8)
    expect(container.querySelectorAll('.agent-pixel__cell--problem')).toHaveLength(0)
    expect(container.querySelectorAll('.agent-pixel__cell--hole')).toHaveLength(1)
  })

  it('无障碍文案随 variant 变（problem ≠ 需要你决定）', () => {
    // ⚠️ 用 container 定位：直接 getByRole 会命中页面里其它 role="status" ✗
    const { container } = render(<AgentDecisionMark variant="problem" />)
    const mark = container.querySelector('[role="status"]')
    expect(mark?.getAttribute('aria-label')).toContain('问题')
  })
})
