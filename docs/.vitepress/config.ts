import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MilkSU',
  description: '一站式网络安全 AI 学习客户端',
  lang: 'zh-CN',
  appearance: false,

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: '开发者文档', link: '/developer/' },
      { text: '当前系统', link: '/architecture/current-system' },
    ],

    sidebar: {
      '/developer/': [
        {
          text: '当前',
          items: [
            { text: '开发者文档', link: '/developer/' },
            { text: '当前开发目标', link: '/developer/current-objectives' },
            { text: '文档与事实状态', link: '/developer/document-status' },
            { text: '当前系统与分层', link: '/architecture/current-system' },
          ],
        },
        {
          text: '操作',
          items: [
            { text: '产品回归', link: '/developer/product-regression-loop' },
            { text: '发版', link: '/developer/release-process' },
            { text: '产品代码准入', link: '/developer/product-code-admission' },
            { text: 'Linux', link: '/developer/linux-platform-support' },
            { text: 'macOS 签名', link: '/developer/macos-signing-and-notarization' },
          ],
        },
        {
          text: '外部作者',
          items: [
            { text: '插件使用说明', link: '/developer/plugin-user-guide' },
            { text: '插件框架', link: '/developer/plugin-framework' },
            { text: '看板娘皮肤', link: '/developer/companion-skin' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '当前',
          items: [
            { text: '当前系统与分层', link: '/architecture/current-system' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/MilkSU-Official/milksu' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: '人与安全 Agent 共同学习、实验、验证与复盘',
      copyright: 'AGPL-3.0-only',
    },
  },
})
