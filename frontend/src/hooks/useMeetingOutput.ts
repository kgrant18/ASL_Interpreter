import { useCallback, useEffect, useRef, useState } from 'react'
import { composePhrase } from '../lib/phrase'
import { meetingApi, type MeetingConfig, type MeetingStatus } from '../services/meetingApi'
import type { HistoryEvent, ProcessingState } from '../types/interpretation'

export type SendMode = 'sign' | 'phrase'

export interface PendingPhrase {
  labels: string[]
  english: string[]
}

/**
 * Bridges recognized captions to the backend meeting output.
 * Never sends simulated captions. Mute shortcut: Ctrl/Cmd+Shift+M.
 */
export function useMeetingOutput(opts: { connected: boolean; sendMode: SendMode; phrasePauseMs: number }) {
  const [status, setStatus] = useState<MeetingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingPhrase>({ labels: [], english: [] })
  const pendingRef = useRef<PendingPhrase>({ labels: [], english: [] })
  const timer = useRef<number | null>(null)
  const seen = useRef<Set<string>>(new Set())
  const optsRef = useRef(opts)
  optsRef.current = opts
  const enabled = Boolean(status?.config.enabled)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const refresh = useCallback(async () => {
    try {
      setStatus(await meetingApi.status())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    if (!opts.connected) {
      setStatus(null)
      return
    }
    void refresh()
    const t = window.setInterval(() => void refresh(), enabled ? 1500 : 4000)
    return () => clearInterval(t)
  }, [opts.connected, enabled, refresh])

  const run = useCallback(async (fn: () => Promise<MeetingStatus>) => {
    try {
      setStatus(await fn())
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [])

  const clearPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pendingRef.current = { labels: [], english: [] }
    setPending(pendingRef.current)
  }, [])

  const sendText = useCallback(
    async (text: string, source: 'recognition' | 'typed' | 'test') => {
      if (!text.trim()) return false
      try {
        const r = await meetingApi.send(text, source)
        setStatus(r.status)
        setError(null)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [],
  )

  const flush = useCallback(() => {
    const p = pendingRef.current
    clearPending()
    if (p.english.length && enabledRef.current) void sendText(composePhrase(p.english), 'recognition')
  }, [clearPending, sendText])

  /** Feed every new history event here. */
  const handleEvent = useCallback(
    (ev: HistoryEvent) => {
      if (seen.current.has(ev.id)) return
      seen.current.add(ev.id)
      if (seen.current.size > 500) seen.current = new Set([ev.id])
      if (ev.simulated || !enabledRef.current) return
      if (optsRef.current.sendMode === 'sign') {
        void sendText(ev.english, 'recognition')
        return
      }
      pendingRef.current = { labels: [...pendingRef.current.labels, ev.label], english: [...pendingRef.current.english, ev.english] }
      setPending(pendingRef.current)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, optsRef.current.phrasePauseMs)
    },
    [flush, sendText],
  )

  /** Signer left the frame -> end of phrase. */
  const handleProcessing = useCallback(
    (state: ProcessingState | null) => {
      if (state === 'no_signer' && pendingRef.current.english.length) flush()
    },
    [flush],
  )

  const mute = useCallback(async () => {
    clearPending()
    await run(meetingApi.mute)
  }, [clearPending, run])

  const setConfig = useCallback(
    (patch: Partial<MeetingConfig>) => {
      if (patch.enabled === false) clearPending()
      return run(() => meetingApi.config(patch))
    },
    [clearPending, run],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        if (enabledRef.current) void mute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mute])

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  return {
    status,
    error,
    enabled,
    pending,
    handleEvent,
    handleProcessing,
    flush,
    clearPending,
    mute,
    setConfig,
    sendText,
    setZoomToken: (t: string | null) => run(() => meetingApi.zoomToken(t)),
    virtualMic: (a: 'create' | 'remove') => run(() => meetingApi.virtualMic(a)),
    dismissError: () => setError(null),
  }
}
