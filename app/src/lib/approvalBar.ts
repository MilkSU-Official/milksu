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
  return approvalKeywordDestructive(content, approvalInput)
    || targetKinds.some(kind => kind !== 'unknown')
}

/** 只有关键词正则那一段，且区分**硬删除**动词与**软命中**（find 只读，典型误报来源）。 */
function approvalKeywordDestructive(content?: string, approvalInput?: string): boolean {
  return approvalHardKeywordDestructive(content, approvalInput)
    || /(^|\s)find\b/.test(`${content ?? ''}\n${approvalInput ?? ''}`)
}

/** 真删除/传递动词：rm、unlink、shred、xargs。决策层低风险分**无权**收掉这些命中。 */
function approvalHardKeywordDestructive(content?: string, approvalInput?: string): boolean {
  const command = `${content ?? ''}\n${approvalInput ?? ''}`
  return /(^|\s)(rm|unlink|shred)\b/.test(command) || /\bxargs\b/.test(command)
}

/**
 * 该不该显示「范围未核验」提示（原：`approvalUnverified`）。
 * 注意：它**不**控制「允许」按钮——按钮始终渲染，读者仍可放行；
 * 为 false 时只是说这条提示条要亮出来（破坏性且评估没通过 ⇒ 读者该多看一眼再拍板）。
 */
export function approvalCanAllow(destructive: boolean, canAllow: boolean): boolean {
  return !destructive || canAllow
}

/** 决策层判高危的阈值（Noul >= 0.5 ⇒ 正则漏掉的 dd/mkfs 也亮提示）。 */
export const APPROVAL_RISK_HIGH = 0.5
/** 决策层判安全的阈值（Noul <= 0.2 且本地只是关键词误报 ⇒ 收掉提示；实测目标不动）。 */
export const APPROVAL_RISK_LOW = 0.2

/**
 * 「范围未核验」提示的最终裁决 = 本地判定 + 决策层风险分（issue #117 场景二）。
 *
 * 决策层只影响**提示显隐**，不改变审批条本身——人在三档批准策略下照样拍板：
 *   - 请求批准：每次弹条，提示更准（漏报的高危命令补上，find 类误报收掉）；
 *   - 替我审批：被拦下来弹条的那部分（删除卡、外部账户等）同一套裁决；
 *   - 完全访问：没有条可挂，决策层不介入（也不该给完全访问添摩擦）。
 *
 * 方向是**对称收窄**：risk 为 null（没配凭据/调用失败）⇒ 退回纯本地判定，行为与本 PR 之前一致。
 */
export function approvalHintVisible({
  content,
  approvalInput,
  targetKinds = [],
  canAllow,
  risk,
}: {
  content?: string
  approvalInput?: string
  targetKinds?: string[]
  canAllow: boolean
  /** 决策层 0..1 风险分；null = 不可用。 */
  risk?: number | null
}): boolean {
  const hasConcreteTarget = targetKinds.some(kind => kind !== 'unknown')
  if (risk != null) {
    if (risk >= APPROVAL_RISK_HIGH) return true
    // 低风险只收**软命中误报**（find 这类只读词）；硬删除动词（rm/unlink/shred/xargs）
    // 和实测目标（kind 不是 unknown）都是更高置信度的事实，决策层无权抹掉。
    if (risk <= APPROVAL_RISK_LOW && !hasConcreteTarget && !approvalHardKeywordDestructive(content, approvalInput)) {
      return false
    }
  }
  return approvalBarIsDestructive({ content, approvalInput, targetKinds }) && !canAllow
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
