/**
 * 审批护栏的本地偏好：是否"同时保护我的项目目录"（maiRecord 等）。
 *
 * 只放前端本地（localStorage），不改后端 settings.json 的结构：这一条是读者本机的选择，
 * 与账户/模型配置无关，改动最小、风险最低。默认 true = 与以前的行为完全一致。
 * 写法照抄 composerDraftStore：读写都 try/catch，没有 window（SSR/测试）或隐私模式写不进去时
 * 退化为内存，功能照常但不持久。
 */
export const APPROVAL_GUARDS_STORAGE_KEY = 'milksu.guard-project-protection.v1'

let memoryValue: boolean | null = null

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/** 默认 true：没写过、读不出来、坏了都按"保护"处理（宁可多保护一次）。 */
export function readProtectProjectPaths(): boolean {
  const store = storage()
  if (!store) return memoryValue ?? true
  try {
    const raw = store.getItem(APPROVAL_GUARDS_STORAGE_KEY)
    if (raw === null) return memoryValue ?? true
    if (raw === 'false') return false
    if (raw === 'true') return true
    return memoryValue ?? true
  } catch {
    return memoryValue ?? true
  }
}

export function writeProtectProjectPaths(value: boolean) {
  memoryValue = value
  const store = storage()
  if (!store) return
  try {
    store.setItem(APPROVAL_GUARDS_STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // 隐私模式/配额满：内存里已经记住，本次会话仍然生效。
  }
}

/** 测试用：把内存里的值清掉（localStorage 由测试自己清）。 */
export function resetApprovalGuardsPreference() {
  memoryValue = null
}
