import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { invokeCommand } from '@/desktop'
import type { EnvLease, EnvOwnerKind, EnvPackage } from '@/envbroker'
import type { EnvironmentLease, EnvironmentProvider } from '@/components-vue/lab-env/environmentTypes'

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
    detail: lease.error || lease.detail,
    occupyJobTitle: lease.occupyOwner,
  }
}

export function useEnvLease(ownerKind: Ref<EnvOwnerKind>, ownerId: Ref<string>, packageId?: Ref<string | undefined>) {
  const lease = ref<EnvLease>({
    ownerKind: ownerKind.value,
    ownerId: ownerId.value,
    provider: 'none',
    state: 'none',
  })
  const packages = ref<EnvPackage[]>([])
  const busy = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

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
    if (!ownerId.value) {
      lease.value = { ownerKind: ownerKind.value, ownerId: '', provider: 'none', state: 'none' }
      return
    }
    try {
      lease.value = await invokeCommand<EnvLease>('get_env_lease', {
        ownerKind: ownerKind.value,
        ownerId: ownerId.value,
      })
    } catch {
      lease.value = { ownerKind: ownerKind.value, ownerId: ownerId.value, provider: 'none', state: 'none' }
    }
  }

  async function loadPackages() {
    try {
      packages.value = await invokeCommand<EnvPackage[]>('list_lab_packages')
    } catch {
      packages.value = []
    }
  }

  async function start(id?: string) {
    const packageToStart = id || packageId?.value || lease.value.packageId
    if (!ownerId.value || !packageToStart) return
    busy.value = true
    try {
      lease.value = await invokeCommand<EnvLease>('start_env_lease', {
        ownerKind: ownerKind.value,
        ownerId: ownerId.value,
        packageId: packageToStart,
      })
    } catch (reason) {
      lease.value = {
        ...lease.value,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      busy.value = false
    }
  }

  async function stop() {
    if (!ownerId.value) return
    busy.value = true
    try {
      lease.value = await invokeCommand<EnvLease>('stop_env_lease', {
        ownerKind: ownerKind.value,
        ownerId: ownerId.value,
      })
    } catch (reason) {
      lease.value = {
        ...lease.value,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      busy.value = false
    }
  }

  async function reset() {
    if (!ownerId.value) return
    busy.value = true
    try {
      lease.value = await invokeCommand<EnvLease>('reset_env_lease', {
        ownerKind: ownerKind.value,
        ownerId: ownerId.value,
      })
    } catch (reason) {
      lease.value = {
        ...lease.value,
        state: 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      }
    } finally {
      busy.value = false
    }
  }

  watch([ownerKind, ownerId], () => {
    stopPoll()
    void refresh()
  })

  watch(() => lease.value.state, state => {
    if (state === 'pulling') startPoll()
    else stopPoll()
  })

  onMounted(() => {
    void loadPackages()
    void refresh()
  })

  onBeforeUnmount(() => {
    stopPoll()
  })

  return { lease, packages, busy, refresh, loadPackages, start, stop, reset }
}
