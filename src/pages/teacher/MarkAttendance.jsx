import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { formatDate, formatTime } from '../../lib/format'
import { capitalise, recentDatesOn, toIsoDate } from '../../lib/dates'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import { Roster } from '../../components/AttendanceRoster'
import { isEditable } from '../../lib/attendance'

// How far back a teacher can pick: this many past occurrences of the class.
const RECENT_WEEKS = 4

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
