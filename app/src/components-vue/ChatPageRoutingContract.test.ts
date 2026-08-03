import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'

describe('ChatPage routing contract', () => {
  it('shows a CVE handoff badge and return action while preserving a typed topbar module', () => {
    expect(chatPageSource).toContain('vulnerabilitySession?: boolean')
    expect(chatPageSource).toContain('returnVuln: []')
    expect(chatPageSource).toContain('vulnerabilitySession: props.vulnerabilitySession')
    expect(chatPageSource).toContain('const topbarModule = computed')
    expect(chatPageSource).toContain("? 'cve'")
    expect(chatPageSource).toContain("{{ ctfSession ? ctfRoleLabel : 'CVE 接力' }}")
    expect(chatPageSource).toContain('aria-label="返回 CVE 工作台"')
    expect(chatPageSource).toContain("@click=\"$emit('returnVuln')\"")
    expect(chatPageSource).toContain(':module="topbarModule"')
  })
})
