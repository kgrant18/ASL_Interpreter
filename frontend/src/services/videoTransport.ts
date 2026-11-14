/**
 * Frame acquisition + transport.
 *
 * - Uses requestVideoFrameCallback when available, setTimeout otherwise.
 * - Throttles to a target FPS.
 * - Downscales so the longest side is <= MAX_SIDE and JPEG-encodes.
 * - Keeps at most ONE frame in flight: the next frame is sent only after the
 *   server acks the previous one (processing.status) or the ack times out.
 *
 * Binary frame layout (little-endian): uint32 sequence | float64 capture ms | JPEG
 */

export const MAX_SIDE = 640
export const JPEG_QUALITY = 0.72
const ACK_TIMEOUT_MS = 1500

export function packFrame(sequence: number, captureMs: number, jpeg: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(12 + jpeg.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, sequence, true)
  view.setFloat64(4, captureMs, true)
  out.set(new Uint8Array(jpeg), 12)
  return out.buffer
}

export function scaledSize(w: number, h: number, maxSide = MAX_SIDE): [number, number] {
  const s = Math.min(1, maxSide / Math.max(w, h))
  return [Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s))]
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

export interface TransportOptions {
  video: HTMLVideoElement
  send: (data: ArrayBuffer) => boolean
  getFps: () => number
  onFrameSent?: (seq: number) => void
}

export class FrameTransport {
  private opts: TransportOptions
  private canvas = document.createElement('canvas')
  private running = false
  private seq = 0
  private inFlight: { seq: number; at: number } | null = null
  private lastSent = 0
  private handle: number | null = null
  private usingRVFC = false
  private encoding = false
  readonly sentAt = new Map<number, number>()

  constructor(opts: TransportOptions) {
    this.opts = opts
  }

  start() {
    this.running = true
    this.seq = 0
    this.inFlight = null
    this.sentAt.clear()
    this.schedule()
  }

  stop() {
    this.running = false
    const v = this.opts.video as VideoWithRVFC
    if (this.handle !== null) {
      if (this.usingRVFC && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.handle)
      else clearTimeout(this.handle)
    }
    this.handle = null
    this.inFlight = null
  }

  /** Called when the server acknowledged a frame. Returns round-trip ms if known. */
  ack(seq: number): number | null {
    const sent = this.sentAt.get(seq)
    this.sentAt.delete(seq)
    if (this.inFlight && seq >= this.inFlight.seq) this.inFlight = null
    // bound the map
    if (this.sentAt.size > 50) this.sentAt.clear()
    return sent !== undefined ? performance.now() - sent : null
  }

  private schedule() {
    if (!this.running) return
    const v = this.opts.video as VideoWithRVFC
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.usingRVFC = true
      this.handle = v.requestVideoFrameCallback(() => this.tick())
    } else {
      this.usingRVFC = false
      this.handle = window.setTimeout(() => this.tick(), 1000 / 30)
    }
  }

  private tick() {
    if (!this.running) return
    const now = performance.now()
    const interval = 1000 / Math.max(1, this.opts.getFps())
    if (this.inFlight && now - this.inFlight.at > ACK_TIMEOUT_MS) this.inFlight = null
    if (!this.encoding && !this.inFlight && now - this.lastSent >= interval * 0.92) {
      this.lastSent = now
      void this.capture(now)
    }
    this.schedule()
  }

  private async capture(captureMs: number) {
    const v = this.opts.video
    if (v.readyState < 2 || !v.videoWidth) return
    this.encoding = true
    try {
      const [w, h] = scaledSize(v.videoWidth, v.videoHeight)
      if (this.canvas.width !== w) this.canvas.width = w
      if (this.canvas.height !== h) this.canvas.height = h
      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(v, 0, 0, w, h)
      const blob = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY))
      if (!blob || !this.running) return
      const seq = ++this.seq
      const ok = this.opts.send(packFrame(seq, captureMs, await blob.arrayBuffer()))
      if (ok) {
        this.inFlight = { seq, at: performance.now() }
        this.sentAt.set(seq, performance.now())
        this.opts.onFrameSent?.(seq)
      }
    } finally {
      this.encoding = false
    }
  }
}
