import { Link } from 'react-router-dom'
import { formatDate, formatNaira, formatNairaCompact } from '../lib/format'
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
import { Alert, Badge, Card, EmptyState, LoadingState, ErrorState, PageHeader, QueryState, StatCard } from '../components/ui/Primitives'
import DataTable from '../components/ui/DataTable'
import Icon from '../components/ui/Icon'

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// School overview: headline numbers, what needs attention, attendance by
// class, who is often absent, and recent activity. Limited admins see the
// same school-wide numbers (they can read the same rows); only the activity
// feed differs (their own and non-admin actions).
//
// Split in two: this component loads the data; AdminDashboardView only
// displays it (so it can also be previewed with sample data, see src/dev).
export default function AdminDashboard() {
  const todayIso = toIsoDate(new Date())
  const termQuery = useAsyncData(fetchCurrentTerm, 'current-term')

  if (termQuery.loading) {
    return (
      <>
        <PageHeader title="Overview" subtitle={formatDate(todayIso)} />
        <LoadingState lines={6} />
      </>
    )
  }
  if (termQuery.error) {
    return (
      <>
        <PageHeader title="Overview" subtitle={formatDate(todayIso)} />
        <ErrorState onRetry={termQuery.reload} />
      </>
    )
  }
  return <DashboardData term={termQuery.data} todayIso={todayIso} />
}

function DashboardData({ term, todayIso }) {
  const weekStart = weekStartIso(new Date())
  const range = termSoFar(term, todayIso)
  const overview = useAsyncData(() => fetchAdminOverview(term), `admin-overview:${term?.id}`)
  const attendance = useAsyncData(
    () => fetchAttendanceOverview(todayIso, weekStart, range),
    `admin-attendance:${todayIso}:${term?.id}`,
  )
  const activity = useAsyncData(() => fetchRecentActivity(8), 'admin-activity')
  return (
    <AdminDashboardView
      term={term}
      todayIso={todayIso}
      weekStart={weekStart}
      range={range}
      overview={overview}
      attendance={attendance}
      activity={activity}
    />
  )
}

// Display only. overview / attendance / activity are useAsyncData results
// ({ loading, error, data, reload }).
export function AdminDashboardView({ term, todayIso, weekStart, range, overview, attendance, activity }) {
  return (
    <>
      <PageHeader title="Overview" subtitle={`${formatDate(todayIso)}${term ? ` · ${term.name}, ${term.sessions.name}` : ''}`} />
      {!term && (
        <Alert tone="warning">
          No term is marked as current yet. Set one up under <Link to="/admin/sessions">Sessions</Link> and{' '}
          <Link to="/admin/terms">Terms</Link>; attendance and fee figures need a current term.
        </Alert>
      )}

      <Stats term={term} overview={overview} attendance={attendance} />

      <div className="ds-grid-2">
        <NeedsAttention term={term} overview={overview} />
        <RecentActivity activity={activity} />
      </div>

      <AttendanceByClass query={attendance} weekStart={weekStart} range={range} />
      <LowAttendance query={attendance} range={range} />
    </>
  )
}

function Stats({ term, overview, attendance }) {
  if (overview.loading) return <LoadingState lines={2} />
  if (overview.error) return <ErrorState onRetry={overview.reload} />
  const o = overview.data
  const today = attendance.data ? sumAttendance(attendance.data.today) : null
  const todayRate = today ? attendanceRate(today) : null
  const outstanding = o.fees ? Number(o.fees.amount_due) - Number(o.fees.amount_paid) : 0
  return (
    <div className="ds-stat-grid">
      <StatCard label="Students" value={o.students} hint="active this session" />
      <StatCard label="Teachers" value={o.teachers} hint="active accounts" />
      <StatCard label="Classes" value={o.classes} />
      <StatCard
        label="Attendance today"
        value={attendance.loading ? '…' : formatPercent(todayRate)}
        hint={today?.records ? `${today.records} marks so far` : 'nothing marked yet'}
        tone={isLow(todayRate) ? 'warning' : undefined}
      />
      {term && o.fees && (
        <>
          <StatCard
            label="Fees collected"
            value={formatNairaCompact(o.fees.amount_paid)}
            exact={formatNaira(o.fees.amount_paid)}
            hint={`of ${formatNairaCompact(o.fees.amount_due)} · ${term.name}`}
          />
          <StatCard
            label="Outstanding"
            value={formatNairaCompact(outstanding)}
            exact={formatNaira(outstanding)}
            hint={`${o.fees.invoices} invoices · ${o.fees.paid} paid`}
            tone={outstanding > 0 ? 'warning' : undefined}
          />
        </>
      )}
    </div>
  )
}

function NeedsAttention({ term, overview }) {
  const items = []
  const o = overview.data
  if (o?.overdueInvoices > 0) {
    items.push({
      key: 'overdue',
      tone: 'danger',
      icon: 'money',
      text: (
        <>
          <strong>{o.overdueInvoices}</strong> overdue {o.overdueInvoices === 1 ? 'invoice' : 'invoices'}
        </>
      ),
      meta: 'All terms',
      to: '/admin/fees',
      action: 'Fees',
    })
  }
  if (o?.inactiveTeacherSlots > 0) {
    items.push({
      key: 'inactive',
      tone: 'warning',
      icon: 'user',
      text: (
        <>
          <strong>{o.inactiveTeacherSlots}</strong> timetable {o.inactiveTeacherSlots === 1 ? 'slot is' : 'slots are'} still assigned to a
          deactivated teacher
        </>
      ),
      meta: term?.name,
      to: '/admin/timetable',
      action: 'Timetable',
    })
  }
  if (o?.unassignedSlots > 0) {
    items.push({
      key: 'unassigned',
      tone: 'warning',
      icon: 'calendar',
      text: (
        <>
          <strong>{o.unassignedSlots}</strong> timetable {o.unassignedSlots === 1 ? 'slot has' : 'slots have'} no teacher
        </>
      ),
      meta: term?.name,
      to: '/admin/timetable',
      action: 'Timetable',
    })
  }
  for (const g of o?.gaps ?? []) {
    items.push({
      key: `gap:${g.section_id}:${g.subject_name}`,
      tone: 'info',
      icon: 'book',
      text: (
        <>
          <strong>
            {g.class_name} {g.section_name} {g.subject_name}
          </strong>{' '}
          isn&apos;t on the timetable
        </>
      ),
      meta: `${g.students} ${Number(g.students) === 1 ? 'student takes' : 'students take'} it · ${term?.name ?? ''}`,
      to: '/admin/timetable',
      action: 'Fix',
    })
  }

  return (
    <Card title="Needs attention" flush>
      {overview.loading ? (
        <LoadingState lines={3} />
      ) : overview.error ? (
        <ErrorState onRetry={overview.reload} />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title="All clear">
          Nothing needs attention right now.
        </EmptyState>
      ) : (
        <ul className="ds-list">
          {items.map((it) => (
            <li key={it.key} className="ds-list-item">
              <span className={`ds-list-icon ds-list-icon-${it.tone}`}>
                <Icon name={it.icon} size={16} />
              </span>
              <span className="ds-list-main">
                {it.text}
                {it.meta && <span className="ds-list-meta">{it.meta}</span>}
              </span>
              <span className="ds-list-action">
                <Link to={it.to}>
                  {it.action} <span aria-hidden="true">→</span>
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RateCell({ row }) {
  if (!row) return <span className="ds-muted">—</span>
  const rate = attendanceRate(row)
  return (
    <span>
      {isLow(rate) ? <Badge tone="warning">{formatPercent(rate)}</Badge> : formatPercent(rate)}
      <span className="ds-muted ds-small"> ({Number(row.records)})</span>
    </span>
  )
}

function AttendanceByClass({ query, weekStart, range }) {
  return (
    <Card title="Attendance by class" flush>
      <QueryState query={query} lines={4}>
        {({ today, week, term: termRows }) => {
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
              <p className="ds-note ds-card-body" style={{ paddingBottom: 0 }}>
                Rate = present + late, out of all marks except excused. Under {LOW_ATTENDANCE_THRESHOLD}% is highlighted. Week from{' '}
                {formatDate(weekStart)}
                {range ? `; term from ${formatDate(range.from)}` : ''}. (n) = marks.
              </p>
              <DataTable
                caption="Attendance by class"
                rowKey={(s) => s.id}
                rows={list}
                empty={<EmptyState icon="check">No attendance has been marked {range ? 'this term' : 'this week'} yet.</EmptyState>}
                columns={[
                  { key: 'label', header: 'Class', primary: true },
                  { key: 'today', header: 'Today', render: (s) => (s.today ? <RateCell row={s.today} /> : <span className="ds-muted">Not marked</span>) },
                  { key: 'week', header: 'This week', render: (s) => <RateCell row={s.week} /> },
                  { key: 'term', header: 'This term', render: (s) => <RateCell row={s.term} /> },
                  { key: 'absent', header: 'Absences (term)', numeric: true, render: (s) => (s.term ? Number(s.term.absent) : 0) },
                ]}
              />
            </>
          )
        }}
      </QueryState>
    </Card>
  )
}

function LowAttendance({ query, range }) {
  return (
    <Card title={`Students below ${LOW_ATTENDANCE_THRESHOLD}% this term`} flush>
      <QueryState query={query} lines={3}>
        {({ lowStudents }) =>
          !range ? (
            <EmptyState icon="calendar">The term hasn&apos;t started yet.</EmptyState>
          ) : (
            <>
              <DataTable
                caption={`Students below ${LOW_ATTENDANCE_THRESHOLD}% attendance this term`}
                rowKey={(s) => s.student_id}
                rows={lowStudents}
                empty={
                  <EmptyState icon="check" title="No one below the line">
                    No student is under {LOW_ATTENDANCE_THRESHOLD}% this term.
                  </EmptyState>
                }
                columns={[
                  { key: 'full_name', header: 'Student', primary: true },
                  { key: 'class', header: 'Class', render: (s) => `${s.class_name} ${s.section_name}` },
                  { key: 'rate', header: 'Rate', render: (s) => <Badge status="late">{formatPercent(s.rate)}</Badge> },
                  { key: 'absent', header: 'Absent', numeric: true, render: (s) => Number(s.absent) },
                  { key: 'counted', header: 'Marks counted', numeric: true, render: (s) => Number(s.records) - Number(s.excused) },
                ]}
              />
              {lowStudents.length === 50 && <p className="ds-note ds-card-body">Showing the 50 lowest.</p>}
            </>
          )
        }
      </QueryState>
    </Card>
  )
}

function RecentActivity({ activity }) {
  return (
    <Card
      title="Recent activity"
      flush
      action={
        <Link to="/admin/audit-log">
          Audit log <span aria-hidden="true">→</span>
        </Link>
      }
    >
      <QueryState query={activity} lines={4}>
        {({ entries, names, rowsByEntity }) =>
          entries.length === 0 ? (
            <EmptyState icon="clock">No activity recorded yet.</EmptyState>
          ) : (
            <ul className="ds-list">
              {entries.map((e) => {
                const { verb, noun } = describeAction(e)
                const who = e.users ? `${e.users.first_name} ${e.users.last_name}` : 'System'
                const tone = verb === 'Deleted' ? 'danger' : verb === 'Created' ? 'success' : 'info'
                return (
                  <li key={e.id} className="ds-list-item">
                    <span className={`ds-list-icon ds-list-icon-${tone}`}>
                      <Icon name={verb === 'Created' ? 'check' : verb === 'Deleted' ? 'x' : 'edit'} size={16} />
                    </span>
                    <span className="ds-list-main">
                      <strong>{who}</strong> {verb.toLowerCase()} {noun} <strong>{targetLabel(e, names, rowsByEntity)}</strong>
                      <span className="ds-list-meta">{dateTime.format(new Date(e.created_at))}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )
        }
      </QueryState>
    </Card>
  )
}
