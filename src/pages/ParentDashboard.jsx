import { Link } from 'react-router-dom'
import { friendlyDbError } from '../lib/db'
import { formatDate, formatNaira } from '../lib/format'
import { toIsoDate } from '../lib/dates'
import { fullName } from '../lib/people'
import { fetchMyChildren } from '../lib/parentChildren'
import { formatPercent, groupBy, isLow, outstandingInvoices, recentGrades, termSoFar } from '../lib/dashboard'
import { fetchChildrenSummaries, fetchCurrentTerm } from '../lib/dashboardData'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../hooks/useAuth'
import { AnnouncementsPreview, GradeList, MessagesPreview } from '../components/DashboardParts'
import { Alert, Badge, Card, EmptyState, LoadingState, PageHeader } from '../components/ui/Primitives'

// Parent home: one card per child (attendance this term, recent grades, fees
// still to pay), then messages and announcements. The summaries for all
// children are loaded together, then split per child by student ID, so one
// child's figures never appear on another's card. The row rules only return
// the parent's own children anyway.
async function fetchParentHome(userId, todayIso) {
  const [children, term] = await Promise.all([fetchMyChildren(userId), fetchCurrentTerm()])
  const summaries = await fetchChildrenSummaries(
    children.map((c) => c.id),
    termSoFar(term, todayIso),
  )
  return { children, term, ...summaries }
}

export default function ParentDashboard() {
  const { profile } = useAuth()
  const todayIso = toIsoDate(new Date())
  const query = useAsyncData(() => fetchParentHome(profile.id, todayIso), `parent-home:${profile.id}:${todayIso}`)

  return (
    <>
      <PageHeader title={`Welcome, ${profile.first_name}`} />
      {query.loading ? (
        <LoadingState lines={5} />
      ) : query.error ? (
        <Alert tone="danger">{friendlyDbError(query.error)}</Alert>
      ) : query.data.children.length === 0 ? (
        <Card>
          <EmptyState icon="users">No children are linked to your account yet. Please contact the school office.</EmptyState>
        </Card>
      ) : (
        <ChildCards data={query.data} todayIso={todayIso} />
      )}
      <div className="ds-grid-2">
        <MessagesPreview base="/parent" />
        <AnnouncementsPreview base="/parent" />
      </div>
    </>
  )
}

function ChildCards({ data, todayIso }) {
  const { children, term } = data
  const rateOf = Object.fromEntries(data.rates.map((r) => [r.student_id, r]))
  const scoresOf = groupBy(data.scores, 'student_id')
  const gradedOf = groupBy(data.graded, 'student_id')
  const invoicesOf = groupBy(data.invoices, 'student_id')

  return (
    <>
      {children.map((c) => {
        const rate = rateOf[c.id]
        const grades = recentGrades(scoresOf[c.id] ?? [], gradedOf[c.id] ?? [], 3)
        const owing = outstandingInvoices(invoicesOf[c.id] ?? [])
        return (
          <Card key={c.id} title={fullName(c)}>
            <p className="ds-muted ds-small" style={{ marginTop: 0 }}>
              {c.className ?? 'Not enrolled this session'} · Admission no. {c.admissionNumber}
            </p>
            <div className="ds-child-grid">
              <div>
                <h3 className="ds-h3">Attendance{term ? ` · ${term.name}` : ''}</h3>
                {!rate ? (
                  <p className="ds-note">Nothing marked yet this term.</p>
                ) : (
                  <p style={{ margin: 0 }}>
                    {isLow(rate.rate) ? <Badge status="low">{formatPercent(rate.rate)}</Badge> : <strong>{formatPercent(rate.rate)}</strong>}
                    <span className="ds-muted ds-small">
                      {' '}
                      · {Number(rate.attended)} of {Number(rate.records) - Number(rate.excused)} lessons
                      {Number(rate.absent) > 0 && `, ${Number(rate.absent)} absent`}
                      {Number(rate.excused) > 0 && `, ${Number(rate.excused)} excused`}
                    </span>
                  </p>
                )}
              </div>
              <div>
                <h3 className="ds-h3">Recent grades</h3>
                <GradeList items={grades} />
              </div>
              <div>
                <h3 className="ds-h3">Fees</h3>
                {owing.length === 0 ? (
                  <p className="ds-note">Nothing to pay.</p>
                ) : (
                  <ul className="ds-dash-list">
                    {owing.slice(0, 3).map((i) => {
                      const overdue = i.status === 'overdue' || (i.due_date && i.due_date < todayIso)
                      return (
                        <li key={i.id} className="ds-dash-row">
                          <span>
                            {i.fee_structures?.name ?? 'Fee'}
                            <span className="ds-muted ds-small"> · {i.terms?.name}</span>
                          </span>
                          <span>
                            <strong>{formatNaira(i.balance)}</strong>{' '}
                            {i.due_date ? (
                              <Badge status={overdue ? 'overdue' : 'due'}>
                                {overdue ? 'overdue since' : 'due'} {formatDate(i.due_date)}
                              </Badge>
                            ) : (
                              <Badge status="due">no due date</Badge>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <Link className="ds-btn ds-btn-link" style={{ paddingLeft: 0 }} to={`/parent/fees?child=${c.id}`}>
                  School fees →
                </Link>
              </div>
            </div>
          </Card>
        )
      })}
    </>
  )
}
