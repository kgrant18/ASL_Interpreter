import { ChevronDown, Speaker, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../types/interpretation'

interface Props {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  running: boolean
  voices: SpeechSynthesisVoice[]
  speechSupported: boolean
  onTestSpeech: () => void
  onClearSession: () => void
  recommendedThreshold?: number
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5 py-3">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm'

export function SettingsPanel(p: Props) {
  const [advanced, setAdvanced] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!p.open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.open, p, p.onClose])
  if (!p.open) return null
  const s = p.settings
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onClick={p.onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="h-full w-full max-w-sm overflow-y-auto border-l border-line bg-surface px-6 py-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button ref={closeRef} type="button" onClick={p.onClose} aria-label="Close settings" className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="divide-y divide-line">
          <Row label="Video source" htmlFor="set-source" hint={p.running ? 'Stop interpreting to change the source.' : undefined}>
            <select id="set-source" className={input} value={s.source} disabled={p.running} onChange={(e) => p.onChange({ source: e.target.value as Settings['source'] })}>
              <option value="webcam">Webcam</option>
              <option value="meeting">Meeting window / tab / screen</option>
            </select>
          </Row>

          <Row label="Speech output" htmlFor="set-audio">
            <label className="inline-flex items-center gap-2 text-sm">
              <input id="set-audio" type="checkbox" checked={s.audioEnabled} disabled={!p.speechSupported} onChange={(e) => p.onChange({ audioEnabled: e.target.checked })} />
              Speak recognized signs aloud
            </label>
            {!p.speechSupported && <p className="text-xs text-warn">This browser has no speech synthesis. Captions still work.</p>}
          </Row>

          <Row label={`Speech rate · ${s.speechRate.toFixed(1)}×`} htmlFor="set-rate">
            <input id="set-rate" type="range" min={0.6} max={1.6} step={0.1} value={s.speechRate} onChange={(e) => p.onChange({ speechRate: Number(e.target.value) })} />
          </Row>

          <Row label="Voice" htmlFor="set-voice" hint={p.voices.length ? undefined : 'No voices reported by the browser yet.'}>
            <select id="set-voice" className={input} value={s.voiceURI ?? ''} onChange={(e) => p.onChange({ voiceURI: e.target.value || null })}>
              <option value="">Default English voice</option>
              {p.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
            <button type="button" onClick={p.onTestSpeech} disabled={!p.speechSupported} className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-50">
              <Speaker size={14} /> Test speech
            </button>
          </Row>

          <Row label="Landmark overlay" htmlFor="set-lm">
            <label className="inline-flex items-center gap-2 text-sm">
              <input id="set-lm" type="checkbox" checked={s.showLandmarks} onChange={(e) => p.onChange({ showLandmarks: e.target.checked })} />
              Draw detected hands and upper body
            </label>
          </Row>

          <Row label={`Phrase pause · ${(s.phrasePauseMs / 1000).toFixed(1)} s`} htmlFor="set-pause" hint="In “Phrase after pause” meeting mode, signs are joined and sent after this much time without a new sign (or when you leave the frame).">
            <input id="set-pause" type="range" min={1000} max={5000} step={250} value={s.phrasePauseMs} onChange={(e) => p.onChange({ phrasePauseMs: Number(e.target.value) })} />
          </Row>

          <div className="py-3">
            <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
              <ChevronDown size={15} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} /> Advanced
            </button>
            {advanced && (
              <div className="mt-2 divide-y divide-line">
                <Row label={`Recognition threshold · ${s.threshold.toFixed(2)}`} htmlFor="set-th" hint="Minimum model score before a sign can be captioned. Higher = fewer false captions, more missed signs.">
                  <input id="set-th" type="range" min={0.4} max={0.95} step={0.05} value={s.threshold} onChange={(e) => p.onChange({ threshold: Number(e.target.value), thresholdCustomized: true })} />
                  {s.thresholdCustomized && p.recommendedThreshold !== undefined && (
                    <button type="button" className="self-start text-xs underline" onClick={() => p.onChange({ threshold: p.recommendedThreshold, thresholdCustomized: false })}>
                      Reset to model default ({p.recommendedThreshold.toFixed(2)})
                    </button>
                  )}
                </Row>
                <Row label={`Target processing FPS · ${s.targetFps}`} htmlFor="set-fps" hint="The model was trained at ~15 FPS. Lower this on slower machines.">
                  <input id="set-fps" type="range" min={5} max={20} step={1} value={s.targetFps} onChange={(e) => p.onChange({ targetFps: Number(e.target.value) })} />
                </Row>
                <Row label="Recognition mode" htmlFor="set-mode" hint="Simulated demo shows scripted captions to demonstrate the UI and speech pipeline. It is always labeled SIMULATED DEMO and does not recognize ASL.">
                  <select id="set-mode" className={input} value={s.mode} disabled={p.running} onChange={(e) => p.onChange({ mode: e.target.value as Settings['mode'] })}>
                    <option value="live">Live recognition (real model)</option>
                    <option value="simulated">Simulated demo (scripted)</option>
                  </select>
                </Row>
              </div>
            )}
          </div>

          <div className="py-4">
            <button type="button" onClick={p.onClearSession} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft">
              Clear session (history & captions)
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
