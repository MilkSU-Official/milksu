/**
 * 审批条的**决策**（纯函数 ✓，从 `ChatPage.tsx` 里抽出来 —— 原先写在组件内联里 ✗，没法在
 * 不渲染整个 ChatPage 的前提下断言 ✓；渲染整个页面会撞 `?raw` 图标坑 ✗）。
 *
 * 语义**完全照抄原实现** ✓（`ChatPage.tsx` 的 `:414` / `:420` / `:431-446` ✓），**没有新增需求** ✗。
 * 这里不放句子 ✓（仓库约定：面向用户的文字走 `t(中文, English)` ✓，句子留在组件里 ✓）。
 */

/** 破坏性命令的判定（原：`/(^|\s)(rm|find|unlink|shred)\b/` + `\bxargs\b` + 有具体目标）。 */
export function approvalBarIsDestructive({
  content,
  approvalInput,
  targetKinds = [],
}: {
  content?: string
  approvalInput?: string
  targetKinds?: string[]
}): boolean {
  const command = `${content ?? ''}\n${approvalInput ?? ''}`
  return (
    /(^|\s)(rm|find|unlink|shred)\b/.test(command)
    || /\bxargs\b/.test(command)
    || targetKinds.some(kind => kind !== 'unknown')
  )
}

/** 能不能给"允许"入口：破坏性且评估不允许 ⇒ **只能拒绝** ✓（原：`!destructive || canAllow`）。 */
export function approvalCanAllow(destructive: boolean, canAllow: boolean): boolean {
  return !destructive || canAllow
}

/**
 * 点"允许/拒绝"时该不该真的发出去 —— 原 `submitApproval` 开头那两道守卫：
 * 没有请求号、或已经在提交中 ⇒ 不重复发。
 *
 * 注意：我们装机线里还多一道"允许 + 评估不允许 ⇒ 拒发"的守卫（**官方没有** ✗），
 * 为了让这条 PR 是**零行为变化**的重构，这里**没有**把它带进来。
 */
export function approvalSubmitAllowed({
  hasRequestId,
  submitting,
}: {
  hasRequestId: boolean
  submitting: boolean
}): boolean {
  return Boolean(hasRequestId) && !submitting
}

/**
 * 提交后一直没被引擎确认（3 秒）时该怎么办 —— 原实现在 `setTimeout` 里做的**回滚** ✓：
 * 仍在提交中 ⇒ **退回未提交并给出"未确认"** ✓；已经收到结果（`submitting === false`）⇒ **什么都不做** ✗
 * （**不许**把已经确定的决定再翻回来 ✓ —— 那正是"留下半个决定" ✗）。
 */
export function approvalTimeoutOutcome(currentlySubmitting: boolean): {
  submitting: boolean
  unconfirmed: boolean
} {
  if (!currentlySubmitting) return { submitting: false, unconfirmed: false }
  return { submitting: false, unconfirmed: true }
}
