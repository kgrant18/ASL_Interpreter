import { AlertTriangle, Camera, Captions, CheckCircle2, CircleHelp, Hand, Loader2, Mic, Play, Radio, Send, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BACKEND_URL, fetchVocabulary } from '../services/api'
import { backgroundApi, meetingApi, type BackgroundStatus } from '../services/meetingApi'
import type { SupportedPhrase } from '../types/interpretation'
import { AboutDialog, DISCLAIMER } from './AboutDialog'
import { Logo } from './Header'
import { PhrasesPanel } from './VocabularyPanel'

const POLL_MS = 1000

type Tone = 'ok' | 'warn' | 'bad' | 'off'

export interface Indicator {
  tone: Tone
  text: string
  detail?: string | null
}

/** Derive the four status indicators from one backend status snapshot. */
export function indicators(s: BackgroundStatus | null, backendUp: boolean): Record<'camera' | 'recognition' | 'voice' | 'captions', Indicator> {
  if (!backendUp || !s) {
    const down: Indicator = { tone: 'bad', text: 'SignBridge is not running', detail: 'Start it with ./scripts/dev.sh' }
    return { camera: down, recognition: down, voice: down, captions: down }
  }
  const { capture, meeting } = s
  const cam = capture.camera
  const camera: Indicator = !capture.running
    ? { tone: 'off', text: 'Off' }
    : cam.state === 'on'
      ? { tone: 'ok', text: `On · ${Math.round(cam.fps)} fps` }
      : cam.state === 'starting'
        ? { tone: 'warn', text: 'Starting…' }
        : { tone: 'bad', text: 'Not available', detail: cam.error }

  const rs = capture.recognition
  const recognition: Indicator = !capture.running || cam.state !== 'on'
    ? { tone: 'off', text: 'Off' }
    : rs.state === 'no_signer'
      ? { tone: 'warn', text: 'No one in view', detail: 'Sit so your head, shoulders and hands are in frame.' }
      : !rs.shoulders_visible
        ? { tone: 'warn', text: 'Move back a little', detail: 'Both shoulders need to be in frame.' }
        : rs.state === 'no_hands'
          ? { tone: 'ok', text: 'Ready · watching for signs' }
          : { tone: 'ok', text: rs.pending.length ? `Recognizing · ${rs.pending.join(' ')}` : 'Recognizing' }

  const enabled = !!meeting?.config.enabled
  const mic = meeting?.virtual_mic
  const voice: Indicator = !meeting
    ? { tone: 'bad', text: 'Unavailable' }
    : !mic?.active
      ? { tone: 'bad', text: 'BlackHole not found', detail: mic?.error ?? 'Install BlackHole 2ch and restart.' }
      : !meeting.tts.available
        ? { tone: 'bad', text: 'Voice unavailable', detail: (meeting.tts as { error?: string }).error ?? null }
        : enabled && meeting.config.speech
          ? { tone: 'ok', text: `Speaking into "${mic.device_name ?? 'BlackHole 2ch'}"` }
          : { tone: 'off', text: `Ready (${mic.device_name ?? 'BlackHole 2ch'}) · not sending` }

  const z = meeting?.zoom
  const recentFail = z?.last_error && (!z.last_ok_at || (z.last_error_at ?? 0) > z.last_ok_at)
  const captions: Indicator = !z?.connected
    ? { tone: 'off', text: 'No caption token', detail: 'Optional: paste the Zoom API token below.' }
    : recentFail
      ? { tone: 'bad', text: 'Captions failing', detail: z.last_error }
      : enabled && meeting?.config.captions
        ? { tone: 'ok', text: z.delivered ? `Sending · ${z.delivered} delivered` : 'Sending to Zoom' }
        : { tone: 'off', text: 'Token saved · not sending' }
  return { camera, recognition, voice, captions }
}

const DOT: Record<Tone, string> = {
  ok: 'bg-accent',
  warn: 'bg-warn',
  bad: 'bg-danger',
  off: 'bg-faint',
}

function StatusTile({ icon, label, ind }: { icon: ReactNode; label: string; ind: Indicator }) {
  return (
    <li className="rounded-xl border border-line bg-surface px-4 py-3" aria-label={`${label}: ${ind.text}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon} {label}
      </div>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[ind.tone]}`} aria-hidden /> {ind.text}
      </p>
      {ind.detail && <p className={`mt-1 text-xs leading-relaxed ${ind.tone === 'bad' ? 'text-danger' : 'text-muted'}`}>{ind.detail}</p>}
    </li>
  )
}

function useTheme() {
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
    const t = window.setInterval(() => void refresh(), POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [refresh])

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
  const history = status?.capture.history ?? []
  const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50'

  return (
    <div className="mx-auto flex min-h-screen max-w-[960px] flex-col">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight">SignBridge for Zoom</h1>
            <p className="text-xs text-muted">Your supported ASL phrases, spoken and captioned in the call</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && sending && (
            <button type="button" onClick={() => void run('mute', () => meetingApi.mute(), 'Stopped sending to the call.')} title="Stop sending (Ctrl+Shift+M)" className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-semibold text-white">
              <Radio size={12} className="animate-pulse" /> Live in call · Stop
            </button>
          )}
          <button type="button" onClick={() => setAboutOpen(true)} aria-label="About and help" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink">
            <CircleHelp size={18} />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pb-10 sm:px-8">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Status">
          <StatusTile icon={<Camera size={14} aria-hidden />} label="Camera" ind={ind.camera} />
          <StatusTile icon={<Hand size={14} aria-hidden />} label="Recognition" ind={ind.recognition} />
          <StatusTile icon={<Mic size={14} aria-hidden />} label="Voice" ind={ind.voice} />
          <StatusTile icon={<Captions size={14} aria-hidden />} label="Captions" ind={ind.captions} />
        </ul>

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

        <section aria-label="Connect" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <ol className="space-y-5">
            <li>
              <h2 className="text-sm font-semibold">1 · Voice</h2>
              <p className="mt-1 text-sm text-muted">
                In Zoom → Settings → Audio, set <strong className="font-medium text-ink">Microphone</strong> to{' '}
                <strong className="font-medium text-ink">{status?.meeting?.virtual_mic.device_name ?? 'BlackHole 2ch'}</strong>. Other participants hear each
                recognized sentence.
              </p>
            </li>

            <li>
              <h2 className="text-sm font-semibold">2 · Zoom captions <span className="font-normal text-muted">(optional)</span></h2>
              <p className="mt-1 text-sm text-muted">
                The host clicks <strong className="font-medium text-ink">Captions</strong> in the meeting toolbar → <strong className="font-medium text-ink">Set up manual captioner</strong> /{' '}
                <strong className="font-medium text-ink">Use a 3rd-party CC service</strong> → <strong className="font-medium text-ink">Copy the API token</strong>, and pastes it here. A new
                meeting means a new token.
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
                  className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs"
                />
                <button type="submit" disabled={!token.trim() || busy !== null} className={`${btn} border border-line hover:bg-canvas`}>
                  Save token
                </button>
                <button
                  type="button"
                  disabled={!zoomConnected || busy !== null}
                  onClick={() => void run('test-caption', () => backgroundApi.testCaption(), 'Test caption delivered. Participants with captions on see it now.')}
                  className={`${btn} border border-line hover:bg-canvas`}
                >
                  {busy === 'test-caption' ? <Loader2 size={14} className="animate-spin" /> : <Captions size={14} />} Test caption
                </button>
                {zoomConnected && (
                  <button type="button" disabled={busy !== null} onClick={() => void run('token', () => meetingApi.zoomToken(null))} className="px-2 text-xs text-muted underline hover:text-ink">
                    Remove token
                  </button>
                )}
              </form>
            </li>

            <li>
              <h2 className="text-sm font-semibold">3 · Start</h2>
              <p className="mt-1 text-sm text-muted">
                SignBridge uses the camera directly, so Zoom can keep your video on. After starting you can minimize this window; recognition keeps running.
                Stop sending any time with <kbd className="rounded border border-line px-1 font-mono text-[11px]">Ctrl+Shift+M</kbd> here or{' '}
                <strong className="font-medium text-ink">Stop sending</strong> in the menu-bar icon.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!running ? (
                  <button type="button" disabled={!backendUp || busy !== null} onClick={() => void run('start', () => backgroundApi.start())} className={`${btn} bg-accent text-white hover:opacity-90`}>
                    {busy === 'start' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Start
                  </button>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => void run('stop', () => backgroundApi.stop())} className={`${btn} bg-danger text-white hover:opacity-90`}>
                    <Square size={14} /> Stop
                  </button>
                )}
                {running && !sending && (
                  <button type="button" disabled={busy !== null} onClick={() => void run('resume', () => meetingApi.config({ enabled: true, speech: true, captions: zoomConnected }))} className={`${btn} border border-line hover:bg-canvas`}>
                    <Radio size={14} /> Resume sending to the call
                  </button>
                )}
                {running && sending && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run('test', () => meetingApi.send('SignBridge is connected.', 'test'), 'Sent “SignBridge is connected.” to the call.')}
                    className={`${btn} border border-line hover:bg-canvas`}
                  >
                    <Send size={14} /> Send test sentence
                  </button>
                )}
              </div>
            </li>
          </ol>
        </section>

        {running && status?.capture.camera.state === 'on' && (
          <section aria-label="Camera view" className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-start sm:p-5">
            <img
              src={`${BACKEND_URL}/api/background/preview.jpg?t=${tick}`}
              alt="Camera view with hand and shoulder tracking"
              className="w-full max-w-[320px] rounded-xl bg-canvas"
            />
            <div className="text-sm text-muted">
              <h2 className="text-sm font-semibold text-ink">Framing</h2>
              <p className="mt-1">
                Head, both shoulders and both hands in view, about an arm's length from the camera. The green line should run across both shoulders. This
                view updates once a second and is only for checking your position.
              </p>
            </div>
          </section>
        )}

        <section aria-label="Recognized in this session" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Recognized</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-faint">{running ? 'Waiting for a supported phrase…' : 'Nothing yet.'}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-baseline justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{h.english}</p>
                    <p className="font-mono text-[11px] text-muted">{h.glosses.join(' ')}</p>
                  </div>
                  <span className="shrink-0 text-xs text-faint">
                    {new Date(h.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {h.sent ? 'sent to call' : 'not sent'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {phrases.length > 0 && <PhrasesPanel phrases={phrases} />}

        <p className="text-center text-xs text-faint">
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
