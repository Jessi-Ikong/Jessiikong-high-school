import { useState } from 'react'
import { friendlyDbError } from '../lib/db'
import { toIsoDate } from '../lib/dates'
import { describeUsage, nameProblem } from '../lib/people'
import {
  addStudentSubject,
  fetchStudentSubjects,
  removeStudentSubject,
  saveStudentDetails,
  saveTeacherDetails,
  setAccountActive,
} from '../lib/peopleEdit'
import { useAsyncData } from '../hooks/useAsyncData'
import ConfirmDialog from './ConfirmDialog'
import Dialog from './ui/Dialog'
import { Field, TextInput, Select } from './ui/Form'

// Admin corrections to students and teachers: details, active/inactive and
// (students) subjects for the current session. Email is fixed after creation
// (it's the login) and a student's class only changes through promotion, so
// neither is editable here.

// A form in the design-system Dialog (full screen on phones). Esc / × cancel
// (unless saving); the Save button submits the form.
function FormDialog({ title, busy, error, onCancel, onSubmit, submitLabel = 'Save changes', children }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      busy={busy}
      dismissOnBackdrop={false}
      footer={
        <div className="ds-form-actions">
          <button type="button" className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="person-edit-form" className="ds-btn ds-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      }
    >
      <form
        id="person-edit-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        {children}
        {error && (
          <div className="ds-alert ds-alert-danger" role="alert">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  )
}

function NameFields({ form, update }) {
  return (
    <>
      <Field label="First name">
        {(p) => <TextInput {...p} value={form.first_name} onChange={(e) => update('first_name', e.target.value)} required data-autofocus />}
      </Field>
      <Field label="Middle name(s)" hint="Optional">
        {(p) => <TextInput {...p} value={form.middle_name} onChange={(e) => update('middle_name', e.target.value)} />}
      </Field>
      <Field label="Last name">
        {(p) => <TextInput {...p} value={form.last_name} onChange={(e) => update('last_name', e.target.value)} required />}
      </Field>
    </>
  )
}

function useEditForm(initial) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }))
  return { form, update, error, setError, busy, setBusy }
}

// person: { studentId, first_name, middle_name, last_name, email, date_of_birth, gender }
export function EditStudentDialog({ person, onClose, onSaved }) {
  const { form, update, error, setError, busy, setBusy } = useEditForm({
    first_name: person.first_name ?? '',
    middle_name: person.middle_name ?? '',
    last_name: person.last_name ?? '',
    date_of_birth: person.date_of_birth ?? '',
    gender: person.gender ?? '',
  })
  const today = toIsoDate(new Date())

  async function save() {
    const problem = nameProblem(form) ?? (form.date_of_birth > today ? "The date of birth can't be in the future." : null)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await saveStudentDetails(person.studentId, form)
      onSaved()
    } catch (err) {
      setError(friendlyDbError(err))
      setBusy(false)
    }
  }

  return (
    <FormDialog title="Edit student details" busy={busy} error={error} onCancel={onClose} onSubmit={save}>
      <NameFields form={form} update={update} />
      <Field label="Date of birth">
        {(p) => <TextInput {...p} type="date" value={form.date_of_birth} max={today} onChange={(e) => update('date_of_birth', e.target.value)} />}
      </Field>
      <Field label="Gender">
        {(p) => (
          <Select {...p} value={form.gender} onChange={(e) => update('gender', e.target.value)}>
            <option value="">Not specified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        )}
      </Field>
      <p className="ds-note">
        Email: {person.email ?? '—'} (can&apos;t be changed: it&apos;s their login). The class changes only through promotion.
      </p>
    </FormDialog>
  )
}

// person: { teacherId, first_name, middle_name, last_name, email, staff_id, department }
export function EditTeacherDialog({ person, onClose, onSaved }) {
  const { form, update, error, setError, busy, setBusy } = useEditForm({
    first_name: person.first_name ?? '',
    middle_name: person.middle_name ?? '',
    last_name: person.last_name ?? '',
    staff_id: person.staff_id ?? '',
    department: person.department ?? '',
  })

  async function save() {
    const problem = nameProblem(form) ?? (form.staff_id.trim() ? null : 'A staff ID is required for teachers.')
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await saveTeacherDetails(person.teacherId, form)
      onSaved()
    } catch (err) {
      setError(friendlyDbError(err, { unique: 'Another teacher already has that staff ID.' }))
      setBusy(false)
    }
  }

  return (
    <FormDialog title="Edit teacher details" busy={busy} error={error} onCancel={onClose} onSubmit={save}>
      <NameFields form={form} update={update} />
      <Field label="Staff ID">
        {(p) => <TextInput {...p} value={form.staff_id} onChange={(e) => update('staff_id', e.target.value)} required />}
      </Field>
      <Field label="Department" hint="Optional">
        {(p) => <TextInput {...p} value={form.department} onChange={(e) => update('department', e.target.value)} />}
      </Field>
      <p className="ds-note">Email: {person.email ?? '—'} (can&apos;t be changed: it&apos;s their login).</p>
    </FormDialog>
  )
}

// What deactivating means, as the rest of the app already behaves.
const EFFECTS = {
  teacher: [
    "They can't sign in, and lose access at once if they're signed in now.",
    'Their timetable slots stay assigned to them: give the classes to another teacher on the Timetable page (the admin dashboard lists these slots).',
    'Their ID card no longer shows as valid when scanned, and no new card can be issued.',
    'Nothing is deleted: attendance, grades and messages stay.',
  ],
  admin: [
    "They can't sign in, and lose all admin access at once if they're signed in now.",
    'Nothing is deleted: what they created or changed stays, and so do their audit log entries.',
    'You can reactivate them at any time from this page.',
  ],
  student: [
    "They can't sign in, and lose access at once if they're signed in now.",
    'They stay enrolled in their class: they still appear on registers and fees are still billed. (Withdrawing a student is an enrollment change, not this.)',
    'Their ID card no longer shows as valid when scanned, and no new card can be issued.',
    'Nothing is deleted.',
  ],
}

// person: { userId, name, role, is_active }; extra: optional line (e.g. slot count)
export function ActiveToggle({ person, extra, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const deactivating = person.is_active

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await setAccountActive(person.userId, !person.is_active)
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={`ds-btn ds-btn-link${deactivating ? ' ds-btn-link-danger' : ''}`} onClick={() => setOpen(true)}>
        {deactivating ? 'Deactivate' : 'Reactivate'}
      </button>
      {open && (
        <ConfirmDialog
          title={deactivating ? `Deactivate ${person.name}?` : `Reactivate ${person.name}?`}
          confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
          danger={deactivating}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setOpen(false)}
        >
          {deactivating ? (
            <ul className="ds-small">
              {EFFECTS[person.role].map((line) => (
                <li key={line}>{line}</li>
              ))}
              {extra && <li>{extra}</li>}
            </ul>
          ) : (
            <p className="ds-small">
              They can sign in again with their existing password, and get back the access their role gives them. An ID card
              can be issued again from ID Cards if needed.
            </p>
          )}
          <p className="ds-note">This is recorded in the audit log.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

// A student's subjects for their CURRENT-session enrollment. Each tick saves
// straight away. Removing a subject the student already has scores,
// attendance or submissions for asks first (the records are kept).
export function StudentSubjectsDialog({ enrollmentId, studentName, classLabel, onClose, onChanged }) {
  const query = useAsyncData(() => fetchStudentSubjects(enrollmentId), `student-subjects:${enrollmentId}`)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [confirming, setConfirming] = useState(null) // subject about to be removed despite records

  async function change(subject, add) {
    setBusyId(subject.id)
    setError(null)
    setMessage(null)
    try {
      if (add) await addStudentSubject(enrollmentId, subject.id)
      else await removeStudentSubject(enrollmentId, subject.id)
      setMessage(`${subject.name} ${add ? 'added' : 'removed'}.`)
      query.reload()
      onChanged?.()
    } catch (err) {
      setError(friendlyDbError(err, { unique: `${subject.name} is already one of their subjects.` }))
    } finally {
      setBusyId(null)
      setConfirming(null)
    }
  }

  function toggle(subject, taken) {
    if (taken && describeUsage(query.data.usage[subject.id])) setConfirming(subject)
    else change(subject, !taken)
  }

  return (
    <>
      <ConfirmDialog title={`Subjects: ${studentName}`} cancelLabel="Done" onCancel={() => !confirming && onClose()} busy={busyId !== null}>
        <p className="ds-note">
          {classLabel}, this session. Changes save straight away. Past sessions&apos; subjects stay as they were.
        </p>
        {query.loading ? (
          <p className="ds-note">Loading…</p>
        ) : query.error ? (
          <div className="ds-alert ds-alert-danger" role="alert">
            {friendlyDbError(query.error)}
          </div>
        ) : query.data.subjects.length === 0 ? (
          <p className="ds-note">No subjects exist yet. Add them under Subjects first.</p>
        ) : (
          <fieldset className="ds-fieldset" disabled={busyId !== null}>
            <legend className="ds-label">Subjects (core and electives)</legend>
            <div className="ds-checklist">
            {query.data.subjects.map((s) => {
              const taken = query.data.taken.has(s.id)
              const recorded = describeUsage(query.data.usage[s.id])
              return (
                <label key={s.id} className="ds-check">
                  <input type="checkbox" checked={taken} onChange={() => toggle(s, taken)} />
                  <span>
                    {s.name}
                    {recorded && <span className="ds-muted ds-small"> · has records</span>}
                    {busyId === s.id && <span className="ds-muted ds-small"> · saving…</span>}
                  </span>
                </label>
              )
            })}
            </div>
          </fieldset>
        )}
        {message && (
          <div className="ds-alert ds-alert-success" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="ds-alert ds-alert-danger" role="alert">
            {error}
          </div>
        )}
      </ConfirmDialog>

      {confirming && (
        <ConfirmDialog
          title={`Remove ${confirming.name}?`}
          confirmLabel={`Remove ${confirming.name}`}
          danger
          busy={busyId !== null}
          onConfirm={() => change(confirming, false)}
          onCancel={() => setConfirming(null)}
        >
          <p>
            {studentName} already has {describeUsage(query.data.usage[confirming.id])} for {confirming.name} this session.
          </p>
          <ul className="ds-small">
            <li>Those records are NOT deleted, but they stop counting: {confirming.name} no longer counts towards their class ranking, and they drop off its attendance registers, gradebook and assignments.</li>
            <li>Ticking {confirming.name} again brings everything back.</li>
          </ul>
          <p className="ds-note">If they took the subject by mistake, removing it is right. If they are dropping it mid-term, consider waiting until the term ends.</p>
        </ConfirmDialog>
      )}
    </>
  )
}
