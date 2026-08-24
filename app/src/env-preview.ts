import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { createApp } from 'vue'
import LabEnvironmentPreview from '@/components-vue/lab-env/LabEnvironmentPreview.vue'
import { applyThemeMode } from '@/lib/themeMode'
import './index.css'

window.milksu = {
  invoke(method: string) {
    if (method === 'GetBuildTracking') {
      return Promise.resolve({ development: true, missing: true, channel: 'dev', appId: 'com.milksu.app' })
    }
    return Promise.resolve(null)
  },
  onEvent() {
    return () => undefined
  },
}

document.documentElement.dataset.colorScheme = 'memoh'
applyThemeMode('dark')
createApp(LabEnvironmentPreview).mount('#app')
