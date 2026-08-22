export function cveBriefing(cveId: string) {
  const id = cveId.trim()
  return {
    prompt: [
      `先根据公开描述整理 ${id}。`,
      '写清影响范围、利用条件、已有公开证据，以及接下来怎么在用户选定范围内验证。',
      '把结论写入工作区 report.md 的摘要。',
      '若查到上游、下游或同类 CVE，写入 related.md。',
      '不要扫描未授权目标。',
    ].join(''),
    visible: `先整理 ${id} 的公开情况和接下来怎么验证。`,
  }
}

export function labJobPrompt(input: {
  scope: 'local' | 'remote'
  request: string
}) {
  const request = input.request.trim()
  const local = input.scope === 'local'
  return {
    prompt: [
      `作业范围：${local ? '本地' : '远程'}。`,
      `用户要求：${request}`,
      '把作业结构化写入 report.md：摘要、范围、当前状况、步骤。',
      local
        ? '只看本机进程、端口、文件和用户点名的本机目标；不要扫描其他主机或互联网地址段。'
        : '只看用户点名的远程目标；不要扫描无关主机或互联网地址段。',
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
