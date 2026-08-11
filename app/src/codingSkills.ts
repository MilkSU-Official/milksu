export interface CodingSkillDefinition {
  name: string
  label: string
  description: string
}

export const CODING_SKILLS: readonly CodingSkillDefinition[] = [
  {
    name: 'product-design',
    label: '产品设计',
    description: '重大 UI 变动先确定视觉目标，再实现和验收',
  },
  {
    name: 'frontend-visual-qa',
    label: '前端视觉验收',
    description: '用真实预览与浏览器检查前端改动',
  },
  {
    name: 'integrate-api',
    label: 'API 集成',
    description: '按官方契约接入外部服务并验证真实请求',
  },
  {
    name: 'review-security',
    label: '安全审查',
    description: '检查凭据、授权、输入边界与外部副作用',
  },
  {
    name: 'create-technical-deliverables',
    label: '技术交付物',
    description: '生成可阅读、可复现的报告、指南和脚本说明',
  },
  {
    name: 'archify',
    label: '架构图',
    description: '生成并校验当前系统架构图',
  },
  {
    name: 'release-milksu',
    label: 'MilkSU 发布',
    description: '仅在开发 MilkSU 时构建、追踪和验收 Beta',
  },
]

export function enabledCodingSkillNames(disabled: readonly string[] = []): string[] {
  const disabledSet = new Set(disabled)
  return CODING_SKILLS
    .map(skill => skill.name)
    .filter(name => !disabledSet.has(name))
}
