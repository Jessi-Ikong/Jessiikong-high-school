import { fullName } from '../lib/people'

// One button per child; hidden when there's only one.
export default function ChildSwitcher({ list, chosen, onChoose }) {
  if (list.length < 2) return null
  return (
    <div className="child-switcher" role="group" aria-label="Choose a child">
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          className={c.id === chosen?.id ? 'child-tab is-active' : 'child-tab'}
          aria-pressed={c.id === chosen?.id}
          onClick={() => onChoose(c.id)}
        >
          {fullName(c)}
          {c.className && <span className="muted small"> · {c.className}</span>}
        </button>
      ))}
    </div>
  )
}
