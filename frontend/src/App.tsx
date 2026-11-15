import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { Header } from './components/Header'
import { InterpretationPanel } from './components/InterpretationPanel'
import { MeetingPanel } from './components/MeetingPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { VideoPreview } from './components/VideoPreview'
import { VocabularyPanel } from './components/VocabularyPanel'
import { useInterpretation } from './hooks/useInterpretation'
import { useMeetingOutput } from './hooks/useMeetingOutput'
import { fetchModel, fetchVocabulary } from './services/api'
import { DEFAULT_SETTINGS, type ModelInfo, type Settings, type Vocabulary } from './types/interpretation'

const STORAGE_KEY = 'signbridge.settings.v1'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>), mode: 'live' }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS
}

function initialDark(): boolean {
  try {
    const t = localStorage.getItem('signbridge.theme')
    if (t) return t === 'dark'
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [dark, setDark] = useState(initialDark)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [vocab, setVocab] = useState<Vocabulary>({ supported: [], disabled: [], phrases: [] })
  const [loadError, setLoadError] = useState<string | null>(null)

  const it = useInterpretation(settings)
  const meeting = useMeetingOutput({ connected: it.connection === 'connected', sendMode: settings.meetingSendMode, phrasePauseMs: settings.phrasePauseMs })
  const { handleEvent, handleProcessing } = meeting

  // Forward new captions (newest first in history) and end-of-phrase cues to meeting output.
  const latestEvent = it.history[0]
  useEffect(() => {
    if (latestEvent) handleEvent(latestEvent)
  }, [latestEvent, handleEvent])
  useEffect(() => {
    handleProcessing(it.status.processing)
  }, [it.status.processing, handleProcessing])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('signbridge.theme', dark ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }, [dark])

  // (Re)load model metadata whenever the backend connects; retry until it succeeds.
  // Results are idempotent, so late responses are harmless.
  useEffect(() => {
    if (it.connection !== 'connected') return
    let done = false
    const load = () =>
      Promise.all([fetchModel(), fetchVocabulary()])
        .then(([m, v]) => {
          done = true
          setModel(m)
          setVocab(v)
          // Follow the model's validated threshold unless the user picked their own.
          const rt = m.recommended_threshold
          if (typeof rt === 'number') setSettings((s) => (s.thresholdCustomized || s.threshold === rt ? s : { ...s, threshold: rt }))
          setLoadError(m.loaded ? null : `Recognition model unavailable: ${m.load_error ?? 'not loaded'}. Train it (README → Model) or use Simulated Demo mode in Settings → Advanced.`)
        })
        .catch(() => setLoadError('Could not load model information from the backend.'))
    void load()
    const timer = window.setInterval(() => {
      if (!done) void load()
    }, 3000)
    return () => clearInterval(timer)
  }, [it.connection])

  const phrases = (vocab.phrases?.length ?? 0) > 0
  const running = it.phase === 'running' || it.phase === 'starting'
  const backendDown = it.connection === 'disconnected' || it.connection === 'reconnecting' || it.connection === 'error'

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <Header phrases={phrases} connection={it.connection} meetingLive={meeting.enabled} onMuteMeeting={() => void meeting.mute()} onSettings={() => setSettingsOpen(true)} onHelp={() => setAboutOpen(true)} dark={dark} onToggleTheme={() => setDark((d) => !d)} />

      <main className="flex flex-1 flex-col gap-5 px-4 pb-10 sm:px-8">
        {backendDown && (
          <Banner tone="danger" icon={<AlertTriangle size={16} />}>
            <span>
              <strong className="font-semibold">Backend disconnected.</strong> Start it with <code className="rounded bg-black/5 px-1 font-mono text-xs">./scripts/dev.sh</code>{' '}
              — SignBridge reconnects automatically{running ? ' and resumes your session' : ''}.
            </span>
            <button type="button" onClick={it.reconnect} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-black/5">
              <RefreshCw size={13} /> Retry now
            </button>
          </Banner>
        )}
        {it.error && it.error.code !== 'backend_disconnected' && (
          <Banner tone="warn" icon={<AlertTriangle size={16} />}>
            <span>{it.error.message}</span>
            <button type="button" onClick={it.dismissError} aria-label="Dismiss" className="rounded-md p-1 hover:bg-black/5">
              <X size={14} />
            </button>
          </Banner>
        )}
        {settings.source === 'meeting' && !running && (
          <Banner tone="neutral" icon={<Info size={16} />}>
            <span>
              Meeting mode captures a tab or window you pick. Works best when <strong className="font-medium text-ink">one signer</strong> is pinned or spotlighted with
              both hands visible. To send your signs <em>to</em> the call, use “Send to meeting” below.
            </span>
          </Banner>
        )}

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <VideoPreview
              videoRef={it.videoRef}
              capture={it.capture}
              source={settings.source}
              onSourceChange={(source) => update({ source })}
              phase={it.phase}
              mode={settings.mode}
              connection={it.connection}
              status={it.status}
              showLandmarks={settings.showLandmarks}
              onToggleLandmarks={() => update({ showLandmarks: !settings.showLandmarks })}
              landmarksRef={it.landmarksRef}
              landmarkTick={it.landmarkTick}
              onStart={it.start}
              onStop={it.stop}
            />
          </div>
          <div className="lg:col-span-5">
            <InterpretationPanel
              phase={it.phase}
              activeMode={it.activeMode}
              caption={it.caption}
              partial={it.partial}
              unknown={it.unknown}
              status={it.status}
              history={it.history}
              onClearHistory={it.clearHistory}
              audioEnabled={settings.audioEnabled}
              onToggleAudio={() => update({ audioEnabled: !settings.audioEnabled })}
              speaking={it.speech.speaking}
              speechSupported={it.speech.supported}
              onStopSpeech={it.speech.cancel}
              threshold={settings.threshold}
              phrases={phrases}
              lastSign={it.lastSign}
            />
          </div>
        </div>

        <MeetingPanel
          meeting={meeting}
          connected={it.connection === 'connected'}
          simulatedSession={it.activeMode === 'simulated' && running}
          sendMode={settings.meetingSendMode}
          onSendMode={(meetingSendMode) => update({ meetingSendMode })}
          phrases={phrases}
        />

        <VocabularyPanel supported={vocab.supported} disabled={vocab.disabled} phrases={vocab.phrases} model={model} loadError={loadError} />

        <p className="text-center text-xs text-faint">
          Experimental prototype · limited {phrases ? 'phrases' : 'vocabulary'} · not a substitute for a qualified interpreter.{' '}
          <button type="button" className="underline hover:text-ink" onClick={() => setAboutOpen(true)}>
            Learn more
          </button>
        </p>
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={update}
        running={running}
        voices={it.speech.voices}
        speechSupported={it.speech.supported}
        onTestSpeech={() => it.speech.speak('SignBridge audio is ready.', undefined, true)}
        recommendedThreshold={model?.recommended_threshold}
        onClearSession={() => {
          it.clearHistory()
          it.speech.cancel()
        }}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} model={model} />
    </div>
  )
}

function Banner({ tone, icon, children }: { tone: 'danger' | 'warn' | 'neutral'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = { danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', neutral: 'border border-line bg-surface text-muted' }[tone]
  return (
    <div role={tone === 'neutral' ? 'note' : 'alert'} className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex flex-1 flex-wrap items-center justify-between gap-2">{children}</div>
    </div>
  )
}
