import { createStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import type { EnvLease, EnvOwnerKind, EnvPackage } from '@/envbroker'
import type { EnvironmentLease, EnvironmentProvider } from '@/lib/environmentTypes'

function mapProvider(value: string | undefined): EnvironmentProvider {
  if (value === 'docker') return 'docker'
  if (value === 'android-avd' || value === 'avd') return 'avd'
  if (value === 'user-attached') return 'user-attached'
  return 'none'
}

export function toStripLease(lease: EnvLease, bound?: { name?: string; provider?: string }): EnvironmentLease {
  const provider = mapProvider(lease.provider || bound?.provider)
  return {
    provider,
    state: (lease.state as EnvironmentLease['state']) || 'none',
    packageName: lease.packageName || bound?.name,
    address: lease.address,
    device: lease.device,
    detail: lease.error || lease.detail,
    occupyOwner: lease.occupyOwner,
    occupyJobTitle: lease.occupyTitle || lease.occupyOwner,
  }
}

export function useEnvLease(
  ownerKind: () => EnvOwnerKind,
  ownerId: () => string,
  packageId?: () => string | undefined,
) {
  const store = createStore({
    lease: {
      ownerKind: ownerKind(),
      ownerId: ownerId(),
      provider: 'none',
      state: 'none',
    } as EnvLease,
    packages: [] as EnvPackage[],
    busy: false,
  })
  const s = {
    get lease() { return store.getState().lease },
    set lease(value) { store.setState({ lease: value }) },
    get packages() { return store.getState().packages },
    set packages(value) { store.setState({ packages: value }) },
    get busy() { return store.getState().busy },
    set busy(value) { store.setState({ busy: value }) },
  }
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastOwner = `${ownerKind()}:${ownerId()}`

  function stopPoll() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  function startPoll() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void refresh()
    }, 1500)
  }

  async function refresh() {
    if (!ownerId()) {
      s.lease = { ownerKind: ownerKind(), ownerId: '', provider: 'none', state: 'none' }
      return
    }
    try {
      s.lease = await invokeCommand<EnvLease>('get_env_lease', {
        ownerKind: ownerKind(),
        ownerId: ownerId(),
      })
    } catch {
      s.lease = { ownerKind: ownerKind(), ownerId: ownerId(), provider: 'none', state: 'none' }
    }
    if (s.lease.state === 'pulling') startPoll()
    else stopPoll()
  }

  async function loadPackages() {
    try {
      s.packages = await invokeCommand<EnvPackage[]>('list_lab_packages')
    } catch {
      s.packages = []
    }
  }

  async function start(id?: string) {
    const packageToStart = id || packageId?.() || s.lease.packageId
    if (!ownerId() || !packageToStart) return
    s.busy = true
    try {
      s.lease = await invokeCommand<EnvLease>('start_env_lease', {
        ownerKind: ownerKind(),
        ownerId: ownerId(),
        packageId: packageToStart,
      })
    } catch (reason) {
      s.lease = {
        ...s.lease,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      s.busy = false
    }
    if (s.lease.state === 'pulling') startPoll()
    else stopPoll()
  }

  async function stop() {
    if (!ownerId()) return
    s.busy = true
    try {
      s.lease = await invokeCommand<EnvLease>('stop_env_lease', {
        ownerKind: ownerKind(),
        ownerId: ownerId(),
      })
    } catch (reason) {
      s.lease = {
        ...s.lease,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      s.busy = false
    }
    stopPoll()
  }

  async function reset() {
    if (!ownerId()) return
    s.busy = true
    try {
      s.lease = await invokeCommand<EnvLease>('reset_env_lease', {
        ownerKind: ownerKind(),
        ownerId: ownerId(),
      })
    } catch (reason) {
      s.lease = {
        ...s.lease,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      s.busy = false
    }
    stopPoll()
  }

  async function listLeases() {
    try {
      return await invokeCommand<EnvLease[]>('list_env_leases')
    } catch {
      return [] as EnvLease[]
    }
  }

  function syncOwner() {
    const next = `${ownerKind()}:${ownerId()}`
    if (next === lastOwner) return
    lastOwner = next
    stopPoll()
    void refresh()
  }

  function mount() {
    void loadPackages()
    void refresh()
  }

  function unmount() {
    stopPoll()
  }

  return {
    store,
    get lease() { syncOwner(); return s.lease },
    set lease(value) { s.lease = value },
    get packages() { return s.packages },
    get busy() { return s.busy },
    refresh,
    loadPackages,
    listLeases,
    start,
    stop,
    reset,
    mount,
    unmount,
  }
}
