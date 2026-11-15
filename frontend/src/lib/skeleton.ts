/**
 * Skeleton overlay for the Position check preview (display only).
 *
 * Landmarks come from the backend camera frame, normalized to [0,1] of that frame,
 * unmirrored. The browser preview may differ in resolution / aspect ratio and is shown
 * with `object-cover` (cropped to the box) and mirrored. `mapPoint` accounts for all three
 * so the lines sit on the signer; the mirroring is applied by drawing inside the same
 * CSS-mirrored layer as the video.
 */

export type Point = number[] // [x, y] or [x, y, visibility]

export interface Landmarks {
  timestamp_ms: number
  width: number
  height: number
  pose: Point[] | null
  left_hand: Point[] | null
  right_hand: Point[] | null
}

export interface Size {
  w: number
  h: number
}

/**
 * Backend-normalized (u, v) -> pixel position in the preview box (before mirroring).
 *
 * Both streams come from the same camera sensor. When their aspect ratios differ, the
 * camera crops the sides and keeps the full height (e.g. 4:3 cut from a 16:9 sensor),
 * so x is rescaled around the center and y is unchanged.
 */
export function makeMapper(backend: Size, video: Size, box: Size) {
  const ab = backend.w / backend.h
  const av = video.w / video.h
  const kx = ab / av
  // object-cover: scale the video to cover the box, centered.
  const scale = Math.max(box.w / video.w, box.h / video.h)
  const dw = video.w * scale
  const dh = video.h * scale
  const ox = (box.w - dw) / 2
  const oy = (box.h - dh) / 2
  return (u: number, v: number): [number, number] => {
    const xv = 0.5 + (u - 0.5) * kx
    return [ox + xv * dw, oy + v * dh]
  }
}

export const POSE_LINES: [number, number][] = [
  [11, 12], // shoulders
  [11, 13], // left upper arm
  [13, 15], // left forearm
  [12, 14],
  [14, 16],
]
const POSE_JOINTS = [11, 12, 13, 14, 15, 16]

export const HAND_LINES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

const VIS = 0.5
const visible = (p?: Point) => !!p && (p[2] ?? 1) >= VIS

export const BODY_COLOR = 'rgba(255,255,255,0.45)'
/** Signer's left hand green (the earlier colour), right hand orange. */
export const HAND_COLORS = {
  left: { line: 'rgba(57,255,160,0.85)', dot: 'rgba(110,255,190,1)' },
  right: { line: 'rgba(255,145,40,0.9)', dot: 'rgba(255,175,80,1)' },
}

/** Draws in CSS pixels; `dpr` scales for sharp lines on Retina screens. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Landmarks | null,
  video: Size,
  box: Size,
  dpr = 1,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, box.w, box.h)
  if (!lm || !video.w || !video.h || !lm.width || !lm.height) return
  const map = makeMapper({ w: lm.width, h: lm.height }, video, box)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const pose = lm.pose
  if (pose) {
    ctx.strokeStyle = BODY_COLOR
    ctx.lineWidth = 2
    for (const [a, b] of POSE_LINES) {
      if (!visible(pose[a]) || !visible(pose[b])) continue
      const [x1, y1] = map(pose[a][0], pose[a][1])
      const [x2, y2] = map(pose[b][0], pose[b][1])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.fillStyle = BODY_COLOR
    for (const j of POSE_JOINTS) {
      if (!visible(pose[j])) continue
      const [x, y] = map(pose[j][0], pose[j][1])
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (const [hand, colors] of [
    [lm.left_hand, HAND_COLORS.left],
    [lm.right_hand, HAND_COLORS.right],
  ] as const) {
    if (!hand || hand.length < 21) continue
    const pts = hand.map((p) => map(p[0], p[1]))
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 1.5
    for (const [a, b] of HAND_LINES) {
      ctx.beginPath()
      ctx.moveTo(pts[a][0], pts[a][1])
      ctx.lineTo(pts[b][0], pts[b][1])
      ctx.stroke()
    }
    ctx.fillStyle = colors.dot
    for (const [x, y] of pts) {
      ctx.beginPath()
      ctx.arc(x, y, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
