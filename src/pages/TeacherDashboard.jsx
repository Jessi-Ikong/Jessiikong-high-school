import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { formatDate, formatTime } from '../lib/format'
import { capitalise, schoolDayOf, toIsoDate } from '../lib/dates'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'

// Today's classes for the signed-in teacher, and whether attendance is marked.
async function fetchToday(userId, todayIso, day) {
  const teacher = await run(supabase.from('teachers').select('id').eq('user_id', userId).maybeSingle())
  if (!teacher) return { problem: 'no-teacher' }

  const term = await run(
    supabase.from('terms').select('id, name, start_date, end_date, sessions(name)').eq('is_current', true).maybeSingle(),
  )
  if (!term) return { problem: 'no-term' }
  if (!day) return { term, problem: 'weekend' }

  const slots = await run(
    supabase
      .from('timetable_slots')
      .select('id, subjects(name), sections(name, classes(name)), periods(name, start_time, end_time)')
      .eq('teacher_id', teacher.id)
      .eq('term_id', term.id)
      .eq('day_of_week', day),
  )
  slots.sort((a, b) => a.periods.start_time.localeCompare(b.periods.start_time))

  const marked = slots.length
    ? await run(
        supabase
          .from('attendance_records')
          .select('timetable_slot_id')
          .in('timetable_slot_id', slots.map((s) => s.id))
          .eq('date', todayIso),
      )
    : []
  const markedCount = {}
  for (const row of marked) markedCount[row.timetable_slot_id] = (markedCount[row.timetable_slot_id] ?? 0) + 1

  return { term, slots: slots.map((s) => ({ ...s, markedCount: markedCount[s.id] ?? 0 })) }
}

export default function TeacherDashboard() {
  const { profile } = useAuth()
  const now = new Date()
  const todayIso = toIsoDate(now)
  const day = schoolDayOf(now)
  const { data, error, loading } = useAsyncData(
    () => fetchToday(profile.id, todayIso, day),
    `teacher-today:${profile.id}:${todayIso}`,
  )

  return (
    <>
      <h1>Today&apos;s classes</h1>
      <p className="muted">
        {capitalise(day ?? '')} {formatDate(todayIso)}
        {data?.term && ` · ${data.term.name}, ${data.term.sessions.name}`}
      </p>

      {loading ? (
        <p className="muted">Loading your timetable…</p>
      ) : error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(error)}</p>
      ) : data.problem === 'no-teacher' ? (
        <p className="alert alert-error" role="alert">
          Your account isn&apos;t set up as a teacher record yet. Please contact the school office.
        </p>
      ) : data.problem === 'no-term' ? (
        <p className="empty-state">No term is marked as current yet, so there is no timetable to show.</p>
      ) : data.problem === 'weekend' ? (
        <p className="empty-state">It&apos;s the weekend — no classes today.</p>
      ) : (
        <>
          {(todayIso < data.term.start_date || todayIso > data.term.end_date) && (
            <p className="alert alert-error" role="alert">
              Today is outside {data.term.name} ({formatDate(data.term.start_date)} – {formatDate(data.term.end_date)}),
              so attendance can&apos;t be recorded for today.
            </p>
          )}
          {data.slots.length === 0 ? (
            <p className="empty-state">You have no classes scheduled today.</p>
          ) : (
            <div className="slot-cards">
              {data.slots.map((slot) => {
                const isMarked = slot.markedCount > 0
                return (
                  <Link
                    key={slot.id}
                    to={`/teacher/attendance/${slot.id}?date=${todayIso}`}
                    className={`slot-card${isMarked ? ' is-marked' : ''}`}
                  >
                    <span className="slot-card-time">
                      {slot.periods.name} · {formatTime(slot.periods.start_time)}–{formatTime(slot.periods.end_time)}
                    </span>
                    <span className="slot-card-subject">{slot.subjects.name}</span>
                    <span className="muted">
                      {slot.sections.classes.name} {slot.sections.name}
                    </span>
                    <span className={`badge${isMarked ? '' : ' badge-warning'}`}>
                      {isMarked
                        ? `Attendance marked (${slot.markedCount} ${slot.markedCount === 1 ? 'student' : 'students'})`
                        : 'Attendance not marked yet'}
                    </span>
                    <span className="slot-card-action">{isMarked ? 'View or edit →' : 'Mark attendance →'}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}
    </>
  )
}
