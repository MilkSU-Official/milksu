import { createStore } from '@/lib/reactStore'
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
  const store = createStore({
    challenges: readChallenges(),
    importing: false,
    error: null as string | null,
  })
  const s = {
    get challenges() { return store.getState().challenges },
    set challenges(value) { store.setState({ challenges: value }) },
    get importing() { return store.getState().importing },
    set importing(value) { store.setState({ importing: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }


  store.subscribe(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, challenges: store.getState().challenges }))
  })

  async function importChallenge(urlOrId: string) {
    s.importing = true
    try {
      const challenge = await invokeCommand<NSSCTFChallenge>('import_nssctf_challenge', { url: urlOrId })
      s.challenges = [
        challenge,
        ...s.challenges.filter(item => item.platformId !== challenge.platformId),
      ]
      s.error = null
      return challenge
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.importing = false
    }
  }

  function removeChallenge(platformId: number) {
    s.challenges = s.challenges.filter(challenge => challenge.platformId !== platformId)
  }

  return {
    store,
    get challenges() { return s.challenges },
    get importing() { return s.importing },
    get error() { return s.error },
    importChallenge,
    removeChallenge,
  }
}

export function useNSSCTFArena() {
  const store = createStore({
    workspace: null as NSSCTFArenaWorkspace | null,
    loading: false,
    error: null as string | null,
  })
  const s = {
    get workspace() { return store.getState().workspace },
    set workspace(value) { store.setState({ workspace: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }


  async function run(command: 'get_nssctf_arena_current' | 'start_nssctf_arena') {
    s.loading = true
    try {
      s.workspace = await invokeCommand<NSSCTFArenaWorkspace>(command)
      s.error = null
      return s.workspace
    } catch (reason) {
      s.error = String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  async function submit(jobId: string, attemptId: number, candidate: string) {
    s.loading = true
    try {
      const result = await invokeCommand<NSSCTFArenaSubmission>('submit_nssctf_arena_flag', {
        jobId,
        attemptId,
        candidate,
      })
      s.workspace = { arena: result.arena, ctf: result.ctf }
      s.error = null
      return result
    } catch (reason) {
      s.error = String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  async function abandon(jobId: string, attemptId: number) {
    s.loading = true
    try {
      s.workspace = await invokeCommand<NSSCTFArenaWorkspace>('abandon_nssctf_arena', { jobId, attemptId })
      s.error = null
      return s.workspace
    } catch (reason) {
      s.error = String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  return {
    store,
    get workspace() { return s.workspace },
    set workspace(value) { s.workspace = value },
    get loading() { return s.loading },
    set loading(value) { s.loading = value },
    get error() { return s.error },
    set error(value) { s.error = value },
    refresh: () => run('get_nssctf_arena_current'),
    start: () => run('start_nssctf_arena'),
    submit,
    abandon,
    openArena: () => invokeCommand('open_nssctf_arena'),
  }
}

export function useNSSCTFWebBridge() {
  const store = createStore({
    status: null as NSSCTFWebBridgeStatus | null,
    loading: false,
    error: null as string | null,
  })
  const s = {
    get status() { return store.getState().status },
    set status(value) { store.setState({ status: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }


  async function refresh() {
    s.loading = true
    try {
      s.status = await invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status')
      s.error = null
      return s.status
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  async function submit(jobId: string, candidate: string) {
    s.loading = true
    try {
      const result = await invokeCommand<NSSCTFWebSubmission>('submit_nssctf_web_flag', {
        jobId,
        candidate,
      })
      s.error = null
      await refresh()
      return result
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  return {
    store,
    get status() { return s.status },
    get loading() { return s.loading },
    get error() { return s.error },
    refresh,
    submit,
  }
}
