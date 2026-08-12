import '@fontsource-variable/inter'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import { createApp } from 'vue'
import App from './App.vue'
import archivePaper from './assets/tactical/archive-paper.jpg'
import commandCarbon from './assets/tactical/command-carbon.jpg'
import './index.css'

document.documentElement.dataset.colorScheme = 'memoh'
document.documentElement.style.setProperty('--tactical-paper-image', `url("${archivePaper}")`)
document.documentElement.style.setProperty('--tactical-carbon-image', `url("${commandCarbon}")`)
createApp(App).mount('#app')
