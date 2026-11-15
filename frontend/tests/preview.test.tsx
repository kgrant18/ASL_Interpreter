import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickCamera, useCameraPreview } from '../src/hooks/useCameraPreview'

const dev = (deviceId: string, label: string) => ({ kind: 'videoinput', deviceId, label, groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo

describe('pickCamera', () => {
  it('index 0 prefers the built-in FaceTime camera over an iPhone', () => {
    const cams = [dev('phone', 'iPhone Camera'), dev('ft', 'FaceTime HD Camera (1C1C:B782)')]
    expect(pickCamera(cams, 0)).toBe('ft')
  })
  it('other indices follow device order', () => {
    expect(pickCamera([dev('a', 'FaceTime HD Camera'), dev('b', 'iPhone Camera')], 1)).toBe('b')
    expect(pickCamera([], 0)).toBeNull()
  })
})

function Harness({ enabled = true }: { enabled?: boolean }) {
  const { videoRef, state } = useCameraPreview(enabled, 0)
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="state">{state}</span>
    </div>
  )
}

const md = () => navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> }

describe('useCameraPreview', () => {
  let stop: ReturnType<typeof vi.fn>
  beforeEach(() => {
    stop = vi.fn()
    md().getUserMedia.mockImplementation(async () => ({ getTracks: () => [{ stop }], getVideoTracks: () => [{ stop, getSettings: () => ({}) }] }))
  })
  afterEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('opens a 640x480 display-only stream', async () => {
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('live'))
    const [constraints] = md().getUserMedia.mock.calls.at(-1)!
    expect(constraints).toMatchObject({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } })
  })

  it('reports failure when the camera is busy or denied (caller falls back to snapshots)', async () => {
    md().getUserMedia.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'))
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('failed'))
  })

  it('stops the stream while the tab is hidden', async () => {
    render(<Harness />)
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('live'))
    await act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(stop).toHaveBeenCalled()
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })
})
