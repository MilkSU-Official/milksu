import assert from 'node:assert/strict'
import test from 'node:test'

import { renderReport } from '../src/report.js'

test('fixture starts incomplete', () => {
  assert.throws(() => renderReport({ owner: 'Mina', items: [] }), /TODO/)
})
