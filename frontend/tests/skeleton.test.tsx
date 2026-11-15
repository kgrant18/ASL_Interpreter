import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLandmarkStream } from '../src/hooks/useLandmarkStream'
import { drawSkeleton, makeMapper, type Landmarks, type Point } from '../src/lib/skeleton'

describe('makeMapper', () => {
  it('same 4:3 frame in a 4:3 box: straight scaling', () => {
    const map = makeMapper({ w: 640, h: 480 }, { w: 640, h: 480 }, { w: 320, h: 240 })
    expect(map(0.5, 0.5)).toEqual([160, 120])
    expect(map(0, 0)).toEqual([0, 0])
    expect(map(1, 1)).toEqual([320, 240])
  })
  it('16:9 browser video with a 4:3 backend frame: shared height, cover-cropped sides', () => {
    // backend 4:3 is the centre of the 16:9 sensor; the 16:9 video is cover-cropped to 4:3
    const map = makeMapper({ w: 640, h: 480 }, { w: 1280, h: 720 }, { w: 400, h: 300 })
    const [cx, cy] = map(0.5, 0.5)
    expect(cx).toBeCloseTo(200)
    expect(cy).toBeCloseTo(150)
    // the backend frame's left edge = 1/8 into the 16:9 frame; cover crop also removes 1/8 → box edge
    expect(map(0, 0.5)[0]).toBeCloseTo(0)
    expect(map(1, 0.5)[0]).toBeCloseTo(400)
  })
  it('4:3 video in a wider box is cropped top and bottom', () => {
    const map = makeMapper({ w: 640, h: 480 }, { w: 640, h: 480 }, { w: 400, h: 200 })
    expect(map(0.5, 0.5)).toEqual([200, 100])
    expect(map(0.5, 0)[1]).toBeCloseTo(-50)
  })
})

function lm(vis = 1, hands = true): Landmarks {
  const pose: Point[] = Array.from({ length: 25 }, () => [0.5, 0.5, vis])
  const hand: Point[] = Array.from({ length: 21 }, (_, i) => [0.4 + i / 100, 0.4])
  return { timestamp_ms: 1, width: 640, height: 480, pose, left_hand: hands ? hand : null, right_hand: null }
}

function fakeCtx() {
  const n = { lines: 0, arcs: 0, strokes: [] as string[] }
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), fill: vi.fn(),
    lineTo: () => n.lines++, arc: () => n.arcs++, stroke() { n.strokes.push(String(this.strokeStyle)) },
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, n }
}

describe('drawSkeleton', () => {
  const V = { w: 640, h: 480 }
  const B = { w: 320, h: 240 }
  it('draws 5 body lines, 6 joints, and 21 hand lines + 21 dots per hand', () => {
    const { ctx, n } = fakeCtx()
    drawSkeleton(ctx, lm(), V, B)
    expect(n.lines).toBe(5 + 21)
    expect(n.arcs).toBe(6 + 21)
  })
  it('skips body points that are not visible, and draws nothing without landmarks', () => {
    const { ctx, n } = fakeCtx()
    drawSkeleton(ctx, lm(0.1, false), V, B)
    expect(n.lines + n.arcs).toBe(0)
    drawSkeleton(ctx, null, V, B)
    expect(n.lines + n.arcs).toBe(0)
  })
  it('draws nothing until the video size is known', () => {
    const { ctx, n } = fakeCtx()
    drawSkeleton(ctx, lm(), { w: 0, h: 0 }, B)
    expect(n.lines).toBe(0)
  })
})

function Probe({ on }: { on: boolean }) {
  const l = useLandmarkStream(on)
  return <span data-testid="lm">{l ? `ts:${l.timestamp_ms}` : 'none'}</span>
}

describe('useLandmarkStream', () => {
  afterEach(() => vi.useRealTimers())

  it('hides quietly when landmarks stop changing', async () => {
    let ts = 100
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ landmarks: { ...lm(), timestamp_ms: ts } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const now = vi.spyOn(Date, 'now')
    let t = 1_000
    now.mockImplementation(() => t)
    render(<Probe on />)
    await waitFor(() => expect(screen.getByTestId('lm')).toHaveTextContent('ts:100'))
    ts = 101
    t += 100
    await waitFor(() => expect(screen.getByTestId('lm')).toHaveTextContent('ts:101'))
    t += 2_000 // backend stuck on the same frame
    await waitFor(() => expect(screen.getByTestId('lm')).toHaveTextContent('none'))
    now.mockRestore()
  })

  it('swallows errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    render(<Probe on />)
    await act(async () => new Promise((r) => setTimeout(r, 200)))
    expect(screen.getByTestId('lm')).toHaveTextContent('none')
  })
})

describe('Show skeleton toggle', () => {
  it('is on by default and can be turned off', async () => {
    const { ConnectPage } = await import('../src/components/ConnectPage')
    const status = {
      capture: { running: true, started_at: 1, camera: { state: 'on', error: null, index: 0, width: 640, height: 480, fps: 15 },
        recognition: { state: 'no_hands', hands_visible: 0, shoulders_visible: true, last_sign: null, pending: [] }, history: [] },
      meeting: { config: { enabled: false, speech: true, captions: false, caption_prefix: true, local_monitor: false },
        virtual_mic: { available: true, active: true, device_name: 'BlackHole 2ch', error: null }, tts: { engine: 'say', voice: 'x', available: true },
        player_available: true, zoom: { connected: false, endpoint: null, seq: null }, queued: 0, recent: [] },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200,
      json: async () => (url.endsWith('/status') ? status : url.endsWith('/landmarks') ? { landmarks: lm() } : { phrases: [] }) })))
    try { localStorage.removeItem('signbridge.preview.skeleton') } catch { /* ignore */ }
    const user = userEvent.setup()
    render(<ConnectPage onUseBrowser={() => undefined} />)
    const box = await screen.findByRole('checkbox', { name: 'Show skeleton' })
    expect(box).toBeChecked()
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    await user.click(box)
    expect(box).not.toBeChecked()
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument()
  })
})

describe('hand colours', () => {
  it('left hand green, right hand orange', async () => {
    const { HAND_COLORS } = await import('../src/lib/skeleton')
    const strokes: string[] = []
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), fill: vi.fn(),
      stroke() { strokes.push(String(this.strokeStyle)) }, strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    } as unknown as CanvasRenderingContext2D
    const hand: Point[] = Array.from({ length: 21 }, () => [0.5, 0.5])
    drawSkeleton(ctx, { timestamp_ms: 1, width: 640, height: 480, pose: null, left_hand: hand, right_hand: hand }, { w: 640, h: 480 }, { w: 320, h: 240 })
    expect(new Set(strokes)).toEqual(new Set([HAND_COLORS.left.line, HAND_COLORS.right.line]))
    expect(HAND_COLORS.left.line).not.toBe(HAND_COLORS.right.line)
  })
})
