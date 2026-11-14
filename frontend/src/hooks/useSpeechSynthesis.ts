import { useCallback, useEffect, useRef, useState } from 'react'

export interface SpeechOptions {
  enabled: boolean
  rate: number
  voiceURI: string | null
}

const MAX_QUEUE = 3

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/**
 * Sequential speech queue on top of window.speechSynthesis.
 * One utterance at a time (no overlap), bounded queue, explicit cancel.
 */
export function useSpeechSynthesis(opts: SpeechOptions) {
  const supported = speechSupported()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const queue = useRef<{ text: string; onDone?: (ok: boolean) => void }[]>([])
  const busy = useRef(false)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!supported) return
    const load = () => {
      const all = window.speechSynthesis.getVoices()
      const en = all.filter((v) => v.lang.toLowerCase().startsWith('en'))
      setVoices(en.length ? en : all)
    }
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [supported])

  const pickVoice = useCallback((): SpeechSynthesisVoice | undefined => {
    const uri = optsRef.current.voiceURI
    if (uri) {
      const v = voices.find((x) => x.voiceURI === uri)
      if (v) return v
    }
    return voices.find((v) => v.lang === 'en-US' && v.default) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0]
  }, [voices])

  const next = useCallback(() => {
    if (!supported || busy.current) return
    const item = queue.current.shift()
    if (!item) {
      setSpeaking(false)
      return
    }
    busy.current = true
    setSpeaking(true)
    const u = new SpeechSynthesisUtterance(item.text)
    const v = pickVoice()
    if (v) u.voice = v
    u.lang = v?.lang ?? 'en-US'
    u.rate = optsRef.current.rate
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      busy.current = false
      item.onDone?.(ok)
      next()
    }
    u.onend = () => done(true)
    u.onerror = () => done(false)
    // Some engines never fire onend; guard with a timeout.
    window.setTimeout(() => done(true), 8000)
    window.speechSynthesis.speak(u)
  }, [pickVoice, supported])

  /** Returns false when speech is muted/unavailable (caption still shown). */
  const speak = useCallback(
    (text: string, onDone?: (ok: boolean) => void, force = false): boolean => {
      if (!supported) return false
      if (!optsRef.current.enabled && !force) return false
      queue.current.push({ text, onDone })
      while (queue.current.length > MAX_QUEUE) queue.current.shift()?.onDone?.(false)
      next()
      return true
    },
    [next, supported],
  )

  const cancel = useCallback(() => {
    if (!supported) return
    queue.current.forEach((q) => q.onDone?.(false))
    queue.current = []
    window.speechSynthesis.cancel()
    busy.current = false
    setSpeaking(false)
  }, [supported])

  useEffect(() => {
    if (!opts.enabled) cancel()
  }, [opts.enabled, cancel])

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel()
  }, [supported])

  return { supported, voices, speaking, speak, cancel }
}
