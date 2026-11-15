import { FlaskConical } from 'lucide-react'
import type { Caption } from '../hooks/useInterpretation'

interface Props {
  caption: Caption | null
  running: boolean
  simulatedSession: boolean
  phrases?: boolean
}

export function CaptionDisplay({ caption, running, simulatedSession, phrases = false }: Props) {
  return (
    <div className="relative min-h-[148px] rounded-xl bg-canvas px-6 py-5">
      {simulatedSession && (
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[11px] font-bold tracking-wider text-warn">
          <FlaskConical size={13} aria-hidden /> SIMULATED DEMO — captions are scripted, not recognized
        </div>
      )}
      <p className="text-xs font-medium uppercase tracking-wider text-faint">Caption</p>
      <div aria-live="assertive" aria-atomic="true">
        {caption ? (
          <div key={caption.at} className="caption-in">
            <p className="mt-2 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{caption.english}</p>
            {caption.glosses && caption.glosses.length > 0 && (
              <p className="mt-2 font-mono text-xs tracking-wide text-muted" aria-label="Recognized signs">
                {caption.glosses.join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-2xl font-medium text-faint">
            {running ? (phrases ? 'Waiting for a supported phrase…' : 'Waiting for a supported sign…') : 'Captions will appear here'}
          </p>
        )}
      </div>
    </div>
  )
}
