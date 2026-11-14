import { Download, Trash2, Volume2, VolumeX } from 'lucide-react'
import type { HistoryEvent } from '../types/interpretation'

const SPEECH_LABEL: Record<HistoryEvent['speech'], string> = {
  spoken: 'Spoken',
  speaking: 'Speaking',
  queued: 'Speaking…',
  muted: 'Muted',
  unavailable: 'No audio',
  skipped: 'Not spoken',
}

function fmt(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function downloadTranscript(history: HistoryEvent[]) {
  const lines = [...history].reverse().map((e) =>
    `${new Date(e.time).toISOString()}\t${e.label}\t${e.english}\tscore=${e.score.toFixed(2)}${e.simulated ? '\tSIMULATED' : ''}`,
  )
  const blob = new Blob([`SignBridge transcript (limited-vocabulary ASL recognition)\n\n${lines.join('\n')}\n`], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `signbridge-transcript-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function HistoryPanel({ history, onClear }: { history: HistoryEvent[]; onClear: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">History</h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => downloadTranscript(history)}
            disabled={!history.length}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink disabled:opacity-40"
          >
            <Download size={13} /> Transcript
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!history.length}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink disabled:opacity-40"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>
      {history.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          Recognized signs will be listed here — one entry per sign.
        </p>
      ) : (
        <ol className="-mx-1 max-h-[340px] space-y-1 overflow-y-auto px-1" aria-label="Interpretation history">
          {history.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-canvas">
              <span className="w-[68px] shrink-0 font-mono text-[11px] text-faint">{fmt(e.time)}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.english}</span>
              {e.simulated && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">SIM</span>}
              <span className="font-mono text-[11px] text-muted" title="Model score (uncalibrated)">{e.score.toFixed(2)}</span>
              <span className="inline-flex w-[84px] items-center justify-end gap-1 text-[11px] text-faint">
                {e.speech === 'spoken' || e.speech === 'queued' || e.speech === 'speaking' ? <Volume2 size={12} /> : <VolumeX size={12} />}
                {SPEECH_LABEL[e.speech]}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
