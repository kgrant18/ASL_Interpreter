import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ModelInfo } from '../types/interpretation'
import { Logo } from './Header'

export const DISCLAIMER =
  'SignBridge is an experimental ASL recognition prototype supporting a limited vocabulary. It is not a substitute for a qualified interpreter, particularly in medical, legal, emergency, or other high-stakes settings.'

export function AboutDialog({ open, onClose, model }: { open: boolean; onClose: () => void; model: ModelInfo | null }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="About SignBridge" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <h2 className="text-lg font-semibold">About SignBridge</h2>
          </div>
          <button ref={ref} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">{DISCLAIMER}</p>

        <div className="mt-5 space-y-4 text-sm leading-relaxed text-muted">
          <section>
            <h3 className="mb-1 font-semibold text-ink">What it does</h3>
            <p>
              SignBridge watches your webcam or a meeting window you choose, extracts hand and upper-body landmarks, and recognizes a small set of
              ASL signs and the supported phrases built from them. Recognized phrases become English captions, are spoken aloud, and can be sent into a
              Zoom, Meet or Teams call through a virtual microphone.
            </p>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-ink">What it does not do</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Translate continuous ASL, grammar, fingerspelling or facial expressions.</li>
              <li>Speak into a call unless you turn on “Send to meeting” (it is off every time the app starts).</li>
              <li>Pick the signer automatically when several people are on screen. Spotlight or pin the signer.</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-ink">Best results</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Signer's head, shoulders and both hands are visible and fill much of the frame.</li>
              <li>Even lighting, plain background, steady camera.</li>
              <li>Sign a supported phrase at a natural pace, then lower your hands.</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-ink">Privacy</h3>
            <p>
              Video frames are sent only to the SignBridge backend running on this machine. Frames and landmarks are processed in memory and never
              stored or uploaded. Stop interpreting at any time to release the camera or screen capture.
            </p>
          </section>
          {model?.loaded && (
            <section>
              <h3 className="mb-1 font-semibold text-ink">Model</h3>
              <p>
                {model.name} (v{model.version}) on {model.device}. Trained on {model.dataset}.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {model.limitations.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
