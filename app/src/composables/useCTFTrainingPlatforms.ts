import { createStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import type { CTFTrainingPlatform } from '@/ctfPlatformTypes'

export function useCTFTrainingPlatforms() {
  const store = createStore({
    platforms: [] as CTFTrainingPlatform[],
    loading: false,
    error: null as string | null,
  })
  const s = {
    get platforms() { return store.getState().platforms },
    set platforms(value) { store.setState({ platforms: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }


  async function load() {
    s.loading = true
    try {
      s.platforms = await invokeCommand<CTFTrainingPlatform[]>('get_ctf_training_platforms')
      s.error = null
      return s.platforms
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return []
    } finally {
      s.loading = false
    }
  }

  return {
    store,
    get platforms() { return s.platforms },
    get loading() { return s.loading },
    get error() { return s.error },
    load,
  }
}
