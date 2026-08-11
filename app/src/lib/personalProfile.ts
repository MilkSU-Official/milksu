import type { CTFSummary } from '@/ctfTypes'
import type { Conversation } from '@/types'
import type { VulnSummary } from '@/vulnTypes'

export type PersonalActivityModule = 'ctf' | 'vuln' | 'coding'

export interface PersonalActivity {
  id: string
  module: PersonalActivityModule
  title: string
  detail: string
  timestamp: number
  confirmed: boolean
}

export interface PersonalModuleSummary {
  module: PersonalActivityModule
  label: 'CTF' | 'CVE' | 'Coding'
  count: number
  unit: string
  stage: string
  recentFocus: string
}

export interface PersonalProfileSnapshot {
  activities: PersonalActivity[]
  activeDays: number
  modules: PersonalModuleSummary[]
  dayCounts: Record<string, number>
}

export const MAX_PROFILE_AVATAR_BYTES = 1024 * 1024

export function profileAvatarFileProblem(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return '请选择 PNG、JPEG 或 WebP 图片。'
  }
  if (file.size <= 0 || file.size > MAX_PROFILE_AVATAR_BYTES) {
    return '头像文件不能超过 1 MB。'
  }
  return ''
}

function validTimestamp(value: string | number | undefined) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value ?? '')
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0
}

function localDay(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function qualitativeStage(count: number) {
  if (count <= 0) return '尚未开始'
  if (count <= 4) return '刚开始'
  if (count <= 15) return '持续练习'
  return '比较熟悉'
}

function codingActivities(conversations: Conversation[]) {
  return conversations.flatMap((conversation): PersonalActivity[] => {
    const taskMessages = conversation.messages.filter(message => message.role !== 'tool')
    const hasUserTask = taskMessages.some(message => message.role === 'user')
    if (!hasUserTask) return []
    const timestamp = Math.max(
      validTimestamp(conversation.createdAt),
      ...taskMessages.map(message => validTimestamp(message.timestamp)),
    )
    const confirmed = conversation.agentGoal?.status === 'complete'
      || taskMessages.some(message => (
        message.role === 'assistant'
        && message.status === 'done'
        && message.content.trim() !== ''
        && !/^(Agent 未启动|Agent 已停止|引导未加入|目标操作失败|停止 Agent 失败)/u.test(message.content.trim())
      ))
    return [{
      id: `coding:${conversation.id}`,
      module: 'coding',
      title: conversation.title || '未命名 Coding 对话',
      detail: confirmed ? '完成一次 Coding 任务' : '推进一次真实 Coding 对话',
      timestamp,
      confirmed,
    }]
  })
}

function ctfActivities(jobs: CTFSummary[]) {
  return jobs.flatMap((job): PersonalActivity[] => {
    const timestamp = validTimestamp(job.updatedAt)
    if (!timestamp) return []
    return [{
      id: `ctf:${job.id}`,
      module: 'ctf',
      title: job.title,
      detail: job.verdict === 'pass' ? '答案已通过独立验证' : '更新一次 CTF 练习记录',
      timestamp,
      confirmed: job.verdict === 'pass' || job.status === 'succeeded',
    }]
  })
}

function vulnActivities(jobs: VulnSummary[]) {
  return jobs.flatMap((job): PersonalActivity[] => {
    const timestamp = validTimestamp(job.updatedAt)
    if (!timestamp) return []
    return [{
      id: `vuln:${job.id}`,
      module: 'vuln',
      title: job.title,
      detail: '更新一次 CVE 研究记录',
      timestamp,
      confirmed: job.verdict === 'pass' || job.status === 'succeeded',
    }]
  })
}

function moduleSummary(
  module: PersonalActivityModule,
  label: PersonalModuleSummary['label'],
  unit: string,
  activities: PersonalActivity[],
) {
  const matching = activities.filter(activity => activity.module === module)
  return {
    module,
    label,
    count: matching.length,
    unit,
    stage: qualitativeStage(matching.length),
    recentFocus: matching[0]?.title ?? '暂无记录',
  } satisfies PersonalModuleSummary
}

export function buildPersonalProfileSnapshot(
  conversations: Conversation[],
  ctfJobs: CTFSummary[],
  vulnJobs: VulnSummary[],
  now = Date.now(),
): PersonalProfileSnapshot {
  const earliest = now - 365 * 24 * 60 * 60 * 1000
  const activities = [
    ...codingActivities(conversations),
    ...ctfActivities(ctfJobs),
    ...vulnActivities(vulnJobs),
  ]
    .filter(activity => activity.timestamp <= now && activity.timestamp >= earliest)
    .sort((left, right) => right.timestamp - left.timestamp)

  const dayCounts: Record<string, number> = {}
  for (const activity of activities) {
    const day = localDay(activity.timestamp)
    dayCounts[day] = (dayCounts[day] ?? 0) + 1
  }

  return {
    activities,
    activeDays: Object.keys(dayCounts).length,
    modules: [
      moduleSummary('ctf', 'CTF', '题', activities),
      moduleSummary('vuln', 'CVE', '项', activities),
      moduleSummary('coding', 'Coding', '次', activities),
    ],
    dayCounts,
  }
}

export function activityCalendar(dayCounts: Record<string, number>, now = Date.now()) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 364 - start.getDay())
  const cells = []
  for (let index = 0; index < 371; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = localDay(date.getTime())
    cells.push({
      key,
      date,
      count: dayCounts[key] ?? 0,
      future: date.getTime() > today.getTime(),
    })
  }
  return cells
}
