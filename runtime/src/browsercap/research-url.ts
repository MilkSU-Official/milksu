import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

export type ResearchAddressLookup = (host: string) => Promise<string[]>

const blocked = new BlockList()
blocked.addSubnet('0.0.0.0', 8, 'ipv4')
blocked.addSubnet('10.0.0.0', 8, 'ipv4')
blocked.addSubnet('100.64.0.0', 10, 'ipv4')
blocked.addSubnet('127.0.0.0', 8, 'ipv4')
blocked.addSubnet('169.254.0.0', 16, 'ipv4')
blocked.addSubnet('172.16.0.0', 12, 'ipv4')
blocked.addSubnet('192.0.0.0', 24, 'ipv4')
blocked.addSubnet('192.0.2.0', 24, 'ipv4')
blocked.addSubnet('192.168.0.0', 16, 'ipv4')
blocked.addSubnet('198.18.0.0', 15, 'ipv4')
blocked.addSubnet('198.51.100.0', 24, 'ipv4')
blocked.addSubnet('203.0.113.0', 24, 'ipv4')
blocked.addSubnet('224.0.0.0', 4, 'ipv4')
blocked.addSubnet('240.0.0.0', 4, 'ipv4')
blocked.addSubnet('::1', 128, 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
blocked.addSubnet('ff00::', 8, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('3fff::', 20, 'ipv6')

const globalUnicastV6 = new BlockList()
globalUnicastV6.addSubnet('2000::', 3, 'ipv6')

export async function validateResearchBrowserURL(
  raw: string,
  resolve: ResearchAddressLookup = lookupAddresses,
): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('invalid research Browser URL')
  }
  const scheme = parsed.protocol.replace(/:$/u, '').toLowerCase()
  if ((scheme !== 'http' && scheme !== 'https') || !parsed.host || !parsed.hostname) {
    throw new Error('research Browser fallback requires an absolute HTTP(S) URL')
  }
  if (parsed.username || parsed.password) {
    throw new Error('research Browser URL cannot include credentials')
  }
  const host = parsed.hostname.replace(/\.$/u, '').toLowerCase()
  if (host.includes('%')) {
    throw new Error('research Browser fallback cannot open a zoned IP address')
  }
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
  ) {
    throw new Error('research Browser fallback cannot open a local or internal host')
  }
  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    if (!host.includes('.') || trimNumericHost(host) === '' || host.startsWith('0x')) {
      throw new Error('research Browser fallback cannot open a local or non-standard numeric host')
    }
    try {
      addresses = await resolve(host)
    } catch {
      throw new Error('research Browser fallback could not verify the host')
    }
    if (!addresses.length) throw new Error('research Browser fallback could not verify the host')
  }
  for (const address of addresses) {
    if (isNonPublicResearchIP(address)) {
      throw new Error('research Browser fallback cannot open a private IP address')
    }
  }
  parsed.protocol = `${scheme}:`
  return parsed.toString()
}

function trimNumericHost(host: string): string {
  const cutset = '0123456789.'
  let start = 0
  let end = host.length
  while (start < end && cutset.includes(host[start]!)) start += 1
  while (end > start && cutset.includes(host[end - 1]!)) end -= 1
  return host.slice(start, end)
}

export function isNonPublicResearchIP(address: string): boolean {
  const version = isIP(address)
  if (!version) return true
  const family = version === 4 ? 'ipv4' : 'ipv6'
  if (blocked.check(address, family)) return true
  if (family === 'ipv6' && !globalUnicastV6.check(address, 'ipv6')) return true
  return false
}

async function lookupAddresses(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true })
  return records.map((record) => record.address)
}
