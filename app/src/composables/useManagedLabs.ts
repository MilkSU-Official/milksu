import { computed, ref } from 'vue'
import { invokeCommand } from '@/desktop'
import { buildManagedLabDefinitions } from '@/lib/managedLabs'
import type {
  ManagedLabAccess,
  ManagedLabInstance,
  ManagedLabJudgeResponse,
  ManagedLabPackage,
  ManagedLabTrainingWorkspace,
} from '@/ctfLabTypes'

export function useManagedLabs() {
  const packages = ref<ManagedLabPackage[]>([])
  const instances = ref<ManagedLabInstance[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')

  const labs = computed(() => buildManagedLabDefinitions(packages.value, instances.value))

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      const [nextPackages, nextInstances] = await Promise.all([
        invokeCommand<ManagedLabPackage[]>('list_managed_lab_packages'),
        invokeCommand<ManagedLabInstance[]>('list_managed_lab_instances'),
      ])
      packages.value = nextPackages
      instances.value = nextInstances
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function run<T>(operation: () => Promise<T>) {
    busy.value = true
    error.value = ''
    try {
      const result = await operation()
      await refresh()
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      await refresh()
      error.value = message
      throw cause
    } finally {
      busy.value = false
    }
  }

  return {
    packages,
    instances,
    labs,
    loading,
    busy,
    error,
    refresh,
    start: (packageId: string) => run(() => (
      invokeCommand<ManagedLabInstance>('start_managed_lab', { packageId })
    )),
    reset: (instanceId: string) => run(() => (
      invokeCommand<ManagedLabInstance>('reset_managed_lab', { instanceId })
    )),
    stop: (instanceId: string) => run(() => (
      invokeCommand<ManagedLabInstance>('stop_managed_lab', { instanceId })
    )),
    destroy: (instanceId: string) => run(() => (
      invokeCommand<ManagedLabInstance>('destroy_managed_lab', { instanceId })
    )),
    open: (instanceId: string) => (
      invokeCommand<void>('open_managed_lab', { instanceId })
    ),
    access: (instanceId: string) => (
      invokeCommand<ManagedLabAccess>('get_managed_lab_access', { instanceId })
    ),
    startTraining: (instanceId: string, collaborationMode: string) => run(() => (
      invokeCommand<ManagedLabTrainingWorkspace>('start_managed_lab_training', {
        instanceId,
        collaborationMode,
      })
    )),
    checkTraining: (instanceId: string, jobId: string) => run(() => (
      invokeCommand<ManagedLabJudgeResponse>('check_managed_lab_training', {
        instanceId,
        jobId,
      })
    )),
  }
}
