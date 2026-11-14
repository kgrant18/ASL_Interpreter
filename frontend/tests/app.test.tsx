import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../src/App'
import { packFrame, scaledSize } from '../src/services/videoTransport'
import { FakeWebSocket, mediaTrack, spoken } from './setup'

function sock() {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

async function renderConnected() {
  const user = userEvent.setup()
  render(<App />)
  await act(async () => sock().open())
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
    sock().receive({ type: 'session.started', session_id: start.session_id, timestamp_ms: 0, mode: start.mode, window_seconds: 1.6, model_loaded: true }),
  )
  return start.session_id as string
}

const result = (sid: string, id: number, label = 'HELLO', english = 'Hello.') => ({
  type: 'recognition.result',
  session_id: sid,
  timestamp_ms: 0,
  sequence: id,
  event_id: id,
  prediction: { label, english, score: 0.91, is_stable: true, is_unknown: false },
  performance: { processing_ms: 30, processed_fps: 14, dropped_frames: 0 },
})

beforeEach(() => {
  FakeWebSocket.instances = []
  spoken.length = 0
  localStorage.clear()
})

describe('SignBridge app', () => {
  it('renders the main controls and accurate capability text', async () => {
    await renderConnected()
    expect(screen.getByText(/Live ASL recognition — supported vocabulary/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start interpreting/i })).toBeInTheDocument()
    expect(await screen.findByText('Backend connected')).toBeInTheDocument()
    expect(await screen.findByText('“Hello.”')).toBeInTheDocument()
  })

  it('switches source between webcam and meeting', async () => {
    const user = await renderConnected()
    const meeting = screen.getByRole('radio', { name: /meeting window/i })
    await user.click(meeting)
    expect(meeting).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Meeting mode captures a tab or window/)).toBeInTheDocument()
  })

  it('starts and stops a session, releasing the camera', async () => {
    const user = await renderConnected()
    const sid = await startSession(user)
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(sock().json().some((m) => m.type === 'session.stop' && m.session_id === sid)).toBe(true)
    expect(mediaTrack.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /start interpreting/i })).toBeInTheDocument()
  })

  it('renders captions, adds one history entry per event, and speaks it', async () => {
    const user = await renderConnected()
    const sid = await startSession(user)
    await act(async () => sock().receive(result(sid, 1)))
    const caption = screen.getByText('Hello.', { selector: 'p' })
    expect(caption).toBeInTheDocument()
    const history = screen.getByRole('list', { name: /interpretation history/i })
    expect(within(history).getAllByRole('listitem')).toHaveLength(1)
    await waitFor(() => expect(spoken).toEqual(['Hello.']))
    await act(async () => sock().receive(result(sid, 2, 'YES', 'Yes.')))
    expect(within(history).getAllByRole('listitem')).toHaveLength(2)
  })

  it('ignores messages from a stale session', async () => {
    const user = await renderConnected()
    await startSession(user)
    await act(async () => sock().receive(result('some-old-session', 1)))
    expect(screen.queryByRole('list', { name: /interpretation history/i })).not.toBeInTheDocument()
  })

  it('mute toggle keeps captions but suppresses speech', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: /speech on/i }))
    expect(screen.getByRole('button', { name: /muted/i })).toBeInTheDocument()
    const sid = await startSession(user)
    await act(async () => sock().receive(result(sid, 1)))
    expect(screen.getByText('Hello.', { selector: 'p' })).toBeInTheDocument()
    expect(spoken).toEqual([])
    const hist = screen.getByRole('list', { name: /interpretation history/i })
    expect(within(hist).getByText('Muted')).toBeInTheDocument()
  })

  it('shows a disconnected banner when the backend drops', async () => {
    await renderConnected()
    await act(async () => sock().close())
    expect(await screen.findByText(/Backend disconnected\./)).toBeInTheDocument()
  })

  it('labels simulated demo results clearly', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: /advanced/i }))
    await user.selectOptions(screen.getByLabelText(/recognition mode/i), 'simulated')
    await user.click(screen.getByRole('button', { name: /close settings/i }))
    const sid = await startSession(user)
    expect(sock().json().find((m) => m.type === 'session.start')!.mode).toBe('simulated')
    await act(async () => sock().receive({ ...result(sid, 1), simulated: true }))
    expect(screen.getByText(/SIMULATED DEMO — captions are scripted/)).toBeInTheDocument()
    expect(screen.getByText('SIM')).toBeInTheDocument()
  })

  it('settings changes persist and the threshold is sent to the backend', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: /advanced/i }))
    const slider = screen.getByLabelText(/recognition threshold/i)
    fireEvent.change(slider, { target: { value: '0.8' } })
    expect(JSON.parse(localStorage.getItem('signbridge.settings.v1')!).threshold).toBe(0.8)
    await user.click(screen.getByRole('button', { name: /close settings/i }))
    await startSession(user)
    expect(sock().json().find((m) => m.type === 'session.start')!.threshold).toBe(0.8)
  })

  it('shows the interpreter disclaimer in About', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: /about and help/i }))
    expect(screen.getByText(/not a substitute for a qualified interpreter, particularly in medical/)).toBeInTheDocument()
  })

  it('reports model-unavailable errors with a next step', async () => {
    const user = await renderConnected()
    await user.click(screen.getByRole('button', { name: /start interpreting/i }))
    const start = await waitFor(() => sock().json().find((x) => x.type === 'session.start')!)
    await act(async () =>
      sock().receive({ type: 'error', session_id: start.session_id, code: 'model_unavailable', message: 'The recognition model is not loaded. Use Simulated Demo mode.', recoverable: true }),
    )
    expect(screen.getByText(/The recognition model is not loaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start interpreting/i })).toBeInTheDocument()
  })
})

describe('video transport', () => {
  it('packs the binary frame header little-endian', () => {
    const buf = packFrame(7, 1234.5, new Uint8Array([0xff, 0xd8]).buffer)
    const v = new DataView(buf)
    expect(v.getUint32(0, true)).toBe(7)
    expect(v.getFloat64(4, true)).toBe(1234.5)
    expect(new Uint8Array(buf, 12)).toEqual(new Uint8Array([0xff, 0xd8]))
  })

  it('downscales large sources to at most 640px', () => {
    expect(scaledSize(1920, 1080)).toEqual([640, 360])
    expect(scaledSize(640, 480)).toEqual([640, 480])
  })
})
