// Mirrors backend/app/schemas/messages.py

export type VideoSource = 'webcam' | 'meeting'
export type RecognitionMode = 'live' | 'simulated'
export type SessionMode = RecognitionMode | 'record'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error'

export type CaptureState =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'cancelled'
  | 'unsupported'
  | 'ended'
  | 'error'

export type ProcessingState = 'no_signer' | 'no_hands' | 'collecting' | 'recognizing' | 'idle'

export interface Prediction {
  label: string
  english: string
  score: number
  is_stable: boolean
  is_unknown: boolean
}

export interface Performance {
  processing_ms: number
  landmark_ms?: number | null
  inference_ms?: number | null
  processed_fps: number
  dropped_frames: number
}

export type Point = [number, number]
export interface Landmarks {
  pose: Point[] | null
  left_hand: Point[] | null
  right_hand: Point[] | null
}

interface Base {
  session_id: string
  timestamp_ms: number
}

export interface SessionStartedMsg extends Base {
  type: 'session.started'
  mode: SessionMode
  window_seconds: number
  model_loaded: boolean
}
export interface SessionStoppedMsg extends Base {
  type: 'session.stopped'
  frames_processed: number
}
export interface ProcessingStatusMsg extends Base {
  type: 'processing.status'
  sequence: number
  state: ProcessingState
  hands_visible: number
  landmarks: Landmarks | null
  frame_width: number
  frame_height: number
  performance: Performance
}
export interface RecognitionPartialMsg extends Base {
  type: 'recognition.partial'
  sequence: number
  prediction: Prediction
  top: [string, number][]
  simulated?: boolean
}
export interface RecognitionResultMsg extends Base {
  type: 'recognition.result'
  sequence: number
  event_id: number
  prediction: Prediction
  performance: Performance
  simulated?: boolean
  /** Present when the result is a matched supported phrase: the signs recognized. */
  glosses?: string[] | null
  phrase_id?: string | null
}
export interface RecognitionSignMsg extends Base {
  type: 'recognition.sign'
  sequence: number
  label: string
  score: number
  pending: string[]
}
export interface RecognitionUnknownMsg extends Base {
  type: 'recognition.unknown'
  sequence: number
  reason: 'low_confidence' | 'unsupported_sign'
  unknown_score: number
}
export interface RecordSavedMsg extends Base {
  type: 'record.saved'
  label: string
  ok: boolean
  message: string
  frames: number
  hand_frames: number
  count: number
}
export interface ErrorMsg {
  type: 'error'
  session_id: string | null
  code: string
  message: string
  recoverable: boolean
}

export type ServerMessage =
  | SessionStartedMsg
  | SessionStoppedMsg
  | ProcessingStatusMsg
  | RecognitionPartialMsg
  | RecognitionResultMsg
  | RecognitionUnknownMsg
  | RecognitionSignMsg
  | RecordSavedMsg
  | ErrorMsg
  | { type: 'pong'; timestamp_ms: number }

export interface VocabularyEntry {
  label: string
  english: string
  description: string
  enabled: boolean
  validation: string
  test_accuracy: number | null
  test_samples: number | null
}

export interface SupportedPhrase {
  id: string
  english: string
  glosses: string[]
}

export interface Vocabulary {
  supported: VocabularyEntry[]
  disabled: VocabularyEntry[]
  phrases?: SupportedPhrase[]
}

export interface ModelInfo {
  name: string | null
  version?: string
  loaded: boolean
  load_error?: string | null
  device?: string
  mode: string
  supported_class_count?: number
  trained_class_count?: number
  window_seconds?: number
  ensemble_size?: number
  recommended_threshold?: number
  dataset?: string
  evaluation?: Record<string, unknown>
  limitations: string[]
}

export type SpeechStatus = 'spoken' | 'speaking' | 'queued' | 'muted' | 'unavailable' | 'skipped'

export interface HistoryEvent {
  id: string
  eventId: number
  time: number
  label: string
  english: string
  score: number
  simulated: boolean
  speech: SpeechStatus
  /** Recognized signs behind a phrase result. */
  glosses?: string[]
  phrase?: boolean
}

export interface Settings {
  source: VideoSource
  mode: RecognitionMode
  targetFps: number
  threshold: number
  /** true once the user moves the threshold slider; otherwise follow the model's recommendation */
  thresholdCustomized: boolean
  audioEnabled: boolean
  speechRate: number
  voiceURI: string | null
  showLandmarks: boolean
  meetingSendMode: 'sign' | 'phrase'
  phrasePauseMs: number
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'webcam',
  mode: 'live',
  targetFps: 15,
  threshold: 0.7,
  thresholdCustomized: false,
  audioEnabled: true,
  speechRate: 1,
  voiceURI: null,
  showLandmarks: true,
  meetingSendMode: 'phrase',
  phrasePauseMs: 2000,
}
