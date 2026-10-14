import { lookPath, runHosted } from './paths.ts'

export const MAXIMUM_REPORTED_LISTENING_PORTS = 16

export function parseListeningPorts(output: string): number[] {
  const seen = new Set<number>()
  for (const line of output.split('\n')) {
    if (!line.startsWith('n')) continue
    const name = line.slice(1).trim()
    const separator = name.lastIndexOf(':')
    if (separator < 0 || separator === name.length - 1) continue
    const port = Number.parseInt(name.slice(separator + 1), 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue
    seen.add(port)
  }
  const ports = [...seen].sort((a, b) => a - b)
  return ports.slice(0, MAXIMUM_REPORTED_LISTENING_PORTS)
}

export async function listeningPorts(pid: number, processGroupID: number, timeoutMs = 350): Promise<number[]> {
  let targetFlag = '-p'
  let targetID = pid
  if (processGroupID > 0) {
    targetFlag = '-g'
    targetID = processGroupID
  }
  if (targetID <= 0) return []
  const lsof = await lookPath('lsof')
  if (!lsof) return []
  try {
    const result = await runHosted(
      lsof,
      ['-nP', '-a', targetFlag, String(targetID), '-iTCP', '-sTCP:LISTEN', '-Fn'],
      { timeoutMs },
    )
    if (result.code !== 0) return []
    return parseListeningPorts(result.output)
  } catch {
    return []
  }
}
