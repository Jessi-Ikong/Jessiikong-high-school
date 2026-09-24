import { useSearchParams } from 'react-router-dom'

// Which child the parent is looking at, kept in the URL (?child=<id>) so it
// survives a refresh and carries between parent pages. Defaults to the first.
export function useChosenChild(list) {
  const [params, setParams] = useSearchParams()
  const chosen = list.find((c) => c.id === params.get('child')) ?? list[0] ?? null
  function choose(id) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('child', id)
        return next
      },
      { replace: true },
    )
  }
  return [chosen, choose]
}
