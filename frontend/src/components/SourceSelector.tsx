import { Camera, MonitorUp } from 'lucide-react'
import type { VideoSource } from '../types/interpretation'

interface Props {
  value: VideoSource
  onChange: (s: VideoSource) => void
  disabled?: boolean
}

const OPTIONS: { value: VideoSource; label: string; icon: typeof Camera }[] = [
  { value: 'webcam', label: 'Webcam', icon: Camera },
  { value: 'meeting', label: 'Meeting window', icon: MonitorUp },
]

export function SourceSelector({ value, onChange, disabled }: Props) {
  return (
    <div role="radiogroup" aria-label="Video source" className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
      {OPTIONS.map(({ value: v, label, icon: Icon }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={15} aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
}
