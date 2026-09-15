import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import LabEnvironmentPreview from '@/components/lab-env/LabEnvironmentPreview'
import { applyHostPlatform } from '@/lib/hostPlatform'
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

applyHostPlatform()
document.documentElement.dataset.colorScheme = 'memoh'
applyThemeMode('dark')

const root = document.getElementById('app')
if (!root) throw new Error('MilkSU renderer root #app is missing')
createRoot(root).render(createElement(StrictMode, null, createElement(LabEnvironmentPreview)))
