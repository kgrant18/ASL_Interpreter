import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { composePhrase } from '../src/lib/phrase'
import { FakeWebSocket, meeting, modelInfo } from './setup'

const sock = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

async function setup() {
  const user = userEvent.setup()
  render(<App />)
  await act(async () => sock().open())
  await screen.findByRole('button', { name: /start sending to call/i })
  return user
}

async function startSession(user: ReturnType<typeof userEvent.setup>, mode: 'live' | 'simulated' = 'live') {
  await user.click(screen.getByRole('button', { name: /start interpreting/i }))
  const start = await waitFor(() => {
    const m = sock().json().find((x) => x.type === 'session.start')
    expect(m).toBeTruthy()
    return m!
  })
  await act(async () =>
    sock().receive({ type: 'session.started', session_id: start.session_id, timestamp_ms: 0, mode, window_seconds: 1.6, model_loaded: true }),
  )
  return start.session_id as string
}

const result = (sid: string, id: number, label: string, english: string, simulated = false) => ({
  type: 'recognition.result',
  session_id: sid,
  timestamp_ms: 0,
  sequence: id,
  event_id: id,
  simulated,
  prediction: { label, english, score: 0.9, is_stable: true, is_unknown: false },
  performance: { processing_ms: 30, processed_fps: 14, dropped_frames: 0 },
})

beforeEach(() => {
  FakeWebSocket.instances = []
  localStorage.clear()
  meeting.reset()
  modelInfo.recommended = undefined
})

describe('model-recommended threshold', () => {
  it('uses the model threshold unless the user customized it', async () => {
    modelInfo.recommended = 0.6
    const user = await setup()
    await screen.findByText('“Hello.”') // model + vocabulary loaded
    const sid = await startSession(user)
    const start = sock().json().find((x) => x.type === 'session.start' && x.session_id === sid)!
    expect(start.threshold).toBe(0.6)
  })

  it('keeps a user-chosen threshold', async () => {
    modelInfo.recommended = 0.6
    localStorage.setItem('signbridge.settings.v1', JSON.stringify({ threshold: 0.85, thresholdCustomized: true }))
    const user = await setup()
    await screen.findByText('“Hello.”')
    const sid = await startSession(user)
    expect(sock().json().find((x) => x.type === 'session.start' && x.session_id === sid)!.threshold).toBe(0.85)
  })
})

describe('composePhrase', () => {
  it('joins glosses and fixes punctuation', () => {
    expect(composePhrase(['Hello.', 'Nice.', 'Meet.', 'You.'])).toBe('Hello nice meet you.')
    expect(composePhrase(['You.', 'Name.', 'What?'])).toBe('You name what?')
    expect(composePhrase(['Where?', 'Bathroom.'])).toBe('Where bathroom?')
    expect(composePhrase(['Learn.', 'English.'])).toBe('Learn English.')
    expect(composePhrase([])).toBe('')
  })
})

describe('meeting output', () => {
  it('is off by default and sends nothing', async () => {
    const user = await setup()
    expect(screen.getByText('Off')).toBeInTheDocument()
    const sid = await startSession(user)
    await act(async () => sock().receive(result(sid, 1, 'HELLO', 'Hello.')))
    await new Promise((r) => setTimeout(r, 50))
    expect(meeting.sends).toHaveLength(0)
  })

  it('sends each sign when live in per-sign mode and shows a live indicator', async () => {
    const user = await setup()
    await user.click(screen.getByRole('radio', { name: /each sign/i }))
    await user.click(screen.getByRole('button', { name: /start sending to call/i }))
    expect(await screen.findAllByText(/live to call/i)).not.toHaveLength(0)
    const sid = await startSession(user)
    await act(async () => sock().receive(result(sid, 1, 'HELLO', 'Hello.')))
    await waitFor(() => expect(meeting.sends).toEqual([{ text: 'Hello.', source: 'recognition', simulated: false }]))
    expect(within(await screen.findByRole('list', { name: /sent to call/i })).getByText('Hello.')).toBeInTheDocument()
  })

  it('joins signs into a phrase after a pause', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /start sending to call/i }))
    const sid = await startSession(user)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await act(async () => sock().receive(result(sid, 1, 'WHERE', 'Where?')))
      await act(async () => sock().receive(result(sid, 2, 'BATHROOM', 'Bathroom.')))
      expect(screen.getByText('WHERE BATHROOM')).toBeInTheDocument()
      expect(meeting.sends).toHaveLength(0)
      await act(async () => vi.advanceTimersByTime(2100))
      await waitFor(() => expect(meeting.sends.map((s) => s.text)).toEqual(['Where bathroom?']))
    } finally {
      vi.useRealTimers()
    }
  })

  it('never sends simulated captions', async () => {
    const user = await setup()
    await user.click(screen.getByRole('radio', { name: /each sign/i }))
    await user.click(screen.getByRole('button', { name: /start sending to call/i }))
    const sid = await startSession(user)
    await act(async () => sock().receive(result(sid, 1, 'HELLO', 'Hello.', true)))
    await new Promise((r) => setTimeout(r, 50))
    expect(meeting.sends).toHaveLength(0)
  })

  it('mute shortcut stops sending', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /start sending to call/i }))
    await screen.findByRole('button', { name: /stop sending/i })
    await user.keyboard('{Control>}{Shift>}M{/Shift}{/Control}')
    await screen.findByRole('button', { name: /start sending to call/i })
    expect(meeting.calls).toContain('/mute')
  })

  it('sends typed messages', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: /start sending to call/i }))
    const box = await screen.findByRole('textbox', { name: /type a message/i })
    await waitFor(() => expect(box).toBeEnabled())
    await user.type(box, 'Give me a moment please{Enter}')
    await waitFor(() => expect(meeting.sends).toEqual([{ text: 'Give me a moment please', source: 'typed', simulated: false }]))
  })
})
