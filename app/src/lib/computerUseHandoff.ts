export type ComputerUseReveal = {
  preferEmulator: boolean
}

let pending: ComputerUseReveal | null = null

export function requestComputerUseReveal(next: ComputerUseReveal = { preferEmulator: false }) {
  pending = next
}

export function takeComputerUseReveal(): ComputerUseReveal | null {
  const value = pending
  pending = null
  return value
}
