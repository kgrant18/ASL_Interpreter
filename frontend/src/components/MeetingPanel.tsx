import { CircleAlert, Mic, MicOff, Radio, Send, Subtitles } from 'lucide-react'
import { useState } from 'react'
import type { SendMode, useMeetingOutput } from '../hooks/useMeetingOutput'
import { composePhrase } from '../lib/phrase'
import type { SentItem } from '../services/meetingApi'

type Meeting = ReturnType<typeof useMeetingOutput>

interface Props {
  meeting: Meeting
  connected: boolean
  simulatedSession: boolean
  sendMode: SendMode
  onSendMode: (m: SendMode) => void
  phrases?: boolean
}

function Toggle({ id, checked, onChange, disabled, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className={`flex items-start justify-between gap-3 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function deliveryText(s: string): { text: string; tone: string } {
  if (s === 'sent') return { text: 'sent', tone: 'text-accent' }
  if (s === 'pending') return { text: 'sending…', tone: 'text-muted' }
  if (s === 'skipped') return { text: 'off', tone: 'text-faint' }
  return { text: 'failed', tone: 'text-danger' }
}

function SentRow({ item }: { item: SentItem }) {
  const sp = deliveryText(item.speech)
  const cc = deliveryText(item.caption)
  const failure = [item.speech, item.caption].find((s) => s.startsWith('failed'))
  return (
    <li className="flex flex-col gap-0.5 py-1.5 text-sm" title={failure}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{item.text}</span>
        <span className="shrink-0 text-[11px]">
          <span className={sp.tone}>voice {sp.text}</span> · <span className={cc.tone}>captions {cc.text}</span>
        </span>
      </div>
      {failure && <span className="text-xs text-danger">{failure.replace(/^failed: /, '')}</span>}
    </li>
  )
}

export function MeetingPanel({ meeting, connected, simulatedSession, sendMode, onSendMode, phrases = false }: Props) {
  const [token, setToken] = useState('')
  const [typed, setTyped] = useState('')
  const st = meeting.status
  const cfg = st?.config
  const live = Boolean(cfg?.enabled)
  const mic = st?.virtual_mic
  const unavailable = !connected || !st

  return (
    <section aria-label="Send to meeting" className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 sm:p-5 ${live ? 'border-danger' : 'border-line'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Send to meeting</h2>
          {live ? (
            <span role="status" className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              <Radio size={11} className="animate-pulse" /> Live to call
            </span>
          ) : (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Off</span>
          )}
        </div>
        {live ? (
          <button type="button" onClick={() => void meeting.mute()} className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <MicOff size={13} /> Stop sending <kbd className="ml-1 rounded bg-white/20 px-1 font-mono text-[10px]">Ctrl+Shift+M</kbd>
          </button>
        ) : (
          <button
            type="button"
            disabled={unavailable || simulatedSession || !(cfg?.speech || cfg?.captions)}
            onClick={() => void meeting.setConfig({ enabled: true })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            <Radio size={13} /> Start sending to call
          </button>
        )}
      </div>

      <p className="text-xs text-muted">
        {phrases ? 'Recognized phrases' : 'Recognized signs'} are spoken into a virtual microphone and/or posted as Zoom captions so other participants receive them. Only live recognition and text you type
        are sent — simulated demo output never is. Review captions here: recognition errors will reach the call.
      </p>

      {simulatedSession && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          <CircleAlert size={13} /> Simulated demo is running — meeting output is disabled.
        </p>
      )}
      {unavailable && <p className="text-xs text-muted">Waiting for the SignBridge backend…</p>}
      {meeting.error && (
        <p role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <span>{meeting.error}</span>
          <button type="button" onClick={meeting.dismissError} className="underline">
            Dismiss
          </button>
        </p>
      )}

      {st && cfg && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Voice */}
          <div className="rounded-xl border border-line p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Mic size={14} /> Voice (virtual microphone)
            </div>
            {!mic?.available ? (
              <p className="text-xs text-danger">{mic?.error ?? 'Audio system unavailable.'}</p>
            ) : mic.active ? (
              <p className="text-xs text-muted">
                Ready. In Zoom: <strong className="font-medium text-ink">Settings → Audio → Microphone → “{mic.device_name}”</strong>.{' '}
                {mic.managed !== false && (
                  <button type="button" className="underline" onClick={() => void meeting.virtualMic('remove')}>
                    Remove device
                  </button>
                )}
              </p>
            ) : (
              <button type="button" className="mt-1 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-canvas" onClick={() => void meeting.virtualMic('create')}>
                Create “SignBridge Virtual Microphone”
              </button>
            )}
            {!st.tts.available && <p className="mt-1 text-xs text-danger">Speech voice not installed — run ./scripts/setup.sh.</p>}
            <Toggle id="mo-speech" label="Speak into the call" checked={cfg.speech} onChange={(v) => void meeting.setConfig({ speech: v })} />
            <Toggle id="mo-monitor" label="Also play on my speakers" hint="Hear what the call hears." checked={cfg.local_monitor} onChange={(v) => void meeting.setConfig({ local_monitor: v })} />
          </div>

          {/* Captions */}
          <div className="rounded-xl border border-line p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Subtitles size={14} /> Zoom captions
            </div>
            {st.zoom.connected ? (
              <p className="text-xs text-muted">
                Connected ({st.zoom.endpoint}, {st.zoom.seq} sent).{' '}
                <button type="button" className="underline" onClick={() => void meeting.setZoomToken(null)}>
                  Disconnect
                </button>
              </p>
            ) : (
              <form
                className="mt-1 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void meeting.setZoomToken(token).then((ok) => ok && setToken(''))
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="Zoom caption API token"
                  placeholder="Paste caption API token"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-1 text-xs"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button type="submit" disabled={!token.trim()} className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-canvas disabled:opacity-40">
                  Connect
                </button>
              </form>
            )}
            <p className="mt-1 text-[11px] text-faint">Host: Captions → “Use a third-party service” → Copy the API token.</p>
            <Toggle id="mo-captions" label="Post captions" disabled={!st.zoom.connected} checked={cfg.captions} onChange={(v) => void meeting.setConfig({ captions: v })} />
            <Toggle id="mo-prefix" label="Prefix with [SignBridge]" hint="Tells participants captions are machine-generated." checked={cfg.caption_prefix} onChange={(v) => void meeting.setConfig({ caption_prefix: v })} />
          </div>
        </div>
      )}

      {st && !phrases && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs text-muted">Send</span>
          <div role="radiogroup" aria-label="Send mode" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            {(['sign', 'phrase'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={sendMode === m}
                onClick={() => onSendMode(m)}
                className={`rounded-md px-2.5 py-1 ${sendMode === m ? 'bg-accent-soft font-medium text-accent' : 'text-muted'}`}
              >
                {m === 'sign' ? 'Each sign' : 'Phrase after pause'}
              </button>
            ))}
          </div>
          {sendMode === 'phrase' && meeting.pending.labels.length > 0 && (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-muted">{meeting.pending.labels.join(' ')}</span>
              <span>→ “{composePhrase(meeting.pending.english)}”</span>
              <button type="button" className="underline" onClick={meeting.flush}>
                Send now
              </button>
              <button type="button" className="underline" onClick={meeting.clearPending}>
                Discard
              </button>
            </span>
          )}
        </div>
      )}

      {st && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void meeting.sendText(typed, 'typed').then((ok) => ok && setTyped(''))
          }}
        >
          <input
            aria-label="Type a message to send to the call"
            placeholder={live ? 'Type a message to speak / caption in the call' : 'Start sending to type a message to the call'}
            disabled={!live}
            maxLength={300}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm disabled:opacity-50"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" disabled={!live || !typed.trim()} aria-label="Send typed message" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 text-xs hover:bg-canvas disabled:opacity-40">
            <Send size={13} /> Send
          </button>
        </form>
      )}

      {st && st.recent.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted">Sent to call</h3>
          <ul aria-label="Sent to call" className="divide-y divide-line">
            {st.recent.slice(0, 5).map((i) => (
              <SentRow key={i.id} item={i} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
