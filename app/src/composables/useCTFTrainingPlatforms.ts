import { ref } from 'vue'
import { invokeCommand } from '@/desktop'
import type { CTFTrainingPlatform } from '@/ctfPlatformTypes'

export function useCTFTrainingPlatforms() {
  const platforms = ref<CTFTrainingPlatform[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    try {
      platforms.value = await invokeCommand<CTFTrainingPlatform[]>('get_ctf_training_platforms')
      error.value = null
      return platforms.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return []
    } finally {
      loading.value = false
    }
  }

  return { platforms, loading, error, load }
}
