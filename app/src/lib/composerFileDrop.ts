/**
 * 整窗拖拽加附件的纯判定部分。
 *
 * 组件里挂 dragenter/dragover/dragleave/drop 时最容易错的三件事都在这里做成可测的函数：
 * ① 只有真正拖着"文件"时才接管 ✓（否则拖侧栏的会话行会被当成加附件 ✗）；
 * ② dragenter/dragleave 会因为子元素反复触发 ✓，必须用计数器 ✓；
 * ③ 超过上限 / 拖进文件夹时要能说清并拒绝 ✗，而不是静默忽略 ✗。
 */

/** 每条消息的附件上限，与输入框那条限制保持一致。 */
export const ATTACHMENT_LIMIT = 8

/**
 * 这次拖拽是否携带文件。`types` 来自 `DataTransfer.types` ✓；
 * 只有它包含 `Files` 时才接管 ✓ —— 拖"会话行"等内部拖拽不会有 Files ✓。
 */
export function isFileDrag(types?: readonly string[] | null): boolean {
  if (!types) return false
  return [...types].some(type => String(type).toLowerCase() === 'files')
}

/**
 * 覆盖层的进出计数：子元素的 dragenter/dragleave 会成对抖动 ✓，
 * 只有计数回到 0 才真正隐藏 ✓（drop 时强制归零 ✓）。
 */
export function nextDragDepth(current: number, event: 'enter' | 'leave' | 'drop'): number {
  if (event === 'drop') return 0
  if (event === 'enter') return Math.max(0, current) + 1
  return Math.max(0, Math.max(0, current) - 1)
}

export type FileDropPlan = {
  /** 这次真正要导入的文件数 ✓ */
  accept: number
  /** 因为超过上限而必须说明的个数 ✓ */
  overflow: number
  /** 其中是文件夹、必须拒绝的个数 ✓（不递归 ✗） */
  folders: number
}

/**
 * 把"拖进来的东西"拆成：能收几个 ✓、超了几个 ✓、几个是文件夹 ✓。
 * `folderCount` 由调用方用 `webkitGetAsEntry()` 判出来 ✓（拿不到就传 0 ✓）。
 */
export type DropFileItem = {
  kind?: string
  getAsFile?: () => File | null
  webkitGetAsEntry?: () => { isDirectory?: boolean } | null
}

/**
 * 从一次 drop 里挑出可以导入的文件。
 * `webkitGetAsEntry` 能用时，文件夹不进入文件列表：它们仍占着 FileList 的位置，
 * 直接按计划切片会把目录算进名额，体积为 0 时还会让整批被拒绝。
 * 没有这个 API 时原样返回 FileList。
 */
export function selectableDropFiles(
  fileList: ArrayLike<File> | undefined,
  items?: { length: number; [index: number]: DropFileItem | undefined } | null,
): { files: File[]; folders: number } {
  const raw = fileList ? Array.from(fileList) : []
  if (!items || typeof items.length !== 'number') return { files: raw, folders: 0 }
  let sawEntry = false
  let fileIndex = 0
  const files: File[] = []
  let folders = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || item.kind !== 'file') continue
    const fromList = raw[fileIndex]
    fileIndex += 1
    let isDirectory = false
    if (typeof item.webkitGetAsEntry === 'function') {
      sawEntry = true
      try {
        isDirectory = item.webkitGetAsEntry()?.isDirectory === true
      } catch {
        isDirectory = false
      }
    }
    if (isDirectory) {
      folders += 1
      continue
    }
    const fromItem = typeof item.getAsFile === 'function' ? item.getAsFile() : null
    const file = fromItem ?? fromList
    if (file) files.push(file)
  }
  if (!sawEntry) return { files: raw, folders: 0 }
  return { files, folders }
}

export function planFileDrop(input: {
  fileCount: number
  pendingCount: number
  folderCount?: number
  limit?: number
}): FileDropPlan {
  const limit = Math.max(0, Math.floor(input.limit ?? ATTACHMENT_LIMIT))
  const total = Math.max(0, Math.floor(input.fileCount ?? 0))
  const folders = Math.min(total, Math.max(0, Math.floor(input.folderCount ?? 0)))
  const importable = total - folders
  const room = Math.max(0, limit - Math.max(0, Math.floor(input.pendingCount ?? 0)))
  const accept = Math.min(importable, room)
  const overflow = importable - accept
  return { accept, overflow, folders }
}
