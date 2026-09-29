/**
 * 侧栏项目文件夹的折叠阈值：每个项目先显示这么多条会话，多出来的收进
 * 末尾的「展开」行。出厂默认 5。Kimi Work 侧栏实测是 6，MilkSU 侧栏更窄，
 * 产品决定默认收到 5，可在设置 → 外观里改。
 *
 * 存储链路跟对话字号一致：设置文件是真值（`sidebar_project_fold_limit`），
 * App 启动时写进 localStorage，设置页改动经 BroadcastChannel 同步给已挂载的
 * 侧栏和其他窗口。
 */
export const PROJECT_FOLD_LIMIT_MIN = 1
export const PROJECT_FOLD_LIMIT_MAX = 20
export const FACTORY_PROJECT_FOLD_LIMIT = 5

export const PROJECT_FOLD_LIMIT_STORAGE_KEY = 'milksu.project-fold-limit'
export const PROJECT_FOLD_LIMIT_SYNC_CHANNEL = 'milksu.project-fold-limit-sync'

export function normalizeProjectFoldLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (Number.isInteger(parsed) && parsed >= PROJECT_FOLD_LIMIT_MIN && parsed <= PROJECT_FOLD_LIMIT_MAX) {
    return parsed
  }
  return FACTORY_PROJECT_FOLD_LIMIT
}

export function readStoredProjectFoldLimit(): number {
  try {
    return normalizeProjectFoldLimit(window.localStorage.getItem(PROJECT_FOLD_LIMIT_STORAGE_KEY))
  } catch {
    return FACTORY_PROJECT_FOLD_LIMIT
  }
}

export function applyProjectFoldLimit(
  value: unknown,
  options: { sync?: boolean } = {},
): number {
  const limit = normalizeProjectFoldLimit(value)
  try {
    window.localStorage.setItem(PROJECT_FOLD_LIMIT_STORAGE_KEY, String(limit))
  } catch {
    /* private mode or blocked storage */
  }
  if (options.sync !== false) {
    try {
      const channel = new BroadcastChannel(PROJECT_FOLD_LIMIT_SYNC_CHANNEL)
      channel.postMessage({ projectFoldLimit: limit })
      channel.close()
    } catch {
      // BroadcastChannel is unavailable in some test and embedded renderers.
    }
  }
  return limit
}

export function subscribeProjectFoldLimitSync(onChange: (limit: number) => void) {
  if (typeof window === 'undefined') return () => {}
  const apply = (value: unknown) => {
    onChange(normalizeProjectFoldLimit(value))
  }
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(PROJECT_FOLD_LIMIT_SYNC_CHANNEL)
    channel.onmessage = event => apply((event.data as { projectFoldLimit?: unknown } | null)?.projectFoldLimit)
  } catch {
    channel = null
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_FOLD_LIMIT_STORAGE_KEY) apply(event.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    if (channel) channel.close()
    window.removeEventListener('storage', onStorage)
  }
}
