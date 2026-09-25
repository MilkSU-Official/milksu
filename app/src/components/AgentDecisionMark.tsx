import { useT } from '@/hooks/useUiLocale'

// 3×3 点阵：中心那一格（索引 4）**留空** ⇒ 8 个方形小格绕成一圈。
const DECISION_RING_SLOTS = 9
const DECISION_RING_CENTER = 4

/**
 * 「这个会话在等你拍板」的标记（侧栏用）。
 *
 * 形态：**3×3 像素点阵、中心留空** ⇒ 8 个小方格雷成一圈、**琥珀色**。
 *
 * 尺寸来自共享网格类（`.agent-pixel` = `repeat(3, 4px)` + `gap: 1.5px`；
 * `.agent-pixel__cell` = 4×4 + `border-radius: 1px`）。修饰类只改颜色：用现成的 `--warning`。
 * 中心空位占住一格，环的尺寸不变。
 * 无障碍：`role="status"` + 双语 `aria-label`（这是状态，不是按钮）。
 */
export default function AgentDecisionMark({ label }: { label?: string }) {
  const t = useT()
  const text = label ?? t('需要你决定', 'Needs your decision')
  return (
    <span className="agent-decision-mark inline-flex items-center" role="status" aria-label={text}>
      <span className="agent-pixel agent-pixel--decision" aria-hidden="true">
        {Array.from({ length: DECISION_RING_SLOTS }, (_slot, index) => (
          index === DECISION_RING_CENTER
            // 中心留空：占位但不画格子，所以"没有格子元素"是可断言的。
            ? <span key={index} className="agent-pixel__cell--hole" />
            : <span key={index} className="agent-pixel__cell agent-pixel__cell--decision" />
        ))}
      </span>
    </span>
  )
}
