import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import appSource from '../App.vue?raw'
import pluginSettingsPanelSource from '../components-vue/PluginSettingsPanel.vue?raw'
import settingsPageSource from '../components-vue/SettingsPage.vue?raw'
import pluginFrameSource from './pluginFrame?raw'

const bootstrapSource = readFileSync(new URL('../../public/plugin-frame-bootstrap.js', import.meta.url), 'utf8')
const skinSettingsSource = readFileSync(
  new URL('../../../plugins/official/milksu.skin-background/src/settings.ts', import.meta.url),
  'utf8',
)

describe('plugin theme bridge contract', () => {
  it('passes the resolved core theme through settings into the isolated frame', () => {
    expect(appSource).toContain('const resolvedTheme = computed<ResolvedThemeMode>')
    expect(appSource).toContain(':resolved-theme="resolvedTheme"')
    expect(settingsPageSource).toContain('resolvedTheme: ResolvedThemeMode')
    expect(settingsPageSource).toContain('<PluginSettingsPanel :theme="resolvedTheme" />')
    expect(pluginSettingsPanelSource).toContain('buildPluginFrameDocument(plugin.id, nonce, props.theme)')
    expect(pluginSettingsPanelSource).toContain('watch(() => props.theme, syncFrameTheme)')
    expect(pluginSettingsPanelSource).toContain('@load="syncFrameTheme"')
  })

  it('updates the opaque frame theme without weakening its sandbox', () => {
    expect(bootstrapSource).toContain("message.type === 'theme_changed'")
    expect(bootstrapSource).toContain('document.documentElement.dataset.theme = value')
    expect(bootstrapSource).toContain("document.documentElement.classList.toggle('dark', value === 'dark')")
    expect(bootstrapSource).toContain('document.documentElement.style.colorScheme = value')
		expect(pluginSettingsPanelSource).toContain('sandbox="allow-scripts"')
		expect(pluginSettingsPanelSource).not.toContain('allow-same-origin')
		expect(pluginFrameSource).toContain("img-src milksu: data: blob:")
		expect(bootstrapSource).toContain("method === 'choose_surface' || method === 'choose_background' ? undefined : setTimeout")
		expect(bootstrapSource).toContain("addEventListener('pagehide'")
  })

  it('defines matching black and white palettes and all stable v1 surface controls', () => {
    expect(skinSettingsSource).toContain(':root[data-theme="light"]')
		expect(skinSettingsSource).toContain('--canvas:#111315')
		expect(skinSettingsSource).toContain('--canvas:#ebe9e2')
		expect(skinSettingsSource).toContain('background:var(--canvas)')
		expect(skinSettingsSource).toContain('color:var(--foreground)')
		for (const slot of ['content-wallpaper', 'workspace-list', 'control-button', 'workspace-topbar', 'overlay-menu', 'chat-composer']) {
			expect(skinSettingsSource).toContain(`'${slot}'`)
		}
		expect(skinSettingsSource).toContain('选择图片')
		expect(skinSettingsSource).toContain('恢复全部系统默认')
		expect(skinSettingsSource).toContain("addEventListener('milksu:theme-changed'")
		expect(skinSettingsSource).toContain("--preview-image-opacity")
		expect(skinSettingsSource).toContain('图片与文字对比预览 Aa')
  })
})
