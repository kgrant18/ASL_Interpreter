import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Optional floating caption bubble: a small always-on-top window (Chrome's Document
 * Picture-in-Picture) that shows "You said: <sentence>" for a few seconds, so the
 * signer can confirm what was spoken while Zoom is in front.
 * Unsupported browsers simply don't offer it.
 */

const SHOW_MS = 6000

type PipWindow = Window & { document: Document }
interface DocumentPiP {
  requestWindow: (opts: { width: number; height: number }) => Promise<PipWindow>
  window: PipWindow | null
}

function api(): DocumentPiP | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ?? null
}

export function bubbleSupported(): boolean {
  return api() !== null
}

function render(w: PipWindow, sentence: string | null) {
  const d = w.document
  const dark = document.documentElement.classList.contains('dark')
  d.body.style.cssText = [
    'margin:0',
    'height:100vh',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    `background:${dark ? '#1c1c1a' : '#ffffff'}`,
    `color:${dark ? '#ecebe6' : '#1c1b19'}`,
  ].join(';')
  d.body.replaceChildren()
  const box = d.createElement('div')
  box.style.cssText = 'padding:12px 18px;text-align:center;line-height:1.25'
  if (sentence) {
    const label = d.createElement('div')
    label.textContent = 'You said'
    label.style.cssText = `font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${dark ? '#6cbca4' : '#2f6f5e'}`
    const text = d.createElement('div')
    text.textContent = sentence
    text.style.cssText = 'margin-top:4px;font-size:22px;font-weight:700'
    box.append(label, text)
  } else {
    box.textContent = 'SignBridge · listening'
    box.style.cssText += `;font-size:13px;color:${dark ? '#77746b' : '#9a968c'}`
  }
  d.body.append(box)
  d.title = 'SignBridge'
}

/** `latest` = id + sentence of the most recent sentence sent to the call. */
export function useCaptionBubble(latest: { id: string; english: string } | null) {
  const [open, setOpen] = useState(false)
  const win = useRef<PipWindow | null>(null)
  const timer = useRef<number | null>(null)
  const lastId = useRef<string | null>(latest?.id ?? null)

  const close = useCallback(() => {
    win.current?.close()
    win.current = null
    setOpen(false)
  }, [])

  const toggle = useCallback(async () => {
    const pip = api()
    if (!pip) return
    if (win.current) return close()
    const w = await pip.requestWindow({ width: 380, height: 110 })
    win.current = w
    lastId.current = latest?.id ?? null
    render(w, null)
    w.addEventListener('pagehide', () => {
      win.current = null
      setOpen(false)
    })
    setOpen(true)
  }, [close, latest?.id])

  useEffect(() => {
    const w = win.current
    if (!w || !latest || latest.id === lastId.current) return
    lastId.current = latest.id
    render(w, latest.english)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => win.current && render(win.current, null), SHOW_MS)
  }, [latest])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    win.current?.close()
  }, [])

  return { supported: bubbleSupported(), open, toggle }
}
