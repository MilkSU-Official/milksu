/** Beautiful UI StreamText leading edge: newest characters stay softly blurred. */
export const AGENT_STREAM_BLUR_TAIL = 6

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

function splitTail(value: string, tailCount: number) {
  const units = [...value]
  const count = Math.min(tailCount, units.length)
  if (count <= 0) return { head: value, tail: '' }
  return {
    head: units.slice(0, units.length - count).join(''),
    tail: units.slice(units.length - count).join(''),
  }
}

export function decorateAgentStream(root: HTMLElement, streaming: boolean) {
  root.querySelectorAll('.agent-stream-caret').forEach(node => node.remove())
  for (const tail of root.querySelectorAll('.agent-stream-tail')) {
    const text = tail.textContent ?? ''
    tail.replaceWith(document.createTextNode(text))
    tail.remove()
  }
  root.normalize()
  if (!streaming) return

  const caret = document.createElement('span')
  caret.className = 'agent-stream-caret is-streaming'
  caret.setAttribute('aria-hidden', 'true')

  const text = lastStreamableTextNode(root)
  if (!text?.nodeValue) {
    root.append(caret)
    return
  }

  const { head, tail } = splitTail(text.nodeValue, AGENT_STREAM_BLUR_TAIL)
  text.nodeValue = head
  if (!tail) {
    text.after(caret)
    return
  }
  const edge = document.createElement('span')
  edge.className = 'agent-stream-tail'
  edge.textContent = tail
  text.after(edge)
  edge.after(caret)
}
