import { AlertTriangle, Camera, Captions, Check, CheckCircle2, ChevronDown, CircleHelp, Hand, Loader2, Mic, Pause, PictureInPicture2, Play, Radio, Send, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCameraPreview } from '../hooks/useCameraPreview'
import { useLandmarkStream } from '../hooks/useLandmarkStream'
import { drawSkeleton, type Landmarks } from '../lib/skeleton'
import { useCaptionBubble } from '../hooks/useCaptionBubble'
import { BACKEND_URL, fetchVocabulary } from '../services/api'
import { backgroundApi, meetingApi, type BackgroundStatus, type PhraseEvent } from '../services/meetingApi'
import type { SupportedPhrase } from '../types/interpretation'
import { AboutDialog, DISCLAIMER } from './AboutDialog'
import { Logo } from './Header'

const POLL_MS = 1000
const HISTORY_MAX = 5
const CLEARED_KEY = 'signbridge.history.clearedAt'

type Tone = 'ok' | 'warn' | 'bad' | 'off'

export interface Indicator {
  tone: Tone
  /** Full sentence (screen readers, tooltips). */
  text: string
  detail?: string | null
  /** Short label for the one-line live status row, e.g. "Ready". */
  short: string
  /** Optional second line under `short`, e.g. "BlackHole 2ch". */
  sub?: string | null
}

type Keys = 'camera' | 'recognition' | 'voice' | 'captions'

/** Derive the four status indicators from one backend status snapshot. */
export function indicators(s: BackgroundStatus | null, backendUp: boolean): Record<Keys, Indicator> {
  if (!backendUp || !s) {
    const down: Indicator = { tone: 'bad', text: 'SignBridge is not running', detail: 'Start it with ./scripts/dev.sh', short: 'Not running' }
    return { camera: down, recognition: down, voice: down, captions: down }
  }
  const { capture, meeting } = s
  const cam = capture.camera
  const camera: Indicator = !capture.running
    ? { tone: 'off', text: 'Off', short: 'Off' }
    : cam.state === 'on'
      ? { tone: 'ok', text: `On · ${Math.round(cam.fps)} fps`, short: 'On', sub: `${Math.round(cam.fps)} fps` }
      : cam.state === 'starting'
        ? { tone: 'warn', text: 'Starting…', short: 'Starting…' }
        : { tone: 'bad', text: 'Not available', detail: cam.error, short: 'Error' }

  const rs = capture.recognition
  const recognition: Indicator = !capture.running || cam.state !== 'on'
    ? { tone: 'off', text: 'Off', short: 'Off' }
    : rs.state === 'no_signer'
      ? { tone: 'warn', text: 'No one in view', detail: 'Sit so your head, shoulders and hands are in frame.', short: 'No one in view' }
      : !rs.shoulders_visible
        ? { tone: 'warn', text: 'Move back a little', detail: 'Both shoulders need to be in frame.', short: 'Move back' }
        : rs.state === 'no_hands'
          ? { tone: 'ok', text: 'Ready · watching for signs', short: 'Watching' }
          : { tone: 'ok', text: rs.pending.length ? `Recognizing · ${rs.pending.join(' ')}` : 'Recognizing', short: 'Recognizing' }

  const enabled = !!meeting?.config.enabled
  const mic = meeting?.virtual_mic
  const device = mic?.device_name ?? 'BlackHole 2ch'
  const voice: Indicator = !meeting
    ? { tone: 'bad', text: 'Unavailable', short: 'Unavailable' }
    : !mic?.active
      ? { tone: 'bad', text: 'BlackHole not found', detail: mic?.error ?? 'Install BlackHole 2ch and restart.', short: 'Not found', sub: 'BlackHole' }
      : !meeting.tts.available
        ? { tone: 'bad', text: 'Voice unavailable', detail: (meeting.tts as { error?: string }).error ?? null, short: 'Unavailable' }
        : enabled && meeting.config.speech
          ? { tone: 'ok', text: `Speaking into "${device}"`, short: 'Ready', sub: device }
          : { tone: 'off', text: `Ready (${device}) · not sending`, short: 'Paused', sub: device }

  const z = meeting?.zoom
  const recentFail = z?.last_error && (!z.last_ok_at || (z.last_error_at ?? 0) > z.last_ok_at)
  const captions: Indicator = !z?.connected
    ? { tone: 'off', text: 'No caption token', detail: 'Optional: paste the Zoom API token below.', short: 'Off', sub: 'no token' }
    : recentFail
      ? { tone: 'bad', text: 'Captions failing', detail: z.last_error, short: 'Failing' }
      : enabled && meeting?.config.captions
        ? { tone: 'ok', text: z.delivered ? `Sending · ${z.delivered} delivered` : 'Sending to Zoom', short: 'On', sub: z.delivered ? `${z.delivered} sent` : 'Zoom' }
        : { tone: 'off', text: 'Token saved · not sending', short: 'Paused' }
  return { camera, recognition, voice, captions }
}

export type Framing = { tone: 'ok' | 'warn'; text: string } | null

/** Framing badge from the existing shoulder / person detection. */
export function framing(s: BackgroundStatus | null): Framing {
  if (!s?.capture.running || s.capture.camera.state !== 'on') return null
  const r = s.capture.recognition
  if (r.state === 'no_signer') return { tone: 'warn', text: 'Step into frame' }
  if (!r.shoulders_visible) return { tone: 'warn', text: 'Move back a little' }
  return { tone: 'ok', text: 'Framing good ✓' }
}

const DOT: Record<Tone, string> = { ok: 'bg-accent', warn: 'bg-warn', bad: 'bg-danger', off: 'bg-faint' }
const ICONS: Record<Keys, ReactNode> = {
  camera: <Camera size={13} aria-hidden />,
  recognition: <Hand size={13} aria-hidden />,
  voice: <Mic size={13} aria-hidden />,
  captions: <Captions size={13} aria-hidden />,
}
const LABELS: Record<Keys, string> = { camera: 'Camera', recognition: 'Recognition', voice: 'Voice', captions: 'Captions' }
const KEYS: Keys[] = ['camera', 'recognition', 'voice', 'captions']

/** Calls `fn` every `ms`. Uses a worker clock when available because browsers slow
 *  down timers in hidden windows, so status keeps updating while minimized. */
function useTicker(fn: () => void, ms: number) {
  const cb = useRef(fn)
  cb.current = fn
  useEffect(() => {
    let worker: Worker | null = null
    let id: number | null = null
    try {
      if (typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' }))
        worker = new Worker(url)
        URL.revokeObjectURL(url)
        worker.onmessage = () => cb.current()
      }
    } catch {
      worker = null
    }
    if (!worker) id = window.setInterval(() => cb.current(), ms)
    return () => {
      worker?.terminate()
      if (id !== null) clearInterval(id)
    }
  }, [ms])
}

export function useTheme() {
  useEffect(() => {
    let dark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
    try {
      const t = localStorage.getItem('signbridge.theme')
      if (t) dark = t === 'dark'
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle('dark', dark)
  }, [])
}

function loadClearedAt(): number {
  try {
    return Number(localStorage.getItem(CLEARED_KEY)) || 0
  } catch {
    return 0
  }
}

const timeOf = (at: number) => new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ---------- small pieces ----------

const H2 = 'text-sm font-semibold text-ink'
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50'
const BTN_SECONDARY = `${BTN} border border-line px-3.5 py-2 text-ink hover:bg-canvas`
const CARD = 'rounded-2xl border border-line bg-surface p-5 sm:p-6'

function StatusRow({ ind, srOnly = false }: { ind: Record<Keys, Indicator>; srOnly?: boolean }) {
  return (
    <ul className={srOnly ? 'sr-only' : 'grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-5 py-3 sm:grid-cols-4'} aria-label="Status">
      {KEYS.map((k) => (
        <li key={k} aria-label={`${LABELS[k]}: ${ind[k].text}`} title={ind[k].detail ?? ind[k].text} className="flex min-w-0 items-start gap-2">
          <span className={`mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full ${DOT[ind[k].tone]}`} aria-hidden />
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              {ICONS[k]} {LABELS[k]}
            </span>
            <span className={`block truncate text-sm font-semibold ${ind[k].tone === 'bad' ? 'text-danger' : 'text-ink'}`}>{ind[k].short}</span>
            {ind[k].sub && <span className="block truncate text-xs text-faint">{ind[k].sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function FramingBadge({ f }: { f: Framing }) {
  if (!f) return null
  return (
    <span
      role="note"
      aria-label={`Framing: ${f.text}`}
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${f.tone === 'ok' ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'}`}
    >
      {f.text}
    </span>
  )
}

const SKELETON_KEY = 'signbridge.preview.skeleton'

function loadSkeletonPref(): boolean {
  try {
    return localStorage.getItem(SKELETON_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Canvas layered exactly over the preview video (inside the same mirrored layer), drawing
 * the backend's latest landmarks mapped through the video's resolution, aspect ratio and
 * object-cover crop. Display only.
 */
function SkeletonCanvas({ lm, videoRef }: { lm: Landmarks | null; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const measure = () => setBox({ w: c.clientWidth, h: c.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current
    const v = videoRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !box.w || !box.h) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(box.w * dpr)) c.width = Math.round(box.w * dpr)
    if (c.height !== Math.round(box.h * dpr)) c.height = Math.round(box.h * dpr)
    drawSkeleton(ctx, lm, { w: v?.videoWidth ?? 0, h: v?.videoHeight ?? 0 }, box, dpr)
  }, [lm, box, videoRef])

  return <canvas ref={ref} aria-hidden data-testid="skeleton" className="pointer-events-none absolute inset-0 h-full w-full" />
}

/**
 * Position check: smooth video from the browser's own camera (display only; recognition
 * keeps using the backend camera), with an optional skeleton overlay from the backend's
 * landmarks. Falls back to the backend's 1-second snapshot (skeleton already drawn in)
 * when the browser can't open the camera. The pill comes from backend detection.
 */
function PositionCheck({ tick, f, cameraIndex, heading = false }: { tick: number; f: Framing; cameraIndex: number; heading?: boolean }) {
  const { videoRef, state } = useCameraPreview(true, cameraIndex)
  const smooth = state === 'live'
  const [skeleton, setSkeleton] = useState(loadSkeletonPref)
  const lm = useLandmarkStream(smooth && skeleton)
  const toggle = () =>
    setSkeleton((on) => {
      try {
        localStorage.setItem(SKELETON_KEY, on ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !on
    })
  return (
    <div className="space-y-3">
      {heading && <h2 className={H2}>Position check</h2>}
      <div>
        <FramingBadge f={f} />
      </div>
      <p className="text-sm text-muted">Head, both shoulders and both hands in view, about an arm's length from the camera.</p>
      <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-xl bg-canvas" title="Camera view">
        <div className={`absolute inset-0 -scale-x-100 ${smooth ? '' : 'hidden'}`}>
          <video ref={videoRef} muted playsInline aria-hidden={!smooth} className="h-full w-full object-cover" />
          {smooth && skeleton && <SkeletonCanvas lm={lm} videoRef={videoRef} />}
        </div>
        {!smooth && state !== 'idle' && state !== 'starting' && (
          <img src={`${BACKEND_URL}/api/background/preview.jpg?t=${tick}`} alt="Camera view" className="h-full w-full object-cover" />
        )}
      </div>
      {smooth && (
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={skeleton} onChange={toggle} className="accent-[var(--color-accent)]" />
          Show skeleton
        </label>
      )}
    </div>
  )
}

function History({ items, showStatus, onClear }: { items: PhraseEvent[]; showStatus: boolean; onClear: () => void }) {
  return (
    <section aria-label="Recognized in this session" className={CARD}>
      <div className="flex items-center justify-between">
        <h2 className={H2}>Recent</h2>
        {items.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
            Clear
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-faint">Nothing yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-3 py-2.5">
              <p className="text-[15px] font-medium" title={h.glosses.join(' ')}>
                {h.english}
              </p>
              <span className="shrink-0 text-xs text-faint">
                {timeOf(h.at)}
                {showStatus && (h.sent ? ' · sent to call' : ' · not sent')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Phrases({ phrases, defaultOpen }: { phrases: SupportedPhrase[]; defaultOpen: boolean }) {
  if (phrases.length === 0) return null
  return (
    <details open={defaultOpen} className={`${CARD} group`}>
      <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        <h2 className={H2}>Supported phrases</h2>
        <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="mt-1 text-xs text-muted">Sign one at a natural pace, then lower your hands. Anything else is not spoken.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {phrases.map((p) => (
          <li key={p.id} className="rounded-xl bg-canvas px-4 py-2.5">
            <p className="text-sm font-medium">{p.english}</p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">{p.glosses.join(' ')}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Step({ n, done, warn, title, children }: { n: number; done: boolean; warn?: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-label={done ? 'done' : 'to do'}
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-accent text-white' : warn ? 'bg-warn-soft text-warn' : 'border border-line text-muted'
        }`}
      >
        {done ? <Check size={15} strokeWidth={3} aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <div className="mt-1 text-sm text-muted">{children}</div>
      </div>
    </li>
  )
}

// ---------- page ----------

export function ConnectPage({ onUseBrowser }: { onUseBrowser: () => void }) {
  useTheme()
  const [status, setStatus] = useState<BackgroundStatus | null>(null)
  const [backendUp, setBackendUp] = useState(true)
  const [phrases, setPhrases] = useState<SupportedPhrase[]>([])
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [checking, setChecking] = useState(false) // camera on for the framing check only
  const [clearedAt, setClearedAt] = useState(loadClearedAt)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await backgroundApi.status()
      if (!alive.current) return
      if (!s?.capture) throw new Error('unexpected status')
      setStatus(s)
      setBackendUp(true)
      setTick((t) => t + 1)
    } catch {
      if (alive.current) setBackendUp(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])
  useTicker(() => void refresh(), POLL_MS)

  useEffect(() => {
    if (!backendUp || phrases.length) return
    fetchVocabulary()
      .then((v) => setPhrases(v.phrases ?? []))
      .catch(() => undefined)
  }, [backendUp, phrases.length])

  const run = useCallback(
    async (name: string, fn: () => Promise<unknown>, ok?: string) => {
      setBusy(name)
      setError(null)
      setNotice(null)
      try {
        await fn()
        if (ok) setNotice(ok)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
        void refresh()
      }
    },
    [refresh],
  )

  const running = !!status?.capture.running
  const sending = !!status?.meeting?.config.enabled
  const zoomConnected = !!status?.meeting?.zoom.connected
  const live = running && !checking

  // Ctrl+Shift+M stops sending to the call (recognition keeps running).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault()
        void run('mute', () => meetingApi.mute(), 'Stopped sending to the call.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  const ind = indicators(status, backendUp)
  const frame = framing(status)
  const allHistory = useMemo(() => (status?.capture.history ?? []).filter((h) => h.at > clearedAt), [status, clearedAt])
  const sentHistory = useMemo(() => allHistory.filter((h) => h.sent), [allHistory])
  const lastSent = sentHistory[0] ?? null
  const bubbleItem = useMemo(() => (lastSent ? { id: lastSent.id, english: lastSent.english } : null), [lastSent])
  const bubble = useCaptionBubble(bubbleItem)

  const clearHistory = () => {
    const now = Date.now() / 1000
    setClearedAt(now)
    try {
      localStorage.setItem(CLEARED_KEY, String(now))
    } catch {
      /* ignore */
    }
  }

  const z = status?.meeting?.zoom
  const captionsTested = !!(z?.connected && z.last_ok_at && !(z.last_error && (z.last_error_at ?? 0) > z.last_ok_at))
  const micOk = !!status?.meeting?.virtual_mic.active
  const device = status?.meeting?.virtual_mic.device_name ?? 'BlackHole 2ch'
  const cameraOn = status?.capture.camera.state === 'on'
  const cameraIndex = status?.capture.camera.index ?? 0

  const start = () =>
    run('start', async () => {
      if (running) await meetingApi.config({ enabled: true, speech: true, captions: zoomConnected })
      else await backgroundApi.start()
      setChecking(false)
    })
  const checkFraming = () =>
    run('check', async () => {
      setChecking(true)
      await backgroundApi.start()
      await meetingApi.mute() // camera only: nothing is sent until Start
    })

  return (
    <div className="mx-auto flex min-h-screen max-w-[880px] flex-col">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo className="h-[31px] w-[31px]" />
          <span className="text-[19px] font-semibold tracking-tight">SignBridge</span>
        </div>
        <div className="flex items-center gap-2">
          {live && sending && (
            <button type="button" onClick={() => void run('mute', () => meetingApi.mute(), 'Stopped sending to the call.')} title="Stop sending (Ctrl+Shift+M)" className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-semibold text-white">
              <Radio size={12} className="animate-pulse" /> Live in call · Stop
            </button>
          )}
          {live && !sending && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
              <Pause size={12} aria-hidden /> Paused
            </span>
          )}
          <button type="button" onClick={() => setAboutOpen(true)} aria-label="About and help" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink">
            <CircleHelp size={18} />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pb-10 sm:px-8">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> {notice}
          </p>
        )}
        {!backendUp && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            SignBridge is not running. Start it in Terminal with <code className="font-mono text-xs">./scripts/dev.sh</code>.
          </p>
        )}

        {backendUp && !status ? (
          <p className="py-24 text-center text-sm text-faint" aria-busy="true">
            <Loader2 size={18} className="mx-auto mb-2 animate-spin" aria-hidden /> Connecting to SignBridge…
          </p>
        ) : !live ? (
          <>
            <div className="pt-2">
              <h1 className="text-2xl font-semibold tracking-tight">Connect to Zoom</h1>
              <p className="mt-1 text-sm text-muted">Three quick checks, then Start. Each one ticks itself off.</p>
            </div>
            <StatusRow ind={ind} srOnly />

            <section aria-label="Setup" className={CARD}>
              <ol className="space-y-6">
                <Step n={1} done={micOk} title={micOk ? `Voice: ${device} detected` : 'Voice: install BlackHole 2ch'}>
                  In Zoom → Settings → Audio, set <strong className="font-medium text-ink">Microphone</strong> to <strong className="font-medium text-ink">{device}</strong>.
                  {!micOk && status?.meeting?.virtual_mic.error && <span className="mt-1 block text-danger">{status.meeting.virtual_mic.error}</span>}
                </Step>

                <Step
                  n={2}
                  done={captionsTested}
                  warn={zoomConnected && !captionsTested}
                  title={captionsTested ? 'Zoom captions: token tested' : zoomConnected ? 'Zoom captions: token saved, not tested' : 'Zoom captions (optional)'}
                >
                  <p>
                    Host: <strong className="font-medium text-ink">Captions</strong> → <strong className="font-medium text-ink">Set up manual captioner</strong> →{' '}
                    <strong className="font-medium text-ink">Copy the API token</strong>. A new meeting means a new token.
                  </p>
                  <form
                    className="mt-2 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(
                        'token',
                        async () => {
                          await meetingApi.zoomToken(token.trim())
                          setToken('')
                          if (sending) await meetingApi.config({ captions: true })
                        },
                        'Caption token saved. Use “Test caption” to check it.',
                      )
                    }}
                  >
                    <label className="sr-only" htmlFor="zoom-token">Zoom caption API token</label>
                    <input
                      id="zoom-token"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={zoomConnected ? 'Token saved — paste a new one to replace it' : 'https://wmcc.zoom.us/closedcaption?id=…'}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
                    />
                    <button type="submit" disabled={!token.trim() || busy !== null} className={BTN_SECONDARY}>
                      Save token
                    </button>
                    <button
                      type="button"
                      disabled={!zoomConnected || busy !== null}
                      onClick={() => void run('test-caption', () => backgroundApi.testCaption(), 'Test caption delivered. Participants with captions on see it now.')}
                      className={BTN_SECONDARY}
                    >
                      {busy === 'test-caption' ? <Loader2 size={14} className="animate-spin" /> : <Captions size={14} />} Test caption
                    </button>
                    {zoomConnected && (
                      <button type="button" disabled={busy !== null} onClick={() => void run('token', () => meetingApi.zoomToken(null))} className="px-1 text-xs text-muted underline hover:text-ink">
                        Remove token
                      </button>
                    )}
                  </form>
                  {zoomConnected && !captionsTested && z?.last_error && <p className="mt-2 text-danger">{z.last_error}</p>}
                </Step>

                <Step n={3} done={frame?.tone === 'ok'} warn={frame?.tone === 'warn'} title={frame?.tone === 'ok' ? 'Position check: framing good' : 'Position check'}>
                  {running && cameraOn ? (
                    <div className="mt-2">
                      <PositionCheck tick={tick} f={frame} cameraIndex={cameraIndex} />
                    </div>
                  ) : running ? (
                    <p className={ind.camera.tone === 'bad' ? 'text-danger' : ''}>{ind.camera.detail ?? 'Opening the camera…'}</p>
                  ) : (
                    <>
                      <p>Check that your head, shoulders and hands are in view. Zoom can keep using the camera.</p>
                      <button type="button" disabled={!backendUp || busy !== null} onClick={() => void checkFraming()} className={`${BTN_SECONDARY} mt-2`}>
                        {busy === 'check' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Check framing
                      </button>
                    </>
                  )}
                </Step>
              </ol>

              <div className="mt-8 border-t border-line pt-6">
                <button type="button" disabled={!backendUp || busy !== null} onClick={() => void start()} className={`${BTN} w-full bg-accent px-6 py-4 text-lg text-white shadow-sm hover:opacity-90`}>
                  {busy === 'start' ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />} Start
                </button>
                <p className="mt-2 text-center text-xs text-faint">After starting you can minimize this window. Recognition keeps running with Zoom in front.</p>
              </div>
            </section>

            {allHistory.length > 0 && <History items={allHistory.slice(0, HISTORY_MAX)} showStatus onClear={clearHistory} />}
            <Phrases phrases={phrases} defaultOpen />
          </>
        ) : (
          <>
            <h1 className="sr-only">Live in Zoom</h1>
            <section aria-label="Last sent" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-wider text-faint">Last sent</p>
              <div aria-live="assertive" aria-atomic="true" className="min-h-[96px]">
                {lastSent ? (
                  <div key={lastSent.id} className="caption-in">
                    <p className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{lastSent.english}</p>
                    <p className="mt-3 text-xs text-faint">
                      {timeOf(lastSent.at)} · spoken{status?.meeting?.config.captions ? ' and captioned' : ''} in the call
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-3xl font-medium text-faint">{sending ? 'Waiting for a supported phrase…' : 'Sending is paused'}</p>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {!sending && (
                  <button type="button" disabled={busy !== null} onClick={() => void run('resume', () => meetingApi.config({ enabled: true, speech: true, captions: zoomConnected }))} className={`${BTN} bg-accent px-4 py-2 text-white hover:opacity-90`}>
                    <Radio size={14} /> Resume sending
                  </button>
                )}
                {sending && (
                  <button type="button" disabled={busy !== null} onClick={() => void run('test', () => meetingApi.send('SignBridge is connected.', 'test'), 'Sent “SignBridge is connected.” to the call.')} className={BTN_SECONDARY}>
                    <Send size={14} /> Send test sentence
                  </button>
                )}
                {bubble.supported && (
                  <button type="button" onClick={() => void bubble.toggle()} aria-pressed={bubble.open} className={BTN_SECONDARY} title="A small always-on-top window that shows each sentence for a few seconds">
                    <PictureInPicture2 size={14} /> {bubble.open ? 'Hide floating caption' : 'Floating caption'}
                  </button>
                )}
                <button type="button" disabled={busy !== null} onClick={() => void run('stop', () => backgroundApi.stop())} className={`${BTN} ml-auto border border-line px-3.5 py-2 text-danger hover:bg-danger-soft`}>
                  <Square size={13} /> Stop
                </button>
              </div>
            </section>

            <StatusRow ind={ind} />
            {[ind.camera, ind.voice, ind.captions].some((i) => i.tone === 'bad') && (
              <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                {[ind.camera, ind.voice, ind.captions].filter((i) => i.tone === 'bad').map((i) => i.detail ?? i.text).join(' ')}
              </p>
            )}

            {cameraOn && (
              <section aria-label="Position check" className={CARD}>
                <PositionCheck tick={tick} f={frame} cameraIndex={cameraIndex} heading />
              </section>
            )}

            <History items={sentHistory.slice(0, HISTORY_MAX)} showStatus={false} onClear={clearHistory} />
            <Phrases phrases={phrases} defaultOpen={false} />
          </>
        )}

        <p className="mt-2 text-center text-xs leading-relaxed text-faint">
          {DISCLAIMER}{' '}
          <button type="button" className="underline hover:text-ink" onClick={() => setAboutOpen(true)}>
            Learn more
          </button>
          {' · '}
          <button type="button" className="underline hover:text-ink" onClick={onUseBrowser}>
            Use the in-browser camera instead
          </button>
        </p>
      </main>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}
