import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())

// ---- Fake WebSocket: records sent messages, lets tests push server messages ----
export class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  binaryType = 'blob'
  bufferedAmount = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  // helpers
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  json() {
    return this.sent.filter((m) => !(m instanceof ArrayBuffer)) as Record<string, unknown>[]
  }
}
vi.stubGlobal('WebSocket', FakeWebSocket)

// ---- Speech synthesis stub ----
export const spoken: string[] = []
class FakeUtterance {
  text: string
  rate = 1
  lang = ''
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}
vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  value: {
    speak: (u: FakeUtterance) => {
      spoken.push(u.text)
      setTimeout(() => u.onend?.(), 0)
    },
    cancel: vi.fn(),
    getVoices: () => [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test', default: true }],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
})

// ---- fetch stub for /api/model and /api/vocabulary ----
// ---- fake meeting-output backend ----
export const meeting = {
  sends: [] as { text: string; source: string; simulated: boolean }[],
  calls: [] as string[],
  config: { enabled: false, speech: true, captions: false, caption_prefix: true, local_monitor: false },
  reset() {
    this.sends.length = 0
    this.calls.length = 0
    this.config = { enabled: false, speech: true, captions: false, caption_prefix: true, local_monitor: false }
  },
  status() {
    return {
      config: { ...this.config },
      virtual_mic: { available: true, active: true, device_name: 'SignBridge Virtual Microphone', error: null },
      tts: { engine: 'piper', voice: 'v', available: true },
      player_available: true,
      zoom: { connected: false, endpoint: null, seq: null },
      queued: 0,
      recent: this.sends.map((x, i) => ({ id: String(i), text: x.text, source: x.source, queued_at: 0, speech: 'sent', caption: 'skipped', finished_at: 1 })).reverse(),
    }
  },
}

function meetingResponse(path: string, body: Record<string, unknown> | undefined) {
  meeting.calls.push(path)
  if (path === '/config') Object.assign(meeting.config, Object.fromEntries(Object.entries(body ?? {}).filter(([, v]) => v !== undefined)))
  if (path === '/mute') meeting.config.enabled = false
  if (path === '/send') {
    if (!meeting.config.enabled) return { ok: false, status: 409, json: async () => ({ detail: 'meeting output is off' }) }
    meeting.sends.push(body as never)
    return { ok: true, status: 200, json: async () => ({ id: 'x', status: meeting.status() }) }
  }
  return { ok: true, status: 200, json: async () => meeting.status() }
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: RequestInit) => {
    const m = url.match(/\/api\/meeting(\/[a-z-]+)$/)
    if (m) return meetingResponse(m[1], init?.body ? JSON.parse(String(init.body)) : undefined) as Response
    const body = url.endsWith('/api/model')
      ? { name: 'SignGRU', version: 't', loaded: true, device: 'cpu', mode: 'live', limitations: ['Limited vocabulary.'] }
      : url.endsWith('/api/vocabulary')
        ? {
            supported: [{ label: 'HELLO', english: 'Hello.', description: 'Salute from forehead.', enabled: true, validation: 'ok', test_accuracy: 0.86, test_samples: 14 }],
            disabled: [{ label: 'GOOD', english: 'Good.', description: '', enabled: false, validation: 'Disabled', test_accuracy: 0.17, test_samples: 12 }],
          }
        : { status: 'ok', model_loaded: true }
    return { ok: true, json: async () => body } as Response
  }),
)

// ---- media devices stub ----
const track = { stop: vi.fn(), onended: null as null | (() => void), getSettings: () => ({ width: 640, height: 480 }), label: 'Fake camera' }
export const mediaTrack = track
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
    getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
  },
})
HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
window.matchMedia = vi.fn(() => ({ matches: false })) as never
