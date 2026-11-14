import { BACKEND_URL } from './api'

export interface MeetingConfig {
  enabled: boolean
  speech: boolean
  captions: boolean
  caption_prefix: boolean
  local_monitor: boolean
}

export interface SentItem {
  id: string
  text: string
  source: 'recognition' | 'typed' | 'test'
  queued_at: number
  speech: string
  caption: string
  finished_at: number | null
}

export interface MeetingStatus {
  config: MeetingConfig
  virtual_mic: { available: boolean; active: boolean; device_name?: string; error: string | null }
  tts: { engine: string; voice: string; available: boolean }
  player_available: boolean
  zoom: { connected: boolean; endpoint: string | null; seq: number | null }
  queued: number
  recent: SentItem[]
}

export class MeetingApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(BACKEND_URL + '/api/meeting' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown }
    if (!res.ok) {
      const d = data.detail
      throw new MeetingApiError(res.status, typeof d === 'string' ? d : `request failed (${res.status})`)
    }
    return data as T
  } finally {
    clearTimeout(t)
  }
}

export const meetingApi = {
  status: () => call<MeetingStatus>('/status'),
  config: (patch: Partial<MeetingConfig>) => call<MeetingStatus>('/config', patch),
  mute: () => call<MeetingStatus>('/mute', {}),
  zoomToken: (token_url: string | null) => call<MeetingStatus>('/zoom-token', { token_url }),
  virtualMic: (action: 'create' | 'remove') => call<MeetingStatus>('/virtual-mic', { action }),
  send: (text: string, source: SentItem['source']) =>
    call<{ id: string; status: MeetingStatus }>('/send', { text, source, simulated: false }),
}
