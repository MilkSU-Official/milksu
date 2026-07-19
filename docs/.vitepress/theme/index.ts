import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeBoundaryMap from './components/HomeBoundaryMap.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeBoundaryMap', HomeBoundaryMap)
  },
} satisfies Theme
