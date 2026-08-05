#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'github-pr-status-live.json')
const liveSmokeEnabled = process.env.MILKSU_GITHUB_PR_STATUS_LIVE_SMOKE === '1'
const expectedRepo = process.env.MILKSU_GITHUB_REPO || 'MilkSU-Official/milksu'
const expectedBase = process.env.MILKSU_GITHUB_PR_BASE || 'main'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function execText(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout.trim()
}

async function git(args) {
  return await execText('git', args, { cwd: repositoryRoot })
}

async function ghJSON(args) {
  return JSON.parse(await execText('gh', args, { cwd: repositoryRoot }))
}

function parseLsRemote(value) {
  const [oid, ref] = value.split(/\s+/, 2)
  return { oid, ref }
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping GitHub PR status live smoke; set MILKSU_GITHUB_PR_STATUS_LIVE_SMOKE=1 to run it.')
    return
  }

  const branch = await git(['branch', '--show-current'])
  assert(branch, 'current worktree is not on a branch')
  const localHead = await git(['rev-parse', 'HEAD'])
  const originURL = await git(['remote', 'get-url', 'origin'])
  const remoteHead = parseLsRemote(await git(['ls-remote', 'origin', `refs/heads/${branch}`]))
  assert(remoteHead.ref === `refs/heads/${branch}`, `origin does not expose refs/heads/${branch}`)
  assert(remoteHead.oid === localHead, `local HEAD ${localHead} is not pushed to origin ${remoteHead.oid}`)

  const repo = await ghJSON([
    'repo',
    'view',
    expectedRepo,
    '--json',
    'nameWithOwner,isPrivate,visibility,url',
  ])
  assert(repo.nameWithOwner === expectedRepo, `unexpected GitHub repo: ${repo.nameWithOwner}`)
  assert(repo.isPrivate === true, `${expectedRepo} is not private`)
  assert(repo.visibility === 'PRIVATE', `${expectedRepo} visibility is not PRIVATE`)

  const prs = await ghJSON([
    'pr',
    'list',
    '--repo',
    expectedRepo,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,title,state,isDraft,url,headRefName,baseRefName,headRefOid,headRepository',
    '--limit',
    '5',
  ])
  assert(Array.isArray(prs), 'GitHub PR list did not return an array')
  assert(prs.length === 1, `expected exactly one open PR for ${branch}, found ${prs.length}`)
  const [pr] = prs
  assert(pr.state === 'OPEN', `PR is not open: ${pr.state}`)
  assert(pr.isDraft === true, 'PR is not a draft')
  assert(pr.headRefName === branch, `PR head ref ${pr.headRefName} does not match ${branch}`)
  assert(pr.baseRefName === expectedBase, `PR base ref ${pr.baseRefName} does not match ${expectedBase}`)
  assert(pr.headRefOid === localHead, `PR head ${pr.headRefOid} does not match local HEAD ${localHead}`)
  assert(pr.headRefOid === remoteHead.oid, `PR head ${pr.headRefOid} does not match origin head ${remoteHead.oid}`)
  assert(pr.headRepository?.nameWithOwner === expectedRepo, `PR head repo ${pr.headRepository?.nameWithOwner} is not ${expectedRepo}`)

  const report = {
    schema: 'milksu-github-pr-status-live-smoke/v1',
    measuredAt: new Date().toISOString(),
    repository: {
      expected: expectedRepo,
      originURL,
      githubURL: repo.url,
      isPrivate: repo.isPrivate,
      visibility: repo.visibility,
    },
    branch: {
      name: branch,
      localHead,
      originHead: remoteHead.oid,
      originRef: remoteHead.ref,
    },
    pullRequest: {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.isDraft,
      url: pr.url,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      headRefOid: pr.headRefOid,
      headRepository: pr.headRepository?.nameWithOwner ?? null,
    },
    gates: {
      originIsMilkSUPrivateRemote: repo.nameWithOwner === expectedRepo && repo.isPrivate === true,
      localHeadPushedToOrigin: remoteHead.oid === localHead,
      openDraftPRExists: pr.state === 'OPEN' && pr.isDraft === true,
      prHeadMatchesCurrentBranch: pr.headRefName === branch && pr.headRefOid === localHead,
      prTargetsExpectedBase: pr.baseRefName === expectedBase,
      prHeadRepositoryIsMilkSU: pr.headRepository?.nameWithOwner === expectedRepo,
    },
    limitations: [
      'This smoke is read-only and does not create, update, publish, or merge a pull request.',
      'It proves the current branch is represented by an open draft PR on the private MilkSU repository.',
      'It does not prove the in-app PR preview/publish UI flow.',
    ],
  }
  const serialized = JSON.stringify(report)
  assert(!/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]/.test(serialized), 'PR status report leaked token-shaped content')
  await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
  await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })

  console.log('GitHub PR status live smoke passed.')
  console.log(`  branch: ${branch}`)
  console.log(`  head: ${localHead.slice(0, 12)}`)
  console.log(`  PR: #${pr.number} ${pr.url}`)
  console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
