import { useEffect, useState } from 'react'
import App from './App'
import { ConnectPage } from './components/ConnectPage'
import { RecordPage } from './components/RecordPage'
import { WelcomePage } from './components/WelcomePage'
import { backgroundApi } from './services/meetingApi'

const RECORD_HASH = '#/record'
export const BROWSER_HASH = '#/browser'
export const CONNECT_HASH = '#/connect'

/**
 * Routes:
 *   (default)   Welcome → Begin
 *   #/connect   Connect to Zoom — the backend reads the camera, works while minimized
 *   #/browser   in-browser camera (fallback; needs the tab visible)
 *   #/record    local recorder (also Ctrl+Option+R)
 */
export default function Root() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyR') {
        e.preventDefault()
        window.location.hash = window.location.hash === RECORD_HASH ? '' : RECORD_HASH
      }
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  if (hash === RECORD_HASH) return <RecordPage onExit={() => (window.location.hash = '')} />
  if (hash === BROWSER_HASH) return <App />
  if (hash !== CONNECT_HASH) return <WelcomePage onBegin={() => (window.location.hash = CONNECT_HASH)} />
  return (
    <ConnectPage
      onUseBrowser={() => {
        // Only one capture path at a time, so a sentence is never sent twice.
        void backgroundApi.stop().catch(() => undefined).finally(() => (window.location.hash = BROWSER_HASH))
      }}
    />
  )
}
