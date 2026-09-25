import { useEffect, useRef } from 'react'
import Icon from './Icon'
import '../../styles/app.css'

// A dialog that is FULL SCREEN on phones (no cramped centred box) and a
// centred panel from 640px up. Esc and the × close it; the page behind
// doesn't scroll while it's open; focus moves into it and back afterwards.
export default function Dialog({ title, onClose, footer, children, busy = false }) {
  const panelRef = useRef(null)
  // latest props for the key handler, so the setup below runs only once
  const latest = useRef({ onClose, busy })
  useEffect(() => {
    latest.current = { onClose, busy }
  })

  useEffect(() => {
    const previous = document.activeElement
    const panel = panelRef.current
    ;(panel.querySelector('[autofocus], input, select, textarea, button:not(.ds-dialog-close)') ?? panel).focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !latest.current.busy) latest.current.onClose()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="ds-dialog-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={panelRef}
        className="ds-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ds-dialog-header">
          <h2 id="ds-dialog-title">{title}</h2>
          <button type="button" className="ds-icon-btn ds-dialog-close" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="x" size={22} />
          </button>
        </header>
        <div className="ds-dialog-body">{children}</div>
        {footer && <footer className="ds-dialog-footer">{footer}</footer>}
      </div>
    </div>
  )
}
