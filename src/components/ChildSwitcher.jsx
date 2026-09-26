import { fullName } from '../lib/people'

// One button per child; hidden when there's only one.
export default function ChildSwitcher({ list, chosen, onChoose }) {
  if (list.length < 2) return null
  return (
    <div className="ds-segmented" role="group" aria-label="Choose a child">
      {list.map((c) => (
        <button key={c.id} type="button" aria-pressed={c.id === chosen?.id} onClick={() => onChoose(c.id)}>
          {fullName(c)}
          {c.className && <span className="ds-segmented-meta"> · {c.className}</span>}
        </button>
      ))}
    </div>
  )
}
