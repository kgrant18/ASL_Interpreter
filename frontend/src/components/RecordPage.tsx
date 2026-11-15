import { ArrowLeft, Circle, Pause, Play, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useVideoCapture } from '../hooks/useVideoCapture'
import { useWebSocket } from '../hooks/useWebSocket'
import { BACKEND_URL, WS_URL } from '../services/api'
import { FrameTransport } from '../services/videoTransport'
import type { Landmarks, ServerMessage } from '../types/interpretation'

/** Signs to record, with the take length. `_IDLE` = everyday non-signing motion. */
const RECORD_TARGETS: { label: string; title: string; goal: number; takeMs: number }[] = [
  { label: 'NICE', title: 'NICE', goal: 25, takeMs: 3000 },
  { label: 'MISS', title: 'MISS', goal: 25, takeMs: 3000 },
  { label: 'YOU', title: 'YOU', goal: 25, takeMs: 3000 },
  { label: 'HELLO', title: 'HELLO', goal: 25, takeMs: 3000 },
  { label: 'ME', title: 'ME', goal: 25, takeMs: 3000 },
  { label: 'IDEA', title: 'IDEA', goal: 25, takeMs: 3000 },
  { label: '_IDLE', title: 'Idle (not signing)', goal: 30, takeMs: 4000 },
]

const IDLE_PROMPTS = [
  'Hands resting in your lap or on the desk',
  'Talk out loud without signing, small natural gestures',
  'Adjust your hair or glasses',
  'Scratch your face or touch your chin',
  'Reach for the mouse or keyboard',
  'Nod, look around, shift in your chair',
]

const COUNT_STEP_MS = 800
const MIN_SHOULDER_WIDTH = 0.12 // image heights; matches the backend check

/** Shoulder width in image heights from overlay landmarks (x is normalized by width). */
function shoulderWidth(lm: Landmarks | null, aspect: number): number | null {
  const p = lm?.pose
  if (!p || p.length < 13) return null
  return Math.hypot((p[11][0] - p[12][0]) * aspect, p[11][1] - p[12][1])
}

const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]]

function drawOverlay(canvas: HTMLCanvasElement, lm: Landmarks | null) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = (canvas.width = canvas.clientWidth)
  const h = (canvas.height = canvas.clientHeight)
  ctx.clearRect(0, 0, w, h)
  if (!lm) return
  // the preview is mirrored, so mirror the overlay too
  const X = (x: number) => (1 - x) * w
  const line = (pts: [number, number][], links: number[][], color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    for (const [a, b] of links) {
      if (!pts[a] || !pts[b]) continue
      ctx.beginPath()
      ctx.moveTo(X(pts[a][0]), pts[a][1] * h)
      ctx.lineTo(X(pts[b][0]), pts[b][1] * h)
      ctx.stroke()
    }
    ctx.fillStyle = color
    for (const p of pts) ctx.fillRect(X(p[0]) - 2, p[1] * h - 2, 4, 4)
  }
  if (lm.pose) line(lm.pose, POSE_LINKS, '#38bdf8')
  if (lm.left_hand) line(lm.left_hand, HAND_LINKS, '#4ade80')
  if (lm.right_hand) line(lm.right_hand, HAND_LINKS, '#f472b6')
}
type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Local landmark recorder (reachable only via #/record or Ctrl+Option+R). */
export function RecordPage({ onExit }: { onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const capture = useVideoCapture(videoRef)
  const transport = useRef<FrameTransport | null>(null)
  const sessionId = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [target, setTarget] = useState(RECORD_TARGETS[0])
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [auto, setAuto] = useState(true)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [hands, setHands] = useState(0)
  const [signer, setSigner] = useState(false)
  const [shoulders, setShoulders] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const framingOkRef = useRef(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const timers = useRef<number[]>([])
  const autoRef = useRef(auto)
  autoRef.current = auto
  const targetRef = useRef(target)
  targetRef.current = target
  const countsRef = useRef(counts)
  countsRef.current = counts

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current = []
  }

  const refreshCounts = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/recordings`)
      setCounts(((await r.json()) as { counts: Record<string, number> }).counts)
    } catch {
      /* backend down: the connection state shows it */
    }
  }, [])

  const startTake = useRef<() => void>(() => undefined)

  const onMessage = useCallback((msg: ServerMessage) => {
    if ('session_id' in msg && msg.session_id && msg.session_id !== sessionId.current) return
    if (msg.type === 'session.started') {
      setReady(true)
      transport.current?.start()
    } else if (msg.type === 'processing.status') {
      transport.current?.ack(msg.sequence)
      setHands(msg.hands_visible)
      setSigner(msg.state !== 'no_signer')
      const aspect = msg.frame_height ? msg.frame_width / msg.frame_height : 4 / 3
      setShoulders(shoulderWidth(msg.landmarks, aspect))
      if (canvasRef.current) drawOverlay(canvasRef.current, msg.landmarks)
    } else if (msg.type === 'record.saved') {
      setMessage(msg.ok ? { ok: true, text: `Saved ${msg.label === '_IDLE' ? 'idle sample' : msg.label} #${msg.count} (${msg.hand_frames}/${msg.frames} frames with hands)` } : { ok: false, text: msg.message })
      if (msg.ok) setCounts((c) => ({ ...c, [msg.label]: msg.count }))
      setPhase('idle')
      const t = targetRef.current
      const done = (msg.ok ? msg.count : countsRef.current[t.label] ?? 0) >= t.goal
      if (autoRef.current && !done) timers.current.push(window.setTimeout(() => startTake.current(), 1200))
      if (done && msg.ok) setAuto(false)
    } else if (msg.type === 'error') {
      setMessage({ ok: false, text: msg.message })
    }
  }, [])

  const ws = useWebSocket(WS_URL, onMessage, () => {
    if (sessionId.current) beginSession()
  })

  function beginSession() {
    const id = uuid()
    sessionId.current = id
    ws.sendJSON({ type: 'session.start', session_id: id, source: 'webcam', mode: 'record', target_fps: 15, enable_landmarks: true, enable_tts: false, threshold: 0.7 })
  }

  const startCamera = async () => {
    if (!(await capture.start('webcam')) || !videoRef.current) return
    transport.current = new FrameTransport({ video: videoRef.current, send: ws.sendBinary, getFps: () => 15 })
    beginSession()
    void refreshCounts()
  }

  startTake.current = () => {
    if (!ready || !sessionId.current) return
    if (!framingOkRef.current) {
      setAuto(false)
      setPhase('idle')
      setMessage({ ok: false, text: 'Paused: move back until the framing badge is green, then press Space.' })
      return
    }
    clearTimers()
    setMessage(null)
    setPhase('countdown')
    setCount(3)
    timers.current.push(window.setTimeout(() => setCount(2), COUNT_STEP_MS))
    timers.current.push(window.setTimeout(() => setCount(1), 2 * COUNT_STEP_MS))
    timers.current.push(
      window.setTimeout(() => {
        const t = targetRef.current
        ws.sendJSON({ type: 'record.begin', session_id: sessionId.current, label: t.label })
        setPhase('recording')
        timers.current.push(
          window.setTimeout(() => {
            ws.sendJSON({ type: 'record.end', session_id: sessionId.current })
            setPhase('saving')
          }, t.takeMs),
        )
      }, 3 * COUNT_STEP_MS),
    )
  }

  const pause = () => {
    clearTimers()
    setAuto(false)
    if (phase === 'recording') ws.sendJSON({ type: 'record.end', session_id: sessionId.current, discard: true })
    setPhase('idle')
  }

  const deleteLast = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/recordings/delete-last`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: target.label }) })
      if (r.ok) {
        setCounts(((await r.json()) as { counts: Record<string, number> }).counts)
        setMessage({ ok: true, text: `Deleted the last ${target.title} take` })
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'idle') {
          setAuto(true)
          startTake.current()
        } else pause()
      } else if (e.code === 'Backspace' && phase === 'idle') {
        e.preventDefault()
        void deleteLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(
    () => () => {
      clearTimers()
      transport.current?.stop()
    },
    [],
  )

  const exit = () => {
    clearTimers()
    transport.current?.stop()
    if (sessionId.current) ws.sendJSON({ type: 'session.stop', session_id: sessionId.current })
    capture.stop()
    onExit()
  }

  const framingOk = shoulders !== null && shoulders >= MIN_SHOULDER_WIDTH
  framingOkRef.current = framingOk
  const n = counts[target.label] ?? 0
  const idlePrompt = IDLE_PROMPTS[n % IDLE_PROMPTS.length]
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-40'

  return (
    <div className="mx-auto flex min-h-screen max-w-[1100px] flex-col gap-4 px-4 py-5 sm:px-8">
      <div className="flex items-center justify-between">
        <button type="button" onClick={exit} className={btn}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-xs text-muted">Backend: {ws.state} · landmarks only, saved on this computer</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div
            className={`relative aspect-video overflow-hidden rounded-2xl bg-black ring-4 ${phase === 'recording' ? 'ring-danger' : 'ring-transparent'}`}
            style={capture.info.width && capture.info.height ? { aspectRatio: `${capture.info.width} / ${capture.info.height}` } : undefined}
          >
            <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
            {capture.info.state !== 'active' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <button type="button" onClick={() => void startCamera()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
                  Start camera
                </button>
              </div>
            )}
            {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center text-[140px] font-bold text-white drop-shadow-lg">{count}</div>}
            {phase === 'recording' && (
              <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-danger px-3 py-1 text-sm font-semibold text-white">
                <Circle size={10} className="animate-pulse fill-current" /> {target.label === '_IDLE' ? 'Recording idle' : `Sign ${target.label}`}
              </div>
            )}
            {capture.info.state === 'active' && (
              <div className="absolute bottom-3 left-3 flex flex-col gap-1">
                <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold text-white ${framingOk ? 'bg-accent' : 'bg-danger'}`}>
                  {framingOk ? 'Framing OK: shoulders detected' : 'Move back: head, both shoulders and hands must be in frame'}
                </span>
                <span className="w-fit rounded-md bg-black/60 px-2 py-1 text-xs text-white">{signer ? `Hands visible: ${hands}` : 'No signer in frame'}</span>
              </div>
            )}
          </div>
          {capture.info.error && <p className="mt-2 text-sm text-danger">{capture.info.error}</p>}
        </div>

        <div className="flex flex-col gap-3 lg:col-span-4">
          <ul className="flex flex-col gap-1">
            {RECORD_TARGETS.map((t) => {
              const c = counts[t.label] ?? 0
              return (
                <li key={t.label}>
                  <button
                    type="button"
                    disabled={phase !== 'idle'}
                    onClick={() => setTarget(t)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${t.label === target.label ? 'border-accent bg-accent-soft font-semibold' : 'border-line'}`}
                  >
                    <span>{t.title}</span>
                    <span className={`font-mono text-xs ${c >= t.goal ? 'text-accent' : 'text-muted'}`}>
                      {c}/{t.goal}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="rounded-xl border border-line p-3 text-sm">
            {target.label === '_IDLE' ? (
              <p>
                <strong>Next idle take:</strong> {idlePrompt}. Don't sign.
              </p>
            ) : (
              <p>
                Start with hands down. When the countdown ends, sign <strong>{target.label}</strong> once at a natural pace, then lower your hands.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {phase === 'idle' ? (
              <button type="button" disabled={!ready || !framingOk} title={framingOk ? undefined : 'Fix your framing first'} onClick={() => { setAuto(true); startTake.current() }} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                <Play size={14} /> {auto ? 'Record (auto-repeat)' : 'Record'}
              </button>
            ) : (
              <button type="button" onClick={pause} className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white">
                <Pause size={14} /> Pause
              </button>
            )}
            <button type="button" disabled={phase !== 'idle' || n === 0} onClick={() => void deleteLast()} className={btn}>
              <Trash2 size={14} /> Delete last
            </button>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-repeat until {target.goal}
          </label>
          <p className="text-xs text-faint">Space: record / pause · Backspace: delete last take</p>
          {message && <p className={`text-sm ${message.ok ? 'text-accent' : 'text-danger'}`}>{message.text}</p>}
        </div>
      </div>
    </div>
  )
}
