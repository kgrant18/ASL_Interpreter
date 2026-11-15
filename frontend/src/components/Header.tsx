import { CircleHelp, Moon, Radio, Settings as SettingsIcon, Sun } from 'lucide-react'
import type { ConnectionState } from '../types/interpretation'
import { StatusIndicator } from './StatusIndicator'

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <path d="M8 19c3-6 6-9 8-9s5 3 8 9" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9" cy="21.5" r="2" fill="white" />
      <circle cx="23" cy="21.5" r="2" fill="white" />
    </svg>
  )
}

interface Props {
  connection: ConnectionState
  onSettings: () => void
  onHelp: () => void
  dark: boolean
  onToggleTheme: () => void
  meetingLive?: boolean
  onMuteMeeting?: () => void
  phrases?: boolean
}

export function Header({ connection, onSettings, onHelp, dark, onToggleTheme, meetingLive, onMuteMeeting, phrases }: Props) {
  const btn = 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink border border-transparent hover:border-line transition-colors'
  return (
    <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        <Logo />
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold tracking-tight">SignBridge</h1>
          <p className="text-xs text-muted">Live ASL recognition — supported {phrases ? 'phrases' : 'vocabulary'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {meetingLive && (
          <button
            type="button"
            onClick={onMuteMeeting}
            title="Sending to the call — click or press Ctrl+Shift+M to stop"
            className="inline-flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-semibold text-white"
          >
            <Radio size={12} className="animate-pulse" /> Live to call · Stop
          </button>
        )}
        <span className="hidden sm:inline-flex">
          <StatusIndicator state={connection} />
        </span>
        <button type="button" className={btn} onClick={onToggleTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button type="button" className={btn} onClick={onHelp} aria-label="About and help">
          <CircleHelp size={18} />
        </button>
        <button type="button" className={btn} onClick={onSettings} aria-label="Settings">
          <SettingsIcon size={18} />
        </button>
      </div>
    </header>
  )
}
