import path from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '#': path.resolve(__dirname, './node_modules/@felinic/ui/src'),
    },
  },
  clearScreen: false,
	test: {
		setupFiles: ['./src/test/setupDesktopMock.ts'],
	},
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/nssctf-api': {
        target: 'https://www.nssctf.cn',
        changeOrigin: true,
        rewrite: pathValue => pathValue.replace(/^\/nssctf-api/, '/api'),
      },
    },
  },
})
