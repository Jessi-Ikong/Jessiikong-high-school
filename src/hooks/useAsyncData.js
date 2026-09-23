import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Loads data with `fetcher` (an async function) and reloads it whenever `key`
// changes or reload() is called. `key` must describe everything the fetcher
// depends on, e.g. `terms:${sessionId}`.
//
// loading:    true until the first result for the current key arrives
// refreshing: true while re-fetching after reload() (old data stays visible)
export function useAsyncData(fetcher, key) {
  const [reloadCount, setReloadCount] = useState(0)
  const requestKey = `${key}#${reloadCount}`
  const [result, setResult] = useState({ key: null, requestKey: null, data: null, error: null })

  // Always call the latest fetcher without re-running the effect every render.
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    let active = true
    fetcherRef.current().then(
      (data) => active && setResult({ key, requestKey, data, error: null }),
      (error) => active && setResult((prev) => ({ key, requestKey, data: prev.key === key ? prev.data : null, error })),
    )
    return () => {
      active = false
    }
  }, [key, requestKey])

  const reload = useCallback(() => setReloadCount((n) => n + 1), [])

  return {
    data: result.key === key ? result.data : null,
    error: result.key === key ? result.error : null,
    loading: result.key !== key,
    refreshing: result.key === key && result.requestKey !== requestKey,
    reload,
  }
}
