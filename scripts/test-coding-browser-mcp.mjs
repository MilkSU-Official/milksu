import assert from 'node:assert/strict'
import {
  access,
  readFile,
  stat,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createFirstPartyPlaywrightMcpServer } from '../bridge-mcp.js'

const requiredEnvironment = [
  'MILKSU_CODING_BROWSER_CDP_ENDPOINT',
  'MILKSU_CODING_BROWSER_EVIDENCE_RELATIVE',
  'MILKSU_CODING_BROWSER_SESSION_ID',
  'MILKSU_CODING_BROWSER_URL',
  'MILKSU_CODING_BROWSER_WORKSPACE',
]

for (const name of requiredEnvironment) {
  assert.ok(String(process.env[name] ?? '').trim(), `${name} is required`)
}

const workspace = resolve(process.env.MILKSU_CODING_BROWSER_WORKSPACE)
const evidenceRelative = process.env.MILKSU_CODING_BROWSER_EVIDENCE_RELATIVE
const evidenceDirectory = resolve(workspace, evidenceRelative)
const evidenceFromWorkspace = relative(workspace, evidenceDirectory)
assert.equal(isAbsolute(evidenceFromWorkspace), false)
assert.notEqual(evidenceFromWorkspace, '..')
assert.equal(evidenceFromWorkspace.startsWith(`..${sep}`), false)

const evidenceFiles = {
  minimumScreenshot: `${evidenceRelative}/minimum-1080x680.png`,
  wideScreenshot: `${evidenceRelative}/wide-1440x900.png`,
  snapshot: `${evidenceRelative}/final-snapshot.md`,
  console: `${evidenceRelative}/console.log`,
  network: `${evidenceRelative}/network.log`,
}

function textContent(result) {
  return (result.content ?? [])
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('\n')
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) {
    throw new Error(`${name} failed: ${textContent(result)}`)
  }
  return result
}

async function requireFile(path, contentPattern) {
  await access(path)
  const metadata = await stat(path)
  assert.equal(metadata.isFile(), true, `${path} must be a regular file`)
  assert.ok(metadata.size > 0, `${path} must not be empty`)
  if (contentPattern) {
    assert.match(await readFile(path, 'utf8'), contentPattern)
  }
  return metadata.size
}

async function main() {
  const builtIn = await createFirstPartyPlaywrightMcpServer(workspace, {
    sessionId: process.env.MILKSU_CODING_BROWSER_SESSION_ID,
    cdpEndpoint: process.env.MILKSU_CODING_BROWSER_CDP_ENDPOINT,
  })
  assert.ok(builtIn)
  assert.deepEqual(builtIn.server.excludeTools, ['browser_run_code_unsafe'])

  const transport = new StdioClientTransport({
    command: builtIn.server.command,
    args: builtIn.server.args,
    cwd: builtIn.server.cwd,
    env: builtIn.server.env,
    stderr: 'pipe',
    maxBufferSize: 16 << 20,
  })
  let serverStderr = ''
  transport.stderr?.setEncoding('utf8')
  transport.stderr?.on('data', chunk => {
    serverStderr += chunk
  })
  const client = new Client({
    name: 'milksu-coding-browser-integration',
    version: '1.0.0',
  })

  try {
    await client.connect(transport)
    const listed = await client.listTools()
    const toolNames = new Set(listed.tools.map(tool => tool.name))
    for (const name of [
      'browser_click',
      'browser_console_messages',
      'browser_navigate',
      'browser_network_requests',
      'browser_resize',
      'browser_snapshot',
      'browser_take_screenshot',
      'browser_wait_for',
    ]) {
      assert.equal(toolNames.has(name), true, `missing Browser tool ${name}`)
    }

    await call(client, 'browser_navigate', {
      url: process.env.MILKSU_CODING_BROWSER_URL,
    })
    await call(client, 'browser_wait_for', { text: 'Authorized challenge' })
    await call(client, 'browser_resize', { width: 1080, height: 680 })
    await call(client, 'browser_take_screenshot', {
      type: 'png',
      filename: evidenceFiles.minimumScreenshot,
      fullPage: true,
      scale: 'css',
    })
    const snapshot = await call(client, 'browser_snapshot', {})
    assert.match(textContent(snapshot), /Authorized challenge/)
    await call(client, 'browser_click', {
      element: 'Verify fixture button',
      target: '#verify',
    })
    await call(client, 'browser_wait_for', { text: 'Verified' })
    await call(client, 'browser_snapshot', {
      filename: evidenceFiles.snapshot,
    })
    await call(client, 'browser_console_messages', {
      level: 'debug',
      all: true,
      filename: evidenceFiles.console,
    })
    await call(client, 'browser_network_requests', {
      static: false,
      filename: evidenceFiles.network,
    })
    await call(client, 'browser_resize', { width: 1440, height: 900 })
    await call(client, 'browser_take_screenshot', {
      type: 'png',
      filename: evidenceFiles.wideScreenshot,
      fullPage: true,
      scale: 'css',
    })

    const sizes = {
      minimumScreenshot: await requireFile(
        join(workspace, evidenceFiles.minimumScreenshot),
      ),
      wideScreenshot: await requireFile(
        join(workspace, evidenceFiles.wideScreenshot),
      ),
      snapshot: await requireFile(
        join(workspace, evidenceFiles.snapshot),
        /Verified/,
      ),
      console: await requireFile(
        join(workspace, evidenceFiles.console),
        /fixture-console-error/,
      ),
      network: await requireFile(
        join(workspace, evidenceFiles.network),
        /api\/failure.*503|503.*api\/failure/,
      ),
    }
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    for (const name of ['minimumScreenshot', 'wideScreenshot']) {
      const bytes = await readFile(join(workspace, evidenceFiles[name]))
      assert.equal(bytes.subarray(0, 4).equals(pngSignature), true)
    }

    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'milksu-coding-browser-evidence/v1alpha1',
      passed: true,
      sessionId: builtIn.browser.sessionId,
      evidenceRelative,
      evidenceFiles,
      sizes,
      checkedTools: [...toolNames].filter(name => (
        name.startsWith('browser_')
        && name !== 'browser_run_code_unsafe'
      )).length,
    })}\n`)
  } catch (error) {
    if (serverStderr.trim()) {
      error.message += `\nPlaywright MCP stderr:\n${serverStderr.slice(-4_000)}`
    }
    throw error
  } finally {
    await client.close()
  }
}

await main()
