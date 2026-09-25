import { describe, expect, it } from 'vitest'
import {
  approvalBarIsDestructive,
  approvalCanAllow,
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
})
