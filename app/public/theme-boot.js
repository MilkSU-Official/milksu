/* Blocking classic script. Keep in sync with app/src/lib/themeMode.ts.
 * Official Vue and adhoc Stable share Electron userData; `light` / `dark`
 * mean that appearance, not a next-themes toggle class. */
(function applyStoredThemeMode() {
  var key = 'milksu.theme-mode'
  var mode = 'system'
  try {
    var stored = window.localStorage.getItem(key)
    if (stored === 'light' || stored === 'dark' || stored === 'system') mode = stored
  } catch (error) {
    mode = 'system'
  }
  var prefersDark = false
  try {
    prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch (error) {
    prefersDark = false
  }
  var resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
  var root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themeMode = mode
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
})()

/* Keep preset ids and px sizes in sync with app/src/lib/uiFonts.ts. Stacks live in CSS. */
;(function applyStoredUiFonts() {
  var families = {
    product: 1,
    inter: 1,
    'noto-sc': 1,
    'ibm-plex': 1,
    'source-sans': 1,
    geist: 1,
    'nunito-sans': 1,
    'noto-serif-sc': 1,
    'zcool-xiaowei': 1,
    'zcool-qingke': 1,
    system: 1,
  }
  function readFamily(key) {
    try {
      var value = window.localStorage.getItem(key)
      return families[value] ? value : 'product'
    } catch (error) {
      return 'product'
    }
  }
  function readSize(key) {
    try {
      var raw = String(window.localStorage.getItem(key) || '').replace(/px$/i, '')
      var n = parseInt(raw, 10)
      if (n >= 11 && n <= 18) return String(n)
    } catch (error) {
      /* private mode or blocked storage */
    }
    return '13'
  }
  var root = document.documentElement
  var uiSize = readSize('milksu.ui-font-size')
  var conversationSize = readSize('milksu.conversation-font-size')
  root.dataset.uiFont = readFamily('milksu.ui-font')
  root.dataset.conversationFont = readFamily('milksu.conversation-font')
  root.dataset.uiFontSize = uiSize
  root.dataset.conversationFontSize = conversationSize
  root.style.setProperty('--ui-font-size', uiSize + 'px')
  root.style.setProperty('--conversation-font-size', conversationSize + 'px')
})()

/* Keep preset ids and hex values in sync with app/src/lib/uiEmphasis.ts. */
;(function applyStoredUiEmphasis() {
  var presets = {
    default: 1,
    blue: 1,
    violet: 1,
    teal: 1,
    amber: 1,
    rose: 1,
  }
  var tokens = {
    blue: {
      dark: { emphasis: '#5b9fff', foreground: '#0b1220', ring: '#5b9fff' },
      light: { emphasis: '#2563eb', foreground: '#ffffff', ring: '#2563eb' },
    },
    violet: {
      dark: { emphasis: '#a78bfa', foreground: '#140a24', ring: '#a78bfa' },
      light: { emphasis: '#7c3aed', foreground: '#ffffff', ring: '#7c3aed' },
    },
    teal: {
      dark: { emphasis: '#2dd4bf', foreground: '#042f2e', ring: '#2dd4bf' },
      light: { emphasis: '#0d9488', foreground: '#ffffff', ring: '#0d9488' },
    },
    amber: {
      dark: { emphasis: '#fbbf24', foreground: '#1c1405', ring: '#fbbf24' },
      light: { emphasis: '#d97706', foreground: '#ffffff', ring: '#d97706' },
    },
    rose: {
      dark: { emphasis: '#fb7185', foreground: '#1f0a10', ring: '#fb7185' },
      light: { emphasis: '#e11d48', foreground: '#ffffff', ring: '#e11d48' },
    },
  }
  var preset = 'default'
  try {
    var stored = window.localStorage.getItem('milksu.ui-emphasis')
    if (presets[stored]) preset = stored
  } catch (error) {
    preset = 'default'
  }
  var root = document.documentElement
  root.dataset.uiEmphasis = preset
  if (preset === 'default') return
  var theme = root.dataset.theme === 'light' ? 'light' : 'dark'
  var pair = tokens[preset][theme]
  root.style.setProperty('--emphasis', pair.emphasis)
  root.style.setProperty('--emphasis-foreground', pair.foreground)
  root.style.setProperty('--primary', pair.emphasis)
  root.style.setProperty('--primary-foreground', pair.foreground)
  root.style.setProperty('--ring', pair.ring)
})()
