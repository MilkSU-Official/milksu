/**
 * 「这个会话在等我拍板吗」的判定。
 *
 * 侧栏现在只会显示"运行中"的转圈，于是会话在等用户批准删除 / 回答一个 ask 时看起来和"在跑"一样，
 * 用户根本不知道轮到自己了。这里给出一个可测的判定，供侧栏（以及其它地方）复用：
 *
 *  - 待审批：消息带 `approvalState === 'pending'` + `approvalRequestId`，且**不是** ask；
 *  - 待回答：`isAskMessage`（milksu_ask + approvalRequestId）且 `approvalState === 'pending'`。
 *
 * 已经回答过的（approved / denied / expired）一律**不算**待决策。
 */

import { isAskMessage } from '@/lib/agentAsk'

type DecisionMessage = {
  approvalState?: string
  approvalRequestId?: string
  toolName?: string
}

/**
 * 会话里是否存在"等用户拍板"的消息。只看最后一条是**不够**的：用户可能在批准前又插了别的话，
 * 所以整段扫一遍 —— 只要还有未决的审批/ask，就仍然是在等他。
 */
export function conversationNeedsDecision(messages?: DecisionMessage[]): boolean {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    if (!message || message.approvalState !== 'pending') return false
    if (!message.approvalRequestId) return false
    // ask 与删除审批都算"待决策"，两者的区别只影响文案，不影响这里。
    return isAskMessage(message) || Boolean(message.approvalRequestId)
  })
}

/** 侧栏要的那一组会话 id（与 runningConversationIds 同形，便于直接传）。 */
export function needsDecisionConversationIds(
  conversations?: Array<{ id: string; messages?: DecisionMessage[] }>,
): string[] {
  if (!Array.isArray(conversations)) return []
  return conversations
    .filter(conversation => conversation && conversationNeedsDecision(conversation.messages))
    .map(conversation => String(conversation.id))
}
