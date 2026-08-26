'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('Electron package includes every local CommonJS module required by main', () => {
  const directory = __dirname
  const source = fs.readFileSync(path.join(directory, 'main.cjs'), 'utf8')
  const packageJSON = JSON.parse(
    fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
  )
  const packagedFiles = new Set(packageJSON.build.files)
  const localRequires = [...source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/gu)]
    .map(match => match[1])

  assert.ok(localRequires.length > 0, 'main.cjs should have local modules')
  for (const relativePath of localRequires) {
    assert.ok(
      packagedFiles.has(relativePath),
      `${relativePath} is required by main.cjs but missing from build.files`,
    )
  }
  assert.ok(
    packagedFiles.has('linux-update-apply.cjs'),
    'linux-update-apply.cjs is required by update-manager.cjs',
  )
})
