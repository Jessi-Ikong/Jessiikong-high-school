import { Link } from 'react-router-dom'
import { formatDate, formatTime } from '../lib/format'
import { capitalise, schoolDayOf, toIsoDate } from '../lib/dates'
import { formatDateTime, submissionStatus } from '../lib/assignments'
import { fullName } from '../lib/people'
import { formatPercent, isLow, recentGrades } from '../lib/dashboard'
import { fetchCurrentTerm, fetchStudentHome } from '../lib/dashboardData'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import { AnnouncementsPreview, DashPanel, GradeList, Loaded, Stat } from '../components/DashboardParts'
import { Alert, Badge, PageHeader } from '../components/ui/Primitives'

// Student home: today's lessons, what's due, recent marks, class position,
// attendance this term and the latest announcements. Everything is the
// student's own (the row rules only return their own records).
export default function StudentDashboard() {
  const { profile } = useAuth()
  const now = new Date()
  const todayIso = toIsoDate(now)
  const day = schoolDayOf(now)
  const query = useAsyncData(async () => {
    const term = await fetchCurrentTerm()
    return { term, ...(await fetchStudentHome(profile.id, term, day, todayIso)) }
  }, `student-home:${profile.id}:${todayIso}`)

  return (
    <>
      <PageHeader title={`Welcome, ${profile.first_name}`} />
      <Loaded query={query}>
        {(data) =>
          data.problem === 'no-student' ? (
            <Alert tone="danger">Your account isn&apos;t set up as a student record yet. Please contact the school office.</Alert>
          ) : (
            <StudentHome data={data} day={day} todayIso={todayIso} />
          )
        }
      </Loaded>
      <AnnouncementsPreview base="/student" />
    </>
  )
}

function StudentHome({ data, day, todayIso }) {
  const { term, enrollment, slots, assignments, scores, graded, rank, rate } = data
  const grades = recentGrades(scores, graded, 5)
  const now = new Date()

  return (
    <>
      <p className="ds-subtitle" style={{ marginTop: 0 }}>
        {capitalise(day ?? '')} {formatDate(todayIso)}
        {enrollment && ` · ${enrollment.sections.classes.name} ${enrollment.sections.name}`}
        {term && ` · ${term.name}, ${term.sessions.name}`}
      </p>
      {!enrollment && (
        <Alert tone="info">You aren&apos;t enrolled in a class this session yet. Please contact the school office.</Alert>
      )}

      <div className="ds-stat-grid ds-stat-grid-fit">
        <Stat
          label="Attendance this term"
          value={formatPercent(rate?.rate)}
          hint={rate ? `${Number(rate.attended)} of ${Number(rate.records) - Number(rate.excused)} lessons` : 'nothing marked yet'}
          tone={isLow(rate?.rate) ? 'warn' : undefined}
        />
        <Stat
          label="Class position"
          value={rank ? `${rank.position} of ${rank.class_size}` : '—'}
          hint={rank ? `average ${Number(rank.average_score).toFixed(1)}% · ${term.name}` : 'not ranked yet this term'}
        />
      </div>

      <div className="ds-grid-2">
        <DashPanel title="Today's timetable">
          {!term ? (
            <p className="ds-note">No term is marked as current yet.</p>
          ) : !day ? (
            <p className="ds-note">It&apos;s the weekend — no lessons today.</p>
          ) : todayIso < term.start_date || todayIso > term.end_date ? (
            <p className="ds-note">Today is outside {term.name}.</p>
          ) : slots.length === 0 ? (
            <p className="ds-note">No lessons scheduled for you today.</p>
          ) : (
            <ul className="ds-dash-list">
              {slots.map((s) => (
                <li key={s.id} className="ds-dash-row">
                  <span>
                    <strong>{s.subjects.name}</strong>
                    {s.teachers?.users && <span className="ds-muted ds-small"> · {fullName(s.teachers.users)}</span>}
                  </span>
                  <span className="ds-muted ds-small">
                    {s.periods.name} · {formatTime(s.periods.start_time)}–{formatTime(s.periods.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashPanel>

        <DashPanel title="Upcoming deadlines" to="/student/assignments" linkText="All assignments →">
          {assignments.length === 0 ? (
            <p className="ds-note">Nothing due — you&apos;re all caught up.</p>
          ) : (
            <ul className="ds-dash-list">
              {assignments.map((a) => {
                // offline work (no hand-in) is just a date to know about
                const offline = a.requires_submission === false
                const status = submissionStatus(a, a.mine, now)
                return (
                  <li key={a.id} className="ds-dash-row">
                    <span>
                      <Link to="/student/assignments">{a.title}</Link>
                      <span className="ds-muted ds-small">
                        {' '}
                        · {a.subjects.name} · due {formatDateTime(a.due_at)}
                      </span>
                    </span>
                    {offline ? <Badge status="no hand-in">No hand-in</Badge> : <Badge status={status.key}>{status.label}</Badge>}
                  </li>
                )
              })}
            </ul>
          )}
        </DashPanel>

        <DashPanel title="Recent grades">
          <GradeList items={grades} />
        </DashPanel>
      </div>
    </>
  )
}
