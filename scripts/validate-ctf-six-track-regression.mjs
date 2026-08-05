#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const manifestPath = new URL('../docs/developer/ctf-six-track-regression-manifest.json', import.meta.url)

const expectedTracks = ['web', 'pwn', 'reverse', 'crypto', 'forensics', 'misc']
const allowedStatuses = new Set(['missing', 'attempted', 'completed', 'judge-verified'])
const requiredEvidence = [
  'authorizedProblemStatement',
  'materials',
  'solverTrajectory',
  'checkpoints',
  'candidates',
  'judgeReceipt',
  'hintDependency',
  'userContribution',
  'interruptionRecovery',
  'debrief',
  'trainingEvidence',
]
const allowedCollaborationKeys = new Set(['tool-builder', 'strategist'])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validateTrack(track, index) {
  const prefix = `tracks[${index}] ${track?.key ?? '<missing-key>'}`
  assert(expectedTracks[index] === track.key, `${prefix}: expected key ${expectedTracks[index]} at fixed index ${index}`)
  assert(isNonEmptyString(track.label), `${prefix}: label is required`)
  assert(allowedStatuses.has(track.status), `${prefix}: invalid status ${track.status}`)
  assert(track.selection && typeof track.selection === 'object', `${prefix}: selection is required`)
  assert(track.judge && typeof track.judge === 'object', `${prefix}: judge is required`)

  const category = String(track.selection.category ?? '').toLowerCase()
  assert(category === track.key, `${prefix}: selection.category must match track key`)

  if (track.status === 'judge-verified') {
    assert(isNonEmptyString(track.selection.platform), `${prefix}: verified track requires platform`)
    assert(isNonEmptyString(track.selection.challengeId), `${prefix}: verified track requires challengeId`)
    assert(Array.isArray(track.selection.materialTypes) && track.selection.materialTypes.length > 0, `${prefix}: verified track requires materialTypes`)
    assert(isISODate(track.selection.acceptedAt), `${prefix}: verified track requires acceptedAt YYYY-MM-DD`)
    assert(track.judge.authority === 'platform', `${prefix}: verified track must use authoritative platform judge`)
    assert(track.judge.status === 'accepted', `${prefix}: verified track judge status must be accepted`)
    assert(track.judge.correct === true, `${prefix}: verified track judge.correct must be true`)
    assert(isNonEmptyString(track.judge.receiptReference), `${prefix}: verified track requires receiptReference`)
    assert(isISODate(track.judge.verifiedAt), `${prefix}: verified track requires verifiedAt YYYY-MM-DD`)
    for (const evidenceKey of requiredEvidence) {
      assert(
        isNonEmptyString(track.evidenceRefs?.[evidenceKey]),
        `${prefix}: verified track missing evidenceRefs.${evidenceKey}`,
      )
    }
    return
  }

  assert(track.judge.correct !== true, `${prefix}: only judge-verified tracks may carry correct=true`)
  assert(!isNonEmptyString(track.judge.receiptReference), `${prefix}: incomplete track must not cite a final Judge receipt`)
  assert(Array.isArray(track.gaps) && track.gaps.length > 0, `${prefix}: incomplete track requires explicit gaps`)
}

function validateCollaborations(collaborations) {
  assert(Array.isArray(collaborations), 'crossTrackCollaborations must be an array')
  assert(collaborations.length === allowedCollaborationKeys.size, 'crossTrackCollaborations must contain tool-builder and strategist')
  const seen = new Set()
  for (const item of collaborations) {
    assert(allowedCollaborationKeys.has(item.key), `invalid collaboration key ${item.key}`)
    assert(!seen.has(item.key), `duplicate collaboration key ${item.key}`)
    seen.add(item.key)
    assert(item.requiredOnce === true, `${item.key}: requiredOnce must be true`)
    assert(allowedStatuses.has(item.status), `${item.key}: invalid status ${item.status}`)
    assert(isNonEmptyString(item.description), `${item.key}: description is required`)
    if (item.status === 'judge-verified') {
      throw new Error(`${item.key}: collaboration should not use judge-verified; use completed with evidence refs later`)
    }
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert(manifest.schema === 'milksu-ctf-six-track-regression/v1alpha1', 'unexpected manifest schema')
assert(Array.isArray(manifest.requiredTracks), 'requiredTracks must be an array')
assert(JSON.stringify(manifest.requiredTracks) === JSON.stringify(expectedTracks), 'requiredTracks must be the six fixed ability axes')
assert(Array.isArray(manifest.requiredEvidence), 'requiredEvidence must be an array')
assert(JSON.stringify(manifest.requiredEvidence) === JSON.stringify(requiredEvidence), 'requiredEvidence changed without updating validator')
assert(Array.isArray(manifest.tracks), 'tracks must be an array')
assert(manifest.tracks.length === expectedTracks.length, 'tracks must contain exactly six entries')
manifest.tracks.forEach(validateTrack)
validateCollaborations(manifest.crossTrackCollaborations)

const judgeVerified = manifest.tracks.filter(track => track.status === 'judge-verified')
console.log(JSON.stringify({
  schema: manifest.schema,
  tracks: manifest.tracks.length,
  judgeVerified: judgeVerified.map(track => track.key),
  ready: judgeVerified.length === expectedTracks.length,
}))
