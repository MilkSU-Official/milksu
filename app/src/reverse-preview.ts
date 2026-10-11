import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import './index.css'

import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ReverseArtifactsPreview from '@/previews/ReverseArtifactsPreview'

const root = document.getElementById('app')
if (!root) throw new Error('MilkSU renderer root #app is missing')
createRoot(root).render(createElement(StrictMode, null, createElement(ReverseArtifactsPreview)))
