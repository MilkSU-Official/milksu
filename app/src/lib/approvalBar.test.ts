import { describe, expect, it } from 'vitest'
import {
  APPROVAL_RISK_HIGH,
  APPROVAL_RISK_LOW,
  approvalBarIsDestructive,
  approvalCanAllow,
  approvalHintVisible,
  approvalSubmitAllowed,
  approvalTimeoutOutcome,
} from '@/lib/approvalBar'

// 审批条的语义（照 ChatPage 原实现抽出来的纯函数；不渲染页面 ⇒ 不撞 ?raw 图标坑）。
describe('approval bar', () => {
  // (a) 破坏性审批 ⇒ 默认就是"需要读者明确批准"，且判定为破坏性。
  it('treats a delete command as destructive', () => {
    expect(approvalBarIsDestructive({ content: 'rm -rf /tmp/build' })).toBe(true)
    expect(approvalBarIsDestructive({ content: 'ls -la' })).toBe(false)
    // 有具体目标（不是 unknown）也算破坏性。
    expect(approvalBarIsDestructive({ content: 'run it', targetKinds: ['file'] })).toBe(true)
    // xargs 是原实现点名的形状。
    expect(approvalBarIsDestructive({ content: 'cat list.txt | xargs rm' })).toBe(true)
  })

  // (b) 破坏性且评估不允许 ⇒ 显示「范围未核验」提示（允许按钮仍在，读者可放行）。
  it('flags a destructive request the assessment refuses as unverified', () => {
    const destructive = approvalBarIsDestructive({ content: 'rm -rf /' })
    expect(destructive).toBe(true)
    expect(approvalCanAllow(destructive, false)).toBe(false)
    // 非破坏性 ⇒ 不亮提示。
    expect(approvalCanAllow(false, false)).toBe(true)
  })

  // 没有请求号、或已经在提交中 ⇒ 重复点不发第二次。
  it('ignores a submit without a request id, and a double submit', () => {
    expect(approvalSubmitAllowed({ hasRequestId: false, submitting: false })).toBe(false)
    expect(approvalSubmitAllowed({ hasRequestId: true, submitting: true })).toBe(false)
  })

  // (c) 回滚：3 秒没被确认 ⇒ 退回未提交 + 给出"未确认"（这条是"由红转绿"的那条）。
  it('rolls the bar back and reports it when the decision was never confirmed', () => {
    expect(approvalTimeoutOutcome(true)).toEqual({ submitting: false, unconfirmed: true })
  })

  // (d) 已经收到结果 ⇒ **不许**再翻回去（否则会留下半个决定）。
  it('never rolls back a decision that already settled', () => {
    expect(approvalTimeoutOutcome(false)).toEqual({ submitting: false, unconfirmed: false })
  })

  // (e) 决策层风险分（issue #117 场景二）：三档批准策略下人都照样拍板，风险分只动提示显隐。
  describe('approvalHintVisible with decision-layer risk', () => {
    // risk 不可用（没配凭据/调用失败）⇒ 与纯本地判定完全一致。
    it('falls back to the local verdict when risk is null', () => {
      expect(approvalHintVisible({ content: 'find . -name x', canAllow: false, risk: null }))
        .toBe(true)
      expect(approvalHintVisible({ content: 'ls -la', canAllow: false, risk: null }))
        .toBe(false)
    })

    // 高危分 ⇒ 即使本地正则什么都没命中也亮提示（dd / mkfs / 覆盖重定向这类漏网命令）。
    it('raises the hint on a high risk score even when the regex missed', () => {
      expect(approvalHintVisible({ content: 'dd if=/dev/zero of=/dev/sda', canAllow: true, risk: APPROVAL_RISK_HIGH }))
        .toBe(true)
    })

    // 低危分 ⇒ 收掉 find 类软命中误报；但硬删除动词（rm）和实测目标抹不掉。
    it('clears a soft keyword false positive on a low risk score', () => {
      expect(approvalHintVisible({ content: 'find . -name "*.log"', canAllow: false, risk: APPROVAL_RISK_LOW }))
        .toBe(false)
      // rm 是真删除动词，决策层说安全也不收。
      expect(approvalHintVisible({ content: 'rm -rf /tmp/build', canAllow: false, risk: APPROVAL_RISK_LOW }))
        .toBe(true)
      // 实测目标（kind 不是 unknown）是本地量出来的事实，同样不收。
      expect(approvalHintVisible({ content: 'run it', targetKinds: ['file'], canAllow: false, risk: APPROVAL_RISK_LOW }))
        .toBe(true)
    })

    // 中间带 ⇒ 维持本地判定，不摇摆。
    it('keeps the local verdict on a middle risk score', () => {
      const middle = (APPROVAL_RISK_HIGH + APPROVAL_RISK_LOW) / 2
      expect(approvalHintVisible({ content: 'find . -name x', canAllow: false, risk: middle }))
        .toBe(true)
      expect(approvalHintVisible({ content: 'ls -la', canAllow: false, risk: middle }))
        .toBe(false)
    })
  })
})
