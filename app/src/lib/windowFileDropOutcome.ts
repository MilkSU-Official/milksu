/**
 * 窗口级拖放"收到文件之后怎么办"的决策（**纯函数 ✓**，可测 ✓，不涉及渲染 ✓）。
 *
 * 为什么单独抽出来：`ChatPage`/`ChatComposer` 一渲染就会拉进图标依赖 ⇒ 在这个 worktree 里撞上
 * 符号链接 `?raw` 既有坑 ✗（已经踩过三次 ✓）⇒ 把决策抽成小模块，红就能在**不渲染**的前提下跑 ✓。
 *
 * 输出只有两样 ✓：**要转交的文件** ✓（由调用方交给现成的 `importCodingFiles` ✓）与**要出的提示** ✓
 * （双语 ✓，由调用方走现成的 toast 通道 ✓）。**不做丢弃、不做静默** ✗。
 */

export type WindowFileDropNotice =
  | { kind: 'overflow'; count: number }
  | { kind: 'folders'; count: number }

export type WindowFileDropOutcome = {
  /** 真正要转交（导入）的文件。 */
  transfer: File[]
  /** 要如实告诉读者的提示（可能为空 ⇒ 什么都不提示 ✓）。 */
  notices: WindowFileDropNotice[]
}

export const WINDOW_FILE_DROP_LIMIT = 8

/**
 * `overflow` = 因为超过上限而没接收的数量 ✓；`folders` = 拖进来的文件夹数量 ✓（真实环境用
 * `webkitGetAsEntry().isDirectory` 数 ✓；jsdom 里没有该 API ⇒ 传 0 ✓）。
 *
 * ⚠️ 这里**不出文案** ✓：仓库约定所有面向用户的文字都要经组件的 `t(中文, English)` 成对出现
 * （`uiLocaleCoverage` 会抓"中文没配英文"✗ —— 我第一版把句子写在这里，被它当场抓到了 ✓）。
 * 所以只给**结构化的事实**（数量 + 种类 ✓），句子由调用方用 `t(...)` 拼 ✓。
 */
export function windowFileDropOutcome({
  accepted,
  overflow = 0,
  folders = 0,
}: {
  accepted: File[]
  overflow?: number
  folders?: number
}): WindowFileDropOutcome {
  const transfer = Array.isArray(accepted) ? accepted.filter(Boolean) : []
  const extra = Math.max(0, Math.floor(Number(overflow) || 0))
  const folderCount = Math.max(0, Math.floor(Number(folders) || 0))
  const notices: WindowFileDropNotice[] = []
  if (extra > 0) notices.push({ kind: 'overflow', count: extra })
  if (folderCount > 0) notices.push({ kind: 'folders', count: folderCount })
  return { transfer, notices }
}
