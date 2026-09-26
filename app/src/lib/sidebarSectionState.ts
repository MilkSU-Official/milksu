export const SIDEBAR_SECTION_STATE_PREFIX = 'milksu.sidebar-section.v1.'

export function readSidebarSectionOpen(
  id: string,
  storage: Pick<Storage, 'getItem'> | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(SIDEBAR_SECTION_STATE_PREFIX + id) !== '0'
  } catch {
    return true
  }
}

export function writeSidebarSectionOpen(
  id: string,
  open: boolean,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
) {
  try {
    storage?.setItem(SIDEBAR_SECTION_STATE_PREFIX + id, open ? '1' : '0')
  } catch {
    // Private mode or quota: keep the in-memory state only.
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
