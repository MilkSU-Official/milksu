import type { ResolvedThemeMode } from '@/lib/themeMode'

export const UI_EMPHASIS_PRESET_IDS = [
  'default',
  'blue',
  'violet',
  'teal',
  'amber',
  'rose',
] as const

export type UiEmphasisPreset = (typeof UI_EMPHASIS_PRESET_IDS)[number]

export const UI_EMPHASIS_STORAGE_KEY = 'milksu.ui-emphasis'
export const FACTORY_UI_EMPHASIS: UiEmphasisPreset = 'default'

type EmphasisTokens = {
  emphasis: string
  foreground: string
  ring: string
}

const EMPHASIS_TOKENS: Record<UiEmphasisPreset, Record<ResolvedThemeMode, EmphasisTokens>> = {
  default: {
    dark: { emphasis: '#f0f0f0', foreground: '#141414', ring: '#d0d0d0' },
    light: { emphasis: '#141414', foreground: '#fcfcfc', ring: '#141414' },
  },
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

/** Swatch preview in Settings (dark-theme sample; light theme still readable). */
export const UI_EMPHASIS_SWATCH: Record<UiEmphasisPreset, string> = {
  default: '#a8a8a8',
  blue: '#5b9fff',
  violet: '#a78bfa',
  teal: '#2dd4bf',
  amber: '#fbbf24',
  rose: '#fb7185',
}

export function normalizeUiEmphasisPreset(value: unknown): UiEmphasisPreset {
  const raw = String(value ?? '').trim().toLowerCase()
  if ((UI_EMPHASIS_PRESET_IDS as readonly string[]).includes(raw)) {
    return raw as UiEmphasisPreset
  }
  if (raw === 'purple' || raw === 'indigo') return 'violet'
  if (raw === 'cyan' || raw === 'green') return 'teal'
  if (raw === 'orange' || raw === 'yellow') return 'amber'
  if (raw === 'pink' || raw === 'red') return 'rose'
  return FACTORY_UI_EMPHASIS
}

export function emphasisTokensFor(
  preset: UiEmphasisPreset,
  theme: ResolvedThemeMode,
): EmphasisTokens {
  return EMPHASIS_TOKENS[normalizeUiEmphasisPreset(preset)][theme]
}

function writeStored(value: string) {
  try {
    window.localStorage.setItem(UI_EMPHASIS_STORAGE_KEY, value)
  } catch {
    /* private mode or blocked storage */
  }
}

function readStoredPreset(): UiEmphasisPreset {
  try {
    return normalizeUiEmphasisPreset(window.localStorage.getItem(UI_EMPHASIS_STORAGE_KEY))
  } catch {
    return FACTORY_UI_EMPHASIS
  }
}

function readDocumentTheme(): ResolvedThemeMode {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function readCurrentPreset(): UiEmphasisPreset {
  if (typeof document === 'undefined') return readStoredPreset()
  return normalizeUiEmphasisPreset(document.documentElement.dataset.uiEmphasis || readStoredPreset())
}

export function applyUiEmphasis(input: {
  preset?: unknown
  theme?: ResolvedThemeMode
} = {}) {
  const preset = input.preset !== undefined
    ? normalizeUiEmphasisPreset(input.preset)
    : readCurrentPreset()
  const theme = input.theme ?? readDocumentTheme()
  const tokens = emphasisTokensFor(preset, theme)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset.uiEmphasis = preset
    if (preset === 'default') {
      root.style.removeProperty('--emphasis')
      root.style.removeProperty('--emphasis-foreground')
      root.style.removeProperty('--primary')
      root.style.removeProperty('--primary-foreground')
      root.style.removeProperty('--ring')
    } else {
      // Colored presets drive both --emphasis and --primary so send / brand
      // buttons, selected filter chips, and text-primary checks follow the accent.
      root.style.setProperty('--emphasis', tokens.emphasis)
      root.style.setProperty('--emphasis-foreground', tokens.foreground)
      root.style.setProperty('--primary', tokens.emphasis)
      root.style.setProperty('--primary-foreground', tokens.foreground)
      root.style.setProperty('--ring', tokens.ring)
    }
  }
  writeStored(preset)
  return { preset, theme, tokens }
}
