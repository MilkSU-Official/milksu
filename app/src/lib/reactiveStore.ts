import { useMemo, useSyncExternalStore } from 'react'

type Listener = () => void

let generation = 0
const listeners = new Set<Listener>()

function notify() {
  generation += 1
  for (const listener of listeners) listener()
}

export function subscribeReactive(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reactiveGeneration() {
  return generation
}

export interface Ref<T> {
  value: T
}

export type MaybeRef<T> = T | Ref<T>

const arrayMutators = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'] as const

function wrapValue<T>(value: T): T {
  if (!Array.isArray(value)) return value
  return new Proxy(value, {
    get(target, key, receiver) {
      const resolved = Reflect.get(target, key, receiver)
      if (typeof key === 'string' && arrayMutators.includes(key as typeof arrayMutators[number])) {
        return (...args: unknown[]) => {
          const result = (resolved as (...inner: unknown[]) => unknown).apply(target, args)
          notify()
          return result
        }
      }
      return resolved
    },
    set(target, key, next) {
      const previous = Reflect.get(target, key)
      const ok = Reflect.set(target, key, next)
      if (ok && !Object.is(previous, next)) notify()
      return ok
    },
  }) as T
}

export function ref<T>(): Ref<T | undefined>
export function ref<T>(initial: T): Ref<T>
export function ref<T>(initial?: T): Ref<T | undefined> {
  let value = wrapValue(initial)
  return {
    get value() {
      return value
    },
    set value(next) {
      const wrapped = wrapValue(next)
      if (Object.is(value, wrapped)) return
      value = wrapped
      notify()
    },
  }
}

export function shallowRef<T>(initial: T): Ref<T> {
  return ref(initial)
}

export function computed<T>(
  getter: (() => T) | { get: () => T; set: (value: T) => void },
): Ref<T> {
  if (typeof getter === 'function') {
    let cached: { generation: number; value: T } | undefined
    return {
      get value() {
        if (!cached || cached.generation !== generation) {
          cached = { generation, value: getter() }
        }
        return cached.value
      },
      set value(_next) {
        throw new Error('computed is readonly')
      },
    }
  }
  return {
    get value() {
      return getter.get()
    },
    set value(next) {
      getter.set(next)
    },
  }
}

type WatchSource<T> = Ref<T> | (() => T)

function readWatchSource(source: unknown): unknown {
  if (Array.isArray(source)) {
    return source.map(item => (typeof item === 'function' ? item() : (item as Ref<unknown>).value))
  }
  if (typeof source === 'function') return source()
  return (source as Ref<unknown>).value
}

type WatchOptions = { immediate?: boolean; deep?: boolean }

export function watch<T>(
  source: WatchSource<T>,
  callback: (next: T, prev: T | undefined) => void,
  options?: WatchOptions,
): () => void
export function watch<T1, T2>(
  source: [WatchSource<T1>, WatchSource<T2>],
  callback: (next: [T1, T2], prev: [T1, T2] | undefined) => void,
  options?: WatchOptions,
): () => void
export function watch(
  source: unknown,
  callback: (next: any, prev?: any) => void,
  options?: WatchOptions,
): () => void {
  let previous = readWatchSource(source)
  let previousSnap = options?.deep ? safeSnap(previous) : null
  if (options?.immediate) callback(previous, undefined)
  return subscribeReactive(() => {
    const next = readWatchSource(source)
    if (options?.deep) {
      const snap = safeSnap(next)
      if (snap === previousSnap) return
      const old = previous
      previous = next
      previousSnap = snap
      callback(next, old)
      return
    }
    if (Object.is(next, previous)) return
    const old = previous
    previous = next
    callback(next, old)
  })
}

function safeSnap(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function reactive<T extends object>(object: T): T {
  return new Proxy(object, {
    get(target, key, receiver) {
      return Reflect.get(target, key, receiver)
    },
    set(target, key, next) {
      const previous = Reflect.get(target, key)
      const ok = Reflect.set(target, key, next)
      if (ok && !Object.is(previous, next)) notify()
      return ok
    },
    deleteProperty(target, key) {
      if (!Reflect.has(target, key)) return true
      const ok = Reflect.deleteProperty(target, key)
      if (ok) notify()
      return ok
    },
  })
}

export function unref<T>(value: MaybeRef<T>): T {
  if (value && typeof value === 'object' && 'value' in value) return (value as Ref<T>).value
  return value as T
}

export function nextTick() {
  return Promise.resolve()
}

type Lifecycle = {
  mounted: Array<() => void>
  unmounted: Array<() => void>
}

let currentLifecycle: Lifecycle | null = null

export function getCurrentInstance() {
  return currentLifecycle
}

export function onMounted(hook: () => void) {
  currentLifecycle?.mounted.push(hook)
}

export function onBeforeUnmount(hook: () => void) {
  currentLifecycle?.unmounted.push(hook)
}

export function runWithLifecycle<T>(factory: () => T): {
  value: T
  mount: () => void
  unmount: () => void
} {
  const lifecycle: Lifecycle = { mounted: [], unmounted: [] }
  currentLifecycle = lifecycle
  try {
    const value = factory()
    return {
      value,
      mount() {
        for (const hook of lifecycle.mounted) hook()
      },
      unmount() {
        for (const hook of lifecycle.unmounted) hook()
      },
    }
  } finally {
    currentLifecycle = null
  }
}

export function useReactive<T>(getter: () => T): T {
  const current = useSyncExternalStore(subscribeReactive, reactiveGeneration, reactiveGeneration)
  return useMemo(() => getter(), [current])
}
