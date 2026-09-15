import { useEffect, useRef } from 'react'
import { runWithLifecycle, useReactive } from '@/lib/reactiveStore'

export function useVueStore<T>(factory: () => T): T {
  const host = useRef<ReturnType<typeof runWithLifecycle<T>> | null>(null)
  if (!host.current) host.current = runWithLifecycle(factory)
  useEffect(() => {
    host.current?.mount()
    return () => {
      host.current?.unmount()
      host.current = null
    }
  }, [])
  return host.current.value
}

export function useVue<T>(getter: () => T): T {
  return useReactive(getter)
}
