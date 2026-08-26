import assert from 'node:assert/strict'
import test from 'node:test'
import { renderLinuxPkgbuild } from './linux-packages.mjs'

test('PKGBUILD template binds version and tarball hash', () => {
  const rendered = renderLinuxPkgbuild({
    version: '26.825.1',
    sha256: 'a'.repeat(64),
    template: 'pkgver=@VERSION@\nsha256sums=(\'@SHA256@\')\n',
  })
  assert.match(rendered, /pkgver=26\.825\.1/u)
  assert.match(rendered, /sha256sums=\('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\)/u)
})

test('PKGBUILD renderer rejects a truncated hash', () => {
  assert.throws(
    () => renderLinuxPkgbuild({ version: '26.825.1', sha256: 'abc', template: '@SHA256@' }),
    /64 hex/u,
  )
})
