#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const serverInfo = {
  name: 'milksu-project-mcp-fixture',
  version: '1.0.0',
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })}\n`)
}

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo,
      instructions: 'Read only the local project fixture file through fixture_read.',
    })
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'ping') {
    reply(id, {})
    return
  }
  if (method === 'tools/list') {
    reply(id, {
      tools: [
        {
          name: 'fixture_read',
          title: 'Read fixture',
          description: 'Read a deterministic local project fixture file.',
          inputSchema: {
            type: 'object',
            properties: {
              expectedSha256: {
                type: 'string',
                description: 'Expected SHA-256 digest for the fixture file.',
              },
            },
            required: ['expectedSha256'],
            additionalProperties: false,
          },
        },
      ],
    })
    return
  }
  if (method === 'tools/call') {
    if (params?.name !== 'fixture_read') {
      fail(id, -32602, `unknown fixture tool ${params?.name ?? '<missing>'}`)
      return
    }
    const expectedSha256 = String(params?.arguments?.expectedSha256 ?? '')
    const text = await readFile('fixture.txt', 'utf8')
    reply(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            source: 'project-fixture',
            expectedSha256,
            text,
          }),
        },
      ],
    })
    return
  }
  fail(id, -32601, `unsupported method ${method}`)
}

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})

for await (const line of lines) {
  if (!line.trim()) continue
  try {
    await handle(JSON.parse(line))
  } catch (error) {
    fail(null, -32000, error instanceof Error ? error.message : String(error))
  }
}
