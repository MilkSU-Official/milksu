import { t } from '@/lib/uiLocale'

export interface CodingSkillDefinition {
  name: string
  label: string
  description: string
}

export const CODING_SKILLS: readonly CodingSkillDefinition[] = [
  {
    name: 'product-design',
    label: t('产品设计', 'Product design'),
    description: t('重大 UI 变动先确定视觉目标，再实现和验收', 'Set the visual goal for major UI changes before implementing and reviewing'),
  },
  {
    name: 'frontend-visual-qa',
    label: t('前端视觉验收', 'Frontend visual review'),
    description: t('用真实预览与浏览器检查前端改动', 'Check frontend changes with a live preview and the browser'),
  },
  {
    name: 'integrate-api',
    label: t('API 集成', 'API integration'),
    description: t('按官方契约接入外部服务并验证真实请求', 'Connect external services to their official contracts and verify real requests'),
  },
  {
    name: 'review-security',
    label: t('安全审查', 'Security review'),
    description: t('检查凭据、授权、输入边界与外部副作用', 'Check credentials, authorization, input boundaries, and external side effects'),
  },
  {
    name: 'create-technical-deliverables',
    label: t('技术交付物', 'Technical deliverables'),
    description: t('生成可阅读、可复现的报告、指南和脚本说明', 'Produce readable, reproducible reports, guides, and script notes'),
  },
  {
    name: 'archify',
    label: t('架构图', 'Architecture diagram'),
    description: t('生成并校验当前系统架构图', 'Generate and validate the current system architecture diagram'),
  },
  {
    name: 'release-milksu',
    label: t('MilkSU 发布', 'MilkSU release'),
    description: t('仅在开发 MilkSU 时构建、追踪和验收 Beta', 'Build, track, and accept Beta only when developing MilkSU'),
  },
]

export function enabledCodingSkillNames(disabled: readonly string[] = []): string[] {
  const disabledSet = new Set(disabled)
  return CODING_SKILLS
    .map(skill => skill.name)
    .filter(name => !disabledSet.has(name))
}
