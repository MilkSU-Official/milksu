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

  it('scrolls to the latest message when route context or conversation changes', () => {
    expect(chatPageSource).toContain("window.requestAnimationFrame")
    expect(chatPageSource).toContain('props.conversation?.id')
    expect(chatPageSource).toContain('props.conversation?.messages.length ?? 0')
    expect(chatPageSource).toContain('props.ctfSession')
    expect(chatPageSource).toContain('props.vulnerabilitySession')
    expect(chatPageSource).toContain('scrollArea.value.scrollTop = scrollArea.value.scrollHeight')
  })

  it('quotes confirmed related history into the Coding composer draft without auto-sending it', () => {
    expect(chatPageSource).toContain('const composer = ref<{ appendDraftText')
    expect(chatPageSource).toContain('quoteSessionHistoryToComposer')
    expect(chatPageSource).toContain('confirm-action-label="引用到输入"')
    expect(chatPageSource).toContain('@confirm-result="quoteSessionHistoryToComposer"')
    expect(chatPageSource).toContain("composer.value?.appendDraftText")
    expect(chatPageSource).toContain('redactProviderCredentials(value)')
    expect(chatPageSource).toContain('trimHistoryField(result.snippet)')
    expect(chatPageSource).toContain('已引用到输入框')
    expect(chatPageSource).not.toContain("emit('send', lines.join")
  })
})
