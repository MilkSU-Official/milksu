// 转写区渲染窗口 —— 纯函数，方便测。
//
// 长对话不能把全部段落挂上 DOM（实测几千轮的会话会有几十万个节点，滚动发涩）。
// 这里把「挂哪些段」做成一个恒有界的滑动窗口：
//   - 窗口最多 cap 段；钉在底部时窗口永远贴尾（新输出总是可见）。
//   - 读者往上翻时，顶部哨兵驱动窗口整体向头部滑动（挂载量不变，底部裁掉已读段），
//     底部哨兵驱动滑回；滚动位置由元素级锚定补偿（见 ChatPage）。
//   - 只影响画什么：chatTranscript 数据一个字节都不动。

/** 同屏最多挂载多少段。 */
export const TRANSCRIPT_WINDOW_CAP = 400

/** 哨兵触发一次，窗口整体滑动多少段。 */
export const TRANSCRIPT_WINDOW_CHUNK = 120

export interface TranscriptWindow {
  /** 窗口起点（含）。 */
  start: number
  /** 窗口终点（不含）。 */
  end: number
  /** 窗口长度（≤ cap）。 */
  size: number
  /** 窗口之前还有多少段（> 0 时顶部有更早内容）。 */
  hiddenBefore: number
  /** 窗口之后还有多少段（> 0 时底部有更新内容）。 */
  hiddenAfter: number
}

/** 贴尾窗口的起点：最后 cap 段。 */
export function tailTranscriptStart(length: number, cap = TRANSCRIPT_WINDOW_CAP): number {
  return Math.max(0, Math.max(0, Math.floor(length)) - Math.max(1, Math.floor(cap)))
}

export function computeTranscriptWindow(
  length: number,
  start: number,
  cap = TRANSCRIPT_WINDOW_CAP,
): TranscriptWindow {
  const safeLength = Math.max(0, Math.floor(length))
  const safeCap = Math.max(1, Math.floor(cap))
  const safeStart = Math.min(Math.max(0, Math.floor(start)), Math.max(0, safeLength - 1))
  const end = Math.min(safeLength, safeStart + safeCap)
  return {
    start: safeStart,
    end,
    size: end - safeStart,
    hiddenBefore: safeStart,
    hiddenAfter: safeLength - end,
  }
}

/** 窗口整体滑动一格，返回新起点（已夹到合法范围）。 */
export function slideTranscriptStart(
  start: number,
  direction: 'earlier' | 'later',
  length: number,
  chunk = TRANSCRIPT_WINDOW_CHUNK,
  cap = TRANSCRIPT_WINDOW_CAP,
): number {
  const step = Math.max(1, Math.floor(chunk))
  if (direction === 'earlier') return Math.max(0, Math.floor(start) - step)
  return Math.min(Math.floor(start) + step, tailTranscriptStart(length, cap))
}
