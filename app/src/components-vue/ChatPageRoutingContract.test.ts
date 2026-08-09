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

  it('owns Goal interaction in the composer instead of the environment sidebar', () => {
    expect(chatPageSource).toContain(':goal="activeGoal"')
    expect(chatPageSource).toContain(':git-summary="composerGitSummary"')
    expect(chatPageSource).toContain('@start-goal="goalMode = true"')
    expect(chatPageSource).toContain('@consume-goal="goalMode = false"')
    expect(chatPageSource).toContain('@control-goal="controlComposerGoal"')
    expect(chatPageSource).toContain("function controlComposerGoal(action: 'pause' | 'resume' | 'clear')")
    expect(chatPageSource).toContain("if (action === 'pause' && props.running)")
    expect(chatPageSource).not.toContain("{{ goalMode ? '已设为目标' : '设为目标' }}")
    expect(chatPageSource).not.toContain('class="mt-3 rounded-lg bg-primary/[0.07] p-3"')
  })

  it('passes only a real dirty Git projection to the composer summary', () => {
    expect(chatPageSource).toContain('const composerGitSummary = computed')
    expect(chatPageSource).toContain('!git?.isRepository || !git.dirty || git.changedFiles <= 0')
    expect(chatPageSource).toContain('changedFiles: git.changedFiles')
    expect(chatPageSource).toContain('additions: git.additions')
    expect(chatPageSource).toContain('deletions: git.deletions')
  })

  it('keeps Terminal as an independent bottom dock instead of a sidebar page', () => {
    expect(chatPageSource).toContain('function toggleTerminalPanel()')
    expect(chatPageSource).toContain('terminalOpen.value = !terminalOpen.value')
    expect(chatPageSource).toContain("? '关闭底部终端' : '打开底部终端'")
    expect(chatPageSource).toContain('aria-label="底部终端面板"')
    expect(chatPageSource).toContain('@close="terminalOpen = false"')
    expect(chatPageSource).not.toContain("contextPanel === 'terminal'")
    expect(chatPageSource).not.toContain('<SelectItem v-if="!ctfSession" value="terminal">终端</SelectItem>')
    expect(chatPageSource.match(/aria-label="关闭右侧栏"/g) ?? []).toHaveLength(0)
  })
})
