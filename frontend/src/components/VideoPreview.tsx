import { AlertTriangle, Camera, Eye, EyeOff, Loader2, MonitorUp, Play, Square, VideoOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { CaptureInfo } from '../hooks/useVideoCapture'
import type { LiveStatus, SessionPhase } from '../hooks/useInterpretation'
import type { ConnectionState, Landmarks, Point, RecognitionMode, VideoSource } from '../types/interpretation'
import { SourceSelector } from './SourceSelector'
import { Pill } from './StatusIndicator'

const HAND_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
const POSE_EDGES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]]

function drawLandmarks(canvas: HTMLCanvasElement, lm: Landmarks | null) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr)
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!lm) return
  const line = (pts: Point[], edges: [number, number][], color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const [a, b] of edges) {
      if (!pts[a] || !pts[b]) continue
      ctx.moveTo(pts[a][0] * w, pts[a][1] * h)
      ctx.lineTo(pts[b][0] * w, pts[b][1] * h)
    }
    ctx.stroke()
  }
  const dots = (pts: Point[], color: string, r: number) => {
    ctx.fillStyle = color
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p[0] * w, p[1] * h, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (lm.pose) line(lm.pose, POSE_EDGES, 'rgba(255,255,255,0.55)', 2)
  for (const [hand, color] of [[lm.left_hand, '#f2b66d'], [lm.right_hand, '#7fd1b9']] as const) {
    if (!hand) continue
    line(hand, HAND_EDGES, color, 2)
    dots(hand, color, 2.4)
  }
}

const PROCESSING_TEXT: Record<string, string> = {
  no_signer: 'No signer visible — keep your head and shoulders in frame',
  no_hands: 'Hands not visible — raise your hands into the frame to sign',
  collecting: 'Collecting motion…',
  recognizing: 'Watching for supported signs',
  idle: 'Idle',
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  capture: CaptureInfo
  source: VideoSource
  onSourceChange: (s: VideoSource) => void
  phase: SessionPhase
  mode: RecognitionMode
  connection: ConnectionState
  status: LiveStatus
  showLandmarks: boolean
  onToggleLandmarks: () => void
  landmarksRef: React.RefObject<Landmarks | null>
  landmarkTick: number
  onStart: () => void
  onStop: () => void
}

export function VideoPreview(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const running = p.phase === 'running' || p.phase === 'starting'
  const active = p.capture.state === 'active'
  const mirrored = p.source === 'webcam'

  useEffect(() => {
    const c = canvasRef.current
    if (c) drawLandmarks(c, p.showLandmarks && active ? p.landmarksRef.current : null)
  }, [p.landmarkTick, p.showLandmarks, active, p.landmarksRef])

  const aspect = p.capture.width && p.capture.height ? `${p.capture.width} / ${p.capture.height}` : '4 / 3'
  const perf = p.status.performance

  return (
    <section aria-label="Video" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SourceSelector value={p.source} onChange={p.onSourceChange} disabled={running} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={p.onToggleLandmarks}
            aria-pressed={p.showLandmarks}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            {p.showLandmarks ? <Eye size={15} /> : <EyeOff size={15} />}
            Landmarks
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-[#0f0f0e]" style={{ aspectRatio: aspect }}>
        <div className={`absolute inset-0 ${mirrored ? '-scale-x-100' : ''}`}>
          <video ref={p.videoRef} className={`h-full w-full object-contain ${active ? '' : 'invisible'}`} muted playsInline autoPlay aria-label="Live video preview" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
        </div>

        {!active && <EmptyState capture={p.capture} source={p.source} phase={p.phase} />}

        {active && (
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 pulse-dot" aria-hidden />
              {p.source === 'webcam' ? 'Camera live' : 'Capturing window'}
            </span>
            <span className="rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] text-white/90 backdrop-blur">
              {p.capture.width}×{p.capture.height}
              {perf ? ` · ${perf.processed_fps.toFixed(1)} fps` : ''}
            </span>
          </div>
        )}
        {active && p.connection !== 'connected' && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
            <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur">
              Paused — waiting for the SignBridge backend to reconnect
            </span>
          </div>
        )}
        {active && p.connection === 'connected' && p.status.processing && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
            <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
              {PROCESSING_TEXT[p.status.processing]}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {p.mode === 'simulated' && <Pill tone="warn">SIMULATED DEMO mode selected</Pill>}
          {perf && (
            <>
              <Pill>Processing {perf.processing_ms.toFixed(0)} ms</Pill>
              {p.status.rttMs !== null && <Pill>Round trip {p.status.rttMs.toFixed(0)} ms</Pill>}
              {perf.dropped_frames > 0 && <Pill>{perf.dropped_frames} stale frames dropped</Pill>}
            </>
          )}
          {!perf && <span>Video is processed locally by your SignBridge backend. Nothing is recorded.</span>}
        </div>
        {running ? (
          <button
            type="button"
            onClick={p.onStop}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:bg-canvas"
          >
            <Square size={15} className="fill-current" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onStart}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:text-[#0d1f1a]"
          >
            <Play size={15} className="fill-current" /> Start Interpreting
          </button>
        )}
      </div>
    </section>
  )
}

function EmptyState({ capture, source, phase }: { capture: CaptureInfo; source: VideoSource; phase: SessionPhase }) {
  let icon = source === 'webcam' ? <Camera size={26} /> : <MonitorUp size={26} />
  let title = source === 'webcam' ? 'No camera selected' : 'No meeting window selected'
  let body =
    source === 'webcam'
      ? 'Press Start Interpreting and allow camera access. Sit so your head, shoulders and both hands are visible.'
      : 'Press Start Interpreting and pick the Meet, Zoom or Teams window. Pin or spotlight the signer so they fill most of the frame.'
  if (capture.state === 'requesting' || phase === 'starting') {
    icon = <Loader2 size={26} className="animate-spin" />
    title = source === 'webcam' ? 'Waiting for camera…' : 'Waiting for you to choose a window…'
    body = 'Approve the browser prompt to continue.'
  } else if (capture.error) {
    icon = capture.state === 'ended' ? <VideoOff size={26} /> : <AlertTriangle size={26} />
    title =
      capture.state === 'denied' ? 'Camera permission denied'
      : capture.state === 'cancelled' ? 'Screen sharing cancelled'
      : capture.state === 'unsupported' ? 'Unsupported browser'
      : capture.state === 'ended' ? 'Video source ended'
      : 'Video unavailable'
    body = capture.state === 'ended' ? `${capture.error} Press Start Interpreting to resume.` : capture.error
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/85">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">{icon}</div>
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="max-w-sm text-sm text-white/65">{body}</p>
    </div>
  )
}
