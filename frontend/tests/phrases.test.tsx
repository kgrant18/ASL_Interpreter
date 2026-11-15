import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import Root from '../src/Root'
import { FakeWebSocket, meeting, spoken, vocabInfo } from './setup'

const PHRASES = [
  { id: 'greeting', english: "Hello, it's nice to meet you.", glosses: ['HELLO', 'NICE', 'MEET', 'YOU'] },
  { id: 'missed', english: 'Did I miss anything?', glosses: ['ME', 'MISS', 'SOMETHING'] },
  { id: 'idea', english: 'I have an idea.', glosses: ['ME', 'HAVE', 'IDEA'] },
  { id: 'show', english: 'I can show this.', glosses: ['ME', 'CAN', 'SHOW', 'THIS'] },
  { id: 'thanks', english: 'Thank you for listening.', glosses: ['THANKYOU'] },
]

const sock = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

async function setup() {
  const user = userEvent.setup()
  render(<App />)
  await act(async () => sock().open())
  await screen.findByRole('region', { name: /supported phrases/i })
  return user
}

async function startSession(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /start interpreting/i }))
  const start = await waitFor(() => {
    const m = sock().json().find((x) => x.type === 'session.start')
    expect(m).toBeTruthy()
    return m!
  })
  await act(async () =>
    sock().receive({ type: 'session.started', session_id: start.session_id, timestamp_ms: 0, mode: 'live', window_seconds: 1.6, model_loaded: true }),
  )
  return start.session_id as string
}

const sign = (sid: string, seq: number, label: string, pending: string[]) => ({
  type: 'recognition.sign', session_id: sid, timestamp_ms: 0, sequence: seq, label, score: 0.9, pending,
})

const phrase = (sid: string, id: number, english: string, glosses: string[], phraseId = 'idea') => ({
  type: 'recognition.result',
  session_id: sid,
  timestamp_ms: 0,
  sequence: 100 + id,
  event_id: id,
  prediction: { label: glosses.join(' '), english, score: 0.88, is_stable: true, is_unknown: false },
  performance: { processing_ms: 30, processed_fps: 14, dropped_frames: 0 },
  glosses,
  phrase_id: phraseId,
})

beforeEach(() => {
  FakeWebSocket.instances = []
  spoken.length = 0
  localStorage.clear()
  meeting.reset()
  vocabInfo.phrases = PHRASES
})
afterEach(() => {
  vocabInfo.phrases = []
  window.location.hash = ''
})

describe('supported phrases', () => {
  it('lists the supported phrases instead of individual signs', async () => {
    await setup()
    const panel = screen.getByRole('region', { name: /supported phrases/i })
    for (const p of PHRASES) expect(within(panel).getByText(`“${p.english}”`)).toBeInTheDocument()
    expect(within(panel).getByText('ME CAN SHOW THIS')).toBeInTheDocument()
    expect(screen.queryByText(/trained but disabled/i)).not.toBeInTheDocument()
    expect(screen.getByText(/supported phrases$/i, { selector: 'p' })).toBeInTheDocument()
  })

  it('never shows model choices, training or recording controls', async () => {
    await setup()
    const text = document.body.textContent ?? ''
    for (const word of [/\bv[123]\b/, /pitch mode/i, /\bpersonal/i, /general \+ personal/i, /\btrain(ing|ed)?\b/i, /\brecord(ing|er)?\b/i, /\bdemo mode\b/i])
      expect(text).not.toMatch(word)
  })

  it('shows individual signs without speaking or logging them', async () => {
    const user = await setup()
    const sid = await startSession(user)
    await act(async () => sock().receive(sign(sid, 1, 'ME', ['ME'])))
    await act(async () => sock().receive(sign(sid, 2, 'HAVE', ['ME', 'HAVE'])))
    expect(screen.getByText('ME · HAVE')).toBeInTheDocument()
    expect(spoken).toEqual([])
    expect(screen.getByText(/Recognized signs will be listed here/)).toBeInTheDocument()
    expect(screen.getByText('Waiting for a supported phrase…')).toBeInTheDocument()
  })

  it('captions the sentence with glosses underneath, speaks it once, logs it', async () => {
    const user = await setup()
    const sid = await startSession(user)
    await act(async () => sock().receive(phrase(sid, 1, 'I have an idea.', ['ME', 'HAVE', 'IDEA'])))
    expect(screen.getByText('I have an idea.', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByLabelText('Recognized signs')).toHaveTextContent('ME · HAVE · IDEA')
    await waitFor(() => expect(spoken).toEqual(['I have an idea.']))
    const history = screen.getByRole('list', { name: /interpretation history/i })
    expect(within(history).getAllByRole('listitem')).toHaveLength(1)
    expect(within(history).getByText('I have an idea.')).toBeInTheDocument()
  })

  it('sends a matched sentence to the call immediately, as is', async () => {
    const user = await setup()
    await user.click(await screen.findByRole('button', { name: /start sending to call/i }))
    expect(screen.queryByRole('radiogroup', { name: /send mode/i })).not.toBeInTheDocument()
    const sid = await startSession(user)
    await act(async () => sock().receive(sign(sid, 1, 'THANKYOU', ['THANKYOU'])))
    await act(async () => sock().receive(phrase(sid, 1, 'Thank you for listening.', ['THANKYOU'], 'thanks')))
    await waitFor(() => expect(meeting.sends).toEqual([{ text: 'Thank you for listening.', source: 'recognition', simulated: false }]))
  })
})

describe('local recorder route', () => {
  it('is only reachable through the hidden route / shortcut', async () => {
    const user = userEvent.setup()
    render(<Root />)
    await act(async () => sock().open())
    expect(screen.queryByRole('button', { name: /start camera/i })).not.toBeInTheDocument()
    await user.keyboard('{Control>}{Alt>}r{/Alt}{/Control}')
    expect(await screen.findByRole('button', { name: /start camera/i })).toBeInTheDocument()
    expect(screen.getAllByText('0/25')).toHaveLength(6)
    expect(screen.getByText('0/30')).toBeInTheDocument()
  })
})
