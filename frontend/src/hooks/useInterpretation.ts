import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_URL } from '../services/api'
import { FrameTransport } from '../services/videoTransport'
import type {
  HistoryEvent,
  Landmarks,
  Performance,
  Prediction,
  ProcessingState,
  RecognitionMode,
  ServerMessage,
  Settings,
  SpeechStatus,
} from '../types/interpretation'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useVideoCapture } from './useVideoCapture'
import { useWebSocket } from './useWebSocket'

export type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping'

export interface LiveStatus {
  processing: ProcessingState | null
  handsVisible: number
  performance: Performance | null
  rttMs: number | null
  frameSize: [number, number] | null
}

export interface Caption {
  english: string
  label: string
  score: number
  simulated: boolean
  at: number
  glosses?: string[]
}

export interface RecognizedSign {
  label: string
  score: number
  pending: string[]
  at: number
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function useInterpretation(settings: Settings) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const capture = useVideoCapture(videoRef)
  const speech = useSpeechSynthesis({ enabled: settings.audioEnabled, rate: settings.speechRate, voiceURI: settings.voiceURI })

  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [activeMode, setActiveMode] = useState<RecognitionMode | null>(null)
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [caption, setCaption] = useState<Caption | null>(null)
  const [partial, setPartial] = useState<{ prediction: Prediction; top: [string, number][] } | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [lastSign, setLastSign] = useState<RecognizedSign | null>(null)
  const [status, setStatus] = useState<LiveStatus>({ processing: null, handsVisible: 0, performance: null, rttMs: null, frameSize: null })
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const landmarksRef = useRef<Landmarks | null>(null)
  const [landmarkTick, setLandmarkTick] = useState(0)

  const sessionId = useRef<string | null>(null)
  const transport = useRef<FrameTransport | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const rttAvg = useRef<number | null>(null)

  const setSpeechStatus = useCallback((id: string, s: SpeechStatus) => {
    setHistory((h) => h.map((e) => (e.id === id ? { ...e, speech: s } : e)))
  }, [])

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === 'pong') return
      // Drop anything from a previous session.
      if ('session_id' in msg && msg.session_id && msg.session_id !== sessionId.current) return
      switch (msg.type) {
        case 'session.started':
          setActiveMode(msg.mode === 'record' ? null : msg.mode)
          setPhase('running')
          setError(null)
          transport.current?.start()
          break
        case 'session.stopped':
          break
        case 'processing.status': {
          const rtt = transport.current?.ack(msg.sequence) ?? null
          if (rtt !== null) rttAvg.current = rttAvg.current === null ? rtt : rttAvg.current * 0.8 + rtt * 0.2
          landmarksRef.current = msg.landmarks
          setLandmarkTick((t) => (t + 1) % 1_000_000)
          setStatus({
            processing: msg.state,
            handsVisible: msg.hands_visible,
            performance: msg.performance,
            rttMs: rttAvg.current,
            frameSize: [msg.frame_width, msg.frame_height],
          })
          if (msg.state === 'no_hands' || msg.state === 'no_signer') setPartial(null)
          break
        }
        case 'recognition.partial':
          setPartial({ prediction: msg.prediction, top: msg.top })
          setUnknown(false)
          break
        case 'recognition.unknown':
          if (msg.reason === 'unsupported_sign') {
            setPartial(null)
            setUnknown(true)
          }
          break
        case 'recognition.sign':
          // An individual sign while phrases are matched: shown, never spoken or logged.
          setLastSign({ label: msg.label, score: msg.score, pending: msg.pending, at: Date.now() })
          break
        case 'recognition.result': {
          const id = `${msg.session_id}-${msg.event_id}`
          const simulated = Boolean(msg.simulated)
          const glosses = msg.glosses ?? undefined
          const ev: HistoryEvent = {
            id,
            eventId: msg.event_id,
            time: Date.now(),
            label: msg.prediction.label,
            english: msg.prediction.english,
            score: msg.prediction.score,
            simulated,
            speech: 'queued',
            glosses,
            phrase: Boolean(msg.phrase_id),
          }
          setCaption({ english: ev.english, label: ev.label, score: ev.score, simulated, at: ev.time, glosses })
          setLastSign((s) => (s ? { ...s, pending: [] } : s))
          setUnknown(false)
          const s = settingsRef.current
          if (!speech.supported) ev.speech = 'unavailable'
          else if (!s.audioEnabled) ev.speech = 'muted'
          setHistory((h) => [ev, ...h].slice(0, 200))
          if (ev.speech === 'queued') {
            speech.speak(ev.english, (ok) => setSpeechStatus(id, ok ? 'spoken' : 'skipped'))
          }
          break
        }
        case 'error':
          setError({ code: msg.code, message: msg.message })
          if (!msg.recoverable || msg.code === 'model_unavailable' || msg.code === 'landmarker_unavailable' || msg.code === 'invalid_config') {
            transport.current?.stop()
            capture.stop()
            sessionId.current = null
            setPhase('idle')
          }
          break
      }
    },
    [capture, setSpeechStatus, speech],
  )

  const sendStart = useRef<() => void>(() => undefined)
  const ws = useWebSocket(WS_URL, onMessage, () => {
    // Reconnected while a session was running: start a fresh session.
    if (phaseRef.current === 'running' || phaseRef.current === 'starting') sendStart.current()
  })

  sendStart.current = () => {
    const s = settingsRef.current
    const id = uuid()
    sessionId.current = id
    transport.current?.stop()
    ws.sendJSON({
      type: 'session.start',
      session_id: id,
      source: s.source,
      mode: s.mode,
      target_fps: s.targetFps,
      enable_landmarks: s.showLandmarks,
      enable_tts: s.audioEnabled,
      threshold: s.threshold,
    })
  }

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return
    setError(null)
    setPhase('starting')
    const ok = await capture.start(settingsRef.current.source)
    if (!ok) {
      setPhase('idle')
      return
    }
    const v = videoRef.current
    if (!v) return
    transport.current = new FrameTransport({
      video: v,
      send: ws.sendBinary,
      getFps: () => settingsRef.current.targetFps,
    })
    if (ws.state !== 'connected') {
      setError({ code: 'backend_disconnected', message: 'Waiting for the SignBridge backend… frames will be sent once it reconnects.' })
      ws.reconnectNow()
      return // onOpen will send session.start
    }
    sendStart.current()
  }, [capture, ws])

  const stop = useCallback(() => {
    const id = sessionId.current
    transport.current?.stop()
    transport.current = null
    if (id) ws.sendJSON({ type: 'session.stop', session_id: id })
    sessionId.current = null
    capture.stop()
    speech.cancel()
    landmarksRef.current = null
    setPartial(null)
    setUnknown(false)
    setLastSign(null)
    setActiveMode(null)
    setStatus({ processing: null, handsVisible: 0, performance: null, rttMs: null, frameSize: null })
    rttAvg.current = null
    setPhase('idle')
  }, [capture, speech, ws])

  // Capture ended by the browser (user clicked "Stop sharing", camera unplugged).
  useEffect(() => {
    capture.setOnEnded(() => {
      const id = sessionId.current
      transport.current?.stop()
      transport.current = null
      if (id) ws.sendJSON({ type: 'session.stop', session_id: id })
      sessionId.current = null
      setPartial(null)
      setActiveMode(null)
      setPhase('idle')
    })
  }, [capture, ws])

  // Backend dropped mid-session: pause sending; onOpen restarts the session.
  useEffect(() => {
    if (ws.state === 'connected') return
    transport.current?.stop()
    // Don't show stale recognition state while nothing is being processed.
    landmarksRef.current = null
    setLandmarkTick((t) => (t + 1) % 1_000_000)
    setPartial(null)
    setUnknown(false)
    setStatus((s) => ({ ...s, processing: null, performance: null, rttMs: null }))
    rttAvg.current = null
  }, [ws.state])

  // Live config updates.
  useEffect(() => {
    if (sessionId.current && phase === 'running')
      ws.sendJSON({ type: 'config.update', session_id: sessionId.current, threshold: settings.threshold, enable_landmarks: settings.showLandmarks })
  }, [settings.threshold, settings.showLandmarks, phase, ws])

  const clearHistory = useCallback(() => {
    setHistory([])
    setCaption(null)
    setLastSign(null)
  }, [])

  return {
    videoRef,
    capture: capture.info,
    connection: ws.state,
    reconnect: ws.reconnectNow,
    phase,
    activeMode,
    history,
    caption,
    partial,
    unknown,
    lastSign,
    status,
    error,
    dismissError: () => setError(null),
    landmarksRef,
    landmarkTick,
    speech,
    start,
    stop,
    clearHistory,
  }
}
