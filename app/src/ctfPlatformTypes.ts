export type CTFPlatformIntegrationStatus = 'ready' | 'planned' | 'restricted'

export interface CTFTrainingPlatform {
  id: 'nssctf' | 'ctfshow' | 'hackthebox' | 'tryhackme'
  name: string
  experience:
    | 'competition-and-challenge-library'
    | 'challenge-library'
    | 'interactive-lab'
    | 'guided-room-and-interactive-lab'
  status: CTFPlatformIntegrationStatus
  adapter: string
  selectable: boolean
  capabilities: string[]
  requirement?: string
  sourceUrl: string
}
