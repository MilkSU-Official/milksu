import { ref } from 'vue'
import { invokeCommand } from '@/desktop'
import type {
  HTBCTFContainer,
  HTBCTFDetails,
  HTBCTFEvent,
  HTBCTFSubmission,
  HTBCTFWorkspace,
} from '@/ctfPlatformTypes'
import type { CTFCollaborationMode } from '@/ctfTypes'

export function useHTBCTF() {
  const events = ref<HTBCTFEvent[]>([])
  const details = ref<HTBCTFDetails | null>(null)
  const selectedEventId = ref<number | null>(null)
  const loading = ref(false)
  const starting = ref(false)
  const judging = ref(false)
  const container = ref<HTBCTFContainer | null>(null)
  const error = ref<string | null>(null)

  async function loadEvent(id: number) {
    selectedEventId.value = id
    loading.value = true
    error.value = null
    try {
      details.value = await invokeCommand<HTBCTFDetails>('get_htb_ctf_event', { id })
      return details.value
    } catch (reason) {
      details.value = null
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function loadEvents() {
    loading.value = true
    error.value = null
    try {
      events.value = await invokeCommand<HTBCTFEvent[]>('list_htb_ctf_events')
      const preferred = events.value.find(event => (
        event.status?.toLowerCase() === 'ongoing'
        && (event.hasJoined || event.canPlay)
      )) ?? events.value.find(event => event.status?.toLowerCase() === 'ongoing')
        ?? events.value[0]
      if (preferred) {
        selectedEventId.value = preferred.id
        details.value = await invokeCommand<HTBCTFDetails>('get_htb_ctf_event', {
          id: preferred.id,
        })
      } else {
        selectedEventId.value = null
        details.value = null
      }
      return events.value
    } catch (reason) {
      events.value = []
      details.value = null
      error.value = reason instanceof Error ? reason.message : String(reason)
      return []
    } finally {
      loading.value = false
    }
  }

  async function startChallenge(
    ctfId: number,
    challengeId: number,
    collaborationMode: CTFCollaborationMode,
  ) {
    starting.value = true
    error.value = null
    try {
      const workspace = await invokeCommand<HTBCTFWorkspace>('start_htb_ctf_challenge', {
        ctfId,
        challengeId,
        collaborationMode,
      })
      container.value = workspace.container ?? null
      return workspace
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      starting.value = false
    }
  }

  async function refreshContainer(jobId: string) {
    error.value = null
    try {
      container.value = await invokeCommand<HTBCTFContainer>(
        'get_htb_ctf_container_status',
        { jobId },
      )
      return container.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    }
  }

  async function stopContainer(jobId: string) {
    error.value = null
    try {
      container.value = await invokeCommand<HTBCTFContainer>(
        'stop_htb_ctf_container',
        { jobId },
      )
      return container.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    }
  }

  async function submitFlag(jobId: string, candidate: string) {
    judging.value = true
    error.value = null
    try {
      return await invokeCommand<HTBCTFSubmission>('submit_htb_ctf_flag', {
        jobId,
        candidate,
      })
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      judging.value = false
    }
  }

  return {
    events,
    details,
    selectedEventId,
    loading,
    starting,
    judging,
    container,
    error,
    loadEvents,
    loadEvent,
    startChallenge,
    refreshContainer,
    stopContainer,
    submitFlag,
  }
}
