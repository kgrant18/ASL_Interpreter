import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectPage, indicators } from '../src/components/ConnectPage'
import type { BackgroundStatus } from '../src/services/meetingApi'

function snapshot(over: { capture?: Partial<BackgroundStatus['capture']>; zoom?: Record<string, unknown>; enabled?: boolean; captions?: boolean } = {}): BackgroundStatus {
  return {
    capture: {
      running: false,
      started_at: null,
      camera: { state: 'off', error: null, index: 0, width: 0, height: 0, fps: 0 },
      recognition: { state: 'off', hands_visible: 0, shoulders_visible: false, last_sign: null, pending: [] },
      history: [],
      ...over.capture,
    },
    meeting: {
      config: { enabled: over.enabled ?? false, speech: true, captions: over.captions ?? false, caption_prefix: true, local_monitor: false },
      virtual_mic: { available: true, active: true, managed: false, device_name: 'BlackHole 2ch', error: null },
      tts: { engine: 'say', voice: 'Samantha', available: true },
      player_available: true,
      zoom: { connected: false, endpoint: null, seq: null, ...over.zoom },
      queued: 0,
      recent: [],
    },
  }
}

describe('status indicators', () => {
  it('reports a stopped backend everywhere', () => {
    const i = indicators(null, false)
    expect(i.camera.tone).toBe('bad')
    expect(i.captions.text).toMatch(/not running/)
  })

  it('shows the camera error with its fix', () => {
    const i = indicators(snapshot({ capture: { running: true, camera: { state: 'error', error: 'Allow camera access in Privacy & Security', index: 0, width: 0, height: 0, fps: 0 } } }), true)
    expect(i.camera).toMatchObject({ tone: 'bad', detail: expect.stringMatching(/Privacy/) })
    expect(i.recognition.tone).toBe('off')
  })

  it('ok when running, sending and captions delivered', () => {
    const i = indicators(
      snapshot({
        enabled: true,
        captions: true,
        capture: { running: true, camera: { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 14.6 }, recognition: { state: 'no_hands', hands_visible: 0, shoulders_visible: true, last_sign: null, pending: [] } },
        zoom: { connected: true, delivered: 3, last_ok_at: 10 },
      }),
      true,
    )
    expect(i.camera.text).toBe('On · 15 fps')
    expect(i.recognition.tone).toBe('ok')
    expect(i.voice.text).toMatch(/BlackHole 2ch/)
    expect(i.captions).toMatchObject({ tone: 'ok', text: 'Sending · 3 delivered' })
  })

  it('flags failing captions until a later caption succeeds', () => {
    const failing = indicators(snapshot({ enabled: true, captions: true, zoom: { connected: true, last_error: 'Zoom rejected the caption token (HTTP 403)', last_error_at: 20, last_ok_at: 10 } }), true)
    expect(failing.captions).toMatchObject({ tone: 'bad', detail: expect.stringMatching(/403/) })
    const recovered = indicators(snapshot({ enabled: true, captions: true, zoom: { connected: true, last_error: null, last_error_at: 20, last_ok_at: 30, delivered: 1 } }), true)
    expect(recovered.captions.tone).toBe('ok')
  })

  it('asks the signer to move back when shoulders are not visible', () => {
    const i = indicators(snapshot({ capture: { running: true, camera: { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 }, recognition: { state: 'recognizing', hands_visible: 2, shoulders_visible: false, last_sign: null, pending: [] } } }), true)
    expect(i.recognition.text).toMatch(/Move back/)
  })
})

// ---- page against a fake backend ----
const backend = {
  state: snapshot(),
  calls: [] as string[],
  testCaptionError: null as string | null,
}

function respond(status: number, body: unknown) {
  return { ok: status < 300, status, json: async () => body } as Response
}

beforeEach(() => {
  backend.state = snapshot()
  backend.calls = []
  backend.testCaptionError = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      if (init?.method === 'POST') backend.calls.push(path)
      const s = backend.state
      switch (path) {
        case '/api/background/status':
          return respond(200, s)
        case '/api/background/start':
          s.capture.running = true
          s.capture.camera = { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 }
          s.meeting!.config.enabled = true
          return respond(200, s)
        case '/api/background/stop':
          s.capture.running = false
          s.meeting!.config.enabled = false
          return respond(200, s)
        case '/api/background/test-caption':
          return backend.testCaptionError ? respond(502, { detail: backend.testCaptionError }) : respond(200, s)
        case '/api/meeting/mute':
          s.meeting!.config.enabled = false
          return respond(200, s.meeting)
        case '/api/meeting/zoom-token':
          s.meeting!.zoom.connected = true
          return respond(200, s.meeting)
        case '/api/vocabulary':
          return respond(200, { supported: [], disabled: [], phrases: [{ id: 'idea', english: 'I have an idea.', glosses: ['ME', 'HAVE', 'IDEA'] }] })
        default:
          return respond(200, s.meeting)
      }
    }),
  )
})

describe('Connect to Zoom page', () => {
  it('starts and stops background recognition', async () => {
    const user = userEvent.setup()
    render(<ConnectPage onUseBrowser={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /^start$/i }))
    expect(backend.calls).toContain('/api/background/start')
    expect(await screen.findByLabelText(/Camera: On/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /live in call/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(backend.calls).toContain('/api/background/stop')
  })

  it('Ctrl+Shift+M stops sending to the call', async () => {
    render(<ConnectPage onUseBrowser={() => undefined} />)
    await screen.findByLabelText(/Camera:/)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, code: 'KeyM' }))
    })
    await waitFor(() => expect(backend.calls).toContain('/api/meeting/mute'))
  })

  it('shows a clear error when the caption token is rejected', async () => {
    const user = userEvent.setup()
    backend.state.meeting!.zoom.connected = true
    backend.testCaptionError = 'Zoom rejected the caption token (HTTP 403): it has expired. Copy the API token again.'
    render(<ConnectPage onUseBrowser={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /test caption/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 403.*Copy the API token/)
  })

  it('saves a pasted caption token', async () => {
    const user = userEvent.setup()
    render(<ConnectPage onUseBrowser={() => undefined} />)
    await user.type(await screen.findByLabelText(/zoom caption api token/i), 'https://wmcc.zoom.us/closedcaption?id=1')
    await user.click(screen.getByRole('button', { name: /save token/i }))
    expect(backend.calls).toContain('/api/meeting/zoom-token')
    expect(await screen.findByRole('status')).toHaveTextContent(/token saved/i)
  })

  it('lists recognized sentences, supported phrases and the disclaimer, and never mentions internals', async () => {
    backend.state.capture.history = [{ id: 'a', english: 'I have an idea.', glosses: ['ME', 'HAVE', 'IDEA'], score: 0.9, at: 1_700_000_000, sent: true }]
    render(<ConnectPage onUseBrowser={() => undefined} />)
    expect(await screen.findByText('Supported phrases')).toBeInTheDocument()
    expect(screen.getAllByText('I have an idea.').length).toBeGreaterThan(0)
    expect(screen.getByText(/sent to call/)).toBeInTheDocument()
    expect(screen.getByText(/not a substitute for a qualified interpreter/)).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\b(model|training|trained|record|recording|demo|personali[sz]ed)\b/i)
  })
})

describe('Welcome and Live screens', () => {
  it('Welcome shows the wordmark, mission line and Begin opens Connect', async () => {
    const { WelcomePage, WELCOME_LINE } = await import('../src/components/WelcomePage')
    const user = userEvent.setup()
    const onBegin = vi.fn()
    render(<WelcomePage onBegin={onBegin} />)
    expect(screen.getByRole('heading', { level: 1, name: 'SignBridge' })).toBeInTheDocument()
    expect(screen.getByText(WELCOME_LINE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /begin/i }))
    expect(onBegin).toHaveBeenCalled()
  })

  it('Setup hides the status tiles and ticks off detected BlackHole', async () => {
    render(<ConnectPage onUseBrowser={() => undefined} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect to Zoom' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Status' })).toHaveClass('sr-only')
    expect(await screen.findByText(/BlackHole 2ch detected/)).toBeInTheDocument()
  })

  it('Live shows the last sent sentence large, hides unsent history, keeps phrases collapsed', async () => {
    backend.state.capture.running = true
    backend.state.capture.camera = { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 }
    backend.state.capture.recognition = { state: 'no_hands', hands_visible: 0, shoulders_visible: true, last_sign: null, pending: [] }
    backend.state.meeting!.config.enabled = true
    const now = Date.now() / 1000
    backend.state.capture.history = [
      { id: 'b', english: 'Thank you for listening.', glosses: ['THANKYOU'], score: 0.9, at: now, sent: true },
      { id: 'x', english: 'Did I miss anything?', glosses: ['ME', 'MISS'], score: 0.9, at: now - 5, sent: false },
      { id: 'a', english: 'I have an idea.', glosses: ['ME', 'HAVE', 'IDEA'], score: 0.9, at: now - 10, sent: true },
    ]
    render(<ConnectPage onUseBrowser={() => undefined} />)
    const card = await screen.findByRole('region', { name: 'Last sent' })
    expect(card).toHaveTextContent('Thank you for listening.')
    expect(screen.getByRole('button', { name: /live in call/i })).toBeInTheDocument()
    expect(screen.queryByText('Did I miss anything?')).not.toBeInTheDocument()
    expect(screen.getByTitle('ME HAVE IDEA')).toHaveTextContent('I have an idea.')
    expect(screen.getByLabelText('Framing: Framing good ✓')).toBeInTheDocument()
    expect(screen.getByText('Supported phrases').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText(/Voice: Speaking into/)).toHaveTextContent(/Ready.*BlackHole 2ch/)
  })

  it('framing badge asks the signer to move back or step in', async () => {
    const { framing } = await import('../src/components/ConnectPage')
    const s = snapshot({ capture: { running: true, camera: { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 }, recognition: { state: 'recognizing', hands_visible: 2, shoulders_visible: false, last_sign: null, pending: [] } } })
    expect(framing(s)?.text).toBe('Move back a little')
    s.capture.recognition.state = 'no_signer'
    expect(framing(s)?.text).toBe('Step into frame')
    expect(framing(snapshot())).toBeNull()
  })
})

describe('Live framing view', () => {
  function goLive() {
    backend.state.capture.running = true
    backend.state.capture.camera = { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 }
    backend.state.capture.recognition = { state: 'no_hands', hands_visible: 0, shoulders_visible: true, last_sign: null, pending: [] }
    backend.state.meeting!.config.enabled = true
  }

  it('uses the smooth browser stream, falling back to backend snapshots if the camera is busy', async () => {
    goLive()
    const gum = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    gum.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'))
    render(<ConnectPage onUseBrowser={() => undefined} />)
    const img = await screen.findByRole('img', { name: 'Camera view' })
    expect(img.getAttribute('src')).toMatch(/\/api\/background\/preview\.jpg/)
  })

  it('shows the Position check card at full size and never shrinks it', async () => {
    goLive()
    render(<ConnectPage onUseBrowser={() => undefined} />)
    const card = await screen.findByRole('region', { name: 'Position check' })
    expect(card).toHaveTextContent('Position check')
    expect(screen.queryByRole('button', { name: /show camera view|make smaller/i })).not.toBeInTheDocument()
  })
})
