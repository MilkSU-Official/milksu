import { describe, expect, it } from 'vitest'
import {
  buildManagedLabDefinitions,
  managedLabPresentation,
} from '@/lib/managedLabs'
import type { ManagedLabInstance, ManagedLabPackage } from '@/ctfLabTypes'

describe('managed lab catalog', () => {
  const juiceShop: ManagedLabPackage = {
    id: 'owasp.juice-shop',
    title: 'OWASP Juice Shop',
    version: 'v20.1.1',
    role: 'ctf',
    categories: ['web'],
    description: 'Discover a bounded web challenge.',
    license: 'MIT',
    challenge: 'Confidential Document',
    judgeType: 'application-oracle',
    launchPath: '',
  }

  it('builds the catalog only from packages exposed by the real backend', () => {
    expect(buildManagedLabDefinitions([], [])).toEqual([])
    const [lab] = buildManagedLabDefinitions([juiceShop], [])

    expect(lab.id).toBe('owasp.juice-shop')
    expect(lab.lifecycle).toBe('ready')
    expect(managedLabPresentation(lab.lifecycle)).toMatchObject({
      statusLabel: '可以启动',
      actionKind: 'start',
      actionDisabled: false,
    })
  })

  it('preserves manifest-derived login and launch metadata', () => {
    const [lab] = buildManagedLabDefinitions([{
      ...juiceShop,
      id: 'owasp.webgoat',
      title: 'OWASP WebGoat',
      launchPath: '/WebGoat/attack#lesson/SqlInjection.lesson',
      accessType: 'form',
    }], [])

    expect(lab.launchPath).toBe('/WebGoat/attack#lesson/SqlInjection.lesson')
    expect(lab.accessType).toBe('form')
  })

  it('derives running and recovery actions from persisted instances', () => {
    const base: ManagedLabInstance = {
      instanceId: 'instance-1',
      packageId: juiceShop.id,
      projectName: 'milksu-lab-instance1',
      phase: 'ready',
      endpoint: 'http://127.0.0.1:41234',
      message: 'ready',
      updatedAt: '2026-08-01T00:00:00Z',
      packageVersion: juiceShop.version,
      imageDigest: `sha256:${'a'.repeat(64)}`,
    }
    const [running] = buildManagedLabDefinitions([juiceShop], [base])
    const [orphaned] = buildManagedLabDefinitions([juiceShop], [{
      ...base,
      phase: 'orphaned',
      updatedAt: '2026-08-01T00:01:00Z',
    }])

    expect(managedLabPresentation(running.lifecycle).actionKind).toBe('train')
    expect(managedLabPresentation(orphaned.lifecycle).actionKind).toBe('destroy')
  })
})
