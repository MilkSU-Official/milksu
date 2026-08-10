// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import type { CTFChallengeRequest } from '@/ctfTypes'
import { toDesktopCTFChallengeRequest } from './useCTFWorkspace'

describe('toDesktopCTFChallengeRequest', () => {
  it('removes Vue proxies before crossing Electron IPC', () => {
    const request = reactive<CTFChallengeRequest>({
      title: 'P3347',
      statement: '公开题面',
      category: 'web',
      collaborationMode: 'copilot',
      deferAgent: true,
      sourceKind: 'url',
      sourceUri: 'https://www.nssctf.cn/problem/3347',
      sourceTargets: [{ kind: 'origin', value: 'https://www.nssctf.cn' }],
      externalPlatform: 'nssctf-web',
      externalAttemptId: 3347,
      expectedFlag: '',
      knowledgePoints: ['JS分析', '代码审计'],
      materials: [{
        name: 'page.html',
        mediaType: 'text/html',
        dataBase64: 'PGh0bWw+',
        provenance: 'NSSCTF public page',
      }],
    })

    const normalized = toDesktopCTFChallengeRequest(request)

    expect(() => structuredClone(normalized)).not.toThrow()
    expect(normalized).toEqual(request)
    expect(normalized).not.toBe(request)
    expect(normalized.knowledgePoints).not.toBe(request.knowledgePoints)
    expect(normalized.materials).not.toBe(request.materials)
    expect(normalized.materials[0]).not.toBe(request.materials[0])
  })
})
