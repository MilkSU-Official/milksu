import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MilkSU',
  description: '用户拥有的安全任务控制面',
  lang: 'zh-CN',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: '架构边界', link: '/developer/security-agent-boundary' },
      { text: '开发者', link: '/developer/architecture' },
      { text: '用户手册', link: '/user/overview' },
      { text: '进度', link: '/progress/status' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '介绍',
          items: [
            { text: '什么是 MilkSU', link: '/guide/what-is-milksu' },
            { text: '快速开始', link: '/guide/getting-started' },
          ],
        },
        {
          text: '核心概念',
          items: [
            { text: '架构', link: '/guide/architecture' },
            { text: '数据流', link: '/guide/data-flow' },
            { text: 'Agent Harness 模式', link: '/guide/agent-harness' },
          ],
        },
      ],

      '/developer/': [
        {
          text: '架构',
          items: [
            { text: '概览', link: '/developer/architecture' },
            { text: '安全 Agent 能力边界', link: '/developer/security-agent-boundary' },
            { text: 'Bridge 协议', link: '/developer/bridge' },
            { text: 'Tauri IPC', link: '/developer/tauri-ipc' },
            { text: 'Skill 系统', link: '/developer/skills' },
          ],
        },
        {
          text: '关键模式',
          items: [
            { text: 'Tool-as-Trigger', link: '/developer/tool-as-trigger' },
            { text: '子代理 (Sub-agent)', link: '/developer/subagents' },
            { text: '流式管道 (Streaming)', link: '/developer/streaming' },
            { text: '中继模式 (Relay)', link: '/developer/relay' },
          ],
        },
        {
          text: '参考',
          items: [
            { text: '模块状态', link: '/developer/module-status' },
            { text: '平台对比', link: '/developer/comparison' },
            { text: '供应商 (Provider)', link: '/developer/providers' },
          ],
        },
      ],

      '/user/': [
        {
          text: '用户手册',
          items: [
            { text: '概览', link: '/user/overview' },
            { text: '对话', link: '/user/chat' },
            { text: '任务类型', link: '/user/task-types' },
            { text: '安全面板', link: '/user/panels' },
            { text: '设置', link: '/user/settings' },
            { text: '项目管理 (Engagement)', link: '/user/engagement' },
          ],
        },
      ],

      '/progress/': [
        {
          text: '项目',
          items: [
            { text: '模块状态', link: '/progress/status' },
            { text: '路线图', link: '/progress/roadmap' },
            { text: '更新日志', link: '/progress/changelog' },
          ],
        },
        {
          text: 'Sprint 回顾',
          items: [
            { text: '2026-07-02', link: '/progress/sprint-2026-07-02' },
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
      message: '基于 Pi agent harness 构建',
      copyright: 'MIT 许可证',
    },
  },
})
