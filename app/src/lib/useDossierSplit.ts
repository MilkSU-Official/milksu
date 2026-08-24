import { ref } from 'vue'

const MIN_WIDTH = 280
const MAX_RATIO = 0.62

function readWidth(storageKey: string, fallback: number) {
  try {
    const raw = Number(localStorage.getItem(storageKey))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH) return raw
  } catch {
    // private mode
  }
  return fallback
}

function splitContainer(handle: HTMLElement) {
  return handle.closest('[data-dossier-split]') as HTMLElement | null
    ?? handle.parentElement
}

export function useDossierSplit(storageKey: string, defaultWidth = 400) {
  const width = ref(readWidth(storageKey, defaultWidth))

  function startResize(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    const parent = splitContainer(handle)
    const originX = event.clientX
    const originWidth = width.value
    const move = (next: PointerEvent) => {
      const max = parent ? Math.max(MIN_WIDTH, Math.round(parent.clientWidth * MAX_RATIO)) : 720
      width.value = Math.min(max, Math.max(MIN_WIDTH, originWidth + (next.clientX - originX)))
    }
    const up = () => {
      handle.releasePointerCapture(event.pointerId)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      try {
        localStorage.setItem(storageKey, String(width.value))
      } catch {
        // private mode
      }
    }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return { width, startResize }
}
