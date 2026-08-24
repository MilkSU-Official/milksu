const pluginUIProtocol = 'milksu.plugin-ui/v1'
export type PluginFrameTheme = 'light' | 'dark'

function validatePluginFrameIdentity(pluginId: string, nonce: string) {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(pluginId)) throw new Error('invalid plugin frame id')
  if (!/^[a-f0-9]{36}$/.test(nonce)) throw new Error('invalid plugin frame nonce')
}

function validatePluginFrameTheme(theme: string): asserts theme is PluginFrameTheme {
  if (theme !== 'light' && theme !== 'dark') throw new Error('invalid plugin frame theme')
}

export function createPluginFrameNonce(cryptoSource: Crypto = window.crypto): string {
  const bytes = new Uint8Array(18)
  cryptoSource.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export function buildPluginFrameDocument(pluginId: string, nonce: string, theme: PluginFrameTheme): string {
  validatePluginFrameIdentity(pluginId, nonce)
  validatePluginFrameTheme(theme)
  const scriptURL = `milksu://app/__plugin-settings/${pluginId}.mjs?nonce=${nonce}`
  const themeClass = theme === 'dark' ? ' class="dark"' : ''
  return `<!doctype html>
<html${themeClass} data-theme="${theme}" style="color-scheme: ${theme}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src milksu: data: blob:; style-src 'unsafe-inline'; script-src 'self'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="plugin-root"></div><script id="milksu-plugin-bootstrap" type="module" src="milksu://app/plugin-frame-bootstrap.js" data-plugin-id="${pluginId}" data-nonce="${nonce}" data-script-url="${scriptURL}"></script></body></html>`
}

export function buildPluginFrameThemeMessage(pluginId: string, nonce: string, theme: PluginFrameTheme) {
  validatePluginFrameIdentity(pluginId, nonce)
  validatePluginFrameTheme(theme)
  return {
    protocol: pluginUIProtocol,
    pluginId,
    nonce,
    type: 'theme_changed' as const,
    theme,
  }
}

export { pluginUIProtocol }
