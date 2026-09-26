import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { formatDate } from '../lib/format'
import { EDIT_WINDOW_DAYS, STATUSES, isEditable } from '../lib/attendance'
import { fullName, byName } from '../lib/people'
import { useAsyncData } from '../hooks/useAsyncData'
import { toneFor } from '../lib/statusTones'
import { useCorrectionConfirm } from './CorrectionConfirm'
import { Alert, Badge, Button, Card, EmptyState, LoadingState } from './ui/Primitives'

// The attendance roster + status grid, shared by the teacher's Mark Attendance
// page and the admin's Correct Attendance page. Both save through the same
// table and rules: the database checks weekday, term, future dates, that the
// student takes the subject, and the 7-day window (admins are exempt), sets
// marked_by, and logs corrections (migration 16) and changes (migration 19).

const OLD_ATTENDANCE_MESSAGE = 'Attendance older than 7 days can only be corrected by an admin.'

// Students in the slot's section for that session who TAKE the slot's subject
// (student_subjects), plus any attendance already saved for the date and who
// marked it. Teachers: active enrollments only. Admins (anyStatus): every
// enrollment status too, so past sessions (promoted / graduated students)
// and students who have since left can be corrected.
// slot needs: id, section_id, subject_id, terms.session_id
async function fetchRosterAndMarks(slot, date, anyStatus) {
  let enrollmentQuery = supabase
    .from('enrollments')
    .select('id, status, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
    .eq('section_id', slot.section_id)
    .eq('session_id', slot.terms.session_id)
    .eq('student_subjects.subject_id', slot.subject_id)
  if (!anyStatus) enrollmentQuery = enrollmentQuery.eq('status', 'active')
  const [enrollments, marks] = await Promise.all([
    run(enrollmentQuery),
    run(
      supabase
        .from('attendance_records')
        .select('enrollment_id, status, updated_at, marker:users!attendance_records_marked_by_fkey(first_name, last_name)')
        .eq('timetable_slot_id', slot.id)
        .eq('date', date),
    ),
  ])
  const students = enrollments
    .map((e) => ({ enrollmentId: e.id, enrollmentStatus: e.status, admissionNumber: e.students.admission_number, ...e.students.users }))
    .sort(byName)
  const existing = Object.fromEntries(marks.map((m) => [m.enrollment_id, m.status]))
  const markedBy = Object.fromEntries(marks.map((m) => [m.enrollment_id, m.marker ? `${m.marker.first_name} ${m.marker.last_name}` : null]))
  return { students, existing, markedBy }
}

// admin: correcting (any date, any enrollment status, only changed rows are
// saved, confirmation outside the 7-day window).
export function Roster({ slot, date, admin = false }) {
  const rosterQuery = useAsyncData(() => fetchRosterAndMarks(slot, date, admin), `roster:${admin}:${slot.id}:${date}`)
  const [savedMessage, setSavedMessage] = useState(null)

  if (rosterQuery.loading) return <LoadingState lines={4} label="Loading students…" />
  if (rosterQuery.error) return <Alert tone="danger">{friendlyDbError(rosterQuery.error)}</Alert>

  const { students, existing, markedBy } = rosterQuery.data
  if (students.length === 0) {
    return (
      <Card>
        <EmptyState icon="users">
          No students in {slot.sections.classes.name} {slot.sections.name} take {slot.subjects.name} this session. Subjects are assigned by the school
          office when students are enrolled.
        </EmptyState>
      </Card>
    )
  }

  return (
    <RosterForm
      // Re-create the form (and its selections) whenever fresh data arrives.
      key={`${date}:${JSON.stringify(existing)}`}
      slot={slot}
      date={date}
      admin={admin}
      students={students}
      existing={existing}
      markedBy={markedBy}
      savedMessage={savedMessage}
      onSaved={(message) => {
        setSavedMessage(message)
        rosterQuery.reload()
      }}
      onEdit={() => setSavedMessage(null)}
    />
  )
}

function RosterForm({ slot, date, admin, students, existing, markedBy, savedMessage, onSaved, onEdit }) {
  const insideWindow = isEditable(date)
  const editable = admin || insideWindow
  // Nothing pre-selected unless this date was already marked.
  const [statuses, setStatuses] = useState(() => ({ ...existing }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const confirm = useCorrectionConfirm()

  const isEditing = Object.keys(existing).length > 0
  const unset = students.filter((s) => !statuses[s.enrollmentId])
  // Only rows that are new or different are saved. Re-saving an unchanged row
  // would still stamp marked_by with the person saving, which the audit log
  // would record as a correction (migration 16) of a mark nobody changed.
  const changed = students.filter((s) => statuses[s.enrollmentId] && statuses[s.enrollmentId] !== existing[s.enrollmentId])
  const counts = Object.fromEntries(STATUSES.map((s) => [s.value, students.filter((st) => statuses[st.enrollmentId] === s.value).length]))

  function setStatus(enrollmentId, status) {
    setStatuses((prev) => ({ ...prev, [enrollmentId]: status }))
    setError(null)
    onEdit()
  }

  function markAllPresent() {
    setStatuses(Object.fromEntries(students.map((s) => [s.enrollmentId, 'present'])))
    setError(null)
    onEdit()
  }

  async function save() {
    setSaving(true)
    try {
      // One row per student per class per date (unique on timetable_slot_id +
      // enrollment_id + date): saving an existing mark UPDATES that row.
      await run(
        supabase.from('attendance_records').upsert(
          changed.map((s) => ({
            timetable_slot_id: slot.id,
            enrollment_id: s.enrollmentId,
            date,
            status: statuses[s.enrollmentId],
          })),
          { onConflict: 'timetable_slot_id,enrollment_id,date' },
        ),
      )
      const corrected = changed.filter((s) => existing[s.enrollmentId]).length
      onSaved(
        admin
          ? `Saved ${changed.length} ${changed.length === 1 ? 'mark' : 'marks'} for ${formatDate(date)}${corrected ? ` (${corrected} corrected)` : ''}.`
          : `Attendance ${isEditing ? 'updated' : 'saved'} for ${formatDate(date)} (${changed.length} ${changed.length === 1 ? 'student' : 'students'} changed).`,
      )
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  function handleSave(event) {
    event.preventDefault()
    setError(null)
    // Teachers mark the whole class. Admins may correct individual students
    // (e.g. someone who joined later has no mark for an old date).
    if (!admin && unset.length > 0) {
      setError(
        `Choose a status for every student before saving (${unset.length} still ${unset.length === 1 ? 'has' : 'have'} none: ${unset
          .map((s) => fullName(s))
          .join(', ')}).`,
      )
      return
    }
    if (changed.length === 0) {
      setError('Nothing has changed.')
      return
    }
    confirm.run(
      admin && !insideWindow,
      `${formatDate(date)} is more than ${EDIT_WINDOW_DAYS} days ago, so teachers can no longer change it. You are about to change ${changed.length} ${changed.length === 1 ? 'mark' : 'marks'}.`,
      save,
    )
  }

  return (
    <form onSubmit={handleSave}>
      {savedMessage && <Alert tone="success">{savedMessage}</Alert>}
      {!insideWindow && !admin && (
        <Alert tone="info">
          {OLD_ATTENDANCE_MESSAGE}
          {!isEditing && ' Nothing was recorded for this date.'}
        </Alert>
      )}
      {!insideWindow && admin && (
        <Alert tone="info">
          🔒 This date is outside the teachers&apos; {EDIT_WINDOW_DAYS}-day window. As an admin you can still correct it; you&apos;ll be
          asked to confirm.
        </Alert>
      )}
      {editable && isEditing && !savedMessage && !admin && (
        <Alert tone="info">Attendance was already marked for {formatDate(date)}. Change anything below and save to update it.</Alert>
      )}

      <div className="ds-roster-toolbar">
        <span className="ds-muted ds-small">
          {students.length} {students.length === 1 ? 'student' : 'students'} · Present {counts.present} · Absent{' '}
          {counts.absent} · Late {counts.late} · Excused {counts.excused}
          {unset.length > 0 && ` · Not marked ${unset.length}`}
        </span>
        {editable && !admin && (
          <Button variant="secondary" onClick={markAllPresent}>
            Mark all present
          </Button>
        )}
      </div>

      <ul className="ds-roster">
        {students.map((student) => {
          const isChanged = statuses[student.enrollmentId] && statuses[student.enrollmentId] !== existing[student.enrollmentId]
          return (
            <li
              key={student.enrollmentId}
              className={statuses[student.enrollmentId] || !editable || admin ? (admin && isChanged ? 'ds-roster-changed' : undefined) : 'ds-roster-unset'}
            >
              <span className="ds-roster-name">
                {fullName(student)} <span className="ds-muted ds-small">{student.admissionNumber}</span>{' '}
                {admin && student.enrollmentStatus !== 'active' && <Badge status={student.enrollmentStatus}>{student.enrollmentStatus}</Badge>}
                {admin && (
                  <span className="ds-muted ds-small" style={{ display: 'block', fontWeight: 400 }}>
                    {existing[student.enrollmentId]
                      ? `Marked by ${markedBy[student.enrollmentId] ?? 'the system'}${isChanged ? ` · was ${existing[student.enrollmentId]}` : ''}`
                      : 'No mark recorded'}
                  </span>
                )}
              </span>
              <fieldset className="ds-status-options">
                <legend className="ds-visually-hidden">Attendance for {fullName(student)}</legend>
                {STATUSES.map((s) => (
                  <label key={s.value} className={`ds-status-option ds-status-${toneFor(s.value)}`}>
                    <input
                      type="radio"
                      name={`status-${student.enrollmentId}`}
                      value={s.value}
                      checked={statuses[student.enrollmentId] === s.value}
                      disabled={!editable}
                      onChange={() => setStatus(student.enrollmentId, s.value)}
                    />
                    {s.label}
                  </label>
                ))}
              </fieldset>
            </li>
          )
        })}
      </ul>

      {error && <Alert tone="danger">{error}</Alert>}
      {editable && (
        <div className="ds-form-actions">
          <Button type="submit" disabled={saving}>
            {saving
              ? 'Saving…'
              : admin
                ? `Save corrections${changed.length ? ` (${changed.length})` : ''}`
                : isEditing
                  ? 'Save changes'
                  : 'Save attendance'}
          </Button>
        </div>
      )}
      {confirm.dialog}
    </form>
  )
}
