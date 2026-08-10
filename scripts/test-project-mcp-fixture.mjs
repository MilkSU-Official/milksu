#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codingMcpOperationRequiresApproval } from '../sidecar/pi/bridge-auto-approval.js'
import { loadCodingMcpConfig } from '../sidecar/pi/bridge-mcp.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspace = await mkdtemp(join(tmpdir(), 'milksu-project-mcp-fixture-'))
const fixtureText = 'MilkSU Project MCP fixture: actual allowlisted tool call.\n'
const fixtureDigest = createHash('sha256').update(fixtureText).digest('hex')
const serverSource = await readFile(
  join(repositoryRoot, 'scripts', 'fixture-project-mcp-server.mjs'),
  'utf8',
)
const serverPath = join(workspace, 'fixture-project-mcp-server.mjs')
await Promise.all([
  writeFile(join(workspace, 'fixture.txt'), fixtureText, { mode: 0o600 }),
  writeFile(serverPath, serverSource, { mode: 0o700 }),
])
await chmod(serverPath, 0o700)

const projectConfig = JSON.stringify({
  mcpServers: {
    fixture: {
      command: process.execPath,
      args: [serverPath],
      includeTools: ['fixture_read'],
      milksu: {
        source: 'fixture:project-local-stdio',
        version: '1.0.0',
        taskScope: 'Project MCP actual-call acceptance fixture',
      },
    },
  },
}, null, 2)
await writeFile(join(workspace, '.mcp.json'), projectConfig, { mode: 0o600 })
const digest = createHash('sha256').update(projectConfig).digest('hex')
const loaded = await loadCodingMcpConfig(workspace, ['fixture'], digest)
assert(loaded.projectSelected.length === 1 && loaded.projectSelected[0] === 'fixture', 'fixture project MCP was not selected')
assert(loaded.config.settings.directTools === false, 'MilkSU must expose Project MCP through the proxy path')
assert(loaded.config.settings.hostConfigDiscovery === 'off', 'Project MCP must not discover ambient host configs')
const fixtureReadCall = {
  server: 'fixture',
  tool: 'fixture_read',
  args: { expectedSha256: fixtureDigest },
}
assert(
  codingMcpOperationRequiresApproval(fixtureReadCall, 'workspace-auto', 'fixture') === false,
  'workspace-auto should not pause for the reviewed read-only Project MCP fixture_read call',
)
assert(
  codingMcpOperationRequiresApproval(fixtureReadCall, 'full-auto', 'fixture') === false,
  'full-auto should not pause for the reviewed read-only Project MCP fixture_read call',
)
assert(
  codingMcpOperationRequiresApproval(fixtureReadCall, 'ask', 'fixture') === true,
  'ask mode must still request approval for Project MCP calls',
)
assert(
  codingMcpOperationRequiresApproval(fixtureReadCall, 'read-only', 'fixture') === true,
  'read-only mode must not silently execute Project MCP calls',
)

const serverDefinition = loaded.config.mcpServers.fixture
assert(serverDefinition.command === '/usr/bin/sandbox-exec', 'fixture MCP was not wrapped by the MilkSU sandbox')
assert(serverDefinition.env && Object.keys(serverDefinition.env).length === 0, 'fixture MCP inherited environment variables')
assert(serverDefinition.args.includes('/usr/bin/env'), 'fixture MCP did not reset its process environment')
assert(
  serverDefinition.args.includes('HOME=' + join(serverDefinition.cwd, '.milksu', 'mcp-runtime', 'home')),
  'fixture MCP did not use the private runtime HOME',
)

const transport = new StdioClientTransport({
  command: serverDefinition.command,
  args: serverDefinition.args,
  env: serverDefinition.env,
  cwd: serverDefinition.cwd,
  stderr: 'pipe',
})
const stderrChunks = []
transport.stderr?.on('data', chunk => stderrChunks.push(Buffer.from(chunk).toString('utf8')))
const client = new Client({ name: 'milksu-project-mcp-fixture-client', version: '1.0.0' })
try {
  await client.connect(transport)
  const tools = await client.listTools()
  assert(tools.tools.length === 1, `expected one allowlisted tool, got ${tools.tools.length}`)
  assert(tools.tools[0].name === 'fixture_read', `unexpected MCP tool ${tools.tools[0].name}`)
  const result = await client.callTool({
    name: 'fixture_read',
    arguments: { expectedSha256: fixtureDigest },
  })
  const textBlock = result.content?.find(block => block.type === 'text')
  assert(textBlock, 'fixture MCP call returned no text content')
  const parsed = JSON.parse(textBlock.text)
  assert(parsed.source === 'project-fixture', 'fixture MCP result lost source metadata')
  assert(parsed.expectedSha256 === fixtureDigest, 'fixture MCP result lost expected digest')
  assert(parsed.text === fixtureText, 'fixture MCP did not read the project fixture file')
  console.log(JSON.stringify({
    schema: 'milksu-project-mcp-actual-call/v1alpha1',
    selected: loaded.projectSelected,
    tools: tools.tools.map(tool => tool.name),
    sandboxed: true,
    inheritedEnvironment: false,
    hostConfigDiscovery: loaded.config.settings.hostConfigDiscovery,
    workspaceAutoApprovalRequired: codingMcpOperationRequiresApproval(
      fixtureReadCall,
      'workspace-auto',
      'fixture',
    ),
    fixtureSha256: fixtureDigest,
  }))
} finally {
  await client.close()
  const stderr = stderrChunks.join('')
  if (stderr.trim()) {
    process.stderr.write(stderr)
  }
}
