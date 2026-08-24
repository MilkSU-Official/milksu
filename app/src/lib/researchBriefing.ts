import { t } from '@/lib/uiLocale'

export function labJobPrompt(input: {
  scope: 'local' | 'remote'
  request: string
}) {
  const request = input.request.trim()
  const local = input.scope === 'local'
  const scopeLabel = local ? t('本地', 'Local') : t('远程', 'Remote')
  return {
    prompt: [
      t(`作业范围：${scopeLabel}。`, `Job scope: ${scopeLabel}.`),
      t(`用户要求：${request}`, `User request: ${request}`),
      t('把作业结构化写入 report.md：摘要、范围、当前状况、步骤。', 'Write a structured job into report.md: summary, scope, current state, and steps.'),
      local
        ? t('只看本机进程、端口、文件和用户点名的本机目标；不要扫描其他主机或互联网地址段。', 'Look only at local processes, ports, files, and hosts the user named; do not scan other hosts or internet ranges.')
        : t('只看用户点名的远程目标；不要扫描无关主机或互联网地址段。', 'Look only at remote targets the user named; do not scan unrelated hosts or internet ranges.'),
    ].join(''),
    visible: request,
  }
}

export function labBriefing(input: {
  scope: 'local' | 'remote'
  request: string
}) {
  return labJobPrompt(input)
}
