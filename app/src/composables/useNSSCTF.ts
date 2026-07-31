import { ref, watch } from 'vue'
import { invokeCommand } from '@/desktop'
import type { NSSCTFArenaSubmission, NSSCTFArenaWorkspace } from '@/nssctfArenaTypes'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type { NSSCTFWebBridgeStatus, NSSCTFWebSubmission } from '@/nssctfWebTypes'

const STORAGE_KEY = 'milksu.nssctf-imports.v1'

function readChallenges(): NSSCTFChallenge[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '') as {
      schema?: number
      challenges?: NSSCTFChallenge[]
    }
    return value.schema === 1 && Array.isArray(value.challenges) ? value.challenges : []
  } catch {
    return []
  }
}

export function useNSSCTFChallenges() {
  const challenges = ref(readChallenges())
  const importing = ref(false)
  const error = ref<string | null>(null)

  watch(challenges, value => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, challenges: value }))
  }, { deep: true })

  async function importChallenge(urlOrId: string) {
    importing.value = true
    try {
      const challenge = await invokeCommand<NSSCTFChallenge>('import_nssctf_challenge', { url: urlOrId })
      challenges.value = [
        challenge,
        ...challenges.value.filter(item => item.platformId !== challenge.platformId),
      ]
      error.value = null
      return challenge
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      importing.value = false
    }
  }

  function removeChallenge(platformId: number) {
    challenges.value = challenges.value.filter(challenge => challenge.platformId !== platformId)
  }

  return { challenges, importing, error, importChallenge, removeChallenge }
}

export function useNSSCTFArena() {
  const workspace = ref<NSSCTFArenaWorkspace | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function run(command: 'get_nssctf_arena_current' | 'start_nssctf_arena') {
    loading.value = true
    try {
      workspace.value = await invokeCommand<NSSCTFArenaWorkspace>(command)
      error.value = null
      return workspace.value
    } catch (reason) {
      error.value = String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function submit(jobId: string, attemptId: number, candidate: string) {
    loading.value = true
    try {
      const result = await invokeCommand<NSSCTFArenaSubmission>('submit_nssctf_arena_flag', {
        jobId,
        attemptId,
        candidate,
      })
      workspace.value = { arena: result.arena, ctf: result.ctf }
      error.value = null
      return result
    } catch (reason) {
      error.value = String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function abandon(jobId: string, attemptId: number) {
    loading.value = true
    try {
      workspace.value = await invokeCommand<NSSCTFArenaWorkspace>('abandon_nssctf_arena', { jobId, attemptId })
      error.value = null
      return workspace.value
    } catch (reason) {
      error.value = String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    workspace,
    loading,
    error,
    refresh: () => run('get_nssctf_arena_current'),
    start: () => run('start_nssctf_arena'),
    submit,
    abandon,
    openArena: () => invokeCommand('open_nssctf_arena'),
  }
}

export function useNSSCTFWebBridge() {
  const status = ref<NSSCTFWebBridgeStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    try {
      status.value = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
      error.value = null
      return status.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function submit(jobId: string, candidate: string) {
    loading.value = true
    try {
      const result = await invokeCommand<NSSCTFWebSubmission>('submit_nssctf_web_flag', {
        jobId,
        candidate,
      })
      error.value = null
      await refresh()
      return result
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  return { status, loading, error, refresh, submit }
}
