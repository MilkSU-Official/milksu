const plugin = {
  initialize(context) {
    if (context?.apiVersion !== 'milksu.plugin/v1') throw new Error('unsupported plugin API')
  },
  async call_tool(name, input) {
    if (name === 'text_stats') {
      const text = String(input.text)
      return {
        characters: Array.from(text).length,
        bytes: Buffer.byteLength(text, 'utf8'),
        words: (text.trim().match(/\S+/gu) ?? []).length,
        lines: text === '' ? 0 : text.split(/\r\n|\r|\n/u).length,
      }
    }
    if (name === 'base64_encode') {
      return { value: Buffer.from(String(input.text), 'utf8').toString('base64') }
    }
    if (name === 'base64_decode') {
      const value = String(input.value)
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
        throw new Error('value is not canonical standard Base64')
      }
      const bytes = Buffer.from(value, 'base64')
      if (bytes.toString('base64') !== value) throw new Error('value is not canonical standard Base64')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return { text }
    }
    throw new Error(`unknown read-only text tool: ${String(name)}`)
  },
  dispose() {},
}

export default plugin
