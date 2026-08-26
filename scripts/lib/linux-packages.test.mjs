import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { renderLinuxPkgbuild } from './linux-packages.mjs'

const packagingLinux = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packaging', 'linux')

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

test('Nix flake wraps linux-unpacked on both x86_64 and aarch64', () => {
  const flake = readFileSync(join(packagingLinux, 'flake.nix'), 'utf8')
  assert.match(flake, /x86_64-linux/)
  assert.match(flake, /aarch64-linux/)
  assert.match(flake, /MILKSU_LINUX_UNPACKED/)
})

test('NixOS verify script selects the host docker platform', () => {
  const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'verify-linux-nixos.sh'), 'utf8')
  assert.match(script, /linux\/arm64/)
  assert.match(script, /NIX_PLATFORM/)
  assert.match(script, /uname -m/)
})
