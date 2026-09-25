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
      <h1>Welcome, {profile.first_name}</h1>
      {query.loading ? (
        <p className="muted">Loading…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : query.data.children.length === 0 ? (
        <p className="empty-state">No children are linked to your account yet. Please contact the school office.</p>
      ) : (
        <ChildCards data={query.data} todayIso={todayIso} />
      )}
      <div className="dash-grid">
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
    <div className="card-list">
      {children.map((c) => {
        const rate = rateOf[c.id]
        const grades = recentGrades(scoresOf[c.id] ?? [], gradedOf[c.id] ?? [], 3)
        const owing = outstandingInvoices(invoicesOf[c.id] ?? [])
        return (
          <div key={c.id} className="panel">
            <h2>{fullName(c)}</h2>
            <p className="muted small">
              {c.className ?? 'Not enrolled this session'} · Admission no. {c.admissionNumber}
            </p>
            <div className="dash-child">
              <div>
                <h3>Attendance{term ? ` · ${term.name}` : ''}</h3>
                {!rate ? (
                  <p className="muted small">Nothing marked yet this term.</p>
                ) : (
                  <p>
                    {isLow(rate.rate) ? (
                      <span className="badge badge-warning">{formatPercent(rate.rate)}</span>
                    ) : (
                      <strong>{formatPercent(rate.rate)}</strong>
                    )}
                    <span className="muted small">
                      {' '}
                      · {Number(rate.attended)} of {Number(rate.records) - Number(rate.excused)} lessons
                      {Number(rate.absent) > 0 && `, ${Number(rate.absent)} absent`}
                      {Number(rate.excused) > 0 && `, ${Number(rate.excused)} excused`}
                    </span>
                  </p>
                )}
              </div>
              <div>
                <h3>Recent grades</h3>
                <GradeList items={grades} />
              </div>
              <div>
                <h3>Fees</h3>
                {owing.length === 0 ? (
                  <p className="muted small">Nothing to pay.</p>
                ) : (
                  <ul className="dash-list">
                    {owing.slice(0, 3).map((i) => {
                      const overdue = i.status === 'overdue' || (i.due_date && i.due_date < todayIso)
                      return (
                        <li key={i.id} className="dash-row">
                          <span>
                            {i.fee_structures?.name ?? 'Fee'}
                            <span className="muted small"> · {i.terms?.name}</span>
                          </span>
                          <span>
                            <strong>{formatNaira(i.balance)}</strong>{' '}
                            {i.due_date ? (
                              <span className={`badge${overdue ? ' badge-warning' : ' badge-muted'}`}>
                                {overdue ? 'overdue since' : 'due'} {formatDate(i.due_date)}
                              </span>
                            ) : (
                              <span className="badge badge-muted">no due date</span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <Link to={`/parent/fees?child=${c.id}`}>School fees →</Link>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
