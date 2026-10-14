import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  collaborationTaskKey,
  collaborationWriterBranch,
  collaborationWriterId,
  codingCollaborationRoot,
  lookupCodingCollaboration,
  prepareCodingCollaboration,
} from './codingcollab/index.ts'

const execFileAsync = promisify(execFile)

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'])
    return true
  } catch {
    return false
  }
}

async function newRepository(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'milksu-collab-repo-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  const run = (...args: string[]) => execFileAsync('git', args, { cwd: repo, env })
  await run('-c', 'commit.gpgsign=false', 'init', '-q')
  await writeFile(join(repo, 'README.md'), 'hello\n')
  await run('-c', 'commit.gpgsign=false', 'add', 'README.md')
  await run(
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '-m',
    'init',
  )
  return repo
}

test('lookup is empty until prepare; prepare creates writer-1 under the collaboration root', async (t) => {
  if (!(await gitAvailable())) {
    t.skip('git is not installed')
    return
  }
  const home = await mkdtemp(join(tmpdir(), 'milksu-collab-home-'))
  const repo = await newRepository()
  const conversationId = 'conversation-writer'

  assert.equal(await lookupCodingCollaboration(home, conversationId, ''), null)
  assert.equal(await lookupCodingCollaboration(home, conversationId, repo), null)

  const prepared = await prepareCodingCollaboration(home, conversationId, repo, 1)
  assert.equal(prepared.schemaVersion, 2)
  assert.equal(prepared.worktrees.length, 1)
  assert.equal(prepared.worktrees[0].id, collaborationWriterId(1))
  assert.equal(prepared.worktrees[0].branch, collaborationWriterBranch(conversationId, 1))
  const root = realpathSync(codingCollaborationRoot(home))
  const expectedPath = join(root, collaborationTaskKey(conversationId), 'writer-1')
  assert.equal(prepared.worktrees[0].path, expectedPath)
  assert.ok(prepared.worktrees[0].path.startsWith(root))

  const lookedUp = await lookupCodingCollaboration(home, conversationId, repo)
  assert.ok(lookedUp)
  assert.equal(lookedUp.worktrees[0].id, 'writer-1')
  assert.equal(lookedUp.worktrees[0].path, prepared.worktrees[0].path)

  const again = await prepareCodingCollaboration(home, conversationId, repo, 1)
  assert.equal(again.worktrees[0].path, prepared.worktrees[0].path)
})
