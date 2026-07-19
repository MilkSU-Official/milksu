import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MilkSU',
  description: '用户拥有的安全任务控制面',
  lang: 'zh-CN',
  appearance: false,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '开发者文档', link: '/developer/' },
      { text: 'Wiki', link: '/wiki/' },
    ],

    sidebar: {
      '/developer/': [
        {
          text: '开始',
          items: [
            { text: '开发者文档', link: '/developer/' },
          ],
        },
        {
          text: '核心架构',
          items: [
            { text: '能力边界（当前主线）', link: '/developer/security-agent-boundary' },
            { text: '六层运行时架构', link: '/developer/architecture' },
            { text: 'Role Packages', link: '/developer/role-packages' },
            { text: '开源项目坐标', link: '/developer/industry-baseline' },
          ],
        },
      ],

      '/wiki/': [
        {
          text: 'Wiki',
          items: [
            { text: '词条索引', link: '/wiki/' },
            { text: '两种“安全”', link: '/wiki/two-securities' },
            { text: '运行时词典', link: '/wiki/runtime-glossary' },
          ],
        },
        {
          text: '开源项目',
          items: [{ text: '项目关系词典', link: '/wiki/project-relations' }],
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
      message: '可验证的安全任务运行时与用户控制面',
      copyright: 'MIT 许可证',
    },
  },
})
