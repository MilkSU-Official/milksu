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
      { text: '架构快照', link: '/architecture/' },
      { text: 'Wiki', link: '/wiki/' },
    ],

    sidebar: {
      '/developer/': [
        {
          text: '当前事实与目标',
          items: [
            { text: '开发者文档', link: '/developer/' },
            { text: '当前开发目标', link: '/developer/current-objectives' },
            { text: '文档与事实状态', link: '/developer/document-status' },
            { text: '当前系统与分层', link: '/architecture/current-system' },
          ],
        },
        {
          text: '稳定工程契约',
          items: [
            { text: 'Coding / Pi 扩展边界', link: '/architecture/coding-agent-pi-extension-boundary' },
            { text: 'CTF Intake / Judge / Memory', link: '/architecture/ctf-intake-agent-judge-memory' },
            { text: 'PI Resource Whitelist', link: '/developer/pi-resource-whitelist' },
            { text: '安全 Agent 能力边界', link: '/developer/security-agent-boundary' },
            { text: '可验证安全任务运行时', link: '/developer/architecture' },
            { text: 'Role Packages', link: '/developer/role-packages' },
          ],
        },
        {
          text: '验收证据',
          items: [
            { text: 'Coding Agent 交付', link: '/developer/coding-agent-delivery-acceptance' },
            { text: 'Coding Browser', link: '/developer/coding-browser-acceptance' },
            { text: '本地交付基线', link: '/developer/local-delivery-baseline' },
            { text: 'NYU safe-static 边界', link: '/developer/nyu-ctf-bench-eval' },
          ],
        },
        {
          text: '研究与历史（非计划）',
          collapsed: true,
          items: [
            {
              text: 'Wallbreaker Harness 调研',
              link: '/developer/research/2026-08-03-wallbreaker-harness-review',
            },
            { text: '开源项目基线', link: '/developer/industry-baseline' },
            { text: '题目接入研究', link: '/developer/challenge-intake-and-automation' },
          ],
        },
      ],

      '/architecture/': [
        {
          text: '当前事实',
          items: [
            { text: '架构快照索引', link: '/architecture/' },
            { text: '当前系统与分层', link: '/architecture/current-system' },
            { text: 'CTF Intake / Judge / Memory', link: '/architecture/ctf-intake-agent-judge-memory' },
            { text: 'Coding / Pi 扩展边界', link: '/architecture/coding-agent-pi-extension-boundary' },
          ],
        },
        {
          text: '未来设计（未发布）',
          items: [
            { text: '安全学习与研究平台', link: '/architecture/security-learning-and-research-platform' },
            { text: 'CTF Labs 设计', link: '/architecture/ctf-labs-design' },
            { text: 'CVE 研究工作台设计', link: '/architecture/cve-research-workbench-design' },
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
