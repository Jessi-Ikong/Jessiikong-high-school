import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { friendlyDbError, run } from '../lib/db'
import { formatDate, formatTime } from '../lib/format'
import { capitalise, schoolDayOf, toIsoDate } from '../lib/dates'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime } from '../lib/assignments'
import { pendingByAssignment, upcomingByDue } from '../lib/dashboard'
import { fetchTeacherWork } from '../lib/dashboardData'
import { DashPanel, Loaded, MessagesPreview } from '../components/DashboardParts'
import { Alert, Badge, Card, EmptyState, LoadingState, PageHeader } from '../components/ui/Primitives'

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
      <PageHeader
        title="Today's classes"
        subtitle={`${capitalise(day ?? '')} ${formatDate(todayIso)}${data?.term ? ` · ${data.term.name}, ${data.term.sessions.name}` : ''}`}
      />

      {loading ? (
        <LoadingState lines={3} label="Loading your timetable…" />
      ) : error ? (
        <Alert tone="danger">{friendlyDbError(error)}</Alert>
      ) : data.problem === 'no-teacher' ? (
        <Alert tone="danger">Your account isn&apos;t set up as a teacher record yet. Please contact the school office.</Alert>
      ) : data.problem === 'no-term' ? (
        <Card>
          <EmptyState icon="calendar">No term is marked as current yet, so there is no timetable to show.</EmptyState>
        </Card>
      ) : data.problem === 'weekend' ? (
        <Card>
          <EmptyState icon="calendar">It&apos;s the weekend — no classes today.</EmptyState>
        </Card>
      ) : (
        <>
          {(todayIso < data.term.start_date || todayIso > data.term.end_date) && (
            <Alert tone="danger">
              Today is outside {data.term.name} ({formatDate(data.term.start_date)} – {formatDate(data.term.end_date)}), so attendance can&apos;t be
              recorded for today.
            </Alert>
          )}
          {data.slots.length === 0 ? (
            <Card>
              <EmptyState icon="calendar">You have no classes scheduled today.</EmptyState>
            </Card>
          ) : (
            <div className="ds-slot-grid">
              {data.slots.map((slot) => {
                const isMarked = slot.markedCount > 0
                return (
                  <Link
                    key={slot.id}
                    to={`/teacher/attendance/${slot.id}?date=${todayIso}`}
                    className={`ds-slot-card${isMarked ? ' is-marked' : ''}`}
                  >
                    <span className="ds-slot-time">
                      {slot.periods.name} · {formatTime(slot.periods.start_time)}–{formatTime(slot.periods.end_time)}
                    </span>
                    <span className="ds-slot-subject">{slot.subjects.name}</span>
                    <span className="ds-muted">
                      {slot.sections.classes.name} {slot.sections.name}
                    </span>
                    <span>
                      <Badge status={isMarked ? 'marked' : 'not marked'}>
                        {isMarked
                          ? `Attendance marked (${slot.markedCount} ${slot.markedCount === 1 ? 'student' : 'students'})`
                          : 'Attendance not marked yet'}
                      </Badge>
                    </span>
                    <span className="ds-slot-action">{isMarked ? 'View or edit →' : 'Mark attendance →'}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}

      <div className="ds-grid-2" style={{ marginTop: 16 }}>
        <TeacherWork userId={profile.id} />
        <MessagesPreview base="/teacher" />
      </div>
    </>
  )
}

// Link to one assignment on the Assignments page (its class preselected, expanded).
function assignmentLink(a) {
  return `/teacher/assignments?class=${a.term_id}:${a.section_id}:${a.subject_id}&open=${a.id}`
}

const classLabel = (a) => `${a.subjects.name} — ${a.sections.classes.name} ${a.sections.name}`

// Handed-in work still waiting for a grade, and the next due dates.
function TeacherWork({ userId }) {
  const query = useAsyncData(() => fetchTeacherWork(userId), `teacher-work:${userId}`)
  return (
    <Loaded query={query}>
      {(data) => {
        if (!data) return null
        const pending = pendingByAssignment(data.ungraded, data.assignments)
        const total = data.ungraded.length
        const upcoming = upcomingByDue(data.assignments, new Date(), 5)
        return (
          <>
            <DashPanel title="Waiting to be graded" to="/teacher/assignments" linkText="All assignments →">
              {pending.length === 0 ? (
                <p className="ds-note">Nothing to grade — every handed-in submission has a mark.</p>
              ) : (
                <>
                  <p className="ds-small" style={{ marginTop: 0 }}>
                    <strong>
                      {total} {total === 1 ? 'submission' : 'submissions'}
                    </strong>{' '}
                    across {pending.length} {pending.length === 1 ? 'assignment' : 'assignments'}.
                  </p>
                  <ul className="ds-dash-list">
                    {pending.slice(0, 6).map(({ assignment: a, count }) => (
                      <li key={a.id} className="ds-dash-row">
                        <span>
                          <Link to={assignmentLink(a)}>{a.title}</Link>
                          <span className="ds-muted ds-small"> · {classLabel(a)}</span>
                        </span>
                        <Badge status="to grade">{count} to grade</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DashPanel>
            <DashPanel title="Coming up" to="/teacher/assignments" linkText="All assignments →">
              {upcoming.length === 0 ? (
                <p className="ds-note">No assignments due soon.</p>
              ) : (
                <ul className="ds-dash-list">
                  {upcoming.map((a) => (
                    <li key={a.id}>
                      <Link to={assignmentLink(a)}>{a.title}</Link>
                      <div className="ds-muted ds-small">
                        {classLabel(a)} · due {formatDateTime(a.due_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DashPanel>
          </>
        )
      }}
    </Loaded>
  )
}
