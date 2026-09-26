import { beforeEach } from 'vitest'

// Node 22.4+ ships a built-in localStorage that stays undefined unless the
// process runs with --localstorage-file; under jsdom that global shadows the
// jsdom Storage, so window.localStorage reads as undefined and any test that
// touches storage fails. Give every test file a real in-memory Storage when
// the environment left it missing.
if (typeof window !== 'undefined' && !window.localStorage) {
	const memory = new Map<string, string>()
	const storage = {
		get length() {
			return memory.size
		},
		clear: () => memory.clear(),
		getItem: (key: string) => (memory.has(String(key)) ? (memory.get(String(key)) as string) : null),
		key: (index: number) => Array.from(memory.keys())[index] ?? null,
		removeItem: (key: string) => {
			memory.delete(String(key))
		},
		setItem: (key: string, value: string) => {
			memory.set(String(key), String(value))
		},
	}
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		writable: true,
		value: storage,
	})
}

// Existing component fixtures describe the backend as a collection of App
// methods. Adapt that test fixture shape to the Electron preload contract;
// product code has no Wails compatibility path.
beforeEach(() => {
	if (typeof window === 'undefined') return
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    get() {
      const legacy = (window as unknown as {
        go?: { main?: { App?: Record<string, (...args: unknown[]) => unknown> } }
      }).go?.main?.App
      if (!legacy) return undefined
      return {
        invoke(method: string, args: unknown[]) {
          const operation = legacy[method]
          if (typeof operation !== 'function') {
            return Promise.reject(new Error(`unsupported desktop test method: ${method}`))
          }
          return Promise.resolve(operation(...args))
        },
        onEvent() {
          return () => undefined
        },
      }
    },
  })
})
