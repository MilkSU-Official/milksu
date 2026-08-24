import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPluginFrameDocument, buildPluginFrameThemeMessage, createPluginFrameNonce } from './pluginFrame'

const bootstrapSource = readFileSync(new URL('../../public/plugin-frame-bootstrap.js', import.meta.url), 'utf8')

describe('plugin settings frame', () => {
  it('builds an opaque, network-denied document with a nonce-bound broker', () => {
    const nonce = 'a'.repeat(36)
    const document = buildPluginFrameDocument('milksu.skin-background', nonce, 'light')
    expect(document).toContain('<html data-theme="light" style="color-scheme: light">')
    expect(document).not.toContain('<html class="dark"')
    expect(document).toContain("default-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("script-src 'self'")
    expect(document).toContain('src="milksu://app/plugin-frame-bootstrap.js"')
    expect(document).toContain(`data-script-url="milksu://app/__plugin-settings/milksu.skin-background.mjs?nonce=${nonce}"`)
    expect(document).not.toContain('allow-same-origin')
    expect(document).not.toContain('window.milksu')
    expect(document).not.toContain('import(')
  })

  it('uses a nonce-bound host message for live light and dark changes', () => {
    const nonce = 'b'.repeat(36)
    expect(buildPluginFrameThemeMessage('milksu.skin-background', nonce, 'dark')).toEqual({
      protocol: 'milksu.plugin-ui/v1',
      pluginId: 'milksu.skin-background',
      nonce,
      type: 'theme_changed',
      theme: 'dark',
    })
    expect(buildPluginFrameDocument('milksu.skin-background', nonce, 'dark')).toContain('<html class="dark" data-theme="dark" style="color-scheme: dark">')
    expect(() => buildPluginFrameDocument('milksu.skin-background', nonce, 'system' as 'dark')).toThrow('invalid plugin frame theme')
  })

  it('uses cryptographic bytes for the frame nonce', () => {
    const getRandomValues = vi.fn((value: Uint8Array) => {
      value.fill(0x2a)
      return value
    })
    expect(createPluginFrameNonce({ getRandomValues } as unknown as Crypto)).toBe('2a'.repeat(18))
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('leaves both current and legacy native image pickers user-paced', () => {
    expect(bootstrapSource).toContain("method === 'choose_surface' || method === 'choose_background'")
    expect(bootstrapSource).toContain('plugin host request timed out')
  })
})
