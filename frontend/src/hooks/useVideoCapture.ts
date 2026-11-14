import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureState, VideoSource } from '../types/interpretation'

export interface CaptureInfo {
  state: CaptureState
  error: string | null
  width: number
  height: number
  label: string | null
}

export function captureSupport(source: VideoSource): boolean {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!md) return false
  return source === 'webcam' ? typeof md.getUserMedia === 'function' : typeof md.getDisplayMedia === 'function'
}

function describeError(err: unknown, source: VideoSource): { state: CaptureState; message: string } {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return source === 'meeting'
      ? { state: 'cancelled', message: 'Screen sharing was cancelled or blocked. Click Start and choose the meeting tab or window.' }
      : { state: 'denied', message: 'Camera permission was denied. Allow camera access in the browser address bar, then try again.' }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return { state: 'error', message: 'No camera was found. Connect a webcam or switch to Meeting mode.' }
  if (name === 'NotReadableError')
    return { state: 'error', message: 'The camera is in use by another application. Close it (or leave the call camera off) and retry.' }
  return { state: 'error', message: 'Could not start video capture. Check your device and browser permissions.' }
}

/** Owns the MediaStream; guarantees all tracks are stopped on stop/unmount. */
export function useVideoCapture(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null)
  const [info, setInfo] = useState<CaptureInfo>({ state: 'idle', error: null, width: 0, height: 0, label: null })
  const onEndedRef = useRef<(() => void) | null>(null)

  const stop = useCallback((next: CaptureState = 'idle') => {
    const s = streamRef.current
    streamRef.current = null
    s?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    if (videoRef.current) videoRef.current.srcObject = null
    setInfo((i) => ({ ...i, state: next, width: 0, height: 0, label: null, error: next === 'ended' ? i.error : null }))
  }, [videoRef])

  const start = useCallback(
    async (source: VideoSource): Promise<boolean> => {
      if (!captureSupport(source)) {
        setInfo({ state: 'unsupported', error: source === 'meeting'
          ? 'This browser cannot capture tabs or windows. Use a recent Chrome, Edge or Firefox on desktop.'
          : 'This browser does not support camera capture. Use a recent Chrome, Edge or Firefox over http://localhost.', width: 0, height: 0, label: null })
        return false
      }
      stop()
      setInfo({ state: 'requesting', error: null, width: 0, height: 0, label: null })
      try {
        const stream =
          source === 'webcam'
            ? await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
                audio: false,
              })
            : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false })
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        track.onended = () => {
          setInfo((i) => ({ ...i, error: source === 'meeting' ? 'Screen sharing ended.' : 'The camera was disconnected.' }))
          stop('ended')
          onEndedRef.current?.()
        }
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        const st = track.getSettings()
        setInfo({ state: 'active', error: null, width: st.width ?? v?.videoWidth ?? 0, height: st.height ?? v?.videoHeight ?? 0, label: track.label || null })
        return true
      } catch (err) {
        const d = describeError(err, source)
        setInfo({ state: d.state, error: d.message, width: 0, height: 0, label: null })
        return false
      }
    },
    [stop, videoRef],
  )

  // Keep resolution up to date (display capture can be resized).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onResize = () => setInfo((i) => (i.state === 'active' ? { ...i, width: v.videoWidth, height: v.videoHeight } : i))
    v.addEventListener('resize', onResize)
    return () => v.removeEventListener('resize', onResize)
  }, [videoRef])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const setOnEnded = useCallback((fn: (() => void) | null) => {
    onEndedRef.current = fn
  }, [])

  return { info, start, stop, setOnEnded, streamRef }
}
