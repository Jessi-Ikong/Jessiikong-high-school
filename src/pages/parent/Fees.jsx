import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyDbError, run } from '../../lib/db'
import { callFunction } from '../../lib/functions'
import { formatDate, formatNaira } from '../../lib/format'
import { formatDateTime } from '../../lib/assignments'
import { fullName } from '../../lib/people'
import { fetchMyChildren } from '../../lib/parentChildren'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../hooks/useAuth'
import ChildSwitcher from '../../components/ChildSwitcher'
import { useChosenChild } from '../../hooks/useChosenChild'
import { InvoiceStatusBadge, PaymentStatusBadge } from '../../components/PaymentBadges'

// The child's invoices (every term) and the payments made against them.
// RLS only returns invoices / payments for the parent's own children.
async function fetchChildFees(studentId) {
  const [invoices, payments] = await Promise.all([
    run(
      supabase
        .from('invoices')
        .select('id, amount_due, amount_paid, status, due_date, created_at, fee_structures(name), terms(name, start_date, sessions(name))')
        .eq('student_id', studentId),
    ),
    run(
      supabase
        .from('payments')
        .select('id, amount, status, provider, provider_ref, paid_at, created_at, invoices!inner(student_id, fee_structures(name), terms(name))')
        .eq('invoices.student_id', studentId)
        .order('created_at', { ascending: false }),
    ),
  ])
  // Newest term first, then by due date.
  invoices.sort(
    (a, b) =>
      (b.terms?.start_date ?? '').localeCompare(a.terms?.start_date ?? '') ||
      (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  )
  return { invoices, payments }
}

export default function Fees() {
  const { profile } = useAuth()
  const query = useAsyncData(() => fetchMyChildren(profile.id), `my-children:${profile.id}`)

  if (query.loading) return <p className="muted">Loading…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>
  if (query.data.length === 0) {
    return (
      <>
        <h1>School fees</h1>
        <p className="empty-state">No children are linked to your account yet. Please contact the school office.</p>
      </>
    )
  }
  return <FeesForChildren list={query.data} />
}

function FeesForChildren({ list }) {
  const [child, chooseChild] = useChosenChild(list)
  return (
    <>
      <h1>School fees</h1>
      <ChildSwitcher list={list} chosen={child} onChoose={chooseChild} />
      <ChildFees key={child.id} child={child} />
    </>
  )
}

function ChildFees({ child }) {
  const query = useAsyncData(() => fetchChildFees(child.id), `child-fees:${child.id}`)

  if (query.loading) return <p className="muted">Loading fees…</p>
  if (query.error) return <p className="alert alert-error" role="alert">{friendlyDbError(query.error)}</p>

  const { invoices, payments } = query.data
  const outstanding = invoices.reduce((sum, i) => sum + Math.max(Number(i.amount_due) - Number(i.amount_paid), 0), 0)

  return (
    <>
      <p className="muted">
        {fullName(child)}
        {child.className ? ` · ${child.className}` : ''} · Admission no. {child.admissionNumber}
      </p>

      <section className="panel">
        <h2>Invoices</h2>
        {invoices.length === 0 ? (
          <p className="empty-state">No fees have been billed for {child.first_name} yet.</p>
        ) : (
          <>
            <p className={outstanding > 0 ? 'fee-balance' : 'fee-balance is-clear'}>
              {outstanding > 0 ? (
                <>
                  Total outstanding: <strong>{formatNaira(outstanding)}</strong>
                </>
              ) : (
                'All fees are paid. Thank you!'
              )}
            </p>
            <div className="table-wrap">
              <table className="data-table fee-table">
                <thead>
                  <tr>
                    <th>Fee</th>
                    <th>Amount due</th>
                    <th>Paid so far</th>
                    <th>Status</th>
                    <th>Due date</th>
                    <th aria-label="Pay" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <InvoiceRow key={inv.id} invoice={inv} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Payments are made securely through Paystack. &quot;Pay&quot; charges the full remaining balance of that fee.
              A payment shows here as soon as Paystack confirms it (usually within a minute).
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Payment history</h2>
        {payments.length === 0 ? (
          <p className="empty-state">No payments yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fee</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{formatDateTime(p.paid_at ?? p.created_at)}</td>
                    <td>
                      {p.invoices.fee_structures?.name}
                      <span className="muted small"> · {p.invoices.terms?.name}</span>
                    </td>
                    <td>{formatNaira(p.amount)}</td>
                    <td className="small">
                      {p.provider === 'manual' ? 'At the school' : 'Paystack'}
                      {p.provider_ref && <div className="muted small reference">{p.provider_ref}</div>}
                    </td>
                    <td>
                      <PaymentStatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {payments.some((p) => p.status === 'pending') && (
          <p className="muted small">
            &quot;Pending&quot; means the payment was started but Paystack hasn&apos;t confirmed it (for example, the
            checkout was closed before paying). You are only charged for payments marked &quot;Successful&quot;.
          </p>
        )}
      </section>
    </>
  )
}

function InvoiceRow({ invoice }) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState(null)
  const balance = Number(invoice.amount_due) - Number(invoice.amount_paid)

  async function pay() {
    setPaying(true)
    setError(null)
    try {
      const result = await callFunction('initialize-payment', { invoice_id: invoice.id })
      // Leave the app for Paystack's checkout; Paystack brings the parent back
      // to /parent/payment-callback afterwards.
      window.location.assign(result.authorization_url)
    } catch (err) {
      setError(err.message)
      setPaying(false)
    }
  }

  return (
    <tr>
      <td>
        {invoice.fee_structures?.name}
        <div className="muted small">
          {invoice.terms?.name}, {invoice.terms?.sessions?.name}
        </div>
      </td>
      <td>{formatNaira(invoice.amount_due)}</td>
      <td>
        {formatNaira(invoice.amount_paid)}
        {balance < 0 && <div className="small late-text">Overpaid by {formatNaira(-balance)}: the school will contact you.</div>}
      </td>
      <td>
        <InvoiceStatusBadge status={invoice.status} />
      </td>
      <td className="small">{invoice.due_date ? formatDate(invoice.due_date) : '—'}</td>
      <td>
        {balance > 0 && (
          <button type="button" onClick={pay} disabled={paying}>
            {paying ? 'Opening Paystack…' : `Pay ${formatNaira(balance)}`}
          </button>
        )}
        {error && (
          <p className="alert alert-error small" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}
