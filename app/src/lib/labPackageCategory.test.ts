import { describe, expect, it } from 'vitest'
import { groupLabPackages, labPackageCategory } from './labPackageCategory'

describe('labPackageCategory', () => {
  it('groups catalog-shaped packages into connectivity, web, linux, android, and CVE', () => {
    const groups = groupLabPackages([
      { id: 'juice-shop', kindLabel: 'Web', provider: 'docker', surface: 'browser', category: 'web' },
      { id: 'webgoat', kindLabel: 'Web', provider: 'docker', surface: 'browser', category: 'web' },
      { id: 'whoami', kindLabel: '连通性', provider: 'docker', surface: 'shell', category: 'probe' },
      { id: 'android-lab', kindLabel: '安卓', provider: 'android-avd', surface: 'emulator', category: 'android' },
      { id: 'struts2-s2-045', kindLabel: 'CVE', provider: 'docker', surface: 'browser', category: 'cve' },
      { id: 'legacy-box', kindLabel: 'Linux', provider: 'docker', surface: 'shell' },
    ])
    expect(groups.map(group => group.category)).toEqual(['probe', 'web', 'linux', 'android', 'cve'])
    expect(groups[0]?.packages.map(item => item.id)).toEqual(['whoami'])
    expect(groups[1]?.packages.map(item => item.id)).toEqual(['juice-shop', 'webgoat'])
    expect(groups[2]?.packages.map(item => item.id)).toEqual(['legacy-box'])
    expect(groups[3]?.packages.map(item => item.id)).toEqual(['android-lab'])
    expect(groups[4]?.packages.map(item => item.id)).toEqual(['struts2-s2-045'])
    expect(groups.map(group => group.label)).toEqual(['连通性', 'Web', 'Linux', '安卓', 'CVE'])
  })

  it('falls back from provider and kind when category is missing', () => {
    expect(labPackageCategory({
      id: 'android-avd',
      kindLabel: '安卓',
      provider: 'android-avd',
      surface: 'emulator',
    })).toBe('android')
    expect(labPackageCategory({
      id: 'whoami',
      kindLabel: '连通性',
      provider: 'docker',
      surface: 'shell',
    })).toBe('probe')
  })
})
