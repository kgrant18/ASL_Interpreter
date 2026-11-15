import { Hand, Square, Volume2, VolumeX } from 'lucide-react'
import type { Caption, LiveStatus, RecognizedSign, SessionPhase } from '../hooks/useInterpretation'
import type { HistoryEvent, Prediction, RecognitionMode } from '../types/interpretation'
import { CaptionDisplay } from './CaptionDisplay'
import { HistoryPanel } from './HistoryPanel'
import { Pill } from './StatusIndicator'

interface Props {
  phase: SessionPhase
  activeMode: RecognitionMode | null
  caption: Caption | null
  partial: { prediction: Prediction; top: [string, number][] } | null
  unknown: boolean
  status: LiveStatus
  history: HistoryEvent[]
  onClearHistory: () => void
  audioEnabled: boolean
  onToggleAudio: () => void
  speaking: boolean
  speechSupported: boolean
  onStopSpeech: () => void
  threshold: number
  phrases?: boolean
  lastSign?: RecognizedSign | null
}

function recognitionLine(p: Props): { text: string; tone: 'neutral' | 'accent' | 'warn' } {
  if (p.phase !== 'running') return { text: 'Not interpreting', tone: 'neutral' }
  if (p.activeMode === 'simulated') return { text: 'Simulated demo running', tone: 'warn' }
  const s = p.status.processing
  if (s === null) return { text: 'Waiting for processing', tone: 'neutral' }
  if (s === 'no_signer') return { text: 'No signer visible', tone: 'neutral' }
  if (s === 'no_hands') return { text: 'No hands detected', tone: 'neutral' }
  if (s === 'collecting') return { text: 'Collecting motion', tone: 'neutral' }
  if (p.partial) return { text: 'Recognizing', tone: 'accent' }
  if (p.unknown) return { text: p.phrases ? 'Watching for supported phrases' : 'No supported sign recognized', tone: 'neutral' }
  return { text: 'Watching for signs', tone: 'neutral' }
}

export function InterpretationPanel(p: Props) {
  const line = recognitionLine(p)
  const latest = p.history[0]
  const simulatedSession = p.activeMode === 'simulated'
  return (
    <section aria-label="Interpretation" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Interpretation</h2>
        <div className="flex items-center gap-1.5">
          {p.speaking && (
            <button type="button" onClick={p.onStopSpeech} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink">
              <Square size={11} className="fill-current" /> Stop speech
            </button>
          )}
          <button
            type="button"
            onClick={p.onToggleAudio}
            aria-pressed={p.audioEnabled}
            disabled={!p.speechSupported}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
              p.audioEnabled && p.speechSupported ? 'border-transparent bg-accent-soft text-accent' : 'border-line text-muted'
            }`}
          >
            {p.audioEnabled && p.speechSupported ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {!p.speechSupported ? 'Speech unavailable' : p.audioEnabled ? 'Speech on' : 'Muted'}
          </button>
        </div>
      </div>

      <CaptionDisplay caption={p.caption} running={p.phase === 'running'} simulatedSession={simulatedSession} phrases={p.phrases} />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Status</p>
          <div className="mt-1.5">
            <Pill tone={line.tone}>
              <Hand size={12} aria-hidden /> {line.text}
            </Pill>
          </div>
          {p.phase === 'running' && !simulatedSession && (
            <p className="mt-2 text-xs text-muted">
              {p.partial ? (
                <>
                  Tracking <span className="font-medium text-ink">{p.partial.prediction.english}</span>{' '}
                  <span className="font-mono">{p.partial.prediction.score.toFixed(2)}</span>
                  {p.partial.prediction.score < p.threshold && <span className="text-faint"> · below threshold</span>}
                </>
              ) : (
                <>Hands in frame: {p.status.handsVisible}</>
              )}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Latest sign</p>
          {p.phrases && !simulatedSession ? (
            p.lastSign ? (
              <>
                <p className="mt-1.5 font-mono text-sm font-semibold">{p.lastSign.label}</p>
                <p className="mt-1 text-xs text-muted">
                  {p.lastSign.pending.length > 1 ? (
                    <span className="font-mono">{p.lastSign.pending.join(' · ')}</span>
                  ) : (
                    <>
                      Model score <span className="font-mono">{p.lastSign.score.toFixed(2)}</span>
                      <span className="text-faint"> (uncalibrated)</span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-faint">—</p>
            )
          ) : latest ? (
            <>
              <p className="mt-1.5 font-mono text-sm font-semibold">{latest.label}</p>
              <p className="mt-1 text-xs text-muted">
                Model score <span className="font-mono">{latest.score.toFixed(2)}</span>
                <span className="text-faint"> (uncalibrated)</span>
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-faint">—</p>
          )}
        </div>
      </div>

      <HistoryPanel history={p.history} onClear={p.onClearHistory} />
    </section>
  )
}
