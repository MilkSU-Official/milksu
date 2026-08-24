const protocol = 'milksu.plugin-ui/v1'
const element = document.querySelector('#milksu-plugin-bootstrap')
const pluginId = element?.dataset.pluginId ?? ''
const nonce = element?.dataset.nonce ?? ''
const scriptURL = new URL(element?.dataset.scriptUrl ?? '', location.href)

if (!/^[a-z][a-z0-9.-]{0,63}$/.test(pluginId)) throw new Error('invalid plugin frame id')
if (!/^[a-f0-9]{36}$/.test(nonce)) throw new Error('invalid plugin frame nonce')
if (
  scriptURL.protocol !== 'milksu:'
  || scriptURL.host !== 'app'
  || scriptURL.pathname !== `/__plugin-settings/${pluginId}.mjs`
  || scriptURL.searchParams.get('nonce') !== nonce
) throw new Error('invalid plugin settings module URL')

const pending = new Map()
let nextRequestId = 0
const applyTheme = value => {
  if (value !== 'light' && value !== 'dark') return false
  document.documentElement.dataset.theme = value
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.style.colorScheme = value
  return true
}
if (!applyTheme(document.documentElement.dataset.theme)) applyTheme('dark')

addEventListener('message', event => {
  const message = event.data
  if (
    event.source !== parent
    || message?.protocol !== protocol
    || message?.pluginId !== pluginId
    || message?.nonce !== nonce
  ) return
  if (message.type === 'theme_changed') {
    if (applyTheme(message.theme)) {
      dispatchEvent(new CustomEvent('milksu:theme-changed', { detail: { theme: message.theme } }))
    }
    return
  }
  const request = pending.get(message.requestId)
  if (!request) return
  pending.delete(message.requestId)
	if (request.timer) clearTimeout(request.timer)
  if (message.error) request.reject(new Error(String(message.error)))
  else request.resolve(message.value)
})

const context = Object.freeze({
  id: pluginId,
  nonce,
  request(method, action, input) {
    const requestId = `${nonce}-${++nextRequestId}`
    return new Promise((resolve, reject) => {
			// Native image selection is user-paced; every other capability request
			// is bounded so a removed or unresponsive frame cannot leak promises.
			const timer = method === 'choose_surface' || method === 'choose_background' ? undefined : setTimeout(() => {
				pending.delete(requestId)
				reject(new Error(`plugin host request timed out: ${method}.${action}`))
			}, 10000)
			pending.set(requestId, { resolve, reject, timer })
      parent.postMessage({ protocol, pluginId, nonce, requestId, method, action, input }, '*')
    })
  },
})

addEventListener('pagehide', () => {
	for (const request of pending.values()) {
		if (request.timer) clearTimeout(request.timer)
		request.reject(new Error('plugin settings frame was unloaded'))
	}
	pending.clear()
}, { once: true })
Object.defineProperty(window, '__MILKSU_PLUGIN_CONTEXT__', {
  value: context,
  configurable: false,
  writable: false,
})

await import(scriptURL.href)
