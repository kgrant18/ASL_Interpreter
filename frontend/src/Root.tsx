import { useEffect, useState } from 'react'
import App from './App'
import { RecordPage } from './components/RecordPage'

const RECORD_HASH = '#/record'

/** Routes between the app and the local recorder (#/record, or Ctrl+Option+R). */
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
  return <App />
}
