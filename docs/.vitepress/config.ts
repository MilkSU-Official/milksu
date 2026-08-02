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
          text: '开始',
          items: [
            { text: '开发者文档', link: '/developer/' },
            { text: '当前开发目标（唯一执行契约）', link: '/developer/current-objectives' },
            { text: '文档与任务状态', link: '/developer/document-status' },
            { text: 'M2 → M3 基础检查点', link: '/developer/checkpoints/2026-07-21-m2-m3-foundation' },
          ],
        },
        {
          text: '核心架构',
          items: [
            { text: '能力边界（当前主线）', link: '/developer/security-agent-boundary' },
            { text: '六层运行时架构', link: '/developer/architecture' },
            { text: '当前架构快照', link: '/architecture/' },
            { text: 'Runtime v1alpha1 · M1 契约', link: '/developer/runtime-v1alpha1' },
            { text: 'ADR-0001 · Engine 与桌面边界', link: '/developer/adr/0001-agent-engine-and-desktop-boundary' },
            { text: 'ADR-0002 · Runtime 事实与恢复', link: '/developer/adr/0002-runtime-facts-and-recovery' },
            { text: 'ADR-0003 · CTF 纵切与 Pi Adapter', link: '/developer/adr/0003-ctf-vertical-slice' },
            { text: 'ADR-0004 · 学习产品与发布边界', link: '/developer/adr/0004-learning-product-and-release-boundary' },
            { text: '题目接入与自动操作', link: '/developer/challenge-intake-and-automation' },
            { text: 'NYU CTF Bench 离线评测', link: '/developer/nyu-ctf-bench-eval' },
            { text: 'Role Packages', link: '/developer/role-packages' },
            { text: '开源项目坐标', link: '/developer/industry-baseline' },
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
