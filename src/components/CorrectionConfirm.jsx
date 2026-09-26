import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

// A speed bump for admins correcting a LOCKED record (outside the teachers'
// edit window). It adds no permission: the database already allows admins.
//
//   const confirm = useCorrectionConfirm()
//   confirm.run(locked, lockedExplanation, () => save())   // asks first only if locked
//   ... {confirm.dialog}
export function useCorrectionConfirm() {
  const [pending, setPending] = useState(null) // { explanation, action }
  const [busy, setBusy] = useState(false)

  function run(locked, explanation, action) {
    if (!locked) return action()
    setPending({ explanation, action })
  }

  async function confirm() {
    setBusy(true)
    try {
      await pending.action()
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const dialog = pending && (
    <ConfirmDialog
      title="Confirm this correction?"
      confirmLabel="Save correction"
      busy={busy}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    >
      <p>This is outside the normal edit window.</p>
      <p className="ds-small">{pending.explanation}</p>
      <p className="ds-muted ds-small">The change is recorded in the audit log under your name, with the old and new values.</p>
    </ConfirmDialog>
  )

  return { run, dialog }
}
