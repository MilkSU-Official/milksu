import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MilkSU',
  description: '一站式网络安全 AI 学习客户端',
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
            { text: '开发计划（当前主线）', link: '/developer/development-plan' },
            { text: 'M2 → M3 基础检查点', link: '/developer/checkpoints/2026-07-21-m2-m3-foundation' },
          ],
        },
        {
          text: '核心架构',
          items: [
            { text: '能力边界（当前主线）', link: '/developer/security-agent-boundary' },
            { text: '六层运行时架构', link: '/developer/architecture' },
            { text: 'Runtime v1alpha1 · M1 契约', link: '/developer/runtime-v1alpha1' },
            { text: 'ADR-0001 · Engine 与桌面边界', link: '/developer/adr/0001-agent-engine-and-desktop-boundary' },
            { text: 'ADR-0002 · Runtime 事实与恢复', link: '/developer/adr/0002-runtime-facts-and-recovery' },
            { text: 'ADR-0003 · CTF 纵切与 Pi Adapter', link: '/developer/adr/0003-ctf-vertical-slice' },
            { text: 'ADR-0004 · 学习产品与发布边界', link: '/developer/adr/0004-learning-product-and-release-boundary' },
            { text: '题目接入与自动操作', link: '/developer/challenge-intake-and-automation' },
            { text: '靶场与环境管理', link: '/developer/lab-management' },
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
      message: '人与安全 Agent 共同学习、实验、验证与复盘',
      copyright: 'MIT 许可证',
    },
  },
})
