import assert from 'node:assert/strict'
import test from 'node:test'

import {
  identityProblem,
  parseCodesignDetails,
  parseCodeSigningIdentities,
  stableCodesignProblem,
} from '../../scripts/check-macos-signing.mjs'

test('parses final app codesign details from stderr-style output', () => {
  const details = parseCodesignDetails(`
Executable=/Applications/MilkSU.app/Contents/MacOS/MilkSU
Identifier=com.milksu.app
Signature=adhoc
TeamIdentifier=not set
Authority=Apple Development: Example
Authority=Apple Worldwide Developer Relations Certification Authority
`)

  assert.equal(details.identifier, 'com.milksu.app')
  assert.equal(details.signature, 'adhoc')
  assert.equal(details.teamIdentifier, 'not set')
  assert.deepEqual(details.authority, [
    'Apple Development: Example',
    'Apple Worldwide Developer Relations Certification Authority',
  ])
})

test('rejects ad-hoc or missing-team signatures for stable Computer Use validation', () => {
  assert.equal(stableCodesignProblem({
    signature: 'adhoc',
    teamIdentifier: 'not set',
  }), 'Signature=adhoc')
  assert.equal(stableCodesignProblem({
    signature: 'signed',
    teamIdentifier: 'not set',
  }), 'TeamIdentifier=not set')
  assert.equal(stableCodesignProblem({
    signature: 'signed',
    teamIdentifier: 'ABCDE12345',
  }), '')
})

test('parses installed Keychain identities without exposing key material', () => {
  const identities = parseCodeSigningIdentities(`
  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: MilkSU LLC (ABCDE12345)"
  2) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Apple Development: MilkSU (ABCDE12345)"
     2 valid identities found
`)

  assert.deepEqual(identities, [
    {
      hash: '0123456789ABCDEF0123456789ABCDEF01234567',
      name: 'Developer ID Application: MilkSU LLC (ABCDE12345)',
      developerIdApplication: true,
    },
    {
      hash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      name: 'Apple Development: MilkSU (ABCDE12345)',
      developerIdApplication: false,
    },
  ])
})

test('requires the selected stable identity to be a Developer ID Application identity', () => {
  const identities = parseCodeSigningIdentities(`
  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: MilkSU LLC (ABCDE12345)"
  2) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Apple Development: MilkSU (ABCDE12345)"
`)

  assert.equal(identityProblem('', identities), '')
  assert.equal(identityProblem('-', identities), 'MILKSU_CODESIGN_IDENTITY is ad-hoc (-)')
  assert.equal(identityProblem(
    'Apple Development: MilkSU (ABCDE12345)',
    identities,
  ), 'identity is not Developer ID Application: Apple Development: MilkSU (ABCDE12345)')
  assert.equal(identityProblem(
    'Developer ID Application: Missing (ABCDE12345)',
    identities,
  ), 'codesigning identity not found in Keychain: Developer ID Application: Missing (ABCDE12345)')
  assert.equal(identityProblem(
    'Developer ID Application: MilkSU LLC (ABCDE12345)',
    identities,
  ), '')
})
