// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ContextUsageMeter from '@/components/ContextUsageMeter'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'

afterEach(cleanup)

function budgetUsage(overrides: Partial<ContextUsagePresentation> = {}): ContextUsagePresentation {
  return {
    strip: '65%',
    percent: 65,
    nearLimit: false,
    inputLabel: '646K',
    outputLabel: '0',
    windowLabel: '1M',
    totalLabel: '646K',
    ioLabel: '↑646K ↓0',
    compacting: false,
    usedLabel: '65% 已用',
    tokenRatioLabel: '~646K / 1M',
    // 分界线的位置靠这两个值算出来：少了 windowTokens 就画不出竖线。
    windowTokens: 1_000_000,
    usableTokens: 616_000,
    budgetPercent: 105,
    overBudget: true,
    budgetLabel: '可用上限 616K',
    budgetHint: '窗口 1M = 输入 616K + 回答预留 384K。超过 616K 后余量不足，长回答可能装不下、对话中断；建议先整理上下文。',
    ...overrides,
  }
}

describe('ContextUsageMeter budget explanation', () => {
  // 读者实测：原生 title 悬停在这个 App 里不弹 ⇒ 提示必须自己画，且平时只显示简版。
  it('keeps the label clean (no extra words) and shows the reason only on hover', () => {
    render(<ContextUsageMeter usage={budgetUsage()} defaultOpen />)
    const label = screen.getByTestId('context-usage-budget')
    expect(label.textContent).toBe('可用上限 616K')
    expect(label.textContent).not.toContain('点一下')
    // 读者反馈过：整行都能触发太广 ⇒ 触发器必须贴着文字（inline-block）。
    expect(label.className).toContain('inline-block')
    expect(screen.queryByTestId('context-usage-budget-hint')).toBeNull()

    fireEvent.mouseEnter(label)
    const hint = screen.getByTestId('context-usage-budget-hint')
    expect(hint.textContent).toContain('384K')
    expect(hint.textContent).toContain('616K')
    // 口径：说清后果，但不能写成"必然崩"；而且要短。
    expect(hint.textContent).toContain('可能')
    expect(hint.textContent).not.toContain('会过满')
    expect(hint.textContent).not.toContain('HTTP 400')
    expect(hint.textContent.length).toBeLessThan(80)
    // 读者实测过：带原生 title 时，悬停会同时弹两个提示 ⇒ 自画提示必须独一份。
    expect(label.getAttribute('title')).toBeNull()

    fireEvent.mouseLeave(label)
    expect(screen.queryByTestId('context-usage-budget-hint')).toBeNull()
  })

  it('shows the same reason when hovering the divider itself', () => {
    render(<ContextUsageMeter usage={budgetUsage()} defaultOpen />)
    const limit = screen.getByTestId('context-usage-limit')
    expect(limit.getAttribute('title')).toBeNull()
    // 读者反馈：细线太难对准 ⇒ 触发区必须比可见的 2px 宽得多。
    expect(limit.className).toContain('w-7')
    fireEvent.mouseEnter(limit)
    expect(screen.getByTestId('context-usage-budget-hint').textContent).toContain('384K')
    fireEvent.mouseLeave(limit)
    expect(screen.queryByTestId('context-usage-budget-hint')).toBeNull()
  })

  it('offers nothing to explain when the model gave no budget', () => {
    render(
      <ContextUsageMeter
        usage={budgetUsage({
          usableTokens: undefined,
          budgetPercent: undefined,
          overBudget: false,
          budgetLabel: undefined,
          budgetHint: undefined,
        })}
        defaultOpen
      />,
    )
    expect(screen.queryByTestId('context-usage-budget')).toBeNull()
    expect(screen.queryByTestId('context-usage-budget-hint')).toBeNull()
  })
})
