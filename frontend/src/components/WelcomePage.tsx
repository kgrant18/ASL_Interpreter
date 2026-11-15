import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { AboutDialog, DISCLAIMER } from './AboutDialog'
import { Logo } from './Header'
import { useTheme } from './ConnectPage'

export const WELCOME_LINE =
  'SignBridge turns supported ASL phrases into spoken words and live captions in Zoom, so Deaf students can join group calls without waiting on an interpreter.'

export function WelcomePage({ onBegin }: { onBegin: () => void }) {
  useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <div className="flex min-h-screen flex-col px-6">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center py-16 text-center">
        <Logo className="h-14 w-14" />
        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">SignBridge</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted">{WELCOME_LINE}</p>
        <button
          type="button"
          onClick={onBegin}
          autoFocus
          className="btn btn-primary mt-12 px-8"
        >
          Begin <ArrowRight size={18} aria-hidden />
        </button>
      </main>
      <footer className="t-meta mx-auto max-w-2xl pb-8 text-center leading-relaxed">
        {DISCLAIMER}{' '}
        <button type="button" className="underline hover:text-ink" onClick={() => setAboutOpen(true)}>
          Learn more
        </button>
      </footer>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}
