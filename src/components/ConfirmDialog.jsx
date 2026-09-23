import { useEffect } from 'react'

// A simple modal. Without onConfirm it is an information box with one button.
export default function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
  error = null,
}) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [busy, onCancel])

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        {children}
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          {onConfirm && (
            <button
              type="button"
              className={danger ? 'button-danger' : undefined}
              onClick={onConfirm}
              disabled={busy}
              autoFocus
            >
              {busy ? 'Please wait…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
