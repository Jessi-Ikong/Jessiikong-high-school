import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { findDependents, friendlyDbError } from '../lib/db'

// "Delete" button with a safety check: first counts records that still use
// the item (`dependencyChecks`, see findDependents). If any exist, explains
// why it can't be deleted; otherwise asks for confirmation, then deletes.
export default function DeleteAction({
  itemName,
  dependencyChecks,
  onDelete,
  onDeleted,
  buttonLabel = 'Delete',
  buttonClassName = 'button-link danger',
}) {
  // null | 'checking' | 'blocked' | 'confirm' | 'deleting'
  const [step, setStep] = useState(null)
  const [dependents, setDependents] = useState([])
  const [error, setError] = useState(null)

  function close() {
    setStep(null)
    setError(null)
  }

  async function handleClick() {
    setStep('checking')
    setError(null)
    try {
      const found = await findDependents(dependencyChecks)
      setDependents(found)
      setStep(found.length > 0 ? 'blocked' : 'confirm')
    } catch (err) {
      setError(friendlyDbError(err))
      setStep('confirm')
    }
  }

  async function handleConfirm() {
    setStep('deleting')
    setError(null)
    try {
      await onDelete()
      setStep(null)
      onDeleted?.()
    } catch (err) {
      setError(friendlyDbError(err))
      setStep('confirm')
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={handleClick}
        disabled={step === 'checking'}
        aria-label={`Delete ${itemName}`}
        title={`Delete ${itemName}`}
      >
        {step === 'checking' ? (buttonLabel === 'Delete' ? 'Checking…' : '…') : buttonLabel}
      </button>

      {step === 'blocked' && (
        <ConfirmDialog title={`Can't delete ${itemName}`} cancelLabel="OK" onCancel={close}>
          <p>It is still being used by:</p>
          <ul>
            {dependents.map((d) => (
              <li key={d.text}>{d.text}</li>
            ))}
          </ul>
          <p className="muted">Remove or move those first, then try again.</p>
        </ConfirmDialog>
      )}

      {(step === 'confirm' || step === 'deleting') && (
        <ConfirmDialog
          title={`Delete ${itemName}?`}
          confirmLabel="Delete"
          danger
          busy={step === 'deleting'}
          error={error}
          onConfirm={handleConfirm}
          onCancel={close}
        >
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
