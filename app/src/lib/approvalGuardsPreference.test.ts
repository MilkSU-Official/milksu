// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APPROVAL_GUARDS_STORAGE_KEY,
  readProtectProjectPaths,
  resetApprovalGuardsPreference,
  writeProtectProjectPaths,
} from '@/lib/approvalGuardsPreference'

// 这个仓库的 vitest 环境不一定自带 localStorage（composerDraftStore.test.ts 也是自己装一个），
// 所以这里装一个最小的内存实现。
function installStorageStub(): Storage {
  const target = (globalThis as unknown as { window?: unknown }).window ?? globalThis
  const host = target as Record<string, unknown> & { localStorage?: Storage }
  if (!host.localStorage) {
    const map = new Map<string, string>()
    const stub: Storage = {
      get length() { return map.size },
      clear: () => { map.clear() },
      getItem: key => (map.has(String(key)) ? map.get(String(key))! : null),
      key: index => [...map.keys()][index] ?? null,
      removeItem: key => { map.delete(String(key)) },
      setItem: (key, value) => { map.set(String(key), String(value)) },
    }
    Object.defineProperty(host, 'localStorage', { configurable: true, value: stub })
  }
  return host.localStorage as Storage
}

beforeEach(() => {
  installStorageStub().clear()
  resetApprovalGuardsPreference()
})

afterEach(() => {
  resetApprovalGuardsPreference()
  installStorageStub().clear()
})

describe('approval guards preference', () => {
  // 默认必须是"保护"：没写过、读不出来、坏了都按保护处理。
  it('defaults to protecting project paths', () => {
    expect(readProtectProjectPaths()).toBe(true)
  })

  it('remembers the reader turning it off, and back on', () => {
    writeProtectProjectPaths(false)
    expect(readProtectProjectPaths()).toBe(false)
    expect(installStorageStub().getItem(APPROVAL_GUARDS_STORAGE_KEY)).toBe('false')

    writeProtectProjectPaths(true)
    expect(readProtectProjectPaths()).toBe(true)
    expect(installStorageStub().getItem(APPROVAL_GUARDS_STORAGE_KEY)).toBe('true')
  })

  // 存了坏值也当"保护"，不要因为坏数据把系统判定放松掉。
  it('treats a corrupt stored value as protected', () => {
    installStorageStub().setItem(APPROVAL_GUARDS_STORAGE_KEY, 'yes-please')
    expect(readProtectProjectPaths()).toBe(true)
  })
})
