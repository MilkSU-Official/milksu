import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { createApp } from 'vue'
import App from './App.vue'
import { applyHostPlatform } from '@/lib/hostPlatform'
import './index.css'

applyHostPlatform()
document.documentElement.dataset.colorScheme = 'memoh'
createApp(App).mount('#app')
