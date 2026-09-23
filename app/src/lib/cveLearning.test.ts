import { describe, expect, it } from 'vitest'
import { orderCveLearningNotes, prepareCveLearningSave } from './cveLearning'

describe('prepareCveLearningSave', () => {
  it('keeps a reflection the tracking workspace will accept', () => {
    expect(prepareCveLearningSave({
      cveId: ' cve-2024-3400 ',
      title: 'PAN-OS',
      summary: '  公告已核对  ',
      referenceHrefs: ['not a url', 'https://user:secret@example.com/a', 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400'],
      content: '  先核对公告，再看补丁。  ',
    })).toEqual({
      ensure: {
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS',
        summary: '公告已核对',
        referenceHref: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400',
      },
      content: '先核对公告，再看补丁。',
    })
  })

  it('drops an empty note, a bad id, and a credential or non-http reference', () => {
    expect(prepareCveLearningSave({ cveId: 'CVE-2024-3400', content: '   ' })).toBeNull()
    expect(prepareCveLearningSave({ cveId: 'not-a-cve', content: '记下' })).toBeNull()
    const plan = prepareCveLearningSave({
      cveId: 'CVE-2024-3400',
      title: '',
      summary: '',
      referenceHrefs: ['javascript:alert(1)', 'https://user@example.com/a'],
      content: '只留结论',
    })
    expect(plan).toEqual({
      ensure: { cveId: 'CVE-2024-3400', title: 'CVE-2024-3400' },
      content: '只留结论',
    })
  })

  it('clips title, summary, and content to the record limits', () => {
    const plan = prepareCveLearningSave({
      cveId: 'CVE-2024-1234',
      title: '题'.repeat(181),
      summary: '摘'.repeat(1201),
      content: '记'.repeat(4001),
    })
    expect(Array.from(plan?.ensure.title ?? '').length).toBe(180)
    expect(Array.from(plan?.ensure.summary ?? '').length).toBe(1200)
    expect(Array.from(plan?.content ?? '').length).toBe(4000)
  })
})

describe('orderCveLearningNotes', () => {
  it('orders oldest first and breaks ties by id', () => {
    expect(orderCveLearningNotes([
      { id: 'b', createdAt: '2026-09-02T00:00:00Z' },
      { id: 'c', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'a', createdAt: '2026-09-01T00:00:00Z' },
    ]).map(item => item.id)).toEqual(['a', 'c', 'b'])
  })
})
