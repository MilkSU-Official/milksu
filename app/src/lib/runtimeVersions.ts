import { createStore, useStore } from '@/lib/reactStore'

/** Installed agent kernel package versions, injected by the backend on read. */
export interface RuntimeVersions {
  pi: string
  dsh: string
}

const emptyVersions: RuntimeVersions = { pi: '', dsh: '' }

function normalizeRuntimeVersions(value: unknown): RuntimeVersions {
  if (!value || typeof value !== 'object') return emptyVersions
  const source = value as Record<string, unknown>
  const pick = (key: string) => (
    typeof source[key] === 'string' ? (source[key] as string).trim() : ''
  )
  return { pi: pick('pi'), dsh: pick('dsh') }
}

const runtimeVersionsStore = createStore({
  current: emptyVersions,
})

/** App installs the versions from the settings payload; never persisted back. */
export function installRuntimeVersions(value: unknown) {
  runtimeVersionsStore.setState({ current: normalizeRuntimeVersions(value) })
}

export function useRuntimeVersions(): RuntimeVersions {
  return useStore(runtimeVersionsStore).current
}

/** Non-reactive read for one-off labels (row helpers, picker options). */
export function runtimeVersion(kernel: 'pi' | 'dsh'): string {
  return runtimeVersionsStore.getState().current[kernel]
}
