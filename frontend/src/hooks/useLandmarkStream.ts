import { useEffect, useState } from 'react'
import type { Landmarks } from '../lib/skeleton'
import { BACKEND_URL } from '../services/api'

const POLL_MS = 80 // ~12 per second; the backend produces ~11-15 frames per second
const STALE_MS = 700 // hide the overlay quietly if nothing new arrives for this long

/**
 * Latest backend landmarks for the skeleton overlay (display only), or null when
 * there are none or they are stale. Polls only while `enabled` and the tab is visible.
 * Errors are silent: the overlay just disappears.
 */
export function useLandmarkStream(enabled: boolean): Landmarks | null {
  const [lm, setLm] = useState<Landmarks | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLm(null)
      return
    }
    let stopped = false
    let busy = false
    let lastNewAt = 0
    let lastTs = -1
    const tick = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const res = await fetch(`${BACKEND_URL}/api/background/landmarks`, { cache: 'no-store' })
        const data = res.ok ? ((await res.json()) as { landmarks?: Landmarks | null }) : null
        if (stopped) return
        const next = data?.landmarks ?? null
        const now = Date.now()
        if (next && next.timestamp_ms !== lastTs) {
          lastTs = next.timestamp_ms
          lastNewAt = now
          setLm(next)
        } else if (now - lastNewAt > STALE_MS) {
          setLm(null)
        }
      } catch {
        if (!stopped && Date.now() - lastNewAt > STALE_MS) setLm(null)
      } finally {
        busy = false
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [enabled])

  return lm
}
