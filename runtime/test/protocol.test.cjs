'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdir, mkdtemp, readFile, writeFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { homedir, tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const readline = require('node:readline')
const test = require('node:test')

const runtimeMain = join(__dirname, '..', 'dist', 'main.cjs')
const KEYCHAIN_SERVICE = 'dev.milksu.app.credentials'

function keychainServiceName(home) {
  const resolved = resolve(home)
  const product = resolve(join(homedir(), '.milksu'))
  if (resolved === product) return KEYCHAIN_SERVICE
  const sum = createHash('sha256').update(resolved).digest('hex').slice(0, 16)
  return `${KEYCHAIN_SERVICE}.${sum}`
}

function loadKeychainAddon() {
  const candidates = [
    join(__dirname, '..', '..', 'build', 'desktop', 'macos-keychain.node'),
    join(process.cwd(), 'build', 'desktop', 'macos-keychain.node'),
  ]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // Missing or unloadable addon is not fatal here.
    }
  }
  return null
}

function writeLine(stream, value) {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function waitLine(lines, predicate, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for RPC line')), timeoutMs)
    const onLine = (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (!predicate(message)) return
      clearTimeout(timer)
      lines.off('line', onLine)
      resolve(message)
    }
    lines.on('line', onLine)
  })
}

function startRuntime(home) {
  const proc = spawn(process.execPath, [runtimeMain], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MILKSU_HOME: home,
    },
  })
  const stderr = []
  proc.stderr.on('data', (chunk) => stderr.push(chunk.toString()))
  const lines = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })
  return { proc, lines, stderr }
}

test('runtime JSONL host: ready, owned invoke, host_request roundtrip, shutdown', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-home-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await mkdir(join(home, 'data', 'stores', 'conversations', 'archived'), { recursive: true })

  const { proc, lines, stderr } = startRuntime(home)
  try {
    const ready = await waitLine(lines, (message) => message.type === 'ready')
    assert.equal(ready.type, 'ready')

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-1',
      source: 'renderer',
      method: 'ListConversations',
      args: [],
    })
    const listed = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-1')
    assert.equal(listed.error, undefined)
    assert.deepEqual(listed.result, [])

    const workspace = join(home, 'picked-workspace')
    await mkdir(workspace)
    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-host',
      source: 'renderer',
      method: 'ChooseAgentWorkspace',
      args: [],
    })
    const hostRequest = await waitLine(lines, (message) => message.type === 'host_request' && message.method === 'dialog.openDirectory')
    assert.equal(hostRequest.method, 'dialog.openDirectory')
    await writeLine(proc.stdin, {
      type: 'host_response',
      id: hostRequest.id,
      result: workspace,
    })
    const hostResult = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-host')
    assert.equal(hostResult.error, undefined)
    assert.equal(typeof hostResult.result, 'string')
    assert.match(String(hostResult.result), /picked-workspace$/)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-cred',
      source: 'renderer',
      method: 'SetAccountModelCredential',
      args: ['https://example.invalid', 'secret'],
    })
    const denied = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-cred')
    assert.match(String(denied.error), /unavailable to renderer/)

    await writeLine(proc.stdin, { type: 'shutdown' })
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timed out')), 4000)),
    ])
  } catch (error) {
    error.message += `\nstderr: ${stderr.join('')}`
    throw error
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})

test('runtime owns ListConversations', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-home-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await mkdir(join(home, 'data', 'stores', 'conversations', 'archived'), { recursive: true })
  await writeFile(join(home, 'data', 'stores', 'conversations', 'chat-1.json'), `${JSON.stringify({
    id: 'chat-1',
    title: 'hello',
    createdAt: 9,
    workspaceHome: 'ctf',
    messages: [],
  }, null, 2)}\n`)
  const { proc, lines, stderr } = startRuntime(home)
  try {
    await waitLine(lines, (message) => message.type === 'ready')
    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-list',
      source: 'renderer',
      method: 'ListConversations',
      args: [],
    })
    const result = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-list')
    assert.equal(result.error, undefined)
    assert.equal(result.result[0].id, 'chat-1')
    assert.equal(result.result[0].workspaceHome, 'chat')

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-send',
      source: 'renderer',
      method: 'SendMessage',
      args: ['chat-1', '', '', '', '', '', '', '', '', '', '', [], [], null, -1, ''],
    })
    const sent = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-send')
    assert.match(String(sent.error), /prompt is required/)
    assert.doesNotMatch(String(sent.error), /helper should not see/)

    await writeFile(join(home, 'data', 'stores', 'conversations', 'dsh-1.json'), `${JSON.stringify({
      id: 'dsh-1',
      title: 'guest',
      createdAt: 10,
      kernel: 'dsh',
      messages: [],
    }, null, 2)}\n`)
    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-acp',
      source: 'renderer',
      method: 'SendMessage',
      args: ['dsh-1', 'hello', '', '', '', '', '', '', '', '', '', [], [], null, -1, ''],
    })
    const acp = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-acp')
    assert.match(String(acp.error), /Agent command is not configured/)

    await writeLine(proc.stdin, { type: 'shutdown' })
    await new Promise((resolve) => proc.once('exit', resolve))
  } catch (error) {
    error.message += `\nstderr: ${stderr.join('')}`
    throw error
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})

test('runtime owns fork, rewind, delete of conversation JSON', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-session-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await mkdir(join(home, 'data', 'stores', 'conversations', 'archived'), { recursive: true })
  await writeFile(join(home, 'data', 'stores', 'conversations', 'chat-fork.json'), `${JSON.stringify({
    id: 'chat-fork',
    title: '新编码任务',
    createdAt: 9,
    messages: [
      { id: 'u1', role: 'user', content: '请修复登录回调状态恢复', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'plan', timestamp: 2 },
      { id: 'u2', role: 'user', content: '继续', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'done', timestamp: 4 },
    ],
  }, null, 2)}\n`)
  const { proc, lines, stderr } = startRuntime(home)
  try {
    await waitLine(lines, (message) => message.type === 'ready')

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-fork',
      source: 'renderer',
      method: 'ForkConversation',
      args: ['chat-fork', 'assistant', 1],
    })
    const forked = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-fork')
    assert.equal(forked.error, undefined)
    assert.match(String(forked.result), /^[0-9a-f-]{36}$/i)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-rewind',
      source: 'renderer',
      method: 'RewindCodingSession',
      args: ['chat-fork'],
    })
    const rewind = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-rewind')
    assert.equal(rewind.error, undefined)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-delete',
      source: 'renderer',
      method: 'DeleteConversation',
      args: ['chat-fork'],
    })
    const deleted = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-delete')
    assert.equal(deleted.error, undefined)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-list',
      source: 'renderer',
      method: 'ListConversations',
      args: [],
    })
    const listed = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-list')
    const ids = (listed.result ?? []).map((item) => item.id)
    assert.equal(ids.includes('chat-fork'), false)
    assert.equal(ids.includes(forked.result), true)

    await writeLine(proc.stdin, { type: 'shutdown' })
    await new Promise((resolve) => proc.once('exit', resolve))
  } catch (error) {
    error.message += `\nstderr: ${stderr.join('')}`
    throw error
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})

test('runtime owns ListAgentResourceCatalog', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-resources-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await mkdir(join(home, 'data', 'stores', 'conversations', 'archived'), { recursive: true })
  const { proc, lines, stderr } = startRuntime(home)
  try {
    await waitLine(lines, (message) => message.type === 'ready')
    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-catalog',
      source: 'renderer',
      method: 'ListAgentResourceCatalog',
      args: [],
    })
    const result = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-catalog')
    assert.equal(result.error, undefined)
    assert.equal(Array.isArray(result.result.mcpServers), true)
    assert.equal(Array.isArray(result.result.skills), true)
    assert.equal(result.result.builtinMCP.some((item) => item.name === 'ida-pro'), true)
    assert.doesNotMatch(JSON.stringify(result.result), /helper should not see/)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-reserved',
      source: 'renderer',
      method: 'UpsertUserMCPServer',
      args: [{ name: 'milksu-playwright', transport: 'command', command: 'npx' }],
    })
    const reserved = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-reserved')
    assert.match(String(reserved.error), /reserved/)

    await writeLine(proc.stdin, { type: 'shutdown' })
    await new Promise((resolve) => proc.once('exit', resolve))
  } catch (error) {
    error.message += `\nstderr: ${stderr.join('')}`
    throw error
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})

test('runtime owns GetSettings/SaveSettingsCmd; json has no key; renderer cannot set credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-settings-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await mkdir(join(home, 'data', 'stores', 'conversations', 'archived'), { recursive: true })
  const { proc, lines, stderr } = startRuntime(home)
  const fakeKey = 'sk-test-settings-secret'
  try {
    await waitLine(lines, (message) => message.type === 'ready')

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-get',
      source: 'renderer',
      method: 'GetSettings',
      args: [],
    })
    const initial = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-get')
    assert.equal(initial.error, undefined)
    assert.doesNotMatch(JSON.stringify(initial.result), /helper should not see/)
    const settings = initial.result
    settings.providers = settings.providers || {}
    settings.providers['custom-relay-deepseek'] = {
      ...(settings.providers['custom-relay-deepseek'] || {}),
      api_key: fakeKey,
      enabled: true,
    }
    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-save',
      source: 'renderer',
      method: 'SaveSettingsCmd',
      args: [settings],
    })
    const saved = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-save')
    assert.equal(saved.error, undefined)

    const json = await readFile(join(home, 'config', 'settings.json'), 'utf8')
    assert.equal(json.includes(fakeKey), false)
    assert.match(json, /"has_api_key": true/)

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-get-after',
      source: 'renderer',
      method: 'GetSettings',
      args: [],
    })
    const after = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-get-after')
    assert.equal(after.error, undefined)
    const providers = after.result.providers
    assert.equal(providers['custom-relay-deepseek'].api_key, undefined)
    assert.equal(providers['custom-relay-deepseek'].has_api_key, true)
    assert.equal(JSON.stringify(after.result).includes(fakeKey), false)

    const account = 'provider:custom-relay-deepseek'
    const dbPath = join(home, 'config', 'credentials.db')
    let sqliteSecret
    try {
      const db = new DatabaseSync(dbPath)
      try {
        const hasTable = db.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credentials'",
        ).get()
        if (hasTable) {
          sqliteSecret = db.prepare('SELECT secret FROM credentials WHERE account = ?').get(account)
        }
      } finally {
        db.close()
      }
    } catch {
      sqliteSecret = undefined
    }
    if (sqliteSecret) {
      assert.equal(sqliteSecret.secret, fakeKey)
    } else {
      const addon = loadKeychainAddon()
      assert.ok(addon, 'credential must land in sqlite or an isolated macOS Keychain service')
      const service = keychainServiceName(home)
      assert.notEqual(service, KEYCHAIN_SERVICE)
      try {
        assert.equal(addon.get(account, service), fakeKey)
      } finally {
        try { addon.delete(account, service) } catch { /* test cleanup */ }
      }
    }

    await writeLine(proc.stdin, {
      type: 'invoke',
      id: 'invoke-cred',
      source: 'renderer',
      method: 'SetAccountModelCredential',
      args: ['https://tokenflux.dev/v1', fakeKey],
    })
    const denied = await waitLine(lines, (message) => message.type === 'result' && message.id === 'invoke-cred')
    assert.match(String(denied.error), /unavailable to renderer/)
    assert.equal(JSON.stringify(denied).includes(fakeKey), false)

    await writeLine(proc.stdin, { type: 'shutdown' })
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timed out')), 4000)),
    ])
  } catch (error) {
    const text = stderr.join('')
    if (text.includes(fakeKey)) error.message += '\nstderr contained the provider key'
    else error.message += `\nstderr: ${text}`
    throw error
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})
