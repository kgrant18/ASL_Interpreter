import { FlaskConical } from 'lucide-react'
import type { Caption } from '../hooks/useInterpretation'

interface Props {
  caption: Caption | null
  running: boolean
  simulatedSession: boolean
}

export function CaptionDisplay({ caption, running, simulatedSession }: Props) {
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
          <p key={caption.at} className="caption-in mt-2 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            {caption.english}
          </p>
        ) : (
          <p className="mt-2 text-2xl font-medium text-faint">
            {running ? 'Waiting for a supported sign…' : 'Captions will appear here'}
          </p>
        )}
      </div>
    </div>
  )
}
