import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatNaira } from '../../lib/format'
import { formatDateTime } from '../../lib/assignments'
import { fullName } from '../../lib/people'
import { useAsyncData } from '../../hooks/useAsyncData'
import { PaymentStatusBadge } from '../../components/PaymentBadges'

// Same numbers as the scheduled sweep (migration 029 / reconcile-pending-payments).
const STUCK_AFTER_MINUTES = 15
const EXPIRE_AFTER_HOURS = 48

const PAYMENT_FIELDS =
  'id, amount, status, provider_ref, created_at, paid_at, provider_response, users(first_name, last_name, email), ' +
  'invoices(amount_due, amount_paid, status, fee_structures(name), terms(name), students(admission_number, users(first_name, middle_name, last_name)))'

async function fetchStuck(includeRecent) {
  let pendingQuery = supabase
    .from('payments')
    .select(PAYMENT_FIELDS)
    .eq('status', 'pending')
    .eq('provider', 'paystack')
    .order('created_at', { ascending: true })
  if (!includeRecent) {
    pendingQuery = pendingQuery.lt('created_at', new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString())
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const [pending, resolved] = await Promise.all([
    run(pendingQuery),
    // Payments the automatic sweep settled in the last 7 days.
    run(
      supabase
        .from('payments')
        .select(PAYMENT_FIELDS)
        .eq('provider', 'paystack')
        .in('status', ['successful', 'failed'])
        .eq('provider_response->last_check->>source', 'reconcile')
        .gte('updated_at', weekAgo)
        .order('updated_at', { ascending: false }),
    ),
  ])
  // "Now" for this load, so the page shows stable durations.
  return { pending, resolved, loadedAt: Date.now() }
}

// "2 h 5 min", "3 days 4 h" (from fromIso until now, a timestamp in ms)
function duration(fromIso, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} days ${hours % 24} h`
}

// What we know from the last check with Paystack (provider_response.last_check).
function CheckSummary({ payment }) {
  const check = payment.provider_response?.last_check
  if (!check) {
    return (
      <>
        <span className="badge badge-warning">Never checked</span>
        <div className="muted small">Not checked with Paystack yet (the next sweep will).</div>
      </>
    )
  }
  const times = `checked ${check.check_count ?? 1}×`
  if (check.outcome === 'paystack-unreachable') {
    return (
      <>
        <span className="badge badge-late">Paystack unreachable</span>
        <div className="muted small">
          {times}, last {formatDateTime(check.at)}. Will retry.
        </div>
      </>
    )
  }
  const repeated = (check.check_count ?? 1) >= 3
  return (
    <>
      <span className={repeated ? 'badge badge-muted' : 'badge badge-info'}>
        {check.paystack_status ? `Paystack: ${check.paystack_status}` : 'Paystack: no status'}
      </span>
      <div className="muted small">
        {times}
        {check.first_checked_at && (check.check_count ?? 1) > 1 ? ` since ${formatDateTime(check.first_checked_at)}` : ''}, last{' '}
        {formatDateTime(check.at)} ({check.source === 'reconcile' ? 'automatic' : check.source})
      </div>
      {check.gateway_response && <div className="muted small">&quot;{check.gateway_response}&quot;</div>}
      {repeated && (
        <div className="small">
          Consistently not completed on Paystack: the parent most likely left the checkout. Nothing was charged.
        </div>
      )}
    </>
  )
}

function PayerCells({ payment }) {
  const student = payment.invoices?.students
  return (
    <>
      <td>
        {student ? fullName(student.users) : '—'}
        <div className="muted small">{student?.admission_number}</div>
      </td>
      <td>
        {payment.users ? fullName(payment.users) : '—'}
        {payment.users?.email && <div className="muted small">{payment.users.email}</div>}
      </td>
      <td>
        {payment.invoices?.fee_structures?.name ?? '—'}
        <div className="muted small">{payment.invoices?.terms?.name}</div>
      </td>
      <td>{formatNaira(payment.amount)}</td>
    </>
  )
}

export default function StuckPayments() {
  const [includeRecent, setIncludeRecent] = useState(false)
  const query = useAsyncData(() => fetchStuck(includeRecent), `stuck-payments:${includeRecent}`)
  const [busyRef, setBusyRef] = useState(null)
  const [message, setMessage] = useState(null)

  async function recheck(payment) {
    setBusyRef(payment.provider_ref)
    setMessage(null)
    try {
      const result = await callFunction('verify-payment', { reference: payment.provider_ref })
      const text = {
        successful: 'Paystack confirmed it: the payment is now marked successful and the invoice updated.',
        'already-successful': 'It was already successful.',
        failed: 'Paystack reports this payment failed. It is now marked failed.',
        mismatch: 'Paystack reports success but for a DIFFERENT amount/currency. Marked failed for review; NOT counted as paid.',
        pending: `Still not completed on Paystack (${result.paystack_status ?? 'no status'}). It stays pending.`,
      }[result.outcome]
      setMessage({ ok: true, text: `${payment.provider_ref}: ${text ?? result.outcome}` })
      query.reload()
    } catch (err) {
      setMessage({ ok: false, text: `${payment.provider_ref}: ${err.message}` })
    } finally {
      setBusyRef(null)
    }
  }

  return (
    <>
      <h1>Stuck payments</h1>
      <p className="muted">
        Online (Paystack) payments still waiting for confirmation {STUCK_AFTER_MINUTES}+ minutes after they were started,
        usually because the parent left the checkout or Paystack&apos;s confirmation didn&apos;t reach us. The system re-checks
        them with Paystack automatically every 15 minutes, and a payment is only ever marked paid if Paystack confirms it.
        Payments Paystack still reports as not completed after {EXPIRE_AFTER_HOURS} hours are marked failed automatically.
      </p>
      <div className="filter-bar">
        <label className="checkbox-field">
          <input type="checkbox" checked={includeRecent} onChange={(e) => setIncludeRecent(e.target.checked)} />
          Also show payments started in the last {STUCK_AFTER_MINUTES} minutes
        </label>
        <button type="button" className="button-secondary" onClick={query.reload} disabled={query.refreshing}>
          {query.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {message && (
        <p className={message.ok ? 'alert alert-success' : 'alert alert-error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}

      {query.loading ? (
        <p className="muted">Loading…</p>
      ) : query.error ? (
        <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
      ) : (
        <>
          <section className="panel">
            <h2>
              Waiting for confirmation <span className="muted small">({query.data.pending.length})</span>
            </h2>
            {query.data.pending.length === 0 ? (
              <p className="empty-state">No stuck payments. 🎉</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table stuck-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Parent</th>
                      <th>Fee</th>
                      <th>Amount</th>
                      <th>Pending for</th>
                      <th>Last Paystack check</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.pending.map((p) => {
                      const hoursLeft = EXPIRE_AFTER_HOURS - (query.data.loadedAt - new Date(p.created_at).getTime()) / 3_600_000
                      return (
                        <tr key={p.id}>
                          <PayerCells payment={p} />
                          <td className="small">
                            {duration(p.created_at, query.data.loadedAt)}
                            <div className="muted small">since {formatDateTime(p.created_at)}</div>
                            <div className="muted small reference">{p.provider_ref}</div>
                            {hoursLeft > 0 && hoursLeft < 24 && (
                              <div className="small">Auto-fails in about {Math.ceil(hoursLeft)} h if still not completed</div>
                            )}
                          </td>
                          <td>
                            <CheckSummary payment={p} />
                          </td>
                          <td>
                            <button type="button" onClick={() => recheck(p)} disabled={busyRef !== null}>
                              {busyRef === p.provider_ref ? 'Checking…' : 'Re-check now'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>
              Settled by the automatic check (last 7 days){' '}
              <span className="muted small">({query.data.resolved.length})</span>
            </h2>
            {query.data.resolved.length === 0 ? (
              <p className="muted small">None.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Parent</th>
                      <th>Fee</th>
                      <th>Amount</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.resolved.map((p) => (
                      <tr key={p.id}>
                        <PayerCells payment={p} />
                        <td>
                          <PaymentStatusBadge status={p.status} />
                          <div className="muted small">
                            {p.provider_response?.expired
                              ? `Expired: never completed on Paystack (checked ${p.provider_response?.last_check?.check_count ?? 1}×)`
                              : p.provider_response?.review
                                ? 'Amount mismatch: needs review'
                                : `Paystack: ${p.provider_response?.last_check?.paystack_status ?? '—'}`}
                          </div>
                          <div className="muted small">{formatDateTime(p.provider_response?.last_check?.at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
