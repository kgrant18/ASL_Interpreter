import type { ConnectionState } from '../types/interpretation'

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  connected: 'Backend connected',
  disconnected: 'Backend disconnected',
  reconnecting: 'Reconnecting',
  error: 'Connection error',
}

const TONE: Record<ConnectionState, string> = {
  connecting: 'bg-warn',
  connected: 'bg-accent',
  disconnected: 'bg-danger',
  reconnecting: 'bg-warn',
  error: 'bg-danger',
}

export function StatusIndicator({ state }: { state: ConnectionState }) {
  const animated = state === 'connecting' || state === 'reconnecting'
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted"
    >
      <span className={`h-2 w-2 rounded-full ${TONE[state]} ${animated ? 'pulse-dot' : ''}`} aria-hidden />
      {LABELS[state]}
    </span>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger' }) {
  const cls = {
    neutral: 'border-line bg-surface text-muted',
    accent: 'border-transparent bg-accent-soft text-accent',
    warn: 'border-transparent bg-warn-soft text-warn',
    danger: 'border-transparent bg-danger-soft text-danger',
  }[tone]
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}
