/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const indexCss = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

describe('global style contract', () => {
  it('keeps compact form controls on one shared font scale', () => {
    expect(indexCss).toContain('[data-slot="native-select"][data-size="sm"],\n[data-slot="select-trigger"][data-size="sm"],\n[data-slot="input"][data-size="sm"]')
    expect(indexCss).toContain('[data-slot="native-select"][data-size="default"],\n[data-slot="select-trigger"][data-size="default"],\n[data-slot="input"][data-size="default"]')
    expect(indexCss).toContain('[data-slot="native-select"][data-size="lg"],\n[data-slot="select-trigger"][data-size="lg"],\n[data-slot="input"][data-size="lg"]')
  })
})
