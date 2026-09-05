function lastStreamableTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!(node instanceof Text) || !node.nodeValue) continue
    if (!node.nodeValue.replace(/\s/g, '')) continue
    if (node.parentElement?.closest('.agent-stream-caret, .agent-code__copy')) continue
    last = node
  }
  return last
}

function unwrapLegacyStreamTails(root: HTMLElement) {
  for (const tail of root.querySelectorAll('.agent-stream-tail')) {
    const text = tail.textContent ?? ''
    tail.replaceWith(document.createTextNode(text))
  }
}

export function decorateAgentStream(root: HTMLElement, streaming: boolean) {
  root.querySelectorAll('.agent-stream-caret').forEach(node => node.remove())
  unwrapLegacyStreamTails(root)
  root.normalize()
  if (!streaming) return

  const caret = document.createElement('span')
  caret.className = 'agent-stream-caret is-streaming'
  caret.setAttribute('aria-hidden', 'true')

  const text = lastStreamableTextNode(root)
  if (text) {
    text.after(caret)
    return
  }
  root.append(caret)
}
