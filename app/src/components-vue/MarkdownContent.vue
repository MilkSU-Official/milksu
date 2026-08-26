<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { invokeCommand } from '@/desktop'
import { decorateAgentStream } from '@/lib/agentStreamText'
import { renderMarkdown } from '@/lib/markdown'
import { t } from '@/lib/uiLocale'

const props = withDefaults(defineProps<{
  content: string
  compact?: boolean
  streaming?: boolean
}>(), {
  compact: false,
  streaming: false,
})

const html = computed(() => renderMarkdown(props.content))
const host = ref<HTMLElement | null>(null)

function decorateCodeBlocks() {
  const root = host.value
  if (!root) return
  for (const block of root.querySelectorAll<HTMLElement>('.agent-code')) {
    if (block.querySelector('.agent-code__copy')) continue
    const bar = block.querySelector('.agent-code__bar') ?? block
    const body = block.querySelector('pre')
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'agent-code__copy'
    copy.textContent = t('复制', 'Copy')
    copy.addEventListener('click', async event => {
      event.preventDefault()
      try {
        await navigator.clipboard.writeText(body?.innerText ?? block.innerText)
        copy.textContent = t('已复制', 'Copied')
        window.setTimeout(() => {
          copy.textContent = t('复制', 'Copy')
        }, 1500)
      } catch {
        copy.textContent = t('复制', 'Copy')
      }
    })
    bar.append(copy)
  }
}

watch(
  [html, () => props.streaming, host],
  async () => {
    await nextTick()
    decorateCodeBlocks()
    if (host.value) decorateAgentStream(host.value, props.streaming)
  },
  { immediate: true },
)

async function openLink(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')?.trim()
  if (!href || href.startsWith('#')) return
  let url: URL
  try {
    url = new URL(href)
  } catch {
    event.preventDefault()
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    event.preventDefault()
    return
  }
  event.preventDefault()
  await invokeCommand('open_ctf_source_url', { url: url.toString() })
}
</script>

<template>
  <div
    ref="host"
    class="markdown-content break-words"
    :class="{ 'markdown-content-compact': compact }"
    @click="openLink"
    v-html="html"
  />
</template>

<style scoped>
.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(blockquote),
.markdown-content :deep(pre),
.markdown-content :deep(table) {
  margin: 0.7rem 0;
}

.markdown-content :deep(:first-child) {
  margin-top: 0;
}

.markdown-content :deep(:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 1.1rem 0 0.55rem;
  color: inherit;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.markdown-content :deep(h1) {
  font-size: 1.35rem;
}

.markdown-content :deep(h2) {
  font-size: 1.18rem;
}

.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: 1rem;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.4rem;
}

.markdown-content :deep(ul) {
  list-style: disc;
}

.markdown-content :deep(ol) {
  list-style: decimal;
}

.markdown-content :deep(li + li) {
  margin-top: 0.3rem;
}

.markdown-content :deep(strong) {
  color: inherit;
  font-weight: 650;
}

.markdown-content :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--primary) 45%, transparent);
  text-underline-offset: 3px;
}

.markdown-content :deep(code) {
  border: 1px solid color-mix(in oklab, var(--border) 82%, transparent);
  border-radius: 0.3rem;
  background: color-mix(in oklab, var(--muted) 72%, transparent);
  color: inherit;
  padding: 0.08rem 0.32rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
}

.markdown-content :deep(.agent-code) {
  position: relative;
  overflow: hidden;
  margin: 0.7rem 0;
  border: 1px solid var(--agent-hairline, var(--border));
  border-radius: var(--agent-code-radius, 8px);
  background: var(--agent-code-surface, var(--card));
  box-shadow: var(--agent-float-shadow, none);
}

.markdown-content :deep(.agent-code__bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid var(--agent-hairline, var(--border));
  padding: 0.4rem 0.7rem;
}

.markdown-content :deep(.agent-code__lang) {
  min-width: 0;
  overflow: hidden;
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.markdown-content :deep(.agent-code__copy) {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 0.72rem;
  cursor: pointer;
}

.markdown-content :deep(.agent-code__body),
.markdown-content :deep(pre) {
  max-width: 100%;
  overflow: auto;
  margin: 0;
  border: 0;
  background: var(--agent-code-inset, var(--card));
  color: var(--foreground);
  padding: 0.55rem 0;
  line-height: 1.7;
}

.markdown-content :deep(pre code),
.markdown-content :deep(.agent-code code) {
  display: block;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: 0.82rem;
}

.markdown-content :deep(blockquote) {
  border-left: 2px solid var(--primary);
  color: var(--muted-foreground);
  padding-left: 0.9rem;
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
  text-align: left;
  vertical-align: top;
}

.markdown-content :deep(th) {
  background: color-mix(in oklab, var(--muted) 75%, transparent);
  font-weight: 600;
}

.markdown-content :deep(hr) {
  margin: 1rem 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.markdown-content :deep(.markdown-image-placeholder) {
  color: var(--muted-foreground);
  font-size: 0.88em;
}

.markdown-content-compact :deep(p),
.markdown-content-compact :deep(ul),
.markdown-content-compact :deep(ol),
.markdown-content-compact :deep(blockquote),
.markdown-content-compact :deep(pre),
.markdown-content-compact :deep(table) {
  margin: 0.45rem 0;
}
</style>
