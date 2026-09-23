import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { formatDate, formatTime } from '../../lib/format'
import { capitalise, recentDatesOn, toIsoDate } from '../../lib/dates'
import { fullName, byName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'

const STATUSES = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// How far back a teacher can pick: this many past occurrences of the class.
const RECENT_WEEKS = 4
// Teachers can only record or change attendance this many days back (the
// database enforces the same rule; admins are exempt). Older dates are view-only.
const EDIT_WINDOW_DAYS = 7
const OLD_ATTENDANCE_MESSAGE = 'Attendance older than 7 days can only be corrected by an admin.'

function isEditable(isoDate) {
  const earliest = new Date()
  earliest.setDate(earliest.getDate() - EDIT_WINDOW_DAYS)
  return isoDate >= toIsoDate(earliest)
}

// Loads the slot ONLY if the signed-in teacher teaches it. A slot ID typed
// into the URL for someone else's class returns nothing. (Saving is also
// blocked by the database's RLS policies regardless of what the page shows.)
async function fetchOwnSlot(userId, slotId) {
  if (!UUID_RE.test(slotId)) return null
  const teacher = await run(supabase.from('teachers').select('id').eq('user_id', userId).maybeSingle())
  if (!teacher) return null
  return run(
    supabase
      .from('timetable_slots')
      .select(
        'id, day_of_week, section_id, subject_id, subjects(name), sections(name, classes(name)), ' +
          'periods(name, start_time, end_time), terms(id, name, session_id, start_date, end_date)',
      )
      .eq('id', slotId)
      .eq('teacher_id', teacher.id)
      .maybeSingle(),
  )
}

// Students in the slot's section for that session who TAKE the slot's
// subject (student_subjects), plus any attendance already saved for the date.
async function fetchRosterAndMarks(slot, date) {
  const [enrollments, marks] = await Promise.all([
    run(
      supabase
        .from('enrollments')
        .select('id, students(admission_number, users(first_name, middle_name, last_name)), student_subjects!inner(subject_id)')
        .eq('section_id', slot.section_id)
        .eq('session_id', slot.terms.session_id)
        .eq('status', 'active')
        .eq('student_subjects.subject_id', slot.subject_id),
    ),
    run(
      supabase
        .from('attendance_records')
        .select('enrollment_id, status')
        .eq('timetable_slot_id', slot.id)
        .eq('date', date),
    ),
  ])
  const students = enrollments
    .map((e) => ({ enrollmentId: e.id, admissionNumber: e.students.admission_number, ...e.students.users }))
    .sort(byName)
  const existing = Object.fromEntries(marks.map((m) => [m.enrollment_id, m.status]))
  return { students, existing }
}

export default function MarkAttendance() {
  const { slotId } = useParams()
  const { profile } = useAuth()
  const slotQuery = useAsyncData(() => fetchOwnSlot(profile.id, slotId), `own-slot:${profile.id}:${slotId}`)

  if (slotQuery.loading) return <p className="muted">Loading class…</p>
  if (slotQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(slotQuery.error)}</p>
  if (!slotQuery.data) {
    return (
      <>
        <h1>Mark attendance</h1>
        <p className="alert alert-error" role="alert">
          This class isn&apos;t on your timetable, so you can&apos;t view or mark its attendance.
        </p>
        <Link to="/teacher">← Back to today&apos;s classes</Link>
      </>
    )
  }
  return <AttendanceForSlot slot={slotQuery.data} />
}

function AttendanceForSlot({ slot }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const term = slot.terms
  const dates = recentDatesOn(slot.day_of_week, term.start_date, term.end_date, RECENT_WEEKS)
  const requested = searchParams.get('date')
  const date = dates.includes(requested) ? requested : dates[0]

  const title = `${slot.subjects.name} — ${slot.sections.classes.name} ${slot.sections.name}`
  const when = `${capitalise(slot.day_of_week)}s, ${slot.periods.name} (${formatTime(slot.periods.start_time)}–${formatTime(slot.periods.end_time)})`

  return (
    <>
      <Link to="/teacher" className="back-link">
        ← Today&apos;s classes
      </Link>
      <h1>{title}</h1>
      <p className="muted">
        {when} · {term.name}
      </p>

      {dates.length === 0 ? (
        <p className="empty-state">
          There is no {capitalise(slot.day_of_week)} in {term.name} up to today yet, so there is nothing to mark.
        </p>
      ) : (
        <>
          <label className="inline-field">
            Date
            <select value={date} onChange={(e) => setSearchParams({ date: e.target.value }, { replace: true })}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                  {d === toIsoDate(new Date()) ? ' (today)' : isEditable(d) ? '' : ' (view only)'}
                </option>
              ))}
            </select>
          </label>
          {requested && requested !== date && (
            <p className="muted small">
              {formatDate(requested)} can&apos;t be marked for this class (wrong weekday, future, outside the term or
              more than {RECENT_WEEKS} weeks ago), so the most recent class date is shown instead.
            </p>
          )}
          <Roster key={date} slot={slot} date={date} />
        </>
      )}
    </>
  )
}

function Roster({ slot, date }) {
  const rosterQuery = useAsyncData(() => fetchRosterAndMarks(slot, date), `roster:${slot.id}:${date}`)
  const [savedMessage, setSavedMessage] = useState(null)

  if (rosterQuery.loading) return <p className="muted">Loading students…</p>
  if (rosterQuery.error) return <p className="alert alert-error" role="alert">{friendlyDbError(rosterQuery.error)}</p>

  const { students, existing } = rosterQuery.data
  if (students.length === 0) {
    return (
      <p className="empty-state">
        No students in {slot.sections.classes.name} {slot.sections.name} take {slot.subjects.name} this session. Subjects
        are assigned by the school office when students are enrolled.
      </p>
    )
  }

  return (
    <RosterForm
      // Re-create the form (and its selections) whenever fresh data arrives.
      key={`${date}:${JSON.stringify(existing)}`}
      slot={slot}
      date={date}
      students={students}
      existing={existing}
      savedMessage={savedMessage}
      onSaved={(message) => {
        setSavedMessage(message)
        rosterQuery.reload()
      }}
      onEdit={() => setSavedMessage(null)}
    />
  )
}

function RosterForm({ slot, date, students, existing, savedMessage, onSaved, onEdit }) {
  const editable = isEditable(date)
  // Nothing pre-selected unless this date was already marked.
  const [statuses, setStatuses] = useState(() => ({ ...existing }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const isEditing = Object.keys(existing).length > 0
  const unset = students.filter((s) => !statuses[s.enrollmentId])
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

  async function handleSave(event) {
    event.preventDefault()
    setError(null)
    if (unset.length > 0) {
      setError(
        `Choose a status for every student before saving (${unset.length} still ${unset.length === 1 ? 'has' : 'have'} none: ${unset
          .map((s) => fullName(s))
          .join(', ')}).`,
      )
      return
    }
    setSaving(true)
    try {
      // One row per student per class per date: saving again UPDATES the
      // existing rows (unique on timetable_slot_id + enrollment_id + date).
      await run(
        supabase.from('attendance_records').upsert(
          students.map((s) => ({
            timetable_slot_id: slot.id,
            enrollment_id: s.enrollmentId,
            date,
            status: statuses[s.enrollmentId],
          })),
          { onConflict: 'timetable_slot_id,enrollment_id,date' },
        ),
      )
      onSaved(
        `Attendance ${isEditing ? 'updated' : 'saved'} for ${students.length} ${students.length === 1 ? 'student' : 'students'} on ${formatDate(date)}.`,
      )
    } catch (err) {
      setError(friendlyDbError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave}>
      {savedMessage && <p className="alert alert-success" role="status">{savedMessage}</p>}
      {!editable && (
        <p className="alert alert-info-plain">
          {OLD_ATTENDANCE_MESSAGE}
          {!isEditing && ' Nothing was recorded for this date.'}
        </p>
      )}
      {editable && isEditing && !savedMessage && (
        <p className="alert alert-info-plain">
          Attendance was already marked for {formatDate(date)}. Change anything below and save to update it.
        </p>
      )}

      <div className="roster-toolbar">
        <span className="muted small">
          {students.length} {students.length === 1 ? 'student' : 'students'} · Present {counts.present} · Absent{' '}
          {counts.absent} · Late {counts.late} · Excused {counts.excused}
          {unset.length > 0 && ` · Not marked ${unset.length}`}
        </span>
        {editable && (
          <button type="button" className="button-secondary" onClick={markAllPresent}>
            Mark all present
          </button>
        )}
      </div>

      <ul className="roster">
        {students.map((student) => (
          <li key={student.enrollmentId} className={statuses[student.enrollmentId] || !editable ? '' : 'is-unset'}>
            <span className="roster-name">
              {fullName(student)} <span className="muted small">{student.admissionNumber}</span>
            </span>
            <fieldset className="status-options">
              <legend className="visually-hidden">Attendance for {fullName(student)}</legend>
              {STATUSES.map((s) => (
                <label key={s.value} className={`status-option status-${s.value}`}>
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
        ))}
      </ul>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {editable && (
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save attendance'}
          </button>
        </div>
      )}
    </form>
  )
}
