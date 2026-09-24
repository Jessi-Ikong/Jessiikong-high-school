import { useEffect, useRef } from 'react'

// Calls `refresh` every `intervalMs` while the tab is visible, and straight
// away when the window regains focus or the tab becomes visible again. Simple
// "fresh enough" updates without websockets.
export function usePolling(refresh, intervalMs = 30_000) {
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refreshRef.current()
    }
    const timer = setInterval(tick, intervalMs)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])
}
