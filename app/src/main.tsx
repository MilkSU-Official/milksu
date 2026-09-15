import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyHostPlatform } from '@/lib/hostPlatform'
import './index.css'

applyHostPlatform()
document.documentElement.dataset.colorScheme = 'memoh'

const root = document.getElementById('app')
if (!root) throw new Error('MilkSU renderer root #app is missing')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
