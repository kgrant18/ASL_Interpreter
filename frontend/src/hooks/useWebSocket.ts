import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState, ServerMessage } from '../types/interpretation'

/**
 * Persistent WebSocket with exponential-backoff reconnect.
 * `onMessage` is held in a ref so re-renders don't reconnect.
 */
export function useWebSocket(url: string, onMessage: (m: ServerMessage) => void, onOpen?: () => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<ConnectionState>('connecting')
  const msgRef = useRef(onMessage)
  const openRef = useRef(onOpen)
  msgRef.current = onMessage
  openRef.current = onOpen
  const retry = useRef(0)
  const timer = useRef<number | null>(null)
  const disposed = useRef(false)

  const connect = useCallback(() => {
    if (disposed.current) return
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setState('error')
      return
    }
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    ws.onopen = () => {
      retry.current = 0
      setState('connected')
      openRef.current?.()
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        msgRef.current(JSON.parse(ev.data) as ServerMessage)
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      if (disposed.current) return
      setState(retry.current === 0 ? 'disconnected' : 'reconnecting')
      const delay = Math.min(8000, 500 * 2 ** retry.current)
      retry.current += 1
      timer.current = window.setTimeout(() => {
        setState('reconnecting')
        connect()
      }, delay)
    }
    ws.onerror = () => {
      /* onclose follows */
    }
  }, [url])

  useEffect(() => {
    disposed.current = false
    connect()
    return () => {
      disposed.current = true
      if (timer.current) clearTimeout(timer.current)
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, [connect])

  const sendJSON = useCallback((obj: unknown): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(obj))
    return true
  }, [])

  const sendBinary = useCallback((data: ArrayBuffer): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    // Avoid piling up data in the socket buffer if the network is slow.
    if (ws.bufferedAmount > 1_000_000) return false
    ws.send(data)
    return true
  }, [])

  const reconnectNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    retry.current = 0
    if (!wsRef.current) {
      setState('connecting')
      connect()
    }
  }, [connect])

  return { state, sendJSON, sendBinary, reconnectNow }
}
