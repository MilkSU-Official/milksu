import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readText = async (url) => (await readFile(url, 'utf8')).replaceAll('\r\n', '\n')

const [macWorkflow, windowsWorkflow, linuxWorkflow, macReleaseScript] = await Promise.all([
  readText(new URL('../../.github/workflows/macos-release.yml', import.meta.url)),
  readText(new URL('../../.github/workflows/windows-release.yml', import.meta.url)),
  readText(new URL('../../.github/workflows/linux-release.yml', import.meta.url)),
  readText(new URL('../../scripts/release-macos.mjs', import.meta.url)),
])

test('release workflows require one immutable verified source commit', () => {
  for (const workflow of [macWorkflow, windowsWorkflow, linuxWorkflow]) {
    assert.match(workflow, /source_commit:\n\s+description: Full verified main commit/u)
    assert.match(workflow, /source_commit:\n(?:.*\n){1,3}\s+required: true/u)
    assert.match(workflow, /git merge-base --is-ancestor/u)
  }
  assert.doesNotMatch(macWorkflow, /\$\{RELEASE_SOURCE_COMMIT,,\}/u)
  assert.match(macWorkflow, /tr '\[:upper:\]' '\[:lower:\]'/u)
})

test('macOS packaging does not repeat the canonical repository suite', () => {
  assert.doesNotMatch(macWorkflow, /go test \.\/\.\.\./u)
  assert.doesNotMatch(macWorkflow, /npm --prefix app test/u)
  assert.doesNotMatch(macWorkflow, /npm run test:sidecar/u)
  assert.doesNotMatch(macWorkflow, /brew install ripgrep fd/u)
})

test('platform workflows retain native package and first-launch acceptance', () => {
  assert.match(windowsWorkflow, /Validate the Windows build boundary/u)
  assert.match(windowsWorkflow, /Verify packaged runtimes and first launch/u)
  assert.match(linuxWorkflow, /Validate the Linux build boundary/u)
  assert.match(linuxWorkflow, /Verify deb, packaged runtimes and first launch/u)
  assert(linuxWorkflow.indexOf('Verify deb, packaged runtimes and first launch')
    < linuxWorkflow.indexOf('actions/upload-artifact@v4'))
})

test('GitHub-only macOS packaging skips updater ZIP and metadata', () => {
  assert.match(macWorkflow, /MILKSU_BUILD_OTA:.*inputs\.upload_release/u)
  assert.match(macReleaseScript, /const buildOta =/u)
  assert.match(macReleaseScript, /if \(buildOta\) \{\n\s+await run\('\/usr\/bin\/ditto'/u)
  assert.match(macReleaseScript, /if \(buildOta\) \{\n\s+const tracking =/u)
})
