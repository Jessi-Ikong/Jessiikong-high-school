import { Link } from 'react-router-dom'
import { formatDate, formatNaira } from '../lib/format'
import { toIsoDate } from '../lib/dates'
import { describeAction, targetLabel } from '../lib/audit'
import {
  LOW_ATTENDANCE_THRESHOLD,
  attendanceRate,
  formatPercent,
  isLow,
  sumAttendance,
  termSoFar,
  weekStartIso,
} from '../lib/dashboard'
import { fetchAdminOverview, fetchAttendanceOverview, fetchCurrentTerm, fetchRecentActivity } from '../lib/dashboardData'
import { useAsyncData } from '../hooks/useAsyncData'
import { DashPanel, Loaded, Stat } from '../components/DashboardParts'

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// School overview: headline numbers, attendance by class, who is often
// absent, fees, things that need attention and recent activity. Limited
// admins see the same school-wide numbers (they can read the same rows); only
// the activity feed differs (their own and non-admin actions).
export default function AdminDashboard() {
  const todayIso = toIsoDate(new Date())
  const termQuery = useAsyncData(fetchCurrentTerm, 'current-term')

  return (
    <>
      <h1>Admin overview</h1>
      <Loaded query={termQuery}>
        {(term) => (
          <>
            <p className="muted">
              {formatDate(todayIso)}
              {term ? ` · ${term.name}, ${term.sessions.name}` : ''}
            </p>
            {!term && (
              <p className="alert alert-info-plain">
                No term is marked as current yet. Set one up under <Link to="/admin/sessions">Sessions</Link> and{' '}
                <Link to="/admin/terms">Terms</Link>; attendance and fee figures need a current term.
              </p>
            )}
            <Body term={term} todayIso={todayIso} />
          </>
        )}
      </Loaded>
    </>
  )
}

// One attendance query (today, this week, this term) feeds both the headline
// "attendance today" figure and the by-class table.
function Body({ term, todayIso }) {
  const weekStart = weekStartIso(new Date())
  const range = termSoFar(term, todayIso)
  const attendance = useAsyncData(
    () => fetchAttendanceOverview(todayIso, weekStart, range),
    `admin-attendance:${todayIso}:${term?.id}`,
  )
  return (
    <>
      <Overview term={term} attendance={attendance} />
      <AttendanceOverview query={attendance} weekStart={weekStart} range={range} />
      <RecentActivity />
    </>
  )
}

function Overview({ term, attendance }) {
  const overview = useAsyncData(() => fetchAdminOverview(term), `admin-overview:${term?.id}`)
  const today = attendance.data ? sumAttendance(attendance.data.today) : null

  return (
    <Loaded query={overview}>
      {(o) => {
        const todayRate = today ? attendanceRate(today) : null
        const outstanding = o.fees ? Number(o.fees.amount_due) - Number(o.fees.amount_paid) : 0
        return (
          <>
            <div className="dash-stats">
              <Stat label="Active students" value={o.students} hint="enrolled this session" />
              <Stat label="Teachers" value={o.teachers} hint="active accounts" />
              <Stat label="Classes" value={o.classes} />
              <Stat
                label="Attendance today"
                value={attendance.loading ? '…' : formatPercent(todayRate)}
                hint={today?.records ? `${today.records} marks so far` : 'nothing marked yet today'}
                tone={isLow(todayRate) ? 'warn' : undefined}
              />
              {term && o.fees && (
                <>
                  <Stat label="Fees collected" value={formatNaira(o.fees.amount_paid)} hint={`of ${formatNaira(o.fees.amount_due)} billed · ${term.name}`} />
                  <Stat label="Fees outstanding" value={formatNaira(outstanding)} hint={`${o.fees.invoices} invoices · ${o.fees.paid} fully paid`} tone={outstanding > 0 ? 'warn' : undefined} />
                </>
              )}
            </div>
            <Alerts o={o} term={term} />
          </>
        )
      }}
    </Loaded>
  )
}

function Alerts({ o, term }) {
  const items = []
  if (o.overdueInvoices > 0) {
    items.push(
      <li key="overdue">
        <strong>{o.overdueInvoices}</strong> overdue {o.overdueInvoices === 1 ? 'invoice' : 'invoices'} (all terms).{' '}
        <Link to="/admin/fees">Fees →</Link>
      </li>,
    )
  }
  if (o.unassignedSlots > 0) {
    items.push(
      <li key="unassigned">
        <strong>{o.unassignedSlots}</strong> timetable {o.unassignedSlots === 1 ? 'slot has' : 'slots have'} no teacher this term.{' '}
        <Link to="/admin/timetable">Timetable →</Link>
      </li>,
    )
  }
  if (o.gaps.length > 0) {
    items.push(
      <li key="gaps">
        Subjects students take but that aren&apos;t on the timetable in {term.name}:{' '}
        {o.gaps.map((g, i) => (
          <span key={`${g.section_id}:${g.subject_name}`}>
            {i > 0 && ', '}
            {g.class_name} {g.section_name} {g.subject_name} ({g.students} {Number(g.students) === 1 ? 'student' : 'students'})
          </span>
        ))}
        . <Link to="/admin/timetable">Timetable →</Link>
      </li>,
    )
  }
  return (
    <DashPanel title="Needs attention">
      {items.length === 0 ? <p className="muted small">Nothing needs attention right now.</p> : <ul className="dash-alerts">{items}</ul>}
    </DashPanel>
  )
}

function AttendanceOverview({ query, weekStart, range }) {
  return (
    <DashPanel title="Attendance by class">
      <Loaded query={query}>
        {({ today, week, term: termRows, lowStudents }) => {
          // Every section with anything marked this week or term.
          const sections = new Map()
          for (const [period, rows] of [['term', termRows], ['week', week], ['today', today]]) {
            for (const r of rows) {
              const s = sections.get(r.section_id) ?? { id: r.section_id, label: `${r.class_name} ${r.section_name}`, level: r.class_level, name: r.section_name }
              s[period] = r
              sections.set(r.section_id, s)
            }
          }
          const list = [...sections.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
          return (
            <>
              <p className="muted small">
                Rate = present + late, out of all marks except excused absences. Classes and students under{' '}
                {LOW_ATTENDANCE_THRESHOLD}% are highlighted. Week from {formatDate(weekStart)}
                {range ? `; term from ${formatDate(range.from)}` : ''}.
              </p>
              {list.length === 0 ? (
                <p className="empty-state">No attendance has been marked {range ? 'this term' : 'this week'} yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Today</th>
                        <th>This week</th>
                        <th>This term</th>
                        <th>Absences (term)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => (
                        <tr key={s.id}>
                          <td>{s.label}</td>
                          <RateCell row={s.today} empty="Not marked" />
                          <RateCell row={s.week} empty="—" />
                          <RateCell row={s.term} empty="—" />
                          <td>{s.term ? Number(s.term.absent) : 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3>Students below {LOW_ATTENDANCE_THRESHOLD}% this term</h3>
              {!range ? (
                <p className="muted small">The term hasn&apos;t started yet.</p>
              ) : lowStudents.length === 0 ? (
                <p className="muted small">No student is below {LOW_ATTENDANCE_THRESHOLD}% this term.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Class</th>
                        <th>Rate</th>
                        <th>Absent</th>
                        <th>Marks counted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStudents.map((s) => (
                        <tr key={s.student_id}>
                          <td>{s.full_name}</td>
                          <td>
                            {s.class_name} {s.section_name}
                          </td>
                          <td>
                            <span className="badge badge-warning">{formatPercent(s.rate)}</span>
                          </td>
                          <td>{Number(s.absent)}</td>
                          <td>{Number(s.records) - Number(s.excused)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowStudents.length === 50 && <p className="muted small">Showing the 50 lowest.</p>}
                </div>
              )}
            </>
          )
        }}
      </Loaded>
    </DashPanel>
  )
}

function RateCell({ row, empty }) {
  const rate = row ? attendanceRate(row) : null
  if (!row) return <td className="muted">{empty}</td>
  return (
    <td>
      {isLow(rate) ? <span className="badge badge-warning">{formatPercent(rate)}</span> : formatPercent(rate)}
      <span className="muted small"> ({Number(row.records)})</span>
    </td>
  )
}

function RecentActivity() {
  const query = useAsyncData(() => fetchRecentActivity(8), 'admin-activity')
  return (
    <DashPanel title="Recent activity" to="/admin/audit-log" linkText="Full audit log →">
      <Loaded query={query}>
        {({ entries, names, rowsByEntity }) =>
          entries.length === 0 ? (
            <p className="muted small">No activity recorded yet.</p>
          ) : (
            <ul className="dash-list">
              {entries.map((e) => {
                const { verb, noun } = describeAction(e)
                const who = e.users ? `${e.users.first_name} ${e.users.last_name}` : 'System'
                return (
                  <li key={e.id}>
                    <span>
                      <strong>{who}</strong> · {verb.toLowerCase()} {noun} <strong>{targetLabel(e, names, rowsByEntity)}</strong>
                    </span>
                    <div className="muted small">{dateTime.format(new Date(e.created_at))}</div>
                  </li>
                )
              })}
            </ul>
          )
        }
      </Loaded>
    </DashPanel>
  )
}
