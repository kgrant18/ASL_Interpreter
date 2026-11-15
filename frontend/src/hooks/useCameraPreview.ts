import { useEffect, useRef, useState } from 'react'

/**
 * Display-only camera preview from the browser's own camera stream.
 *
 * Recognition does NOT use this: the backend keeps reading the camera itself. This only
 * makes the framing view smooth. It asks for the same 640x480 format the backend uses, so
 * macOS doesn't switch the camera's format under the backend or Zoom.
 *
 * - Picks the same physical camera as the backend (`cameraIndex`, AVFoundation order;
 *   index 0 prefers the built-in FaceTime camera over an iPhone Continuity Camera).
 * - Stops the stream while the tab is hidden, so it never competes with Zoom.
 * - `failed` = the browser could not open the camera; callers fall back to snapshots.
 */

export type PreviewState = 'idle' | 'starting' | 'live' | 'failed'

const CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }

export function pickCamera(devices: MediaDeviceInfo[], index: number): string | null {
  const cams = devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
  if (cams.length === 0) return null
  if (index === 0) {
    const builtIn = cams.find((d) => /facetime|built-?in|integrated/i.test(d.label))
    if (builtIn) return builtIn.deviceId
  }
  return (cams[index] ?? cams[0]).deviceId
}

export function useCameraPreview(enabled: boolean, cameraIndex: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [state, setState] = useState<PreviewState>('idle')
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    const onVis = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!enabled || !visible) {
      setState((s) => (s === 'failed' ? s : 'idle'))
      return
    }
    if (!md?.getUserMedia) {
      setState('failed')
      return
    }
    let stream: MediaStream | null = null
    let cancelled = false
    const stop = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop())

    const run = async () => {
      setState('starting')
      try {
        stream = await md.getUserMedia({ video: CONSTRAINTS, audio: false })
        if (cancelled) return stop(stream)
        // Labels are readable only after permission: switch to the backend's camera if needed.
        if (typeof md.enumerateDevices === 'function') {
          const want = pickCamera(await md.enumerateDevices(), cameraIndex)
          const have = stream.getVideoTracks()[0]?.getSettings?.().deviceId
          if (want && have && want !== have) {
            stop(stream)
            stream = await md.getUserMedia({ video: { ...CONSTRAINTS, deviceId: { exact: want } }, audio: false })
            if (cancelled) return stop(stream)
          }
        }
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        setState('live')
      } catch {
        stop(stream)
        stream = null
        if (!cancelled) setState('failed')
      }
    }
    void run()
    return () => {
      cancelled = true
      stop(stream)
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [enabled, visible, cameraIndex])

  return { videoRef, state }
}
