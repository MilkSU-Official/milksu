// 转写区的“显示窗口”计算 —— 纯函数，方便测。
//
// 背景（实测）：窗口只增不减 ⇒ 往上滚得越多挂得越多 ⇒ 长会话最终把**全部**轮次都挂在
// DOM 上（实测一个 3781 轮的对话有 224,550 个节点，输出/滚动时每秒 2~3 次 50ms 级长任务）。
//
// 这里把窗口固定成一个**有上限的滑动窗口**：
//   - 长度 ≤ cap（页面上的节点数因此有上限 ✓）
//   - 可以整体往回挪 shift 段（更早的内容**仍然看得到** ✓，只是不常驻 ✓）
//   - 只看**窗口**，永远不删数据：chatTranscript 本身一个字节都不动 ✓
//
// ⚠️ 这**只影响画什么**，不影响发给模型的上下文，也不影响别的对话来读这份对话 ✓。

/** 同屏最多摊开多少段（超出部分收成一行「更早的 N 段」）。 */
export const TRANSCRIPT_MOUNT_CAP = 400

/** 点一次「更早的 N 段」，窗口往回挪多少段。 */
export const TRANSCRIPT_OLDER_CHUNK = 200

export interface TranscriptWindowInput {
  /** 转写里的总段数。 */
  length: number
  /** 调用方希望挂载的段数（现有 refill 逻辑会不断把它调大）。 */
  mounted: number
  /** 上限，默认 TRANSCRIPT_MOUNT_CAP。 */
  cap?: number
  /** 窗口从尾巴往回挪了多少段。 */
  shift?: number
}

export interface TranscriptWindow {
  /** 窗口起点（含）。 */
  start: number
  /** 窗口终点（不含）。 */
  end: number
  /** 窗口长度（= end - start，≤ cap）。 */
  size: number
  /** 窗口外还有多少段更早的（> 0 时该显示「更早的 N 段」入口）。 */
  hidden: number
  /** 窗口已经顶到上限（此时再往上滚不会再多挂，只能整体往回挪窗口）。 */
  atCap: boolean
  /** 实际生效的 shift（已被夹到合法范围）。 */
  shift: number
}

/**
 * 计算要渲染的那一段。
 *
 * 总段数 ≤ cap 时返回整段（start=0 / end=length / hidden=0）⇒ 短对话的行为**完全不变** ✓。
 */
export function computeTranscriptWindow(input: TranscriptWindowInput): TranscriptWindow {
  const length = Math.max(0, Math.floor(input.length))
  const cap = Math.max(1, Math.floor(input.cap ?? TRANSCRIPT_MOUNT_CAP))
  const mounted = Math.max(0, Math.floor(input.mounted))
  const wantedCap = Math.min(mounted, cap)
  const maxShift = Math.max(0, length - wantedCap)
  const shift = Math.min(Math.max(0, Math.floor(input.shift ?? 0)), maxShift)
  const end = length - shift
  const start = Math.max(0, end - wantedCap)
  return {
    start,
    end,
    size: end - start,
    hidden: start,
    atCap: wantedCap >= cap && length > cap,
    shift,
  }
}
