import type { ModelInfo, Vocabulary } from '../types/interpretation'

export const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8000'

export const WS_URL = BACKEND_URL.replace(/^http/, 'ws') + '/ws/interpret'

async function getJSON<T>(path: string, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BACKEND_URL + path, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${path} returned ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

export const fetchHealth = () => getJSON<{ status: string; model_loaded: boolean }>('/health')
export const fetchModel = () => getJSON<ModelInfo>('/api/model')
export const fetchVocabulary = () => getJSON<Vocabulary>('/api/vocabulary')
