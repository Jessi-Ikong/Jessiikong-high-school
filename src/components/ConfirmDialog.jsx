import Dialog from './ui/Dialog'

// A confirmation (or, without onConfirm, an information box with one button),
// built on the design-system Dialog: full screen on phones, a centred panel on
// larger screens. Used across portals (admin, teacher...).
// Same behaviour as before: Esc cancels (unless busy); tapping outside does
// nothing; focus starts on the confirm button (or the only button).
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
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      busy={busy}
      dismissOnBackdrop={false}
      footer={
        <div className="ds-form-actions">
          <button type="button" className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={busy} data-autofocus={onConfirm ? undefined : true}>
            {cancelLabel}
          </button>
          {onConfirm && (
            <button type="button" className={`ds-btn ${danger ? 'ds-btn-danger' : 'ds-btn-primary'}`} onClick={onConfirm} disabled={busy} data-autofocus>
              {busy ? 'Please wait…' : confirmLabel}
            </button>
          )}
        </div>
      }
    >
      <div className="ds-stack">{children}</div>
      {error && (
        <div className="ds-alert ds-alert-danger" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
    </Dialog>
  )
}
