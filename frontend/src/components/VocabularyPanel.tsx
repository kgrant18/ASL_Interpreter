import { CheckCircle2, ChevronDown, CircleSlash } from 'lucide-react'
import { useState } from 'react'
import type { ModelInfo, SupportedPhrase, VocabularyEntry } from '../types/interpretation'

interface Props {
  supported: VocabularyEntry[]
  disabled: VocabularyEntry[]
  model: ModelInfo | null
  loadError: string | null
  phrases?: SupportedPhrase[]
}

export function VocabularyPanel({ supported, disabled, model, loadError, phrases = [] }: Props) {
  const [showDisabled, setShowDisabled] = useState(false)
  if (phrases.length > 0 && !loadError) return <PhrasesPanel phrases={phrases} />
  return (
    <section aria-label="Supported vocabulary" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Supported vocabulary</h2>
          <p className="text-xs text-muted">
            Isolated ASL signs this model was validated on with held-out signers. Anything else is reported as “no supported sign”.
          </p>
        </div>
        {model?.loaded && (
          <p className="font-mono text-[11px] text-faint">
            {model.name} · v{model.version} · {model.device}
          </p>
        )}
      </div>

      {!model && !loadError ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          Loading model information from the backend…
        </p>
      ) : loadError ? (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{loadError}</p>
      ) : supported.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          {model?.loaded ? 'No signs passed validation for this model.' : 'Model unavailable — start the backend and train the model (see README), or use Simulated Demo mode.'}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {supported.map((v) => (
            <li key={v.label} className="rounded-xl border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{v.label}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-accent" title={v.validation}>
                  <CheckCircle2 size={12} aria-hidden /> validated
                </span>
              </div>
              <p className="mt-1 text-sm font-medium">“{v.english}”</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{v.description}</p>
              {v.test_accuracy !== null && v.test_samples !== null && (
                <p className="mt-1.5 text-[11px] text-faint">
                  Held-out accuracy {(v.test_accuracy * 100).toFixed(0)}% on {v.test_samples} clips
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {disabled.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowDisabled((s) => !s)} aria-expanded={showDisabled} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
            <ChevronDown size={14} className={`transition-transform ${showDisabled ? 'rotate-180' : ''}`} />
            {disabled.length} trained but disabled signs
          </button>
          {showDisabled && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {disabled.map((v) => (
                <li key={v.label} title={v.validation} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-faint">
                  <CircleSlash size={11} aria-hidden /> {v.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function PhrasesPanel({ phrases }: { phrases: SupportedPhrase[] }) {
  return (
    <section aria-label="Supported phrases" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Supported phrases</h2>
        <p className="text-xs text-muted">
          Sign one of these phrases at a natural pace, then lower your hands. The English sentence is captioned and spoken; anything else is not.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {phrases.map((p) => (
          <li key={p.id} className="rounded-xl border border-line px-4 py-3">
            <p className="text-sm font-medium">“{p.english}”</p>
            <p className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted">
              <CheckCircle2 size={12} className="text-accent" aria-hidden /> {p.glosses.join(' ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
