export interface NSSCTFChallenge {
  platform: 'NSSCTF'
  platformId: number
  sourceUrl: string
  title: string
  statement: string
  category: string
  points: number
  difficulty: number
  tags: string[]
  hasEnvironment: boolean
  hasAttachment: boolean
  solvedCount: number
  wrongAnswerCount: number
  writeupCount: number
  importedAt: string
}

interface NSSCTFAPIResponse {
  code: number
  data: {
    pid: number
    title: string
    desc: string
    point: number
    type: number
    level: number
    docker: boolean
    annex: boolean
    tag: Array<[string, number]>
    info: { solved: number; wa: number; wp: number }
  }
}

const CATEGORY_BY_TYPE: Record<number, string> = {
  1: 'Web',
  2: 'Pwn',
  3: 'Reverse',
  4: 'Crypto',
  5: 'Misc',
}

export function normalizeNSSCTFProblemURL(raw: string) {
  const input = raw.trim()
  if (/^[1-9][0-9]*$/.test(input)) {
    const id = Number(input)
    return { id, url: `https://www.nssctf.cn/problem/${id}` }
  }
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('请输入题目 ID，或 https://www.nssctf.cn/problem/{id} 形式的链接')
  }
  const match = /^\/problem\/([1-9][0-9]*)\/?$/.exec(parsed.pathname)
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'www.nssctf.cn'
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !match
  ) {
    throw new Error('请输入题目 ID，或 https://www.nssctf.cn/problem/{id} 形式的链接')
  }
  const id = Number(match[1])
  return { id, url: `https://www.nssctf.cn/problem/${id}` }
}

export function challengeFromNSSCTFAPI(payload: NSSCTFAPIResponse, requestedId: number): NSSCTFChallenge {
  if (payload.code !== 200 || payload.data.pid !== requestedId || !payload.data.title.trim()) {
    throw new Error('NSSCTF 没有返回有效题目')
  }
  const parser = new DOMParser()
  const documentValue = parser.parseFromString(payload.data.desc || '', 'text/html')
  const statement = documentValue.body.textContent?.replace(/\n{3,}/g, '\n\n').trim()
    || 'NSSCTF 公开题面未提供文字描述；请在平台查看环境、附件与题目要求。'
  const tags = [...new Set(payload.data.tag.map(item => item[0].trim()).filter(Boolean))].slice(0, 8)
  return {
    platform: 'NSSCTF',
    platformId: payload.data.pid,
    sourceUrl: `https://www.nssctf.cn/problem/${payload.data.pid}`,
    title: payload.data.title.trim(),
    statement,
    category: CATEGORY_BY_TYPE[payload.data.type] ?? 'Misc',
    points: payload.data.point,
    difficulty: payload.data.level,
    tags,
    hasEnvironment: payload.data.docker,
    hasAttachment: payload.data.annex,
    solvedCount: payload.data.info.solved,
    wrongAnswerCount: payload.data.info.wa,
    writeupCount: payload.data.info.wp,
    importedAt: new Date().toISOString(),
  }
}
